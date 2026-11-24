"""Build a deterministic public-alpha ZIP only after local approval. No network."""
from archive import H, ROOT, MARGIN, check, enc, sha
from plan import generate, one
from io import BytesIO
from pathlib import Path, PurePosixPath
from urllib.parse import unquote
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import argparse
import re
import shutil
import stat
import struct

NAME = 'MonsterDefense-v0.1.0-alpha.1.zip'
VERSION = 'v0.1.0-alpha.1'
VENDOR = H.parent / 'core-worker' / 'inputs' / 'vendor'
NOTICE_PATH = Path('/usr/share/common-licenses/OFL-1.1')
README = """魔物抵御战 Web 复刻 · v0.1.0-alpha.1 开发预览
非官方项目；不是《星落》客户端，也不是完成版或 TapTap 验收版。
将此目录作为 HTTPS 静态站点根目录（也可以是同源子目录），或使用 HTTP 本机回环地址。不能通过 file:// 运行。入口 index.html，无需登录，不连接原游戏服务。
原规则仍驱动战斗、升级和结算。有限关卡通关在主动确认结算后保存在浏览器；浏览器拒绝存储时，仅保留会话进度。不同站点子目录不共享进度。第21关只提供有边界的规则验证，默认关闭。
部分关卡或特效可能隐藏画面；尚未完整复现原弹道、原生粒子、音频混音和部分 HUD。此开发预览不代表手机 WebView/TapTap 或所有场景验收。
"""
NOTICE = """Third-party notices / 第三方版权说明

Project-authored code uses the project's separate license; it does not cover game assets.
Original game Lua and graphical assets retain their original rightsholders' rights. The project owner confirmed permission for this project's public distribution of those included game materials; this statement does not grant any further license or imply official endorsement.

Wasmoon 1.16.0: MIT; see Wasmoon-MIT.txt.
Lua runtime within Wasmoon: Lua license; see Lua-License.txt.
Source Han Sans SC Medium Version 2.004: Adobe, SIL Open Font License 1.1; see Source-Han-Sans-OFL-1.1.txt. The asset's packaged filename is an alias, not the font family name.
"""
SENSITIVE = re.compile(rb'(?i)BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY|ghp_[A-Za-z0-9]{28,}|github_pat_[A-Za-z0-9_]{40,}|sk-(?:proj-)?[A-Za-z0-9_\-]{25,}|\bAKIA[A-Z0-9]{16}\b|\bAIza[A-Za-z0-9_-]{30,}|eyJ[A-Za-z0-9_-]{12,}\.eyJ[A-Za-z0-9_-]{10,}\.|/workspace/|/home/agent/|C:\\Users\\|E:\\All-Projects|sdmntpr|chenji|luckyking|outlook\.com|drive\.google\.com')
SECRETS = re.compile(rb'''(?i)(?:password|passwd|access_token|authorization|client_secret|sessionid|cookie|bearer)\s*["']?\s*[:=]\s*["'][^"'\r\n]{7,}''')

def review(name, data):
    ext = PurePosixPath(name).suffix
    if ext in ('.png', '.otf', '.wasm'):
        if ext == '.png':
            assert data[:8] == b'\x89PNG\r\n\x1a\n'
            j = 8
            while j < len(data):
                n, kind = struct.unpack_from('>I4s', data, j)
                # No embedded PNG comments or EXIF; retain stock graphics only.
                assert kind not in (b'tEXt', b'zTXt', b'iTXt', b'eXIf'), (name,kind)
                j += 12+n
            assert j == len(data), name
        return
    assert ext in ('.lua','.js','.mjs','.json','.jsonl','.html','.css','.txt'), name
    data.decode('utf-8')
    assert not SENSITIVE.search(data) and not SECRETS.search(data), name


