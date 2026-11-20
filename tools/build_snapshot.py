"""Generate a deterministic, fictional-data-only static snapshot."""
from pathlib import Path
import json, sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'program'))
from catalog import Catalog

class EmptyStore:
    def all(self):
        return []

def snapshot_bytes():
    snapshot = Catalog(ROOT / 'examples/site', EmptyStore()).snapshot()
    for doc in snapshot['docs'].values():
        doc['updated'] = '2026-11-20'
    for chunk in snapshot['chunks']:
        chunk['updated'] = '2026-11-20'
    snapshot['indexed_at'] = '2026-11-20 00:00:00'
    snapshot['version'] = (ROOT / 'VERSION.txt').read_text(encoding='utf-8').strip()
    return ('window.WORKBENCH_SNAPSHOT=' + json.dumps(snapshot, ensure_ascii=False, sort_keys=True) + ';\n').encode('utf-8')

if __name__ == '__main__':
    (ROOT / 'program/static/snapshot.js').write_bytes(snapshot_bytes())
    print('Fictional example snapshot generated.')
