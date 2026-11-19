#!/usr/bin/env python3
"""Apply only checksum-pinned upstream changes; reject fuzzy/partial backports."""
import hashlib
import json
import pathlib
import subprocess
import sys

directory = pathlib.Path(__file__).resolve().parent
source = pathlib.Path(sys.argv[1]).resolve()
lock = json.loads((directory / 'openssl-source.lock.json').read_text())
for patch in [lock['distributionPatch'], *lock['patches']]:
    filename = directory / patch['file']
    assert hashlib.sha256(filename.read_bytes()).hexdigest() == patch['sha256'], 'Patch checksum differs'
    subprocess.run(['patch', '--batch', '--forward', '--fuzz=0', '-p1', '-i', str(filename)], cwd=source, check=True)
    for file in patch.get('patchedFiles', []):
        assert hashlib.sha256((source / file['path']).read_bytes()).hexdigest() == file['sha256'], 'Patched source differs: ' + file['path']
print('Verified every upstream OpenSSL patch and patched source digest')
