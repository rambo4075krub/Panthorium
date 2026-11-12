"""Download only pinned, checksummed 4B assets into candidates; never activate them."""
import argparse, json, shutil, urllib.request
from pathlib import Path
from model_profile import PROFILE, ROOT, verify_model

def prepare(root):
    directory = root / 'models' / 'candidates'
    directory.mkdir(parents=True, exist_ok=True)
    if directory.is_symlink() or directory.parent.is_symlink(): raise RuntimeError('Linked model directory')
    assets = [PROFILE, PROFILE['projector']]
    if shutil.disk_usage(directory).free < sum(a['bytes'] for a in assets) + 2 * 1024**3:
        raise RuntimeError('Need at least 5.5 GB free disk for staging')
    results = []
    for asset in assets:
        target = directory / asset['filename']
        if target.exists():
            verify_model(target, asset)
        else:
            partial = target.with_suffix('.gguf.part')
            url = 'https://huggingface.co/{}/resolve/{}/{}'.format(PROFILE['repository'], PROFILE['revision'], asset.get('remoteFilename',asset['filename']))
            # Exclusive create: do not follow links or overwrite an interrupted download.
            with partial.open('xb') as out:
                try:
                    with urllib.request.urlopen(url, timeout=120) as response:
                        written = 0
                        while chunk := response.read(8 * 1024**2):
                            written += len(chunk)
                            if written > asset['bytes']: raise ValueError('Download exceeds pinned size')
                            out.write(chunk)
                    out.flush()
                except BaseException:
                    out.close(); partial.unlink(missing_ok=True); raise
            try:
                verify_model(partial, asset)
                partial.replace(target)
            except BaseException:
                partial.unlink(missing_ok=True); raise
            target.with_suffix('.gguf.source.json').write_text(json.dumps({'repository':PROFILE['repository'],'revision':PROFILE['revision'],'sha256':asset['sha256'],'bytes':asset['bytes']}),encoding='utf-8')
        results.append({'file':target.name,'verified':True})
    return results

if __name__ == '__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,default=ROOT)
    print(json.dumps({'staged':prepare(parser.parse_args().root),'activated':False}))
