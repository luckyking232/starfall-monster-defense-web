from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.extract_content import entries


class ExtractContentTest(unittest.TestCase):
    def test_multiline_tables_and_final_entry(self):
        sample = '''BaseShootStage = {
  [78000001] = {
    id = 78000001,
    name = function()
      return T(80220001, "01")
    end,
    card_id = {
      78000110,
      78000101,
      78000102
    },
    card_pos = {
      505,
      204,
      206
    },
    level_time = {
      30,
      75,
      140,
      200
    },
    active_buff_list = {
      "78040101:3001:10000"
    },
    size = {30, 9}
  }
}
'''
        [(_, stage)] = entries(sample)
        self.assertEqual(stage['card_id'], [78000110, 78000101, 78000102])
        self.assertEqual(stage['card_pos'], [505, 204, 206])
        self.assertEqual(stage['level_time'], [30, 75, 140, 200])
        self.assertEqual(stage['active_buff_list'], ['78040101:3001:10000'])
        self.assertEqual(stage['size'], [30, 9])

    def test_compact_original_word_entries(self):
        sample = 'BaseWord_cn = {\n  [80101118] = {id = 80101118, name = "安妮斯"},\n  [80440120] = {id = 80440120, name = "裂波术"},\n}\n'
        parsed = dict(entries(sample))
        self.assertEqual(parsed[80101118]['name'], '安妮斯')
        self.assertEqual(parsed[80440120]['name'], '裂波术')

    def test_unterminated_table_is_not_accepted_as_a_scalar(self):
        with self.assertRaises(ValueError):
            list(entries('Data = {\n  [1] = {\n    values = {\n      30\n  }\n}\n'))


if __name__ == '__main__':
    unittest.main()
