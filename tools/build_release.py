"""Build an allowlisted ZIP without reading the live site directory."""
from pathlib import Path, PurePosixPath
import argparse, hashlib, json, zipfile
from build_snapshot import snapshot_bytes

ROOT = Path(__file__).resolve().parents[1]

def build(output):
    allowed = json.loads((ROOT / 'release-files.json').read_text(encoding='utf-8'))
    payload = {}
    for name in allowed:
        p = PurePosixPath(name)
        if p.is_absolute() or '..' in p.parts or p.parts[0] in ['site', 'dist', '.git', '.venv', 'wheels']:
            raise ValueError('Invalid release path: ' + name)
        source = (ROOT / name).resolve()
        if not source.is_relative_to(ROOT) or not source.is_file():
            raise ValueError('Missing or external release file: ' + name)
        raw = source.read_bytes()
        if p.parts[0] != 'third_party' and p.suffix not in ['.jpg', '.png', '.gz']:
            raw = raw.replace(b'\r\n', b'\n')
            if p.suffix == '.cmd':
                raw = raw.replace(b'\n', b'\r\n')
        payload[name] = raw
    lock = json.loads(payload['dependencies.lock.json'])
    for row in lock['wheels']:
        raw = (ROOT / 'wheels' / row['filename']).read_bytes()
        if hashlib.sha256(raw).hexdigest() != row['sha256']:
            raise ValueError('Wheel checksum mismatch: ' + row['filename'])
        payload['wheels/' + row['filename']] = raw
    for row in lock['sources']:
        if hashlib.sha256(payload['third_party/sources/' + row['filename']]).hexdigest() != row['sha256']:
            raise ValueError('Source archive checksum mismatch')
    payload['program/static/snapshot.js'] = snapshot_bytes()
    version = payload['VERSION.txt'].decode().strip()
    manifest = {'version': version, 'files': [{'path': p, 'bytes': len(v), 'sha256': hashlib.sha256(v).hexdigest()} for p, v in sorted(payload.items())]}
    payload['MANIFEST.json'] = json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2).encode('utf-8')
    output.mkdir(parents=True, exist_ok=True)
    path = output / f'ResearchWorkbench-{version}-windows-x64.zip'
    with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for name, raw in sorted(payload.items()):
            info = zipfile.ZipInfo('ResearchWorkbench/' + name, date_time=(2026, 11, 20, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            z.writestr(info, raw, compresslevel=9)
    checksum = hashlib.sha256(path.read_bytes()).hexdigest()
    path.with_suffix('.zip.sha256').write_text(checksum + '  ' + path.name + '\n', encoding='ascii')
    print(json.dumps({'file': str(path), 'sha256': checksum, 'files': len(payload)}, indent=2))
    return path

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=ROOT / 'dist')
    build(parser.parse_args().output.resolve())
