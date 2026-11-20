from pathlib import Path
from urllib.parse import urlsplit
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse, FileResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from storage import Store, Conflict, validate, encoded, now
from catalog import Catalog, work_id
from annotations import install_annotations
import argparse, json, os, secrets, time, uuid

BASE=Path(__file__).resolve().parent
VERSION=(BASE.parent/'VERSION.txt').read_text(encoding='utf-8').strip()

def create_app(site_root,data_root=None,test_mode=False):
    root=Path(site_root).resolve()
    store=Store(data_root or root/'07_个人记录')
    catalog=Catalog(root,store)
    token=secrets.token_urlsafe(32)
    previews={}
    app=FastAPI(docs_url=None,redoc_url=None,openapi_url=None)
    app.state.store=store; app.state.catalog=catalog; app.state.token=token
    install_annotations(app,catalog,store)

    @app.middleware('http')
    async def local_only(request,call_next):
        host=request.url.hostname
        if host not in ({'127.0.0.1','localhost','testserver'} if test_mode else {'127.0.0.1','localhost'}):
            return JSONResponse({'error':'仅允许本机访问'},403)
        if request.method in ('POST','PUT','DELETE','PATCH'):
            origin=request.headers.get('origin')
            if origin and origin!=f'{request.url.scheme}://{request.url.netloc}':
                return JSONResponse({'error':'请求来源不匹配'},403)
            if not secrets.compare_digest(request.headers.get('x-workbench-token',''),token):
                return JSONResponse({'error':'会话已更新，请刷新后重试；请先导出未保存草稿'},403)
            try: size=int(request.headers.get('content-length','0'))
            except ValueError: return JSONResponse({'error':'请求大小无效'},400)
            if size>10_000_000: return JSONResponse({'error':'记录包过大'},413)
        response=await call_next(request)
        response.headers['X-Content-Type-Options']='nosniff'
        response.headers['Referrer-Policy']='no-referrer'
        if request.url.path.startswith(('/api','/app')):
            response.headers['Cache-Control']='no-store'
            response.headers['Content-Security-Policy']="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
        return response

    @app.exception_handler(Conflict)
    async def conflict_handler(request,e):
        return JSONResponse({'error':'记录已在另一个页面或操作中更新。你的草稿仍保留，请比较后合并。','current':e.current},409)

    @app.exception_handler(ValueError)
    async def value_handler(request,e):
        return JSONResponse({'error':str(e)},400)

    @app.exception_handler(OSError)
    async def io_handler(request,e):
        return JSONResponse({'error':'磁盘写入或读取失败，内容尚未保存。请保留/导出草稿并重试。'},503)

    @app.get('/')
    def home(): return RedirectResponse('/app/')

    @app.get('/api/health')
    def health(): return {'service':'research-workbench','version':VERSION,'test_mode':test_mode,'site_root':str(root)}

    @app.post('/api/shutdown')
    def shutdown():
        server=getattr(app.state,'server',None)
        if server is None: raise ValueError('当前服务不能通过此入口停止')
        server.should_exit=True
        return {'stopping':True}

    @app.get('/api/bootstrap')
    def bootstrap():
        catalog.ensure()
        records=store.all()
        return {'token':token,'version':VERSION,'test_mode':test_mode,'papers':catalog.all_papers(),'state':catalog.state,'activities':catalog.activities,'directions':list(catalog.directions.values()),'indexed_at':catalog.indexed_at,'document_count':len(catalog.docs),'records':records,'docs':[{k:d[k] for k in ['id','title','path','status','kind','updated','paper_id']} for d in catalog.docs.values()]}

    @app.get('/api/docs/{key}')
    def get_doc(key):
        catalog.ensure()
        if key not in catalog.docs: raise HTTPException(404,'未找到资料')
        return catalog.docs[key]

    @app.get('/api/search')
    def search(q:str='',scope:str='curated'):
        if len(q)>160 or scope not in ['curated','archive']: raise ValueError('搜索条件无效')
        start=time.perf_counter(); result=catalog.search(q,scope)
        result['elapsed_ms']=round((time.perf_counter()-start)*1000,2)
        return result

    @app.post('/api/reindex')
    def reindex():
        catalog.ensure(force=True)
        return {'indexed_at':catalog.indexed_at,'documents':len(catalog.docs)}

    @app.get('/api/records/{kind}/{key}')
    def get_record(kind,key): return store.get(kind,key)

    @app.put('/api/records/{kind}/{key}')
    async def put_record(kind,key,request:Request):
        if kind not in ['reading','task','settings']: raise ValueError('此类型不支持直接编辑')
        if kind=='reading' and key not in {p['id'] for p in catalog.all_papers()}: raise ValueError('论文不存在，不能写入阅读记录')
        if kind in ['task','settings'] and key!='main': raise ValueError('记录编号无效')
        body=await request.json()
        if not isinstance(body,dict): raise ValueError('请求格式错误')
        return store.save(kind,key,body.get('data'),body.get('expected_revision'),body.get('expected_hash',''))

    @app.post('/api/papers')
    async def add_paper(request:Request):
        data=await request.json(); validate('paper',data)
        identity=work_id(data['url'])
        known=next((p for p in catalog.all_papers() if p['id']==identity or work_id(p['url'])==identity),None)
        if known: return JSONResponse({'error':'这篇论文已收录，请打开原条目核对所读版本。','paper_id':known['id']},409)
        record=store.save('paper',identity,data,0,'')
        return {'id':identity,'record':record}

    @app.get('/api/export')
    def export():
        return Response(encoded(store.export()),media_type='application/json',headers={'Content-Disposition':'attachment; filename="research-records.json"'})

    @app.post('/api/import/preview')
    async def preview(request:Request):
        bundle=await request.json()
        with store.lock:
            rows=store.inspect_bundle(bundle)
            known={p['id'] for p in catalog.all_papers()}|{x['id'] for x in rows if x['kind']=='paper'}
            if any(x['kind']=='reading' and x['id'] not in known for x in rows): raise ValueError('备份含未收录论文的阅读记录，请同时导入对应文献条目')
            for k in list(previews):
                if time.time()-previews[k]['time']>900: previews.pop(k)
            if len(previews)>20: previews.clear()
            key=uuid.uuid4().hex
            previews[key]={'bundle':bundle,'generation':store.generation(),'time':time.time()}
        return {'preview_id':key,'rows':rows,'message':'默认选中新增记录；冲突项须逐条查看后自行选择。'}

    @app.post('/api/import/apply')
    async def apply_import(request:Request):
        payload=await request.json()
        preview=previews.get(payload.get('preview_id'))
        if not preview or time.time()-preview['time']>900: raise ValueError('预览已失效，请重新预览')
        selected=payload.get('selected',[])
        # Reading imports need their paper either already present or selected too.
        incoming=store.inspect_bundle(preview['bundle'])
        known={p['id'] for p in catalog.all_papers()}|{x['id'] for x in incoming if x['kind']=='paper' and x['key'] in selected}
        if any(x['kind']=='reading' and x['key'] in selected and x['id'] not in known for x in incoming): raise ValueError('请同时选中新增论文条目')
        result=store.apply_bundle(preview['bundle'],selected,preview['generation'])
        previews.pop(payload['preview_id'],None)
        return result

    @app.get('/site/{rel:path}')
    def site_file(rel):
        path=(root/rel).resolve()
        if not path.is_relative_to(root) or not path.is_file(): raise HTTPException(404,'未找到本地资料')
        parts=path.relative_to(root).parts
        if any(p.startswith('.') for p in parts) or parts[0].startswith('07_') or path.suffix.lower() not in {'.html','.md','.txt','.json','.css','.js','.pdf','.png','.jpg','.jpeg','.svg','.webp','.csv','.cmd','.ps1'}: raise HTTPException(403,'此文件不通过网页公开')
        return FileResponse(path)

    app.mount('/app',StaticFiles(directory=BASE/'static',html=True),name='app')
    return app

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--root',default=str(BASE.parent/'site'))
    parser.add_argument('--data-root')
    parser.add_argument('--port',type=int,default=8767)
    parser.add_argument('--test-mode',action='store_true')
    args=parser.parse_args()
    import uvicorn
    app=create_app(args.root,args.data_root,args.test_mode)
    lock_path=app.state.store.root/'.runtime/writer.lock'
    lock_path.parent.mkdir(parents=True,exist_ok=True)
    lock_file=lock_path.open('a+b')
    lock_file.seek(0); lock_file.write(b'1'); lock_file.flush();lock_file.seek(0)
    if os.name=='nt':
        import msvcrt
        msvcrt.locking(lock_file.fileno(),msvcrt.LK_NBLCK,1)
    server=uvicorn.Server(uvicorn.Config(app,host='127.0.0.1',port=args.port,access_log=False))
    app.state.server=server
    server.run()
