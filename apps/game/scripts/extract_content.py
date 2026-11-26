"""Extract original stage/card/skill/monster tables into browser-readable JSON."""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
ENTRY_START = re.compile(r'^  \[(\d+)\] = \{(.*)$')
ENTRY_END = re.compile(r'^  \},?$')
FIELD = re.compile(r'^(?:    )?(\w+) = (.*)$')


def value(raw: str):
    raw = raw.strip().rstrip(',')
    if raw.startswith('{') and raw.endswith('}'):
        inner = raw[1:-1].strip()
        if not inner:
            return []
        parts = re.findall(r'"(?:\\.|[^"\\])*"|[^,\s]+', inner)
        return [value(part) for part in parts]
    if raw.startswith('"') and raw.endswith('"'):
        return raw[1:-1]
    try:
        return int(raw)
    except ValueError:
        try:
            return float(raw)
        except ValueError:
            return raw


def entries(text: str):
    source_lines = text.splitlines()
    index = 0
    while index < len(source_lines):
        start = ENTRY_START.match(source_lines[index])
        if not start:
            index += 1
            continue
        key = int(start.group(1))
        remainder = start.group(2).rstrip()
        block_lines = []
        compact = remainder.endswith('},') or remainder.endswith('}')
        if compact:
            block_lines.append(remainder[:-2] if remainder.endswith('},') else remainder[:-1])
            index += 1
        else:
            if remainder:
                block_lines.append(remainder)
            index += 1
            while index < len(source_lines) and not ENTRY_END.match(source_lines[index]):
                block_lines.append(source_lines[index])
                index += 1
            if index == len(source_lines):
                raise ValueError(f'Unterminated entry: {key}')
            index += 1
        block = '\n'.join(block_lines)
        if compact:
            matches = [match for match in re.finditer(r'"(?:\\.|[^"\\])*"|\b(\w+)\s*=\s*', block) if match.group(1)]
            block_lines = [
                f'{match.group(1)} = {block[match.end():matches[i + 1].start() if i + 1 < len(matches) else len(block)].strip().rstrip(",")}'
                for i, match in enumerate(matches)
            ]
        fields = {}
        lines = iter(block_lines)
        for line in lines:
            field = FIELD.match(line)
            if not field:
                continue
            raw = field.group(2)
            depth = raw.count('{') - raw.count('}')
            while depth > 0:
                line = next(lines, None)
                if line is None:
                    raise ValueError(f'Unterminated table field: {field.group(1)}')
                raw += '\n' + line
                depth += line.count('{') - line.count('}')
            if depth != 0:
                raise ValueError(f'Unbalanced table field: {field.group(1)}')
            fields[field.group(1)] = value(raw)
        name_id = re.search(r'\bname = function\(\)\s*\n\s*return T\((\d+)', block)
        description_id = re.search(r'\bdes = function\(\)\s*\n\s*return T\((\d+)', block)
        if name_id:
            fields['_name_id'] = int(name_id.group(1))
        if description_id:
            fields['_des_id'] = int(description_id.group(1))
        yield key, fields


def words(path: Path):
    return {key: fields.get('name', '') for key, fields in entries(path.read_text(encoding='utf-8'))}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    args = parser.parse_args()
    decoded = args.source / 'lua' / '134395529309427262' / 'decoded'
    word_map = words(decoded / 'BaseWord_cn.lua')
    descriptions = {key: fields.get('name', '') for key, fields in entries((decoded / 'BaseWord_cn.lua').read_text(encoding='utf-8'))}

    skills = []
    for key, fields in entries((decoded / 'BaseShootSkill.lua').read_text(encoding='utf-8')):
        name_id = fields.pop('_name_id', None)
        description_id = fields.pop('_des_id', None)
        skills.append({
            'id': key,
            **fields,
            'name': word_map.get(name_id, ''),
            'des': descriptions.get(description_id, ''),
        })

    cards = []
    for key, fields in entries((decoded / 'BaseShootCard.lua').read_text(encoding='utf-8')):
        name_id = fields.pop('_name_id', None)
        cards.append({'id': key, **fields, 'name': word_map.get(name_id, '')})

    stages = []
    for key, fields in entries((decoded / 'BaseShootStage.lua').read_text(encoding='utf-8')):
        fields.pop('name', None)
        stages.append({'id': key, **fields})

    groups = []
    for key, fields in entries((decoded / 'BaseShootMonsterGroup.lua').read_text(encoding='utf-8')):
        groups.append({'id': key, **fields})

    destination = APP / 'public' / 'assets' / 'content'
    destination.mkdir(parents=True, exist_ok=True)
    for name, data in [('skills', skills), ('cards', cards), ('stages', stages), ('monster-groups', groups)]:
        (destination / f'{name}.json').write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(name, len(data))
    assert len(skills) == 67
    assert len(stages) == 21
    assert len(groups) == 409


if __name__ == '__main__':
    main()
