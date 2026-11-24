from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from threading import Thread
from subprocess import run
from urllib.parse import urlsplit,quote,unquote
from pathlib import Path
from plan import generate,H
import json,sys,os
from zipfile import ZipFile
progress=os.environ.get('STARFALL_PROGRESS_BUILD')=='1'
F,doc=generate(progress)
source=ZipFile(sys.argv[1]) if len(sys.argv)>=2 else None
if source:
 for k in F:
  z='xingluo-monsters-defense/'+unquote(k)[1:];assert source.read(z)==F[k]
 def bytes_at(k):
  return source.read('xingluo-monsters-defense/'+unquote(k)[1:]) if k in F else None
else:bytes_at=F.get

PREFIX=sys.argv[2] if len(sys.argv)>=3 else '/deep/permissions/h5/xingluo-monsters-defense'
assert PREFIX.startswith('/') and not PREFIX.endswith('/')
mime={'.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.html':'text/html','.json':'application/json',
 '.wasm':'application/wasm','.png':'image/png','.otf':'font/otf','.lua':'text/plain','.jsonl':'application/x-ndjson'}
TR=[]
class Hdl(BaseHTTPRequestHandler):
 def do_GET(self):
  url=urlsplit(self.path)
  u=url.path[len(PREFIX):] if url.path.startswith(PREFIX+'/') else ''
  b=bytes_at(u) if not url.query and u else None
  TR.append([self.path,b is not None])
  if not b:self.send_error(404);return
  self.send_response(200)
  self.send_header('Content-Type',mime[Path(unquote(u)).suffix])
  self.send_header('Content-Length',str(len(b)))
  self.end_headers(); self.wfile.write(b)
 def log_message(self,*args):pass
with ThreadingHTTPServer(('127.0.0.1',0),Hdl) as s:
 t=Thread(target=s.serve_forever,daemon=True);t.start()
 base=f'http://127.0.0.1:{s.server_port}'+PREFIX+'/'
 try:
  run(['node','--experimental-vm-modules',H/'nested-test.mjs',base,json.dumps(doc['workerRoutes'])],check=True,timeout=100)
  assert all(ok for p,ok in TR),[p for p,ok in TR if not ok]
  print(json.dumps({'allRealRequests':len(TR),'distinctReadPaths':len({p for p,_ in TR}),
      'allInNestedPrefix':all(p.startswith(PREFIX+'/') for p,_ in TR),'nonlocalRequests':0,'exactArchiveServedWithoutExtract':source is not None}))
 finally:s.shutdown();t.join()
