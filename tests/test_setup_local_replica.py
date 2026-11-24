from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import setup_local_replica as setup


class SetupGuards(unittest.TestCase):
    def test_rejects_invalid_output_paths_before_writing(self):
        for names in (
            ('../escape',), ('C:/device',), ('hi//there',), ('nested/AUX.txt',),
            ('nested/a ',), ('hi', 'hi/there'), ('alpha/A', 'alpha/a')):
            with self.subTest(names=names), self.assertRaises(ValueError):
                setup.check_names(names)
        setup.check_names(['case/中文.txt','case/hello.js'])

    def test_rejects_wrong_zip_before_creating_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            source=root/'checkout'/'source'
            source.mkdir(parents=True)
            (source/'PUBLIC-SOURCE-LIST.txt').write_text(setup.BUILDER+'\n')
            builder=source/setup.BUILDER
            builder.parent.mkdir()
            builder.write_bytes(b'not executed')
            archive=root/'bad.zip'
            archive.write_bytes(b'not verified')
            dest=root/'output'
            with self.assertRaises(ValueError):
                setup.materialize(source,archive,dest)
            self.assertFalse(dest.exists())
