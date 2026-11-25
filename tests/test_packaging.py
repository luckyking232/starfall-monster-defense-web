import hashlib, io, json, sys, tempfile, unittest, zipfile
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from check_zip import check
from package_zip import prepare

class Checks(unittest.TestCase):
    def inspect(self, items):
        f=io.BytesIO()
        with zipfile.ZipFile(f,'w') as z:
            for name,body in items:
                z.writestr(name,body)
        return check(f,len(f.getbuffer()))

    def test_nested_paths(self):
        r=self.inspect([('tool/index.html','<link href="./css/app.css">'),
                        ('tool/css/app.css','@font-face{src:url(../f.woff2)}'),
                        ('tool/f.woff2','fixture')])
        self.assertEqual(r['status'],'STATIC_PREFLIGHT_ONLY')
        self.assertEqual(r['static_reference_count'],2)

    def test_reject_unsafe_paths(self):
        for tail in [('tool/../x','x'),('tool/.env','x'),('tool/A.png','x'),('other/file','x')]:
            r=self.inspect([('tool/index.html','<h1>x</h1>'),('tool/a.png','x'),tail])
            self.assertEqual(r['status'],'FAIL')
        self.assertEqual(self.inspect([('index.html','x')])['status'],'FAIL')
        self.assertEqual(self.inspect([('tool/index.html','<img src="/bad.png">')])['status'],'FAIL')

    def test_deterministic_and_gate(self):
        with tempfile.TemporaryDirectory() as tmp:
            d=Path(tmp)
            root=d/'build'; root.mkdir()
            page=b'<h1>Synthetic fixture only</h1>'
            (root/'index.html').write_bytes(page)
            cfg=d/'manifest.json'
            cfg.write_text('{}')
            with self.assertRaisesRegex(ValueError,'HOLD'):
                prepare(root,cfg,d/'fail.zip')
            cfg.write_text(json.dumps({'eligibility':'public-playable','files':{
                'index.html':{'bytes':len(page),'sha256':hashlib.sha256(page).hexdigest(),
                              'license':'original-mit','provenance':'synthetic test'}}}))
            prepare(root,cfg,d/'one.zip')
            prepare(root,cfg,d/'two.zip')
            self.assertEqual((d/'one.zip').read_bytes(),(d/'two.zip').read_bytes())
            (root/'index.html').write_bytes(b'<h1>changed</h1>')
            with self.assertRaisesRegex(ValueError,'hash mismatch'):
                prepare(root,cfg,d/'changed.zip')
            self.assertFalse((d/'changed.zip').exists())

if __name__=='__main__':
    unittest.main()
