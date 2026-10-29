#!/usr/bin/python3 -I
"""Root-owned entry point for IBobko/history. No caller-selected paths or images."""
import fcntl
import io
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import time
import urllib.request

BASE = Path('/opt/history-archive')
REPO = BASE / 'repository'
CONTENT = BASE / 'content'
CONFIG = Path('/etc/project-deploy/history.compose.yml')
STATE = Path('/etc/project-deploy/history-state.json')
SELF = Path('/usr/local/sbin/history-deploy')
URL = 'https://github.com/IBobko/history.git'
CATEGORIES = ('Russia', 'USA', 'Common')
ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'HOME': '/root', 'LANG': 'C.UTF-8',
       'GIT_TERMINAL_PROMPT': '0', 'GIT_CONFIG_GLOBAL': '/dev/null',
       'GIT_CONFIG_NOSYSTEM': '1', 'DOCKER_BUILDKIT': '1'}
IMAGE = re.compile(r'(?m)^    image: (history-archive:[A-Za-z0-9_.-]+)$')


def trusted(path):
    for item in [path, *path.parents]:
        if item.is_symlink():
            raise RuntimeError(f'Symlink in privileged input: {item}')
        info = item.stat()
        if info.st_uid != 0 or info.st_mode & (stat.S_IWGRP | stat.S_IWOTH):
            raise RuntimeError(f'Privileged input is writable or not root-owned: {item}')


def run(args, *, timeout=1800, capture=False):
    return subprocess.run(args, cwd='/', env=ENV, stdin=subprocess.DEVNULL,
                          check=True, timeout=timeout, capture_output=capture).stdout


def git(*args, capture=False):
    return run(['/usr/bin/git', '-c', 'core.hooksPath=/dev/null', '-C', str(REPO), *args],
               timeout=180, capture=capture)


def atomic_write(path, data):
    temporary = path.with_name(path.name + '.new')
    temporary.write_bytes(data)
    temporary.chmod(0o644)
    os.replace(temporary, path)


def select_release(target):
    temporary = CONTENT / 'current.new'
    temporary.unlink(missing_ok=True)
    temporary.symlink_to(target)
    os.replace(temporary, CONTENT / 'current')


def image_name():
    matches = IMAGE.findall(CONFIG.read_text())
    if len(matches) != 1:
        raise RuntimeError('Expected one fixed history-archive image in protected Compose.')
    return matches[0]


def compose_up():
    run(['/usr/bin/docker', 'compose', '--project-name', 'history-archive',
         '--project-directory', str(BASE / 'web'), '-f', str(CONFIG),
         'up', '-d', '--no-build', '--wait', '--wait-timeout', '120'], timeout=180)


def fetch_revision(revision):
    if not re.fullmatch(r'[0-9a-f]{40}', revision):
        raise RuntimeError('Expected a full lowercase Git commit SHA.')
    if not REPO.exists():
        run(['/usr/bin/git', 'init', str(REPO)], timeout=30)
    trusted(REPO)
    trusted(REPO / '.git')
    git('fetch', '--no-tags', '--depth=1', URL, 'refs/heads/main')
    head = git('rev-parse', 'FETCH_HEAD', capture=True).decode().strip()
    if revision != head:
        raise RuntimeError('Requested revision is no longer main. Re-run the workflow on main.')
    return head


def export_content(revision):
    destination = CONTENT / 'releases' / revision
    if destination.exists():
        trusted(destination)
        return destination
    staging = destination.with_name(revision + '.new')
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(mode=0o755)
    archive = git('archive', '--format=tar', revision, '--', *CATEGORIES, capture=True)
    try:
        with tarfile.open(fileobj=io.BytesIO(archive)) as source:
            for member in source:
                if member.isdir() and member.name.rstrip('/') in CATEGORIES:
                    continue
                # Only regular annual Markdown files; never extract links or arbitrary paths.
                if not re.fullmatch(r'(Russia|USA|Common)/\d{1,4}\.md', member.name):
                    if member.isfile() and member.name.endswith('.bak'):
                        continue
                    raise RuntimeError(f'Unexpected archive entry: {member.name}')
                if not member.isfile() or member.size > 16 * 1024 * 1024:
                    raise RuntimeError(f'Invalid annual file: {member.name}')
                target = staging / member.name
                target.parent.mkdir(mode=0o755, exist_ok=True)
                target.write_bytes(source.extractfile(member).read())
                target.chmod(0o644)
        for category in CATEGORIES:
            if not list((staging / category).glob('*.md')):
                raise RuntimeError(f'Empty category: {category}')
        os.replace(staging, destination)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    return destination


