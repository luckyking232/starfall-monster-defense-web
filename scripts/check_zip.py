"""Read-only preflight for TapTap 游戏工具 ZIPs. Never extracts or runs contents."""
import argparse, hashlib, json, os, posixpath, re, stat, unicodedata, zipfile, zlib
from html.parser import HTMLParser
from urllib.parse import unquote, urljoin, urlsplit

MAX_ZIP = 314572800
# Conservative budgets for this checker, not published TapTap requirements.
MAX_TOTAL = 768 * 1024**2
MAX_TEXT = 8 * 1024**2
MAX_MEMBERS = 16000
MOUNT = 'https://preflight.invalid/host/nested/tool/'
MOUNT_PATH = urlsplit(MOUNT).path
TEXT = {'.html', '.htm', '.css', '.js', '.mjs'}
Q = r"""["']([^"'\r\n]+)["']"""
CSS = (re.compile(r'url\(\s*'+Q+r'\s*\)',re.I),
       re.compile(r"""url\(\s*([^"'()\s][^()\s]*)\s*\)""",re.I),
       re.compile(r'@import\s+'+Q,re.I))
JS = (re.compile(r'\b(?:import|export)\s+(?:[^;\r\n]{0,1024}?\bfrom\s+)?'+Q),
      re.compile(r'\b(?:import|fetch|importScripts|(?:Shared)?Worker|URL)\s*\(\s*'+Q+r'(?=\s*[,)])'))
DYNAMIC = re.compile(r"""\b(?:import|fetch|importScripts|(?:Shared)?Worker|URL)\s*\(\s*[^"']|["']\s*\+""")
BAD = re.compile(r'[\x00-\x1f\x7f\\:%?*"< >\|#]'.replace(' ', ''))
DEVICE = re.compile(r'^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)', re.I)


class Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.refs, self.inline = [], []
        self.kind = None
        self.base = self.srcset = False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'base':
            self.base = True
        if tag in ('style', 'script'):
            self.kind = tag
        if a.get('style'):
            self.inline.append(('style', a['style']))
        self.srcset |= bool(a.get('srcset') or a.get('imagesrcset'))
        for key in ('src', 'href', 'poster'):
            if a.get(key):
                if tag == 'a' and key == 'href' and re.match(r'(?:https?://|mailto:)', a[key], re.I):
                    self.refs.append(('external-navigation', a[key]))
                else:
                    self.refs.append((tag+'['+key+']', a[key]))

    def handle_endtag(self, tag):
        if tag == self.kind:
            self.kind = None

    def handle_data(self, data):
        if self.kind and data:
            self.inline.append((self.kind, data))


