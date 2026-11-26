import json
from pathlib import Path
import unittest


CONTENT = Path(__file__).resolve().parents[2] / 'public' / 'assets' / 'content'


class ExportedContentTest(unittest.TestCase):
    def read(self, name):
        return json.loads((CONTENT / f'{name}.json').read_text(encoding='utf-8'))

    def test_original_table_counts_and_first_stage_fields(self):
        stages = self.read('stages')
        self.assertEqual(len(stages), 21)
        self.assertEqual(len(self.read('skills')), 67)
        self.assertEqual(len(self.read('cards')), 20)
        self.assertEqual(len(self.read('monster-groups')), 409)
        first = stages[0]
        self.assertEqual(first['card_id'], [78000110, 78000101, 78000102])
        self.assertEqual(first['card_pos'], [505, 204, 206])
        self.assertEqual(first['size'], [30, 9])
        self.assertEqual(len(first['level_time']), 100)
        self.assertEqual(first['level_time'][:4], [30, 75, 140, 200])

    def test_original_localized_names_and_multiline_buffs(self):
        skills = {row['id']: row for row in self.read('skills')}
        cards = {row['id']: row for row in self.read('cards')}
        self.assertEqual(skills[78010110]['name'], '潮汐冲击')
        self.assertEqual(skills[78010111]['active_buff_list'], ['78040101:3001:10000'])
        self.assertEqual(cards[78000101]['name'], '安妮斯')
        self.assertEqual(cards[78000102]['name'], '蒂娜')


if __name__ == '__main__':
    unittest.main()
