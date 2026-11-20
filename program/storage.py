"""Small, revisioned file store. User records never overwrite research sources."""
from pathlib import Path
from threading import RLock
from datetime import datetime, timezone
import hashlib, json, os, re, tempfile, uuid

KINDS = {'reading': '阅读记录', 'task': '当前任务', 'settings': '收藏与筛选', 'paper': '新增文献', 'annotation':'原文批注'}
READING_STATES = ['待本人确认', '待读', '在读', '已读', '需要复读']

def now():
    return datetime.now(timezone.utc).isoformat()

def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2).encode('utf-8')

def digest(value):
    return hashlib.sha256(encoded(value)).hexdigest()

class Conflict(Exception):
    def __init__(self, current):
        self.current = current

def clean_id(value):
    if not isinstance(value, str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,100}', value):
        raise ValueError('记录编号无效')
    return value

def validate(kind, data):
    if kind not in KINDS or not isinstance(data, dict):
        raise ValueError('记录格式不正确')
    allowed = {
        'reading': {'status','favorite','understanding','questions','next_step','location','paper_version'},
        'task': {'title','reason','criteria','status','link'},
        'settings': {'views'},
        'paper': {'title','name','url','version','year','directions','venue','problem'},
        'annotation': {'doc_id','doc_title','doc_path','paper_id','quote','prefix','suffix','start','end','section_id','section_title','source_hash','question','answer','understanding','status','archived'},
    }[kind]
    if set(data) - allowed:
        raise ValueError('记录包含未知字段')
    if len(encoded(data)) > 200_000:
        raise ValueError('一条记录过长，请拆分后保存')
    for key, value in data.items():
        if key in ('favorite','archived'):
            if type(value) is not bool: raise ValueError('收藏状态格式不正确')
        elif kind=='annotation' and key in ('start','end'):
            if type(value) is not int or not 0<=value<=10_000_000:raise ValueError('原文位置无效')
        elif key in ('directions',):
            if not isinstance(value, list) or len(value)>20 or any(not isinstance(x,str) or len(x)>100 for x in value): raise ValueError('方向格式不正确')
        elif key == 'views':
            if not isinstance(value,list) or len(value)>30: raise ValueError('筛选列表过多')
            for v in value:
                if not isinstance(v,dict) or set(v)!={'name','filters'} or not isinstance(v['name'],str) or not 1<=len(v['name'])<=80: raise ValueError('保存筛选格式不正确')
                if not isinstance(v['filters'],dict) or set(v['filters'])-{'q','direction','year','status','depth','favorite'} or any(not isinstance(x,str) or len(x)>200 for x in v['filters'].values()): raise ValueError('筛选条件格式不正确')
        else:
            if not isinstance(value,str) or len(value)>30_000: raise ValueError('文字格式不正确或内容过长')
    if kind == 'reading' and data.get('status','待本人确认') not in READING_STATES:
        raise ValueError('阅读状态无效')
    if kind == 'annotation':
        if not re.fullmatch(r'doc-[a-f0-9]{16}',data.get('doc_id','')):raise ValueError('批注所属资料无效')
        if not data.get('quote','').strip() or len(data['quote'])>5000:raise ValueError('请选择1至5000字符的原文')
        if not data.get('question','').strip():raise ValueError('请写下批注或困惑')
        if data.get('status') not in ['待讨论','仍有疑问','已理解']:raise ValueError('批注状态无效')
        if not re.fullmatch(r'[a-f0-9]{64}',data.get('source_hash','')):raise ValueError('原文版本无效')
        if data.get('end',0)<=data.get('start',0):raise ValueError('原文选择范围无效')
        if any(len(data.get(k,''))>80 for k in ['prefix','suffix']):raise ValueError('定位上下文过长')
    if kind == 'task' and data.get('status','待办') not in ['待办','进行中','完成','暂停']:
        raise ValueError('任务状态无效')
    if kind == 'paper':
        if not data.get('title','').strip(): raise ValueError('请填写论文题名')
        if len(data['title'])>500: raise ValueError('题名过长')
        from urllib.parse import urlsplit
        url=urlsplit(data.get('url',''))
        if url.scheme not in ('http','https') or not url.netloc or url.username or url.password: raise ValueError('原文地址须为有效的 http/https 链接')
    if kind == 'task' and data.get('link'):
        from urllib.parse import urlsplit
        link=data['link']
        parsed=urlsplit(link)
        if not (link.startswith('#/') or (parsed.scheme in ('http','https') and parsed.netloc and not parsed.username)):
            raise ValueError('产物链接须为网页地址或工作台内的 #/ 链接')
    return data

