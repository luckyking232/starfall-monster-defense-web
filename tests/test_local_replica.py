from contextlib import redirect_stderr, redirect_stdout
from hashlib import sha256
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch


script = Path(__file__).resolve().parents[1] / 'scripts/check_local_replica.py'
spec = importlib.util.spec_from_file_location('check_local_replica', script)
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)


class LocalReplica(unittest.TestCase):
    def setUp(self):
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        root = Path(scratch.name)
        self.local = root / 'local'
        self.public = root / 'public'
        for x in (self.local, self.public):
            x.mkdir()

    def write(self, root, rel, value):
        b = json.dumps(value).encode() if not isinstance(value, bytes) else value
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b)
        return sha256(b).hexdigest()

    def recipe(self, *, route='../placeholder', error=False):
        pathkey = '/qa-hidden/a.js'
        output = {
            '/qualified-game/': {'file': route, 'sha256': '0' * 64},
            '/duplicate': {'file': route, 'sha256': ('1' if error else '0') * 64},
            '/discarded/': {'file': 'not-read', 'sha256': 'f'},
            pathkey: {'file': 'not-read', 'sha256': 'f'},
        }
        if route == 'index.html' and not error:
            h = self.write(self.local, route, b'handwritten fixture')
            output['/qualified-game/']['sha256'] = h
            output['/duplicate']['sha256'] = h
        route_pin = self.write(self.local, 'base/routes.json', output)
        parent_pin = self.write(self.local, 'base/VERIFICATION.json',
                                {'files': {'routes.json': route_pin}})
        witness = {'observer.mjs': {'sha256': '3' * 64}}
        witness_pin = self.write(self.local, 'revision/test/VERIFICATION.json', {'files': witness})
        return patch.multiple(check, PARENT='base', PARENT_SHA=parent_pin, REV='revision',
                              WITNESSES={'test': (witness_pin, ('observer.mjs',))})

    def test_enumerates_exact_private_recipe_and_deduplicates(self):
        with self.recipe(route='index.html'):
            actual = check.inputs(self.local, False)
        self.assertEqual(set(actual), {'base/routes.json', 'base/VERIFICATION.json', 'index.html',
                                       'revision/test/VERIFICATION.json', 'revision/test/observer.mjs'})
        with self.recipe(route='index.html', error=True), self.assertRaisesRegex(ValueError, 'Conflicting'):
            check.inputs(self.local, False)

    def test_preflight_hashes_each_source_and_does_not_copy(self):
        good = self.write(self.public, 'module.js', b'good')
        local = self.write(self.local, 'local.lua', b'fixture')
        self.write(self.public, 'local.lua', b'not the approved bytes')
        self.write(self.public, 'wrong.json', b'bad')
        rows = check.report(self.public, self.local,
                            {'module.js': good, 'local.lua': local, 'missing.png': 'e'*64,
                             'wrong.json': 'b'*64}, False)
        by_file = {r['path']: r['state'] for r in rows}
        self.assertEqual([by_file[k] for k in ('module.js', 'local.lua', 'missing.png', 'wrong.json')],
                         ['public', 'local', 'missing', 'mismatch'])
        self.assertFalse((self.local / 'module.js').exists())

    def test_rejects_recipe_with_path_escapes_or_symlink(self):
        for rel in ('../placeholder', '/absolute', './x', 'abc//x', 'C:\\x'):
            with self.recipe(route=rel), self.assertRaisesRegex(ValueError, 'path'):
                check.inputs(self.local, False)
        (self.local / 'link').symlink_to(self.public, target_is_directory=True)
        with self.recipe(route='link/secret'), self.assertRaisesRegex(ValueError, 'Symlink'):
            check.inputs(self.local, False)

    def test_missing_recipe_is_explicit_not_success(self):
        args = [str(script), '--local', str(self.local), '--public-source', str(self.public)]
        stderr = io.StringIO()
        with patch.object(sys, 'argv', args), redirect_stderr(stderr), redirect_stdout(io.StringIO()):
            self.assertEqual(check.main(), 2)
        self.assertIn('Recipe required before exact enumeration', stderr.getvalue())


if __name__ == '__main__':
    unittest.main()
