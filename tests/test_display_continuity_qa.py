import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import materialize_display_continuity_qa as overlay

class ContinuityOverlayTests(unittest.TestCase):
    def test_real_patch_declares_only_five_existing_presentation_modules(self):
        pins=json.loads((overlay.HERE/'PATCH-RECEIPT.json').read_bytes())
        self.assertEqual(len(pins),5)
        for path,pin in pins.items():
            self.assertTrue(path.startswith('qualified-game/revisions/r6/'))
            self.assertTrue(path.endswith(('.mjs','/companion.js')))
            self.assertNotIn('/site/session',path)
            self.assertNotIn('/worker.js',path)
            self.assertRegex(pin['before'],r'^[a-f0-9]{64}$')
            self.assertRegex(pin['after'],r'^[a-f0-9]{64}$')
            self.assertNotEqual(pin['before'],pin['after'])

    def test_mount_is_atomic_deterministic_and_updates_exact_descriptors(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);base=root/'base';base.mkdir();fixture=root/'patch';fixture.mkdir()
            name='world.mjs'; old=b'const a=1;\n';new=b'const a=2;\n'
            (base/name).write_bytes(old)
            (base/'unrelated').write_text('not changed')
            led=base/overlay.LEDGER;led.parent.mkdir()
            table={'/'+name:overlay.sig(old)}
            led.write_text(overlay.PREFIX+json.dumps(table)+');\nglobalThis.workerRoutes=[];')
            (base/overlay.RECEIPT).write_text(json.dumps({'rawFiles':
                {name:overlay.sig(old),overlay.LEDGER:overlay.sig(led.read_bytes()),
                 'unrelated':overlay.sig((base/'unrelated').read_bytes())}}))
            (fixture/'PATCH-RECEIPT.json').write_text(json.dumps(
                {name:{'before':hashlib.sha256(old).hexdigest(),'after':hashlib.sha256(new).hexdigest()}}))
            (fixture/'portable-alpha1-display-continuity.patch').write_text(
                '--- a/world.mjs\n+++ b/world.mjs\n@@ -1 +1 @@\n-const a=1;\n+const a=2;\n')
            with patch.object(overlay,'HERE',fixture):
                with self.assertRaisesRegex(ValueError,'cannot be mixed'):
                    overlay.mount(base,root/'wrong',startup=True)
                self.assertFalse((root/'wrong').exists())
                out=root/'result'
                overlay.mount(base,out)
                self.assertEqual((base/name).read_bytes(),old)
                self.assertEqual((out/name).read_bytes(),new)
                self.assertEqual((out/'unrelated').read_text(),'not changed')
                m=json.loads((out/overlay.RECEIPT).read_bytes())
                self.assertEqual(m['rawFiles'][name],overlay.sig(new))
                self.assertEqual(m['rawFiles'][overlay.LEDGER],overlay.sig((out/overlay.LEDGER).read_bytes()))
                self.assertIs(m['displayContinuityCandidate']['publishedArtifact'],False)
                with self.assertRaisesRegex(ValueError,'new output'):
                    overlay.mount(base,out)
                (base/'extra').write_text('unexpected')
                with self.assertRaisesRegex(ValueError,'Alpha inventory'):
                    overlay.mount(base,root/'extra')
                (base/'extra').unlink()
                (base/name).write_bytes(b'const a=0;\n')
                with self.assertRaisesRegex(ValueError,'input drift'):
                    overlay.mount(base,root/'bad')
                self.assertFalse((root/'bad').exists())
