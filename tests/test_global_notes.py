import unittest
import test_api
from tempfile import TemporaryDirectory
from storage import Store

class GlobalNotesTests(unittest.TestCase):
    setUp=test_api.ApiTests.setUp
    tearDown=test_api.ApiTests.tearDown
    def excerpt(self,key='excerpt-test',base=None,**patch):
        data={'source':'/app/#/home','title':'测试页面','quote':'目标原句','context':'前文。目标原句。后文。','locator':'{}','question':'这里是什么意思','answer':'','understanding':'','status':'待讨论',**patch}
        return self.client.put('/api/excerpts/'+key,json={'data':data,'expected_revision':base['revision'] if base else 0,'expected_hash':base['hash'] if base else ''},headers=self.headers)

    def test_snapshot_conflict_immutable_and_restore(self):
        r=self.excerpt().json()
        self.assertEqual(self.excerpt().status_code,409)
        updated=self.excerpt(base=r,context='伪造',quote='替换',question='追加问题').json()
        self.assertEqual(updated['data']['context'],r['data']['context'])
        self.assertEqual(updated['data']['quote'],r['data']['quote'])
        bundle=self.client.get('/api/export').json()
        with TemporaryDirectory() as d:
            target=Store(d); rows=target.inspect_bundle(bundle)
            target.apply_bundle(bundle,[r['key'] for r in rows],target.generation())
            self.assertEqual(target.get('excerpt','excerpt-test')['data'],updated['data'])

    def test_cross_page_packet_and_reply(self):
        self.excerpt()
        self.excerpt('excerpt-two',source='/site/example.html',context='另一页目标原句及上下文')
        result=self.client.post('/api/discussion-packets',json={'ids':['excerpt:excerpt-test','excerpt:excerpt-two']},headers=self.headers)
        self.assertEqual(result.status_code,200)
        packet=result.json();self.assertIn('另一页目标原句及上下文',packet['text']);self.assertIn('/app/#/home',packet['text'])
        r=self.client.get('/api/discussion-packets').json()[0]
        result=self.client.put('/api/discussion-packets/'+r['id'],json={'answer':'讨论摘录','expected_revision':r['revision'],'expected_hash':r['hash']},headers=self.headers)
        self.assertEqual(result.status_code,200)
        self.assertEqual(result.json()['data']['content'],packet['text'])
        self.assertEqual(self.client.get('/api/excerpts').json()[0]['data']['status'],'待讨论')

    def test_reject_foreign_source_missing_quote_and_missing_ids(self):
        for patch in ({'source':'https://example.com/'},{'context':'不含引用'},{'source':'//evil.test/app/'},{'status':'自动理解'}):
            self.assertEqual(self.excerpt(**patch).status_code,400)
        result=self.client.post('/api/discussion-packets',json={'ids':['excerpt:missing']},headers=self.headers)
        self.assertEqual(result.status_code,400)

    def test_large_context_is_not_cut(self):
        context='目标原句'+('中间内容'*20000)+'完整结尾'
        r=self.excerpt(context=context)
        self.assertEqual(r.status_code,200)
        packet=self.client.post('/api/discussion-packets',json={'ids':['excerpt:excerpt-test']},headers=self.headers).json()
        self.assertIn(context,packet['text'])

    def test_static_html_and_text_have_shared_ui(self):
        (self.site/'sample.html').write_text('<html><body><p>Fictional sample</p></body></html>',encoding='utf-8')
        (self.site/'sample.txt').write_text('Fictional sample',encoding='utf-8')
        for path in ['sample.html','sample.txt']:
            response=self.client.get('/site/'+path)
            self.assertEqual(response.status_code,200)
            self.assertIn('/app/global_notes.js',response.text)
        self.assertIn('global_notes.js',self.client.get('/app/').text)
