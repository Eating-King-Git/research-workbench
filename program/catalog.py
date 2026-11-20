from pathlib import Path
from markdown_it import MarkdownIt
from urllib.parse import quote, unquote, urlsplit, urlunsplit
import hashlib, json, re, time

BASE=Path(__file__).resolve().parent
SURVEY='05_文献阅读/阅读卡'
HOME='00_阅读入口'

def work_id(url):
    m=re.search(r'arxiv\.org/(?:abs|html|pdf)/(\d{4}\.\d{4,5})',url,re.I)
    if m: return 'arxiv-'+m[1].replace('.','-')
    p=urlsplit(url)
    normalized=urlunsplit((p.scheme.lower(),p.netloc.lower(),p.path.rstrip('/'),p.query,''))
    return 'paper-'+hashlib.sha256(normalized.encode()).hexdigest()[:20]

class Catalog:
    def __init__(self,root,store):
        self.root=Path(root).resolve(); self.store=store
        self.meta_path=self.root/'05_文献阅读/文献元数据.json'
        self.fallback=BASE/'data/papers.json'
        direction_source=BASE/'data/directions.json'
        directions=json.loads(direction_source.read_text(encoding='utf-8'))
        self.directions={d['id']:d['name'] for d in directions}
        self.md=MarkdownIt('commonmark',{'html':False,'linkify':False}).enable('table')
        self.last_check=0; self.signature=None
        self.reload()

    def source_paths(self):
        paths=[]
        for folder in ['00_阅读入口','01_工作接续','02_个人科研梳理','06_方法与工具']:
            paths.extend((self.root/folder).glob('*.md'))
        paths.extend((self.root/SURVEY).glob('*.md'))
        paths.extend((self.root/'05_文献阅读').glob('*.md'))
        return sorted(paths)

    def ensure(self,force=False):
        if not force and time.monotonic()-self.last_check<2: return
        self.last_check=time.monotonic()
        paths=self.source_paths()+[self.meta_path if self.meta_path.exists() else self.fallback,self.root/'01_工作接续/当前状态.json',self.root/'01_工作接续/实验索引.json']
        sig=tuple((str(p),p.stat().st_mtime_ns,p.stat().st_size) for p in paths)
        if force or sig!=self.signature:
            self.reload(); self.signature=sig

    def status_for(self,rel):
        if rel.startswith(SURVEY): return '通用示例','论文卡'
        if '当前状态' in rel: return '当前有效','当前任务'
        if rel.startswith('06_') or rel.startswith('00_'): return '使用指南','学习资料'
        return '本地资料','资料记录'

    def render(self,path):
        text=path.read_text(encoding='utf-8-sig')
        tokens=self.md.parse(text)
        headings=[]; used={}; current='概览'; anchor='top'; chunks=[]; lines=[]
        def flush():
            if lines: chunks.append({'heading':current,'anchor':anchor,'text':'\n'.join(lines)})
        for i,t in enumerate(tokens):
            if t.type=='heading_open':
                flush(); lines=[]
                title=tokens[i+1].content
                slug='s-'+hashlib.sha256(title.encode()).hexdigest()[:12]
                used[slug]=used.get(slug,0)+1
                anchor=slug+('-'+str(used[slug]) if used[slug]>1 else '')
                current=title; t.attrSet('id',anchor)
                headings.append({'text':title,'id':anchor,'level':int(t.tag[1])})
            if t.type=='inline':
                # Index visible prose rather than Markdown URLs and formatting.
                lines.append(''.join('\n' if c.type in ('softbreak','hardbreak') else c.content if c.type in ('text','code_inline','image') else '' for c in t.children or []))
                for child in t.children or []:
                    attr='href' if child.type=='link_open' else ('src' if child.type=='image' else None)
                    if not attr: continue
                    href=child.attrGet(attr) or ''
                    if href and not urlsplit(href).scheme and not href.startswith('#'):
                        raw,_,frag=href.partition('#')
                        target=(path.parent/unquote(raw)).resolve()
                        if target.is_relative_to(self.root): child.attrSet(attr,'/site/'+quote(target.relative_to(self.root).as_posix())+('#'+frag if frag else ''))
                    if child.type=='link_open': child.attrSet('target','_blank'); child.attrSet('rel','noopener noreferrer')
            elif t.type in ('fence','code_block'): lines.append(t.content)
        flush()
        return text,self.md.renderer.render(tokens,self.md.options,{}),headings,chunks

    def reload(self):
        src=self.meta_path if self.meta_path.exists() else self.fallback
        original=json.loads(src.read_text(encoding='utf-8'))
        self.papers=[]
        for p in original:
            self.papers.append({
                'id':p.get('work_id') or work_id(p['url']), 'legacy_id':p.get('legacy_id',p.get('id')),
                **{k:p.get(k,'') for k in ['name','title','year','venue','url','version','card_path','depth','code_status','data','cost','problem','code']},
                'directions':[self.directions.get(x,x) for x in p.get('directions',[])],
            })
        assert len({p['id'] for p in self.papers})==len(self.papers)
        self.state=json.loads((self.root/'01_工作接续/当前状态.json').read_text(encoding='utf-8'))
        self.activities=json.loads((self.root/'01_工作接续/实验索引.json').read_text(encoding='utf-8'))
        self.docs={}; self.chunks=[]
        paper_by_path={Path(p['card_path']).with_suffix('.md').as_posix():p for p in self.papers}
        for path in self.source_paths():
            rel=path.relative_to(self.root).as_posix()
            text,html,headings,chunks=self.render(path)
            key='doc-'+hashlib.sha256(rel.encode()).hexdigest()[:16]
            status,kind=self.status_for(rel)
            paper=paper_by_path.get(rel)
            title=headings[0]['text'] if headings else path.stem
            updated=time.strftime('%Y-%m-%d',time.localtime(path.stat().st_mtime))
            doc={'id':key,'title':title,'path':rel,'status':status,'kind':kind,'updated':updated,'paper_id':paper['id'] if paper else None,'headings':headings,'html':html,'text':text,'source_hash':hashlib.sha256(text.encode()).hexdigest()}
            self.docs[key]=doc
            if paper: paper['doc_id']=key
            for c in chunks:
                self.chunks.append({**{k:doc[k] for k in ['id','title','status','kind','updated','paper_id']},**c})
        self.indexed_at=time.strftime('%Y-%m-%d %H:%M:%S')

    def all_papers(self):
        extras=[]
        for r in self.store.all():
            if r['kind']=='paper':
                d=r['data']; extras.append({**d,'id':r['id'],'name':d.get('name') or d['title'],'legacy_id':'新增','depth':'待核实','code_status':'待核实','data':'待核实','cost':'待核实','card_path':'','doc_id':None,'code':''})
        return self.papers+extras

    def search(self,q,scope='curated'):
        self.ensure()
        terms=q.casefold().split()
        if not terms: return {'results':[],'total':0,'indexed_at':self.indexed_at}
        candidates=[]
        if scope=='archive':
            raw=json.loads((self.root/'04_材料索引/材料索引.json').read_text(encoding='utf-8'))
            for r in raw:
                text=' '.join(str(r.get(k,'')) for k in ['relative_source','source','category','status'])
                if all(t in text.casefold() for t in terms):
                    candidates.append({'title':r.get('relative_source') or r.get('source'),'heading':r.get('category',''),'text':text,'anchor':'','url':'/site/'+quote(r['archive']) if r.get('archive') else None,'status':'历史清单快照','kind':'材料路径','updated':r.get('updated','')})
        else:
            chunks=self.chunks.copy()
            for r in self.store.all():
                if r['kind']=='annotation' and not r['data'].get('archived'):
                    d=r['data'];doc=self.docs.get(d['doc_id'])
                    chunks.append({'id':d['doc_id'],'paper_id':d.get('paper_id'),'url':'#/doc/'+d['doc_id']+'?annotation='+r['id'],'title':d['doc_title']+' · 原文批注','heading':d.get('section_title','原文批注'),'text':'\n'.join(d.get(k,'') for k in ['quote','question','answer','understanding']),'anchor':'','status':d['status'],'kind':'原文批注','updated':r['updated_at'][:10]})
                if r['kind']=='task':
                    d=r['data']
                    chunks.append({'id':None,'paper_id':None,'url':'#/home','title':d.get('title') or '当前产物','heading':'当前产物与完成标准','text':'\n'.join(str(d.get(k,'')) for k in ['reason','criteria','status']),'anchor':'','status':'个人记录','kind':'当前产物','updated':r['updated_at'][:10]})
                if r['kind']=='paper':
                    d=r['data']
                    chunks.append({'id':None,'paper_id':r['id'],'title':d['title'],'heading':'收录信息','text':'\n'.join(str(d.get(k,'')) for k in ['problem','version','year','url','directions']),'anchor':'','status':'待核实','kind':'新增文献','updated':r['updated_at'][:10]})
                if r['kind']=='reading':
                    p=next((p for p in self.all_papers() if p['id']==r['id']),None)
                    if p:
                        chunks.append({'id':p.get('doc_id'),'paper_id':p['id'],'title':p['name']+' · 我的记录','heading':'我的理解与疑问','text':'\n'.join(str(r['data'].get(k,'')) for k in ['understanding','questions','next_step','location']),'anchor':'notes','status':'个人记录','kind':'我的记录','updated':r['updated_at'][:10]})
            for c in chunks:
                hay=(c['title']+' '+c['heading']+' '+c['text']).casefold()
                if all(t in hay for t in terms):
                    score=sum((15 if t in c['title'].casefold() else 0)+(6 if t in c['heading'].casefold() else 0)+min(hay.count(t),8) for t in terms)
                    if c['status'] in ['当前有效','当前汇总','已停止']: score+=25
                    candidates.append({**c,'score':score})
            candidates.sort(key=lambda c:(-c['score'],c['title']))
        total=len(candidates)
        for c in candidates[:80]:
            t=c['text']; indexes=[t.casefold().find(term) for term in terms]; idx=min((x for x in indexes if x>=0),default=0)
            start=max(0,idx-65); c['snippet']=('…' if start else '')+t[start:start+240]+('…' if len(t)>start+240 else '')
            c.pop('text',None)
        return {'results':candidates[:80],'total':total,'indexed_at':self.indexed_at}

    def snapshot(self):
        return {'papers':self.papers,'state':self.state,'activities':self.activities,'docs':self.docs,'chunks':self.chunks,'indexed_at':self.indexed_at,'directions':list(self.directions.values())}
