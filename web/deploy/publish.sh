#!/usr/bin/env bash
set -euo pipefail

action="${1:-}"
case "$action" in check|content|code) ;; *) echo 'Expected check, content or code' >&2; exit 2 ;; esac
[[ "${GITHUB_SHA:-}" =~ ^[0-9a-f]{40}$ ]]
test -n "${DEPLOY_SSH_KEY:-}"

ssh_directory=$(mktemp -d)
trap 'rm -rf -- "$ssh_directory"' EXIT
chmod 700 "$ssh_directory"
printf '%s\n' "$DEPLOY_SSH_KEY" > "$ssh_directory/key"
chmod 600 "$ssh_directory/key"
unset DEPLOY_SSH_KEY
# Pinned against the host key already verified by the administrator.
printf '%s\n' '91.99.238.7 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIF2UqCdpd2e1yICB0cqNijvZplphlywLC3Oj+RF9o/zw' > "$ssh_directory/known_hosts"
ssh_options=(-T -F /dev/null -i "$ssh_directory/key" -o BatchMode=yes -o IdentitiesOnly=yes
  -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$ssh_directory/known_hosts"
  -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=8)

ssh "${ssh_options[@]}" deploy@91.99.238.7 \
  'test "$(id -un)" = deploy && test ! -w /var/run/docker.sock && test ! -w /etc/project-deploy'
printf '%s\n' "$GITHUB_SHA" | ssh "${ssh_options[@]}" deploy@91.99.238.7 \
  sudo -n /usr/local/sbin/history-deploy "$action"

curl --fail --silent --show-error --retry 8 --retry-all-errors --retry-delay 3 \
  --connect-timeout 10 --max-time 20 https://todo100.ru/api/health
curl --fail --silent --show-error --output /dev/null \
  --connect-timeout 10 --max-time 20 https://todo100.ru/
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  printf 'Archive action **%s** succeeded for `%s`. Site: https://todo100.ru\n' "$action" "$GITHUB_SHA" >> "$GITHUB_STEP_SUMMARY"
fi
