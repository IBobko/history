import importlib.util
import io
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('history_deploy', Path(__file__).parents[1] / 'history-deploy.py')
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class PublicationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.content = self.root / 'content'
        (self.content / 'releases' / 'old').mkdir(parents=True)
        (self.content / 'releases' / 'new').mkdir()
        (self.content / 'current').symlink_to('releases/old')
        self.config = self.root / 'compose.yml'
        self.config.write_text('services:\n  web:\n    image: history-archive:old\n')
        self.patches = [patch.object(deploy, 'CONTENT', self.content), patch.object(deploy, 'CONFIG', self.config)]
        for item in self.patches:
            item.start()

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.temporary.cleanup()

    def test_content_publication_is_atomic_and_does_not_restart_application(self):
        with patch.object(deploy, 'live_health') as health, patch.object(deploy, 'compose_up') as up:
            deploy.publish(self.content / 'releases/new', {'events': 10})
        self.assertEqual(os.readlink(self.content / 'current'), 'releases/new')
        self.assertIn('history-archive:old', self.config.read_text())
        health.assert_called_once()
        up.assert_not_called()

    def test_failed_content_health_restores_previous_release(self):
        with patch.object(deploy, 'live_health', side_effect=[RuntimeError('bad data'), None]), \
             patch.object(deploy, 'candidate_health', return_value={'events': 9}), \
             patch.object(deploy, 'compose_up') as up:
            with self.assertRaisesRegex(RuntimeError, 'bad data'):
                deploy.publish(self.content / 'releases/new', {'events': 10})
        self.assertEqual(os.readlink(self.content / 'current'), 'releases/old')
        up.assert_not_called()

    def test_failed_code_start_restores_both_image_and_content(self):
        with patch.object(deploy, 'compose_up', side_effect=[RuntimeError('bad image'), None]) as up, \
             patch.object(deploy, 'candidate_health', return_value={'events': 9}), \
             patch.object(deploy, 'live_health'):
            with self.assertRaisesRegex(RuntimeError, 'bad image'):
                deploy.publish(self.content / 'releases/new', {'events': 10}, 'history-archive:new')
        self.assertEqual(os.readlink(self.content / 'current'), 'releases/old')
        self.assertIn('history-archive:old', self.config.read_text())
        self.assertEqual(up.call_count, 2)

    def test_rejects_invalid_and_stale_revisions(self):
        with self.assertRaisesRegex(RuntimeError, 'full lowercase'):
            deploy.fetch_revision('main; arbitrary command')
        with patch.object(deploy, 'REPO', self.root), patch.object(deploy, 'trusted'), \
             patch.object(deploy, 'git', side_effect=[None, b'b' * 40 + b'\n']):
            with self.assertRaisesRegex(RuntimeError, 'no longer main'):
                deploy.fetch_revision('a' * 40)

    def test_rejects_archive_traversal_and_symlinks_without_touching_active_release(self):
        for name, kind in [('../escape', tarfile.REGTYPE), ('Russia/1991.md', tarfile.SYMTYPE)]:
            archive = io.BytesIO()
            with tarfile.open(fileobj=archive, mode='w') as output:
                member = tarfile.TarInfo(name)
                member.type = kind
                member.linkname = '/etc/passwd' if kind == tarfile.SYMTYPE else ''
                output.addfile(member)
            with patch.object(deploy, 'git', return_value=archive.getvalue()):
                with self.assertRaises(RuntimeError):
                    deploy.export_content('a' * 40)
            self.assertFalse((self.content / 'releases' / ('a' * 40 + '.new')).exists())
            self.assertEqual(os.readlink(self.content / 'current'), 'releases/old')


if __name__ == '__main__':
    unittest.main()
