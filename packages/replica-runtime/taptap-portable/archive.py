"""Build/verify one private preflight portable wrapper ZIP. Never deploys or extracts."""
from pathlib import Path, PurePosixPath
from urllib.parse import unquote
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from io import BytesIO
import argparse,json,shutil,stat,sys
from plan import H,generate,enc,sha
ROOT='xingluo-monsters-defense'
MARGIN=12*1024**3+30_000_000+1024**2
MAX=300*1024**2
README="""魔物抵御战 · 私有静态 H5 预检包
独立研究用复刻，不是《星落》官方网页或公开发布版；原素材与角色权利归权利方。此包未上传 TapTap。上传、发行及再传播前需自行确认授权。
ZIP 内只有一个目录，入口 xingluo-monsters-defense/index.html。需通过该目录下的 HTTPS 静态页面或本机 HTTP 回环静态服务访问，勿用 file://。保持目录结构；网页 Worker、WASM、字体和资源均随包，不登录也不调用游戏服务。
使用原规则及已核验的原资源画面。已知未完全复现原生粒子、混音、Unity 动画时钟、部分 HUD；未核验的场景仍可能只显示规则或暂停画面。第 21 关为单独可选的有限验证，非完整无尽复刻。
这是本地工程预检，不代表 TapTap 审核通过、真实启动兼容或可公开发行。
""".encode()
def assemble():
 files,plan=generate();docs='/私有预检说明.txt'
 # This UTF-8 file is an artifact note, not a runtime route.
 files[docs]=README
 manifest=enc({'schema':'starfall-taptap-private-preflight-artifact/1','enginePlan':plan,
    'rawFiles':{unquote(k)[1:]:[len(b),sha(b)] for k,b in files.items()}})
 files['/MANIFEST-PRIVATE.json']=manifest
 inner={ROOT+'/'+unquote(p)[1:]:b for p,b in files.items()}
 assert len(inner)==len(files)
 for k in inner:
  p=PurePosixPath(k);assert p.parts[0]==ROOT and p.name!='' and all(x not in ('','.','..') for x in p.parts)
 return inner
def check(f,example=None):
 docs=ROOT+'/MANIFEST-PRIVATE.json'
 with ZipFile(f) as z:
  names=z.namelist();assert len(names)==len(set(names)) and len(set(n.split('/')[0] for n in names))==1
  assert ROOT+'/index.html' in names and not any(n.startswith('/') or '\\' in n or '..' in n.split('/') for n in names)
  mf=json.loads(z.read(docs));expected={ROOT+'/'+k:val for k,val in mf['rawFiles'].items()}
  assert set(names)==set(expected)|{docs}
  assert all(not i.is_dir() and stat.S_IFMT(i.external_attr>>16)==stat.S_IFREG and not i.flag_bits&1 for i in z.infolist())
  for name,x in expected.items():b=z.read(name);assert x==[len(b),sha(b)],name
  if example is not None:assert names==sorted(example) and all(z.read(k)==v for k,v in example.items())
  assert z.testzip() is None
 return {'entries':len(names),'entry':ROOT+'/index.html','manifestSha256':sha(mf and (enc(mf))),'verifiedNoExternalData':True}
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--write',type=Path);p.add_argument('--verify',type=Path);a=p.parse_args()
 assert bool(a.write)!=bool(a.verify),'choose exactly write or verify'
 if a.verify:
  assert a.verify.stat().st_size<=MAX
  report=check(a.verify,assemble());print(json.dumps({**report,'bytes':a.verify.stat().st_size,'sha256':sha(a.verify.read_bytes())},ensure_ascii=False));sys.exit()
 out=a.write.resolve();assert out.parent==H and not out.exists() and out.suffix=='.zip' and '预检' in out.name,'Only additive private preflight output'
 files=assemble();buf=BytesIO()
 with ZipFile(buf,'w',compression=ZIP_DEFLATED,compresslevel=6) as z:
  for k in sorted(files):
   i=ZipInfo(k,(2026,11,24,0,0,0));i.external_attr=(stat.S_IFREG|0o644)<<16;i.compress_type=ZIP_DEFLATED
   z.writestr(i,files[k],compresslevel=6)
 b=buf.getvalue();assert 0<len(b)<=MAX
 report=check(BytesIO(b),files)
 assert shutil.disk_usage(H).free-len(b)>=MARGIN,'Minimum space after draft below hard floor + transfer margin'
 with out.open('xb') as f:f.write(b)
 assert out.stat().st_size==len(b) and sha(out.read_bytes())==sha(b)
 print(json.dumps({**report,'bytes':len(b),'sha256':sha(b),'privateDraft':out.name,'uploaded':False},ensure_ascii=False))
