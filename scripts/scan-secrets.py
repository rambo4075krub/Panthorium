"""Scan tracked source/history; raw scanner findings stay in process memory."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
VERSION = '8.30.1'
ARCHIVE_SHA256 = '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb'
FORBIDDEN = re.compile(r'(^|/)(?:\.env(?:\..+)?|\.claude/settings\.local\.json|\.codex/auth\.json|local-profile\.(?:json|dpapi|lock)|LOCAL_LOGIN\.txt|trial-api-key\.txt|id_rsa|id_ed25519|panthorium-state(?:/.*)?)$|\.(?:dpapi|key|p12|pfx|jks|keystore)$|(?:^|/)[^/]*-private\.pem$', re.I)

def blocked_path(name):
    return bool(FORBIDDEN.search(name)) and Path(name).name != '.env.example'

def approved(finding, exceptions):
    digest = hashlib.sha256(finding.get('Secret', '').encode()).hexdigest()
    return any(item['path'] == finding['File'] and item['rule'] == finding['RuleID'] and
               item['sha256'] == digest for item in exceptions)

def safe_finding(finding):
    return {key: finding.get(key) for key in ('RuleID', 'File', 'StartLine', 'Commit')}

def run_scan(binary, source, config, ignore_file, history=False):
    args = [str(binary), 'git' if history else 'dir', str(source), '--config', str(config),
            '--gitleaks-ignore-path', str(ignore_file), '--ignore-gitleaks-allow',
            '--redact=0', '--report-format', 'json', '--report-path', '-',
            '--no-banner', '--no-color', '--log-level', 'error', '--max-decode-depth', '5', '--max-archive-depth', '3']
    if history:
        args += ['--log-opts=--all --full-history --diff-merges=first-parent']
    # Never inherit stdout/stderr: even failures can contain an offending value.
    result = subprocess.run(args, cwd=source, capture_output=True, text=True, timeout=600)
    if result.returncode not in (0, 1):
        raise RuntimeError('secret_scanner_failed')
    try:
        findings = json.loads(result.stdout)
        if not isinstance(findings, list): raise ValueError()
        for finding in findings:
            name = finding['File'].replace('\\', '/')
            prefix = str(source).replace('\\', '/').rstrip('/') + '/'
            if name.startswith(prefix): name = name[len(prefix):]
            finding['File'] = name.removeprefix('./')
        return findings
    except (ValueError, KeyError, TypeError):
        raise RuntimeError('secret_scanner_report_invalid') from None

def download_binary(directory):
    if not sys.platform.startswith('linux') or os.uname().machine != 'x86_64':
        raise RuntimeError('automatic_scanner_install_requires_linux_x64')
    name = f'gitleaks_{VERSION}_linux_x64.tar.gz'
    url = f'https://github.com/gitleaks/gitleaks/releases/download/v{VERSION}/{name}'
    data = urllib.request.urlopen(url, timeout=60).read()
    if hashlib.sha256(data).hexdigest() != ARCHIVE_SHA256:
        raise RuntimeError('secret_scanner_checksum_mismatch')
    archive = directory / name
    archive.write_bytes(data)
    with tarfile.open(archive) as bundle:
        entry = bundle.getmember('gitleaks')
        if not entry.isfile(): raise RuntimeError('secret_scanner_archive_invalid')
        binary = directory / 'gitleaks'
        binary.write_bytes(bundle.extractfile(entry).read())
    binary.chmod(0o700)
    return binary

def verify_detector(binary, temporary, config, ignore_file):
    fixtures = temporary/'detector-check'; (fixtures/'.claude').mkdir(parents=True)
    # Synthetic values exist only in temporary files and captured subprocess memory.
    github_token = 'ghp_' + secrets.token_hex(18)
    ordinary_password = 'simple' + 'pass123'
    (fixtures/'fixture.txt').write_text('GITHUB_TOKEN=' + github_token)
    (fixtures/'.claude/settings.json').write_text(json.dumps({'permissions':{'allow':['Bash(PGPASSWORD='+ordinary_password+' psql)']}}))
    findings = run_scan(binary, fixtures, config, ignore_file)
    rules = {item['RuleID'] for item in findings}
    if 'github-pat' not in rules or 'agent-command-credential' not in rules:
        raise RuntimeError('secret_detector_regression_failed')

def scan_repository(repo, binary, temporary, history=False):
    config = repo / '.gitleaks.toml'
    exceptions = json.loads((repo/'scripts/secret-scan-allowlist.json').read_text())
    names = subprocess.check_output(['git', '-C', str(repo), 'ls-files', '-z']).decode().split('\0')
    names = [name for name in names if name]
    blocked = [name for name in names if blocked_path(name)]
    source = temporary/'tracked-source'; source.mkdir()
    for name in names:
        src = repo/name
        if src.is_symlink(): raise RuntimeError('tracked_symlink_requires_secret_review')
        if not src.is_file(): continue
        target = source/name; target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, target)
    empty_ignore = temporary/'empty.ignore'; empty_ignore.write_text('')
    verify_detector(binary, temporary, config, empty_ignore)
    findings = run_scan(binary, source, config, empty_ignore)
    if history: findings += run_scan(binary, repo, config, empty_ignore, history=True)
    unexpected = [safe_finding(item) for item in findings if not approved(item, exceptions)]
    return {'tracked_files':len(names), 'history_scanned':history,
            'reviewed_occurrences':len(findings)-len(unexpected),
            'blocked_paths':blocked, 'findings':unexpected,
            'passed':not blocked and not unexpected}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--gitleaks', help='Path to an installed Gitleaks binary')
    parser.add_argument('--install', action='store_true', help='Download the pinned, checksum-verified Linux scanner')
    parser.add_argument('--history', action='store_true')
    args = parser.parse_args()
    try:
        with tempfile.TemporaryDirectory(prefix='panthorium-secret-scan-') as temp:
            temporary = Path(temp)
            binary = Path(args.gitleaks).resolve() if args.gitleaks else download_binary(temporary) if args.install else Path(shutil.which('gitleaks') or '')
            if not binary.is_file(): raise RuntimeError('secret_scanner_not_installed')
            result = scan_repository(ROOT, binary, temporary, args.history)
            print(json.dumps(result, ensure_ascii=False))
            return 0 if result['passed'] else 1
    except Exception:
        # No raw subprocess output, exception payload, Match or Secret fields.
        print('Secret scan could not complete; the check fails closed.', file=sys.stderr)
        return 2

if __name__ == '__main__':
    raise SystemExit(main())
