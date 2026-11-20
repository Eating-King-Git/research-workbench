"""Exercise the actual ZIP, with fresh environments and a separate empty record store."""
from pathlib import Path, PurePosixPath
from tempfile import TemporaryDirectory
import argparse, hashlib, http.client, json, os, socket, subprocess, sys, time, urllib.error, urllib.parse, urllib.request, zipfile

def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]

def request(port, path, body=None, method=None, token=None):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['X-Workbench-Token'] = token
    req = urllib.request.Request(f'http://127.0.0.1:{port}/api' + path,
            data=json.dumps(body, ensure_ascii=False).encode() if body is not None else None,
            headers=headers, method=method)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(req, timeout=4) as response:
        return json.load(response)

def entry(root, action, port):
    env = {**os.environ, 'WORKBENCH_NO_PAUSE': '1', 'WORKBENCH_NO_BROWSER': '1',
           'WORKBENCH_PORT': str(port), 'PYTHONUTF8': '1'}
    labels = {'install': '首次安装', 'start': '启动工作台', 'stop': '停止工作台'}
    result = subprocess.run(['cmd', '/d', '/c', str(root / (labels[action] + '.cmd'))],
                            env=env, capture_output=True, timeout=180)
    if result.returncode:
        raise RuntimeError(result.stdout.decode(errors='replace') + result.stderr.decode(errors='replace'))

def wait_stopped(port):
    for _ in range(40):
        try:
            request(port, '/health')
        except (urllib.error.URLError, ConnectionError, http.client.RemoteDisconnected, TimeoutError):
            return
        time.sleep(.15)
    raise AssertionError('Service failed to stop')

def verify(archive):
    if sys.platform != 'win32':
        raise RuntimeError('Release smoke test requires Windows')
    archive = archive.resolve()
    with zipfile.ZipFile(archive) as z:
        assert z.testzip() is None
        manifest = json.loads(z.read('ResearchWorkbench/MANIFEST.json'))
        expected = {'ResearchWorkbench/' + r['path'] for r in manifest['files']} | {'ResearchWorkbench/MANIFEST.json'}
        assert set(z.namelist()) == expected
        for name in z.namelist():
            p = PurePosixPath(name)
            assert not p.is_absolute() and '..' not in p.parts and '__pycache__' not in p.parts
            assert not any(x in p.parts for x in ['07_个人记录', '.venv', '.git'])
        for row in manifest['files']:
            raw = z.read('ResearchWorkbench/' + row['path'])
            assert len(raw) == row['bytes'] and hashlib.sha256(raw).hexdigest() == row['sha256']
        with TemporaryDirectory(prefix='workbench-验收 ') as tmp:
            a = Path(tmp) / '解压 A/ResearchWorkbench'
            b = Path(tmp) / '空库 B/ResearchWorkbench'
            z.extractall(a.parent)
            z.extractall(b.parent)
            ports = [free_port(), free_port()]
            while ports[0] == ports[1]:
                ports[1] = free_port()
            running = []
            try:
                for root, port in zip([a, b], ports):
                    entry(root, 'install', port)
                    entry(root, 'start', port)
                    running.append((root, port))
                    boot = request(port, '/bootstrap')
                    assert boot['records'] == [] and len(boot['papers']) == 1
                p, q = ports
                boot = request(p, '/bootstrap'); token = boot['token']; paper = boot['papers'][0]
                doc = request(p, '/docs/' + paper['doc_id'])
                note = request(p, '/records/reading/' + paper['id'], {'data': {'status': '在读',
                       'understanding': '发布验收：公平比较', 'questions': '相同输入为何重要？'},
                       'expected_revision': 0, 'expected_hash': ''}, 'PUT', token)
                quote = '比较两种方法时，应使用相同的输入和评价标准。'
                annotation = {'doc_id': doc['id'], 'doc_title': '', 'doc_path': '', 'paper_id': '',
                    'quote': quote, 'prefix': '', 'suffix': '', 'start': 0, 'end': len(quote),
                    'section_id': doc['headings'][2]['id'], 'section_title': '公平比较',
                    'source_hash': doc['source_hash'], 'question': '发布验收：解释这一句',
                    'answer': '', 'understanding': '', 'status': '待讨论', 'archived': False}
                ann = request(p, '/annotations/ann-release', {'data': annotation, 'expected_revision': 0,
                              'expected_hash': ''}, 'PUT', token)
                assert request(p, '/search?q=' + urllib.parse.quote('发布验收'))['total'] >= 2
                entry(a, 'stop', p); wait_stopped(p); entry(a, 'start', p)
                rows = request(p, '/bootstrap')['records']
                assert len(rows) == 2
                bundle = request(p, '/export')
                empty = request(q, '/bootstrap'); assert empty['records'] == []
                preview = request(q, '/import/preview', bundle, token=empty['token'])
                assert all(r['state'] == '新增' for r in preview['rows'])
                result = request(q, '/import/apply', {'preview_id': preview['preview_id'],
                        'selected': [r['key'] for r in preview['rows']]}, token=empty['token'])
                assert result['imported'] == 2
                assert list((b / 'site/07_个人记录/导入前备份').glob('*.json'))
                entry(b, 'stop', q); wait_stopped(q); entry(b, 'start', q)
                for record in [note, ann]:
                    assert request(q, '/records/' + record['kind'] + '/' + record['id'])['data'] == record['data']
                print('PASS: manifest, clean ZIP, two fresh offline installs, start, save, search, restart, JSON export, empty-store restore, backup, restored restart.')
            finally:
                for root, port in running:
                    entry(root, 'stop', port)
                    wait_stopped(port)
    return {'status': 'passed', 'version': manifest['version'], 'files': len(expected),
            'zip_sha256': hashlib.sha256(archive.read_bytes()).hexdigest(), 'python': sys.version.split()[0]}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('archive', type=Path)
    args = parser.parse_args()
    result = verify(args.archive)
    args.archive.with_suffix('.validation.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result, indent=2))
