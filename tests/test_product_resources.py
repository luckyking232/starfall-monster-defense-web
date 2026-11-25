"""Unit tests for the verified-byte placement map."""
import sys
from pathlib import Path
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from audit_runtime import sig
from product_resources import move_pinned_resources

class ProductResources(unittest.TestCase):
    old='core-worker/inputs/lua/BaseShootStage.lua'
    new='assets/lua/battle/BaseShootStage.lua'
    alias='/verified/alias.lua'
    data=b'raw Lua input'
    def test_remaps_existing_aliases_without_copying_or_changing_the_bytes(self):
        files={self.old:self.data,'untouched.js':b'x'}
        mark=sig(self.data)
        routes={'/'+self.old:mark,self.alias:[*mark,'/'+self.old]}
        self.assertEqual(move_pinned_resources(files,routes,[],sig),{self.old:self.new})
        self.assertEqual(files,{self.new:self.data,'untouched.js':b'x'})
        self.assertEqual(routes['/'+self.new],mark)
        self.assertEqual(routes['/'+self.old],routes[self.alias])
        self.assertEqual(routes[self.alias],[*mark,'/'+self.new])

    def test_refuses_existing_destination_worker_or_mismatched_alias(self):
        mark=sig(self.data)
        for files,routes,workers in [
            ({self.old:self.data,self.new:b'existing'},{'/'+self.old:mark},[]),
            ({self.old:self.data},{'/'+self.old:mark},['/'+self.old]),
            ({self.old:self.data},{'/'+self.old:mark,self.alias:[*sig(b'other data'),'/'+self.old]},[]),
        ]:
            with self.subTest(files=files,routes=routes,workers=workers):
                with self.assertRaises(ValueError):move_pinned_resources(files,routes,workers,sig)