def candidate_health(image, release):
    name = 'history-candidate-' + str(os.getpid())
    run(['/usr/bin/docker', 'run', '--detach', '--rm', '--name', name,
         '--network', 'none', '--memory', '768m', '--cpus', '1.5', '--pids-limit', '256',
         '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
         '--mount', f'type=bind,src={release},dst=/archive,readonly',
         '--env', 'ARCHIVE_ROOT=/archive', image], timeout=30)
    script = "fetch('http://127.0.0.1:3000/api/health').then(async r=>{if(!r.ok)process.exit(1);console.log(JSON.stringify(await r.json()))}).catch(()=>process.exit(1))"
    try:
        for _ in range(45):
            try:
                data = json.loads(run(['/usr/bin/docker', 'exec', name, 'node', '-e', script],
                                      timeout=8, capture=True))
                if data.get('status') == 'ok' and data.get('events', 0) > 0:
                    return data
            except (subprocess.SubprocessError, ValueError):
                pass
            time.sleep(2)
        raise RuntimeError('Candidate failed its archive health check.')
    finally:
        try:
            run(['/usr/bin/docker', 'rm', '--force', name], timeout=30)
        except subprocess.CalledProcessError:
            # --rm may already have removed a candidate which failed to start.
            pass


def live_health(expected):
    for _ in range(20):
        try:
            with urllib.request.urlopen('http://127.0.0.1:3100/api/health', timeout=5) as response:
                actual = json.load(response)
            with urllib.request.urlopen('http://127.0.0.1:3100/', timeout=10) as response:
                if response.status != 200:
                    raise RuntimeError('Homepage failed.')
            if all(actual.get(key) == expected.get(key) for key in ('status', 'files', 'events')):
                return
        except (OSError, ValueError, RuntimeError):
            pass
        time.sleep(2)
    raise RuntimeError('Published site failed its health check.')


def publish(release, expected, image=None):
    previous_target = os.readlink(CONTENT / 'current')
    previous_config = CONFIG.read_bytes()
    try:
        select_release(Path('releases') / release.name)
        if image is not None:
            text, count = IMAGE.subn('    image: ' + image, previous_config.decode())
            if count != 1:
                raise RuntimeError('Could not replace fixed image.')
            atomic_write(CONFIG, text.encode())
            compose_up()
        live_health(expected)
    except BaseException:
        print('Publication failed; restoring previous content and image.', flush=True)
        select_release(previous_target)
        atomic_write(CONFIG, previous_config)
        if image is not None:
            compose_up()
        # An unhealthy rollback must also be reported.
        rollback_expected = candidate_health(image_name(), (CONTENT / 'current').resolve())
        live_health(rollback_expected)
        raise


def prune_content():
    active = (CONTENT / 'current').resolve()
    releases = sorted((CONTENT / 'releases').iterdir(), key=lambda p: p.stat().st_mtime, reverse=True)
    for release in releases[5:]:
        if release != active and release.is_dir() and not release.is_symlink():
            shutil.rmtree(release)


def prune_images(previous_image):
    tags = run(['/usr/bin/docker', 'image', 'ls', 'history-archive', '--format', '{{.Repository}}:{{.Tag}}'],
               capture=True).decode().splitlines()
    releases = [tag for tag in tags if re.fullmatch(r'history-archive:[0-9a-f]{40}', tag)]
    keep = {image_name(), previous_image, *releases[:5]}
    for tag in releases:
        if tag not in keep:
            run(['/usr/bin/docker', 'image', 'rm', tag], timeout=60)


def deploy(action, revision):
    revision = fetch_revision(revision)
    release = export_content(revision)
    image = image_name()
    previous_image = image
    if action == 'code':
        git('checkout', '--force', '--detach', revision)
        trusted(REPO / 'web')
        trusted(REPO / 'web' / 'Dockerfile')
        image = 'history-archive:' + revision
        run(['/usr/bin/docker', 'build', '--pull', '--tag', image, str(REPO / 'web')])
    expected = candidate_health(image, release)
    previous = json.loads(STATE.read_text()) if STATE.exists() else {}
    publish(release, expected, image if action == 'code' else None)
    state = {**previous, 'content': revision, 'previous': previous, 'published_at': int(time.time())}
    state['previous'] = {key: value for key, value in previous.items() if key != 'previous'}
    if action == 'code':
        state['code'] = revision
    atomic_write(STATE, (json.dumps(state, indent=2) + '\n').encode())
    prune_content()
    if action == 'code':
        prune_images(previous_image)
    print(json.dumps({'action': action, 'revision': revision, 'image': image, **expected}), flush=True)


def main():
    if os.geteuid() != 0 or len(sys.argv) != 2 or sys.argv[1] not in {'check', 'content', 'code'}:
        raise RuntimeError('Use exactly check, content or code as root through the fixed sudo policy.')
    os.umask(0o022)
    os.environ.clear()
    os.environ.update(ENV)
    for path in (SELF, BASE, CONTENT, CONTENT / 'releases', CONFIG):
        trusted(path)
    with open('/run/lock/project-deploy/history.lock', 'a') as lock:
        deadline = time.monotonic() + 900
        while True:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise RuntimeError('Another publication still holds the archive lock.')
                time.sleep(0.5)
        if sys.argv[1] == 'check':
            expected = candidate_health(image_name(), (CONTENT / 'current').resolve())
            live_health(expected)
            print(json.dumps({'image': image_name(), 'release': os.readlink(CONTENT / 'current'), **expected}))
        else:
            deploy(sys.argv[1], sys.stdin.readline(128).strip())


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, ValueError, subprocess.SubprocessError, tarfile.TarError) as error:
        print(f'Archive deployment failed: {error}', file=sys.stderr)
        sys.exit(1)
