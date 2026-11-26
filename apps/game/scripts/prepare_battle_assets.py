"""Prepare original stage-one frames, effects and audio with provenance hashes."""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory

APP = Path(__file__).resolve().parents[1]
FRAME_SETS = (
    'minigamespine_10000118_pixel',
    'minigamespine_10000134_pixel',
    'minigamespine_10000104_pixel',
    'minigamespine_10000101_pixel',
    'minigamespine_10000198_pixel',
    'battlespine_20010_pixel',
    'battlespine_20302_pixel',
)
EFFECTS = {
    'MiniGame022_bullet1.png',
    'Minigame022_guangqiu.png',
    'Minigame022_guangzhu.png',
    'Minigame022_ice.png',
    'Minigame022_liuxue.png',
}


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def pcm_sha(path: Path, ffmpeg: str) -> str:
    result = subprocess.run(
        [ffmpeg, '-v', 'error', '-nostdin', '-i', str(path), '-c:a', 'pcm_s16le', '-f', 'hash', '-hash', 'sha256', '-'],
        capture_output=True, check=True, text=True,
    )
    return result.stdout.strip().split('=', 1)[1]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--ffmpeg', default='ffmpeg', help='FFmpeg executable used to encode battle music as FLAC')
    args = parser.parse_args()
    source = args.source.resolve(strict=True)
    prefab = source / 'assets' / 'exported' / 'assets' / 'art' / 'models' / 'minigame022' / 'prefab'
    effects = source / 'assets' / 'exported' / 'assets' / 'art' / 'effects' / 'prefab' / 'ui_prefab' / 'minigame' / 'minigame022'
    destination = APP / 'public' / 'assets'
    records: dict[str, dict[str, object]] = {}

    def copy(source_file: Path, target_name: str, provenance: str) -> None:
        if not source_file.is_file():
            raise FileNotFoundError(source_file)
        target = destination / target_name
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists() or sha(source_file) != sha(target):
            shutil.copyfile(source_file, target)
        records[target_name] = {
            'bytes': target.stat().st_size,
            'sha256': sha(target),
            'source': str(source_file.relative_to(source)).replace('\\', '/'),
            'provenance': provenance,
        }

    for prefix in FRAME_SETS:
        for source_file in sorted(prefab.glob(f'{prefix}_*.png'), key=lambda path: int(path.stem.rsplit('_', 1)[1])):
            copy(source_file, f'units/{source_file.name}', 'original-frame')
    copy(prefab / 'minigamespine_zhalan_pixel.png', 'units/minigamespine_zhalan_pixel.png', 'original-wall')
    for name in EFFECTS:
        copy(effects / name, f'effects/{name}', 'original-effect')
    for path in sorted((source / 'assets' / 'audio' / 'minigame022').glob('*.wav')):
        copy(path, f'audio/{path.name}', 'original-sfx')
    for path in sorted((source / 'assets' / 'audio' / 'bgm_b02').glob('*.wav')):
        target_name = f'audio/{path.stem}.flac'
        target = destination / target_name
        source_hash = sha(path)
        legacy_copy = target.with_suffix('.wav')
        if legacy_copy.exists() and sha(legacy_copy) != source_hash:
            raise ValueError(f'The existing WAV does not match its source: {legacy_copy}')
        with TemporaryDirectory(dir=target.parent) as directory:
            encoded = Path(directory) / target.name
            subprocess.run(
                [args.ffmpeg, '-v', 'error', '-nostdin', '-y', '-i', str(path), '-map_metadata', '-1',
                 '-c:a', 'flac', '-compression_level', '12', str(encoded)],
                check=True,
            )
            original_pcm = pcm_sha(path, args.ffmpeg)
            if original_pcm != pcm_sha(encoded, args.ffmpeg):
                raise ValueError(f'Decoded music samples changed: {path.name}')
            encoded.replace(target)
        legacy_copy.unlink(missing_ok=True)
        records[target_name] = {
            'bytes': target.stat().st_size,
            'sha256': sha(target),
            'source': path.relative_to(source).as_posix(),
            'provenance': 'lossless-original-bgm',
            'sourceSha256': source_hash,
            'pcmSha256': original_pcm,
        }

    manifest = {'schema': 'starfall.monster-defense.battle-assets/1', 'files': records}
    (destination / 'battle-assets.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Prepared {len(records)} battle assets in {destination}')


if __name__ == '__main__':
    main()
