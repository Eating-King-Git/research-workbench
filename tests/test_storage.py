from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
import unittest,json,time,os
from fastapi.testclient import TestClient
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"program"))



from storage import Store,Conflict,digest,encoded

class StorageTests(unittest.TestCase):
    def setUp(self):
        self.tmp=TemporaryDirectory();self.store=Store(self.tmp.name)
    def tearDown(self): self.tmp.cleanup()
    def test_roundtrip_unicode_and_revision_conflict(self):
        data={'status':'在读','understanding':'中文\n公式 α + β，链接 https://example.org','favorite':False}
        first=self.store.save('reading','paper-1',data,0,'')
        reopened=Store(self.tmp.name).get('reading','paper-1')
        self.assertEqual(reopened,first)
        with self.assertRaises(Conflict): self.store.save('reading','paper-1',{'status':'已读'},0,'')
        with self.assertRaises(Conflict): self.store.save('reading','paper-1',{'status':'已读'},1,'wronghash')
        self.assertEqual(self.store.get('reading','paper-1')['data'],data)
    def test_failed_replace_keeps_original(self):
        first=self.store.save('task','main',{'title':'旧任务'},0,'')
        original=self.store.path('task','main').read_bytes()
        with patch('storage.os.replace',side_effect=PermissionError('simulated locked file')):
            with self.assertRaises(PermissionError): self.store.save('task','main',{'title':'新任务'},1,first['hash'])
        self.assertEqual(self.store.path('task','main').read_bytes(),original)
        self.assertFalse(list(Path(self.tmp.name).rglob('*.tmp')))
    def test_export_restore_and_checksum(self):
        first=self.store.save('reading','paper-1',{'status':'已读','questions':'为什么？'},0,'')
        bundle=self.store.export()
        with TemporaryDirectory() as other:
            target=Store(other)
            rows=target.inspect_bundle(bundle)
            self.assertEqual(rows[0]['state'],'新增')
            target.apply_bundle(bundle,['reading:paper-1'],target.generation())
            self.assertEqual(target.get('reading','paper-1')['data'],first['data'])
        bundle['records'][0]['data']['status']='待读'
        with self.assertRaises(ValueError): self.store.inspect_bundle(bundle)
    def test_import_preview_stale_and_midway_rollback(self):
        self.store.save('reading','paper-1',{'status':'在读'},0,'')
        source=Store(Path(self.tmp.name)/'source')
        source.save('reading','paper-1',{'status':'已读'},0,'')
        source.save('task','main',{'title':'将失败'},0,'')
        bundle=source.export(); generation=self.store.generation()
        orig=self.store.save
        def fail_task(kind,*args):
            if kind=='task':raise OSError('simulated disk failure')
            return orig(kind,*args)
        with patch.object(self.store,'save',side_effect=fail_task):
            with self.assertRaises(OSError):self.store.apply_bundle(bundle,['reading:paper-1','task:main'],generation)
        self.assertEqual(self.store.get('reading','paper-1')['data']['status'],'在读')
        self.assertEqual(self.store.get('task','main')['revision'],0)
        old=self.store.generation();self.store.save('task','main',{'title':'changed'},0,'')
        with self.assertRaises(Conflict):self.store.apply_bundle(bundle,['reading:paper-1'],old)
    def test_reject_paths_and_unsafe_metadata(self):
        with self.assertRaises(ValueError):self.store.get('reading','../bad')
        with self.assertRaises(ValueError):self.store.save('paper','a',{'title':'a','url':'javascript:alert(1)'},0,'')
        with self.assertRaises(ValueError):self.store.save('task','main',{'link':'javascript:alert(1)'},0,'')

