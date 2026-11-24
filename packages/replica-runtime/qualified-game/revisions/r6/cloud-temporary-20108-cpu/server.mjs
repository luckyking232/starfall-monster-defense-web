/** No file server, API, or route for a different registry: only exact R6 private reads. */
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {readFile,stat,realpath} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=await realpath(fileURLToPath(new URL('../../../../',import.meta.url)));
const manifestHash='1e1a52d7d8f58d7876a1671a785e25bfa1cefda5d65038cbac2c7be1ab11b791';
export const ENTRY='/qualified-game/';
const hash=b=>createHash('sha256').update(b).digest('hex');
const mime={'.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8',
 '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png',
 '.otf':'font/otf','.json':'application/json','.jsonl':'application/x-ndjson','.lua':'text/plain; charset=utf-8','.wasm':'application/wasm'};
async function materialize(){
 const raw=await readFile(new URL('./routes.json',import.meta.url));
 if(hash(raw)!==manifestHash)throw Error('Private route manifest changed');
 const flat=JSON.parse(raw);
 if(Object.keys(flat).length!==527||!Object.hasOwn(flat,ENTRY))throw Error('Unexpected route manifest scope');
 const routes=new Map();
 for(const [url,d] of Object.entries(flat)){
  if(url!==new URL(url,'http://127.0.0.1').pathname||typeof d.file!=='string'||
     !/^[a-f0-9]{64}$/.test(d.sha256)||!Object.hasOwn(mime,extname(d.file)))throw Error('Unsanctioned route');
  const path=resolve(root,d.file),actual=await realpath(path);
  if(path!==actual||!actual.startsWith(root+sep))throw Error('Unqualified route symlink');
  const st=await stat(actual);
  if(!st.isFile()||st.size<=0||(d.file==="native-font-shell/SOURCEHANSANSSC-NORMAL-2.otf"&&d.sha256==="c43383a8ac94024203f062537b5b3a0d0a5bf056172eff78673636ea8fb3c039"?st.size!==16523904:st.size>8*1024*1024))throw Error('Unqualified route size');
  const bytes=await readFile(actual);
  if(bytes.length!==st.size||hash(bytes)!==d.sha256)throw Error('Unqualified route bytes '+url);
  routes.set(url,{bytes,type:mime[extname(actual)]});
 }
 return routes;
}
async function createPrivateR6Server({enableR6=false}={}){
 if(typeof enableR6!=='boolean')throw Error('Explicit boolean opt-in required');
 const routes=enableR6?await materialize():new Map();
 const server=createServer((req,res)=>{
  const host='127.0.0.1:'+server.address().port;
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Cross-Origin-Resource-Policy','same-origin');
  res.setHeader('Cross-Origin-Opener-Policy','same-origin');
  res.setHeader('Content-Security-Policy',
   "default-src 'none'; script-src 'self' blob: 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self' blob:; img-src 'self' blob:; style-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  if(req.headers.host!==host||req.headers.origin&&req.headers.origin!=='http://'+host||
     req.headers['sec-fetch-site']&&!['same-origin','none'].includes(req.headers['sec-fetch-site'])){
   res.writeHead(403);return res.end();
  }
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'});return res.end();}
  const d=routes.get(req.url);
  if(!d){res.writeHead(404);return res.end();}
  res.writeHead(200,{'Content-Type':d.type,'Content-Length':d.bytes.length});
  return res.end(req.method==='HEAD'?undefined:d.bytes);
 });
 server.requestTimeout=10000;server.headersTimeout=5000;server.maxHeadersCount=48;
 await new Promise((ok,bad)=>{server.once('error',bad);server.listen(4173,'127.0.0.1',ok);});
 const {address,port}=server.address();
 return Object.freeze({address,port,url:'http://'+address+':'+port+'/',paths:Object.freeze([...routes.keys()]),
   close:()=>new Promise((ok,bad)=>server.close(e=>e?bad(e):ok()))});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 if(process.env.SITES_MANAGED_LINUX_CONTAINER!=='1'||
    JSON.stringify(process.argv.slice(2))!==JSON.stringify(['--enable-managed-temporary-20108-cpu','--host','127.0.0.1','--port','4173','--strictPort']))
   throw Error('Managed-only QA requires the exact opt-in and documented loopback tuple');
 const instance=await createPrivateR6Server({enableR6:true});
 console.log('Private R6 scoped composition · '+new URL(ENTRY,instance.url));
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>instance.close().catch(e=>{console.error(e);process.exitCode=1;}));
}
