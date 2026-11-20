from pathlib import Path
from tempfile import TemporaryDirectory
import shutil, sys, unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'program'))
from fastapi.testclient import TestClient
from app import create_app

class ApiTests(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.site = Path(self.tmp.name) / '资料 副本'
        shutil.copytree(ROOT / 'examples/site', self.site)
        self.app = create_app(self.site, test_mode=True)
        self.client = TestClient(self.app)
        self.boot = self.client.get('/api/bootstrap').json()
        self.headers = {'X-Workbench-Token': self.boot['token'], 'Origin': 'http://testserver'}
        self.paper = self.boot['papers'][0]
        self.doc = self.client.get('/api/docs/' + self.paper['doc_id']).json()

    def tearDown(self):
        self.client.close()
        self.tmp.cleanup()

    def save_note(self):
        data = {'status': '在读', 'questions': '测试疑问：如何公平比较？', 'understanding': '控制输入与评价标准。'}
        body = {'data': data, 'expected_revision': 0, 'expected_hash': ''}
        path = '/api/records/reading/' + self.paper['id']
        saved = self.client.put(path, json=body, headers=self.headers)
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(self.client.put(path, json=body, headers=self.headers).status_code, 409)
        return saved.json()

    def save_annotation(self):
        quote = '比较两种方法时，应使用相同的输入和评价标准。'
        data = {'doc_id': self.doc['id'], 'doc_title': '', 'doc_path': '', 'paper_id': '',
                'quote': quote, 'prefix': '', 'suffix': '', 'start': 0, 'end': len(quote),
                'section_id': self.doc['headings'][2]['id'], 'section_title': '公平比较',
                'source_hash': self.doc['source_hash'], 'question': '测试批注：为什么保持输入相同？',
                'answer': '', 'understanding': '', 'status': '待讨论', 'archived': False}
        body = {'data': data, 'expected_revision': 0, 'expected_hash': ''}
        response = self.client.put('/api/annotations/ann-test', json=body, headers=self.headers)
        self.assertEqual(response.status_code, 200)
        return response.json()

    def test_fictional_catalog_and_search(self):
        self.assertEqual(self.boot['records'], [])
        self.assertEqual(len(self.boot['papers']), 1)
        self.assertEqual(self.boot['document_count'], 3)
        result = self.client.get('/api/search', params={'q': '评价标准'}).json()
        self.assertTrue(any(x['paper_id'] == self.paper['id'] for x in result['results']))
        self.assertEqual(self.client.get('/api/search?q=demo&scope=archive').json()['total'], 0)

    def test_save_conflict_search_and_discussion(self):
        self.save_note()
        ann = self.save_annotation()
        self.assertEqual(ann['data']['doc_path'], self.doc['path'])
        self.assertEqual(ann['data']['paper_id'], self.paper['id'])
        result = self.client.get('/api/search', params={'q': '测试批注'}).json()
        self.assertTrue(any(x['kind'] == '原文批注' for x in result['results']))
        packet = self.client.get('/api/discussion/' + self.doc['id'], params={'ids': 'ann-test'}).json()
        self.assertIn('为什么保持输入相同', packet['text'])
        self.assertEqual(self.client.get('/api/annotations').json()[0]['data']['status'], '待讨论')

    def test_export_restore_in_independent_empty_store(self):
        note = self.save_note()
        ann = self.save_annotation()
        exported = self.client.get('/api/export')
        self.assertIn('attachment', exported.headers['content-disposition'])
        with TestClient(create_app(self.site, Path(self.tmp.name) / '恢复 空库', True)) as target:
            boot = target.get('/api/bootstrap').json()
            self.assertEqual(boot['records'], [])
            headers = {'X-Workbench-Token': boot['token']}
            preview = target.post('/api/import/preview', json=exported.json(), headers=headers).json()
            self.assertTrue(all(row['state'] == '新增' for row in preview['rows']))
            result = target.post('/api/import/apply', json={'preview_id': preview['preview_id'],
                    'selected': [r['key'] for r in preview['rows']]}, headers=headers)
            self.assertEqual(result.status_code, 200)
            self.assertEqual(result.json()['imported'], 2)
            for record in [note, ann]:
                restored = target.get('/api/records/' + record['kind'] + '/' + record['id']).json()
                self.assertEqual(restored['data'], record['data'])
            self.assertTrue(list((Path(self.tmp.name) / '恢复 空库/导入前备份').glob('*.json')))

    def test_local_origin_token_and_private_files(self):
        path = '/api/records/reading/' + self.paper['id']
        body = {'data': {'status': '在读'}, 'expected_revision': 0, 'expected_hash': ''}
        self.assertEqual(self.client.put(path, json=body).status_code, 403)
        self.assertEqual(self.client.put(path, json=body, headers={**self.headers, 'Origin': 'https://example.org'}).status_code, 403)
        self.assertEqual(self.client.get('/api/health', headers={'Host': 'example.org'}).status_code, 403)
        private = self.site / '07_个人记录/private.txt'
        private.write_text('test private', encoding='utf-8')
        self.assertEqual(self.client.get('/site/07_个人记录/private.txt').status_code, 403)

    def test_reject_stale_annotation_source(self):
        ann = self.save_annotation()
        data = {**ann['data'], 'source_hash': '0' * 64}
        response = self.client.put('/api/annotations/ann-stale', json={'data': data,
                'expected_revision': 0, 'expected_hash': ''}, headers=self.headers)
        self.assertEqual(response.status_code, 400)

    def test_new_paper_duplicate_and_search(self):
        paper = {'title': '虚构新增条目', 'url': 'https://example.org/fictional-paper', 'version': 'v1', 'directions': []}
        self.assertEqual(self.client.post('/api/papers', json=paper, headers=self.headers).status_code, 200)
        self.assertEqual(self.client.post('/api/papers', json=paper, headers=self.headers).status_code, 409)
        self.assertGreater(self.client.get('/api/search', params={'q': '虚构新增条目'}).json()['total'], 0)

if __name__ == '__main__':
    unittest.main()
