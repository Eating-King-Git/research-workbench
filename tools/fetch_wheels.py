"""Fetch only explicitly locked official PyPI files; never resolve new versions."""
from pathlib import Path
from urllib.parse import urlsplit
import hashlib, json, urllib.request

ROOT = Path(__file__).resolve().parents[1]

def fetch(row, target):
    if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() == row['sha256']:
        return
    if urlsplit(row['url']).scheme != 'https' or urlsplit(row['url']).hostname != 'files.pythonhosted.org':
        raise ValueError('Dependency URL must use official PyPI file hosting')
    if Path(row['filename']).name != row['filename'] or row['bytes'] > 10_000_000:
        raise ValueError('Invalid dependency file')
    with urllib.request.urlopen(row['url'], timeout=45) as response:
        raw = response.read(row['bytes'] + 1)
    if len(raw) != row['bytes'] or hashlib.sha256(raw).hexdigest() != row['sha256']:
        raise ValueError('Dependency size or SHA256 mismatch: ' + row['filename'])
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(raw)

def main():
    lock = json.loads((ROOT / 'dependencies.lock.json').read_text(encoding='utf-8'))
    for row in lock['wheels']:
        fetch(row, ROOT / 'wheels' / row['filename'])
        print('Verified:', row['filename'])
    for row in lock['sources']:
        fetch(row, ROOT / 'third_party/sources' / row['filename'])
    print('Locked offline dependencies ready.')

if __name__ == '__main__':
    main()
