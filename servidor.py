"""Local, 30-image prototype. Source images and classification remain read-only."""
from pathlib import Path
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlsplit,unquote
from datetime import datetime,timezone
import argparse,json,mimetypes,threading,shutil,os

ROOT=Path(__file__).resolve().parent
PUBLIC=ROOT/'dist'
MEDIA=json.loads((ROOT/'originais.json').read_text(encoding='utf-8'))
JOURNAL=ROOT/'marcacoes-simulacao-v01.jsonl'
LOCK=threading.RLock()
RECORDS={}
STATUS={'pendente','aprovado','ajuste','descartado'}
REASONS={'ajuste':{'Logomarca','Ajustes Finos'},'descartado':{'Duplicado','Fora de Padrão'}}
if JOURNAL.exists():
    for line in JOURNAL.read_text(encoding='utf-8').splitlines():
        if line.strip():
            event=json.loads(line)
            if event['id'] in MEDIA:RECORDS[event['id']]=event['record']

def update(item):
    image_id=item.get('id');patch=item.get('patch')
    if image_id not in MEDIA or not isinstance(patch,dict) or set(patch)-{'status','reasons','observation'}:raise ValueError('Alteracao invalida')
    with LOCK:
        record={'status':'pendente','reasons':[],'observation':'',**RECORDS.get(image_id,{})}
        if 'status' in patch:
            if patch['status'] not in STATUS:raise ValueError('Status invalido')
            if record['status']!=patch['status']:record['reasons']=[]
            record['status']=patch['status']
        if 'reasons' in patch:
            values=patch['reasons']
            if not isinstance(values,list) or any(v not in REASONS.get(record['status'],set()) for v in values):raise ValueError('Motivo invalido')
            record['reasons']=list(dict.fromkeys(values))
        if 'observation' in patch:
            if not isinstance(patch['observation'],str) or len(patch['observation'])>4000:raise ValueError('Observacao invalida')
            record['observation']=patch['observation']
        record['updated_at']=datetime.now(timezone.utc).isoformat()
        event={'id':image_id,'patch':patch,'record':record}
        with JOURNAL.open('a',encoding='utf-8') as f:
            f.write(json.dumps(event,ensure_ascii=False)+'\n');f.flush();os.fsync(f.fileno())
        RECORDS[image_id]=record
        return record

class Handler(BaseHTTPRequestHandler):
    server_version='IronPrototype/1'
    def send_headers(self,code,kind,size,cache='no-store'):
        self.send_response(code)
        self.send_header('Content-Type',kind)
        self.send_header('Content-Length',str(size))
        self.send_header('Cache-Control',cache)
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Referrer-Policy','same-origin')
        self.send_header('X-Frame-Options','SAMEORIGIN')
        self.end_headers()
    def json_response(self,value,code=200):
        body=json.dumps(value,ensure_ascii=False).encode('utf-8')
        self.send_headers(code,'application/json; charset=utf-8',len(body))
        self.wfile.write(body)
    def do_GET(self):
        path=unquote(urlsplit(self.path).path)
        if path=='/api/marcacoes':
            with LOCK:self.json_response({'records':dict(RECORDS)})
            return
        if path=='/api/saude':
            self.json_response({'ok':True,'images':len(MEDIA),'prototype':True});return
        if path.startswith('/media/'):
            image_id=path[7:]
            if image_id not in MEDIA:self.send_error(404);return
            target=Path(MEDIA[image_id]);cache='private, max-age=3600'
        elif path in {'/','/index.html','/app.css','/app.js','/imagens.json'}:
            target=PUBLIC/('index.html' if path=='/' else path[1:]);cache='no-store'
        else:self.send_error(404);return
        try:
            with target.open('rb') as f:
                kind=mimetypes.guess_type(target.name)[0] or 'application/octet-stream'
                if kind in {'text/html','text/css','text/javascript','application/javascript','application/json'}:kind+='; charset=utf-8'
                self.send_headers(200,kind,target.stat().st_size,cache)
                shutil.copyfileobj(f,self.wfile,length=1024*1024)
        except (BrokenPipeError,ConnectionResetError):pass
        except FileNotFoundError:self.send_error(404)
    def do_POST(self):
        path=urlsplit(self.path).path
        if path not in {'/api/marcacoes','/api/marcacoes/lote'}:self.send_error(404);return
        origin=self.headers.get('Origin')
        if origin and urlsplit(origin).netloc!=self.headers.get('Host'):
            self.json_response({'error':'Origem invalida'},403);return
        try:
            size=int(self.headers.get('Content-Length','0'))
            if size<=0 or size>200000:raise ValueError('Tamanho invalido')
            payload=json.loads(self.rfile.read(size))
            if path.endswith('/lote'):
                updates=payload.get('updates')
                if not isinstance(updates,list) or len(updates)>30:raise ValueError('Lote invalido')
                for item in updates:update(item)
                self.json_response({'ok':True})
            else:self.json_response({'ok':True,'record':update(payload)})
        except (ValueError,TypeError,KeyError,json.JSONDecodeError) as error:self.json_response({'error':str(error)},400)
        except OSError:self.json_response({'error':'Nao foi possivel salvar no computador'},500)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--host',default='0.0.0.0');parser.add_argument('--port',type=int,default=8766)
    args=parser.parse_args()
    server=ThreadingHTTPServer((args.host,args.port),Handler)
    print(f'Iron Supply: http://192.168.3.33:{args.port}/ | {len(MEDIA)} imagens',flush=True)
    server.serve_forever()
