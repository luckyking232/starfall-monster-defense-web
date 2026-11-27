"""Derive the lossless media used by the player build from tracked original assets."""

import hashlib
import json
import re
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from PIL import Image


APP = Path(__file__).resolve().parents[1]
SOURCE = APP / 'public/assets'
ATLAS_OUTPUT = APP / 'release-assets/fgui'
FONT_OUTPUT = APP / 'src/fonts'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def atlases():
    ATLAS_OUTPUT.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((SOURCE / 'fgui/fgui-manifest.json').read_text(encoding='utf-8'))
    evidence = {}
    for package in manifest['packages']:
        for atlas in package['atlases']:
            source = SOURCE / 'fgui' / atlas['file']
            output = (ATLAS_OUTPUT / source.name).with_suffix('.webp')
            assert sha(source) == atlas['sha256'], source
            with Image.open(source) as image:
                rgba = image.convert('RGBA')
            rgba.save(output, format='WEBP', lossless=True, quality=75, method=3, exact=True)
            with Image.open(output) as converted:
                assert rgba.size == converted.size and rgba.tobytes() == converted.convert('RGBA').tobytes(), output
            evidence[source.name] = {'original': sha(source), 'converted': sha(output)}
    (ATLAS_OUTPUT.parent / 'atlases.json').write_text(json.dumps(evidence, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(f'{len(evidence)} atlases verified byte-for-byte in RGBA')


def ranges(codepoints):
    start = end = None
    result = []
    for point in sorted(codepoints):
        if start is None:
            start = end = point
        elif point == end + 1:
            end = point
        else:
            result.append(f'U+{start:X}' if start == end else f'U+{start:X}-{end:X}')
            start = end = point
    if start is not None:
        result.append(f'U+{start:X}' if start == end else f'U+{start:X}-{end:X}')
    return ','.join(result)


def fonts():
    FONT_OUTPUT.mkdir(parents=True, exist_ok=True)
    source = SOURCE / 'fonts/source-han-sans.otf'
    original = TTFont(source, recalcTimestamp=False)
    cmap = original.getBestCmap()
    # Canvas font metrics also request Phaser's default sample '|MÃ‰qgy'.
    text = set(range(32, 0x0250)) | set(range(0x2000, 0x2070))
    # Read runtime dialogue and metadata, but keep the full dictionary from defining the first font download.
    candidates = [APP / 'index.html']
    for directory, patterns in [
        (APP / 'src', ('*.css', '*.ts')),
        (APP / 'runtime/ui', ('*.ts',)),
        (SOURCE / 'runtime/ui', ('*.lua',)),
        (SOURCE / 'runtime/core-worker', ('*.lua',)),
        (SOURCE / 'content', ('*.json',)),
        (SOURCE / 'fgui', ('*.json',)),
    ]:
        for pattern in patterns:
            candidates.extend(directory.rglob(pattern))
    words = (SOURCE / 'runtime/ui/original/BaseWord_cn.lua').read_text(encoding='utf-8')
    ids = set()
    for file in sorted(candidates):
        if file.name == 'BaseWord_cn.lua' or file.parent == FONT_OUTPUT:
            continue
        content = file.read_text(encoding='utf-8')
        text.update(map(ord, content))
        ids.update(re.findall(r'\bT\s*\(\s*(\d+)\s*[,)]', content))
    for row in re.split(r'(?m)(?=^  \[\d+\] = \{)', words):
        key = re.match(r'  \[(\d+)\]', row)
        if key and key[1] in ids:
            text.update(map(ord, row))
    codepoints = text.intersection(cmap)
    for name, points in [('full', set(cmap)), ('common', codepoints)]:
        font = TTFont(source, recalcTimestamp=False)
        if name == 'common':
            options = subset.Options()
            options.layout_features = ['*']
            sub = subset.Subsetter(options=options)
            sub.populate(unicodes=points)
            sub.subset(font)
        font.flavor = 'woff2'
        output = FONT_OUTPUT / f'source-han-sans-{name}.woff2'
        font.save(output)
        converted = TTFont(output)
        actual = converted.getBestCmap()
        assert set(actual) == points, name
        assert all(original['hmtx'][cmap[ch]] == converted['hmtx'][glyph] for ch, glyph in actual.items()), name
        # Compare decomposed outline operations for the subset and full CFF charstrings for the complete face.
        if name == 'full':
            assert original['CFF '].compile(original) == converted['CFF '].compile(converted), name
        else:
            from fontTools.pens.recordingPen import DecomposingRecordingPen
            originals = original.getGlyphSet()
            variants = converted.getGlyphSet()
            for ch, glyph in actual.items():
                left, right = DecomposingRecordingPen(originals), DecomposingRecordingPen(variants)
                originals[cmap[ch]].draw(left)
                variants[glyph].draw(right)
                assert left.value == right.value, (name, ch)
        print(f'{name} font: {len(points)} mappings, {output.stat().st_size} bytes')
    leftover = set(cmap) - codepoints
    css = '\n'.join(f'''@font-face {{
  font-family: 'SourceHanSans';
  src: url('./source-han-sans-{name}.woff2') format('woff2');
  font-display: swap;
  unicode-range: {ranges(points)};
}}''' for name, points in [('full', leftover), ('common', codepoints)])
    (FONT_OUTPUT / 'source-han-sans.css').write_text('/* Generated by scripts/prepare_player_media.py. */\n' + css + '\n', encoding='utf-8', newline='\n')


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('part', choices=('all', 'atlases', 'fonts'), default='all', nargs='?')
    part = parser.parse_args().part
    if part in {'all', 'atlases'}:
        atlases()
    if part in {'all', 'fonts'}:
        fonts()