def check(source, byte_count):
    errors, warnings, files, loc, refs = [], [], {}, {}, set()
    total, wrapper = 0, None

    def result():
        return dict(status='FAIL' if errors else 'STATIC_PREFLIGHT_ONLY', zip_bytes=byte_count,
                    zip_limit=MAX_ZIP, wrapper=wrapper, files=len(files),
                    declared_uncompressed_bytes=total, static_reference_count=len(refs),
                    errors=errors, manual_review=sorted(set(warnings)), browser_required=[
                        'Load at a nested URL; inspect network failures, console, MIME, MIME for WASM, workers and fonts.',
                        'Verify keyboard/touch, resizing/orientation, sound unlock, choice and settlement on real target browsers.',
                        'Confirm redistribution rights and TapTap acceptance separately. No upload or review submission.'])

    if not 0 < byte_count <= MAX_ZIP:
        errors.append('Empty ZIP or exceeds 314572800 bytes.')
        return result()
    try:
        with zipfile.ZipFile(source) as jar:
            infos = jar.infolist()
            if not 0 < len(infos) <= MAX_MEMBERS:
                errors.append('Empty ZIP or exceeds local member budget.')
                return result()
            dirs, members = set(), set()
            for it in infos:
                raw = it.orig_filename
                name = raw.removesuffix('/')
                parts = name.split('/')
                if (raw != it.filename or len(raw) > 1024 or BAD.search(raw)
                        or any(not p or p in ('.','..') or p[-1] in ' .' or DEVICE.match(p) for p in parts)):
                    errors.append('Unsafe name: '+repr(raw))
                    continue
                if name in members:
                    errors.append('Duplicate member: '+repr(name))
                members.add(name)
                if any(p in {'.git', '.env', 'node_modules', '__MACOSX', '.DS_Store', 'Thumbs.db'} or p.startswith('.env.') for p in parts):
                    errors.append('Private or unnecessary development/system file: '+repr(name))
                for i in range(1,len(parts)+1):
                    p = '/'.join(parts[:i])
                    key = unicodedata.normalize('NFC',p).casefold()
                    if key in loc and p != loc[key]:
                        errors.append('Case or Unicode collision: '+repr(p)+' / '+repr(loc[key]))
                    loc[key] = p
                    if i < len(parts):
                        dirs.add(p)
                typ = stat.S_IFMT(it.external_attr >> 16)
                if typ not in (0, stat.S_IFDIR if it.is_dir() else stat.S_IFREG):
                    errors.append('Non-regular ZIP entry: '+repr(name))
                if it.flag_bits & 1 or it.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                    errors.append('Encrypted or unsupported compression: '+repr(name))
                if it.is_dir():
                    dirs.add(name)
                    if it.file_size or it.CRC:
                        errors.append('Nonempty directory entry: '+repr(name))
                else:
                    files[name] = it
                total += it.file_size
            for p in sorted(dirs & files.keys()):
                errors.append('File/directory collision: '+repr(p))
            roots = {x.split('/')[0] for x in members}
            if len(roots) != 1:
                errors.append('Expected exactly one wrapper directory.')
                return result()
            wrapper = roots.pop()
            entry = wrapper+'/index.html'
            if wrapper in files or entry not in files or not files[entry].file_size:
                errors.append('Missing nonempty wrapper/index.html.')
            if total > MAX_TOTAL:
                errors.append('Exceeds local safe streaming budget (768 MiB).')
            if errors:
                return result()
            with jar.open(files[entry]) as html:
                if b'starfall-local-editable-preview' in html.read(65536):
                    errors.append('Local editable preview cannot be packaged or deployed.')
                    return result()

            def ref(origin, kind, value):
                value = value.strip()
                if not value or value.startswith('#'):
                    return
                if kind == 'external-navigation':
                    warnings.append(origin+': external hyperlink (not an embedded resource): '+repr(value))
                    return
                if value.lower().startswith(('data:', 'blob:')):
                    warnings.append(origin+': '+kind+' inline/blob resource requires runtime coverage.')
                    return
                if value.startswith('/') or re.match(r'^[A-Za-z][A-Za-z0-9+.-]*:',value):
                    errors.append(origin+': non-relative '+kind+' '+repr(value))
                    return
                if re.search(r'[\\\x00-\x1f]|%(?:00|2e|2f|5c)',value,re.I):
                    errors.append(origin+': ambiguous URL '+repr(value))
                    return
                url = urljoin(MOUNT + origin[len(wrapper)+1:],value)
                target = urlsplit(url)
                if not url.startswith(MOUNT):
                    errors.append(origin+': URL escapes nested mount '+repr(value))
                    return
                p = wrapper+'/'+unquote(target.path[len(MOUNT_PATH):], errors='strict')
                if p.endswith('/') and p+'index.html' in files:
                    p += 'index.html'
                if p not in files:
                    # JS string matching does not establish URL base, execution, or whether this is even code.
                    dest = warnings if kind == 'script' else errors
                    dest.append(origin+': missing literal '+kind+' '+repr(value)+'; JS base/flow requires browser verification.' if kind == 'script' else origin+': missing literal '+kind+' '+repr(value))
                    return
                refs.add((origin,kind,p))

            for member,it in files.items():
                ext = posixpath.splitext(member)[1].lower()
                keep = ext in TEXT and it.file_size <= MAX_TEXT
                if ext in TEXT and not keep:
                    warnings.append(member+': text exceeds local scan budget.')
                consumed = 0
                buf = bytearray()
                with jar.open(it) as f:
                    while part := f.read(128*1024):
                        consumed += len(part)
                        if consumed > it.file_size:
                            raise ValueError('Member exceeds declared size.')
                        if keep:
                            buf.extend(part)
                if consumed != it.file_size:
                    raise ValueError('Member shorter than declared size.')
                if not keep:
                    continue
                body = buf.decode('utf-8-sig')
                if ext in ('.html','.htm'):
                    h = Page()
                    h.feed(body)
                    h.close()
                    if h.base:
                        errors.append(member+': <base> overrides nested URL resolution.')
                    if h.srcset:
                        warnings.append(member+': srcset/imagesrcset requires browser coverage.')
                    for kind,value in h.refs:
                        ref(member,kind,value)
                    blocks = h.inline
                else:
                    blocks = [('style' if ext == '.css' else 'script', body)]
                for kind,data in blocks:
                    data = re.sub(r'/\*[\s\S]*?\*/','',data) if kind == 'style' else data
                    for rx in CSS if kind == 'style' else JS:
                        for m in rx.finditer(data):
                            ref(member,kind,m.group(1))
                    if kind == 'script' and DYNAMIC.search(data):
                        warnings.append(member+': computed URL requires browser coverage.')
    except (OSError, ValueError, UnicodeError, RuntimeError, NotImplementedError, zipfile.BadZipFile, zlib.error) as exc:
        errors.append(f'Cannot safely parse ZIP: {type(exc).__name__}: {exc}')
    return result()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('archive')
    try:
        with open(p.parse_args().archive,'rb') as f:
            r = check(f,os.fstat(f.fileno()).st_size)
            f.seek(0)
            digest = hashlib.sha256()
            while chunk := f.read(1024*1024):
                digest.update(chunk)
            r['sha256'] = digest.hexdigest()
    except OSError as e:
        p.error(str(e))
    print(json.dumps(r,ensure_ascii=False,indent=2))
    return 2 if r['status']=='FAIL' else 0


if __name__ == '__main__':
    raise SystemExit(main())