def assemble():
    entries, plan = generate(with_progress=True)
    source = entries['/index.html'].decode()
    source = one(source, '<title>魔物抵御战｜私有多关卡源验证</title>',
                 f'<title>魔物抵御战｜开发预览 {VERSION}（非官方）</title>')
    source = one(source, '私有离线诊断 · 非发布版 · Android 134377281279792758',
                 '开发预览 v0.1.0-alpha.1 · 非官方 · 原规则版本 134377281279792758')
    source, count = re.subn(r'(?s)<p>同一原版规则与选关：.*?</p>',
      '<p>原规则驱动战斗、升级和结算。确认通关结算后可在当前浏览器保存进度。'
      '部分原生特效、音频和 HUD 尚未复现；遇到未验收画面时不替画。第 21 关仅为有限验证，默认关闭。</p>', source)
    assert count == 1
    entries['/index.html'] = source.encode()
    local_ofl = H / 'licenses' / 'Source-Han-Sans-OFL-1.1.txt'
    if local_ofl.is_file():
        font_notice = local_ofl.read_bytes()
    else:
        ofl = NOTICE_PATH.read_bytes()
        font_notice = (
            "© 2014-2021 Adobe (http://www.adobe.com/), with Reserved Font Name 'Source'.\n\n".encode()
            + ofl[ofl.index(b'This Font Software is licensed'):])
    assert sha(font_notice) == '8d0f91a6f2007777d23a7173bcc8daa7b73733408a7bfb083827b5d0fad0b669'
    entries.update({
        '/README.zh-CN.txt': README.encode(),
        '/LICENSES/NOTICES.txt': NOTICE.encode(),
        '/LICENSES/Wasmoon-MIT.txt': (VENDOR / 'LICENSE').read_bytes(),
        '/LICENSES/Lua-License.txt': (VENDOR / 'LUA-LICENSE').read_bytes(),
        '/LICENSES/Source-Han-Sans-OFL-1.1.txt': font_notice,
    })
    assert sha(entries['/LICENSES/Wasmoon-MIT.txt']) == '9ed9226c0138819a0859cf3c55a3414b4a186a17a4eaf4b5a51ceed7937615ac'
    assert sha(entries['/LICENSES/Lua-License.txt']) == 'fce99dce100557696d8d8b8a2e040d68f816cfe52692d4373aa40e22247beeb6'
    for k,v in entries.items():
        review(k,v)
    # The archive's existing verifier requires this filename to validate raw entries.
    # It is private-build lineage metadata, not a restriction on this WIP artifact.
    entries['/MANIFEST-PRIVATE.json'] = enc({
        'schema': 'starfall.taptap-public-alpha-artifact/1', 'version': VERSION,
        'enginePlan': plan,'notOfficial': True,'notFullVisualParity': True,
        'rawFiles': {unquote(k)[1:]: [len(b),sha(b)] for k,b in entries.items()}})
    inner = {ROOT + '/' + unquote(k)[1:]: v for k,v in entries.items()}
    assert len(inner)==len(entries)
    return inner


def archive_bytes():
    entries=assemble()
    tmp=BytesIO()
    with ZipFile(tmp,'w',compression=ZIP_DEFLATED,compresslevel=9) as z:
        for k,v in sorted(entries.items()):
            zi=ZipInfo(k,(2026,11,24,0,0,0))
            zi.create_system=3
            zi.external_attr=(stat.S_IFREG | 0o644)<<16
            z.writestr(zi,v,compress_type=ZIP_DEFLATED,compresslevel=9)
    check(BytesIO(tmp.getbuffer()),entries)
    return entries,tmp.getbuffer()


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--write',action='store_true')
    p.add_argument('--verify',action='store_true')
    a=p.parse_args()
    assert not(a.write and a.verify)
    dst=H/NAME
    entries,got=archive_bytes()
    print(enc({'file':NAME,'size':len(got),'sha256':sha(got),
        'entries':len(entries),'uncompressed':sum(map(len,entries.values())),
        'freeBeforeWrite':shutil.disk_usage(H).free,'reserve':MARGIN}).decode().strip())
    if a.write:
        assert len(got)<300*1024**2 and shutil.disk_usage(H).free-len(got)>=MARGIN
        created=False
        try:
            with dst.open('xb') as f:
                created=True
                f.write(got)
            check(dst,entries)
        except Exception:
            if created:
                dst.unlink()
            raise
    if a.verify:
        assert sha(dst.read_bytes())==sha(got)
        check(dst,entries)


if __name__ == '__main__':
    main()
