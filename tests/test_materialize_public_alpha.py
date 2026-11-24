import hashlib, json, sys, tempfile, unittest, zipfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from materialize_public_alpha import LICENSES, deploy

class PagesArtifact(unittest.TestCase):
    def make(self, root, extra):
        contents = {p:'example notices' for p in LICENSES}
        contents.update({'index.html':'<script src="./game.js"></script>','game.js':'// fixture'})
        contents.update(extra)
        archive = root/'x.zip'
        with zipfile.ZipFile(archive,'w') as z:
            for n,s in contents.items():
                z.writestr('game/'+n,s)
        receipt = root/'receipt.json'
        receipt.write_text(json.dumps(dict(sha256=hashlib.sha256(archive.read_bytes()).hexdigest(),
            wrapper='game',members=len(contents),bytes=archive.stat().st_size)))
        return archive,receipt

    def test_expands_verified_wrapper_only(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d); a,r=self.make(p,{})
            deploy(a,r,p/'target')
            self.assertTrue((p/'target'/'index.html').exists())
            self.assertFalse((p/'target'/'game').exists())

    def test_refuses_altered_receipt_or_unsafe_paths(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d); a,r=self.make(p,{'../x.js':'forbidden'})
            with self.assertRaisesRegex(ValueError,'member'):
                deploy(a,r,p/'target')
            self.assertFalse((p/'target').exists())
            m=json.loads(r.read_text());m['sha256']='0'*64;r.write_text(json.dumps(m))
            with self.assertRaisesRegex(ValueError,'SHA'):
                deploy(a,r,p/'target')