class Store:
    def __init__(self, root):
        self.root=Path(root).resolve()
        self.root.mkdir(parents=True,exist_ok=True)
        self.lock=RLock()

    def path(self, kind, key):
        if kind not in KINDS: raise ValueError('记录类型无效')
        return self.root/KINDS[kind]/(clean_id(key)+'.json')

    def get(self, kind, key):
        p=self.path(kind,key)
        if not p.exists(): return {'kind':kind,'id':key,'revision':0,'hash':'','data':{}}
        obj=json.loads(p.read_text(encoding='utf-8'))
        if obj.get('schema_version')!=1 or obj.get('kind')!=kind or obj.get('id')!=key or type(obj.get('revision')) is not int or obj['revision']<1: raise ValueError('记录格式损坏，请从备份恢复')
        validate(kind,obj.get('data'))
        return {**obj,'hash':digest(obj)}

    @staticmethod
    def atomic_write(path, content):
        path=Path(path)
        path.parent.mkdir(parents=True,exist_ok=True)
        fd,tmp=tempfile.mkstemp(prefix='.__write_',suffix='.tmp',dir=path.parent)
        try:
            with os.fdopen(fd,'wb') as f:
                f.write(content); f.flush(); os.fsync(f.fileno())
            os.replace(tmp,path)
        finally:
            if os.path.exists(tmp): os.unlink(tmp)

    def save(self, kind, key, data, revision, expected_hash):
        validate(kind,data)
        if type(revision) is not int or revision<0: raise ValueError('修订号无效')
        with self.lock:
            old=self.get(kind,key)
            if old['revision']!=revision or old['hash']!=expected_hash: raise Conflict(old)
            timestamp=now()
            obj={'schema_version':1,'kind':kind,'id':key,'revision':revision+1,'created_at':old.get('created_at',timestamp),'updated_at':timestamp,'source':'user','data':data}
            if revision:
                history=self.root/'版本快照'/f'{kind}-{key}'/f'{revision}-{old["hash"][:12]}.json'
                if not history.exists(): self.atomic_write(history,encoded({k:v for k,v in old.items() if k!='hash'}))
            self.atomic_write(self.path(kind,key),encoded(obj))
            return {**obj,'hash':digest(obj)}

    def all(self):
        with self.lock:
            return [self.get(kind,p.stem) for kind,folder in KINDS.items() for p in sorted((self.root/folder).glob('*.json'))]

    def export(self):
        records=[{k:v for k,v in item.items() if k!='hash'} for item in self.all()]
        return {'format':'research-workbench-records','schema_version':1,'exported_at':now(),'records':records,'sha256':digest(records)}

    def generation(self):
        return digest(self.all())

    def inspect_bundle(self, bundle):
        if not isinstance(bundle,dict) or bundle.get('format')!='research-workbench-records' or bundle.get('schema_version')!=1: raise ValueError('不支持的备份格式')
        records=bundle.get('records')
        if not isinstance(records,list) or len(records)>5000 or len(encoded(bundle))>10_000_000 or digest(records)!=bundle.get('sha256'): raise ValueError('备份内容或校验值不正确')
        rows=[]; keys=set()
        for obj in records:
            if not isinstance(obj,dict) or obj.get('schema_version')!=1: raise ValueError('备份记录格式错误')
            kind,key=obj.get('kind'),obj.get('id')
            self.path(kind,key); validate(kind,obj.get('data'))
            identity=f'{kind}:{key}'
            if identity in keys: raise ValueError('备份包含重复记录')
            keys.add(identity)
            current=self.get(kind,key)
            state='新增' if current['revision']==0 else ('相同' if current['data']==obj['data'] else '冲突')
            rows.append({'key':identity,'kind':kind,'id':key,'state':state,'current_revision':current['revision'],'current_hash':current['hash'],'incoming':obj['data'],'current':current['data']})
        return rows

    def apply_bundle(self, bundle, selected, generation):
        with self.lock:
            if self.generation()!=generation: raise Conflict({'message':'预览后已有记录变化，请重新预览'})
            rows=self.inspect_bundle(bundle)
            options={x['key']:x for x in rows}
            if not isinstance(selected,list) or len(selected)!=len(set(selected)) or any(x not in options for x in selected): raise ValueError('导入选择无效')
            if not selected: raise ValueError('请至少选择一条记录')
            before=self.export()
            stamp=datetime.now().strftime('%Y%m%d_%H%M%S')+'_'+uuid.uuid4().hex[:8]
            self.atomic_write(self.root/'导入前备份'/f'{stamp}.json',encoded(before))
            originals={key:(self.path(options[key]['kind'],options[key]['id']).read_bytes() if self.path(options[key]['kind'],options[key]['id']).exists() else None) for key in selected}
            done=[]
            try:
                for key in selected:
                    r=options[key]
                    self.save(r['kind'],r['id'],r['incoming'],r['current_revision'],r['current_hash'])
                    done.append(key)
            except Exception:
                for key in reversed(done):
                    r=options[key]; path=self.path(r['kind'],r['id'])
                    if originals[key] is None: path.unlink(missing_ok=True)
                    else: self.atomic_write(path,originals[key])
                raise
            return {'imported':len(done),'backup':f'导入前备份/{stamp}.json'}
