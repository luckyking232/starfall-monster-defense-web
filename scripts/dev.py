"""Build the pinned replica in a temporary workspace and serve it on loopback."""
import argparse
from hashlib import sha256
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib.util import module_from_spec, spec_from_file_location
import json
import mimetypes
from pathlib import Path
import re
import sys
import tempfile
from urllib.parse import quote, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from setup_local_replica import materialize, read_lock, replica_source, BUILDER

PAGES = '/play/'
HOST = '127.0.0.1'
GITHUB = 'github.com'
CDN = frozenset(('release-assets.githubusercontent.com','objects.githubusercontent.com'))
FIRST = '/luckyking232/starfall-monster-defense-web/releases/download/v0.1.0-alpha.1/MonsterDefense-source-inputs-v0.1.0-alpha.1.zip'


def download_input(spec):
    def allowed(url, initial=False):
        u=urlsplit(url)
        if (u.scheme!='https' or u.username or u.password or u.port or u.fragment or
                (initial and (u.netloc!=GITHUB or u.path!=FIRST or u.query)) or
                (not initial and u.netloc not in CDN)):
            raise ValueError('Only the pinned GitHub release or its standard CDN redirect is allowed')

    class Redirect(HTTPRedirectHandler):
        max_redirections=3
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            allowed(newurl)
            return super().redirect_request(req, fp, code, msg, headers, newurl)

    allowed(spec['url'],True)
    with build_opener(Redirect()).open(Request(spec['url'],headers={'Accept':'application/zip'}), timeout=30) as r:
        advertised=r.headers.get('Content-Length')
        if advertised is not None and advertised != str(spec['size']):
            raise ValueError('Release returned an unexpected asset size')
        raw=r.read(spec['size']+1)
    if len(raw)!=spec['size'] or sha256(raw).hexdigest()!=spec['sha256']:
        raise ValueError('Release input differs from the checked-in lock')
    return raw


def load_builder(tree):
    local=tree/BUILDER
    sys.path.insert(0,str(local.parent))
    try:
        spec=spec_from_file_location('local_wip_builder',local)
        module=module_from_spec(spec)
        spec.loader.exec_module(module)
        return module, module.archive_bytes()
    finally:
        sys.path.pop(0)


def static_routes(entries):
    root='xingluo-monsters-defense/'
    mapped={}
    for member,data in entries.items():
        if not member.startswith(root):
            raise ValueError('Built entry outside wrapper')
        k=PAGES+quote(member[len(root):],safe='/')
        ext=Path(member).suffix
        mime={'.mjs':'text/javascript','.js':'text/javascript','.wasm':'application/wasm',
              '.lua':'text/plain; charset=utf-8','.otf':'font/otf'}.get(ext) or mimetypes.guess_type(member)[0]
        if k in mapped:
            raise ValueError('Duplicate serving path')
        mapped[k]=(mime or 'application/octet-stream',data)
    mapped[PAGES]=mapped[PAGES+'index.html']
    return mapped


def server(routes, port):
    class Local(ThreadingHTTPServer):
        daemon_threads=True
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self): self.respond(True)
        def do_HEAD(self): self.respond(False)
        def respond(self, body):
            allowed_host=f'{HOST}:{self.server.server_port}'
            if (self.client_address[0]!=HOST or self.headers.get_all('Host')!=[allowed_host] or
                self.headers.get_all('Origin',[]) not in ([],['http://'+allowed_host]) or
                self.headers.get('Sec-Fetch-Site') not in (None,'none','same-origin')):
                self.send_error(403); return
            if self.path not in routes:
                self.send_error(404); return
            mime,data=routes[self.path]
            self.send_response(200)
            self.send_header('Content-Type',mime)
            self.send_header('Content-Length',str(len(data)))
            self.send_header('Cache-Control','no-store')
            self.send_header('X-Content-Type-Options','nosniff')
            self.send_header('X-Frame-Options','DENY')
            self.end_headers()
            if body: self.wfile.write(data)
    return Local((HOST,port),Handler)


def main():
    args=argparse.ArgumentParser(description=__doc__)
    args.add_argument('--overlay',type=Path,help='use an already downloaded overlay; no network')
    args.add_argument('--source',type=Path,default=replica_source())
    args.add_argument('--port',type=int,default=8000,help='loopback port; keep the same port for the same local save')
    args.add_argument('--verify-only',action='store_true')
    a=args.parse_args()
    if not (a.port==0 or 1024<=a.port<=65535):
        args.error('port must be 0 or 1024–65535')
    try:
        lock=read_lock()
        incoming=a.overlay
        if incoming is None:
            print('Downloading the exact input asset from the public release…',flush=True)
            incoming=download_input(lock['inputs'])
        with tempfile.TemporaryDirectory(prefix='monster-defense-dev-') as tmp:
            tree=Path(tmp)/'replica'
            materialize(a.source.resolve(strict=True),incoming,tree)
            module,(entries,raw)=load_builder(tree)
            pin=lock['alpha']
            # zlib builds can differ across platforms. The runtime route bytes are
            # checked individually by the original recipes; recipe manifest remains
            # byte-equivalent regardless of container ZIP output differences.
            manifest_sha=sha256(entries[module.ROOT+'/MANIFEST-PRIVATE.json']).hexdigest()
            if len(entries)!=pin['entries'] or manifest_sha!=pin['manifestSha256']:
                raise ValueError('Built content does not match the exact Alpha')
            got=sha256(raw).hexdigest()
            if got==pin['sha256'] and len(raw)==pin['size']:
                print(f'Alpha exact ZIP SHA-256: {got}',flush=True)
            else:
                print(f'Alpha entries match the pinned manifest; ZIP compression differs: {got}',flush=True)
            if a.verify_only:
                return 0
            routes=static_routes(entries)
        with server(routes,a.port) as s:
            print(f'Open http://{HOST}:{s.server_port}{PAGES}   (Ctrl+C to stop)',flush=True)
            try: s.serve_forever()
            except KeyboardInterrupt: pass
    except (OSError, KeyError, ValueError, AssertionError) as e:
        print(f'Cannot launch replica: {e}',file=sys.stderr)
        return 2
    return 0

if __name__=='__main__':
    raise SystemExit(main())
