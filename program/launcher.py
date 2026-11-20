"""Start/stop only this local workbench; never kills an unrelated process."""
from pathlib import Path
import argparse,json,subprocess,sys,time,urllib.request,urllib.error,http.client

def request(base,path,data=None,token=None):
    headers={'Content-Type':'application/json'}
    if token: headers['X-Workbench-Token']=token
    req=urllib.request.Request(base+path,data=json.dumps(data).encode() if data is not None else None,headers=headers)
    # Loopback must not be redirected through system proxy configuration.
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req,timeout=3) as response: return json.load(response)

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--root',required=True);parser.add_argument('--port',type=int,default=8767)
    parser.add_argument('--stop',action='store_true')
    args=parser.parse_args();root=Path(args.root).resolve()
    base=f'http://127.0.0.1:{args.port}'
    live=None
    try: live=request(base,'/api/health')
    except (urllib.error.URLError,TimeoutError,ValueError,ConnectionError,http.client.RemoteDisconnected): pass
    if live:
        if live.get('service')!='research-workbench' or Path(live.get('site_root','')).resolve()!=root or live.get('test_mode'):
            raise RuntimeError('This port belongs to another service; no changes made.')
        if args.stop:
            token=request(base,'/api/bootstrap')['token']
            request(base,'/api/shutdown',{},token)
            for _ in range(40):
                try: request(base,'/api/health')
                except (urllib.error.URLError,TimeoutError,ConnectionError,http.client.RemoteDisconnected):
                    print('Workbench stopped. Personal records remain saved.');return
                time.sleep(.15)
            raise RuntimeError('Shutdown requested, but the port is still responding. Check the service log.')
        print('Workbench already running: '+base+'/app/');return
    if args.stop:
        print('Workbench is not running.');return
    logs=root/'07_个人记录/.runtime';logs.mkdir(parents=True,exist_ok=True)
    with (logs/'service.log').open('ab') as stream:
        proc=subprocess.Popen([sys.executable,str(Path(__file__).with_name('app.py')),'--root',str(root),'--port',str(args.port)],stdout=stream,stderr=stream,stdin=subprocess.DEVNULL,creationflags=subprocess.CREATE_NO_WINDOW if sys.platform=='win32' else 0)
    for _ in range(60):
        try:
            live=request(base,'/api/health')
            if live.get('service')=='research-workbench' and Path(live['site_root']).resolve()==root:
                print('Workbench ready: '+base+'/app/');return
        except (urllib.error.URLError,TimeoutError,ValueError): pass
        if proc.poll() is not None: break
        time.sleep(.25)
    raise RuntimeError('Startup failed. See 07_个人记录/.runtime/service.log')

if __name__=='__main__': main()
