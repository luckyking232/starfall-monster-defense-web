"""Decode selected original UI Lua TextAssets from a verified local Unity bundle."""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import shutil
import subprocess
import sys
from pathlib import Path

import UnityPy

APP = Path(__file__).resolve().parents[1]


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--xl', type=Path, default=Path('E:/FallStar/XL'))
    parser.add_argument('--unluac', type=Path, default=Path('E:/FallStar/server-exports/monster-defense-research-20261125/tools/unluac-java8.jar'))
    parser.add_argument('--opmap', type=Path, default=Path('E:/FallStar/XL/xl_updata_tool/tools/lua/opmap'))
    parser.add_argument('--name', action='append', required=True)
    args = parser.parse_args()
    bundle = args.bundle.resolve(strict=True)
    requested = set(args.name)
    data = bundle.read_bytes()
    offset = data.index(b'UnityFS')
    UnityPy.set_assetbundle_decrypt_key(b'yunguihaowan1234')
    environment = UnityPy.load(io.BytesIO(data[offset:]))
    raw_dir = APP / 'local-inputs' / 'ui-bytecode'
    raw_dir.mkdir(parents=True, exist_ok=True)
    metadata_path = APP / 'local-inputs' / 'ui-dependencies.json'
    metadata = json.loads(metadata_path.read_text(encoding='utf-8')) if metadata_path.exists() else {}
    found = set()
    for obj in environment.objects:
        if obj.type.name != 'TextAsset':
            continue
        asset = obj.read()
        if asset.m_Name not in requested:
            continue
        name = asset.m_Name
        value = asset.m_Script
        script = value.encode('utf-8', errors='surrogateescape') if isinstance(value, str) else bytes(value or b'')
        (raw_dir / name).write_bytes(script)
        metadata[name] = {
            'bundle': bundle.name,
            'bundleMd5': hashlib.md5(data).hexdigest(),
            'pathId': str(obj.path_id),
            'bytecodeSha256': sha(script),
        }
        found.add(name)
    missing = requested - found
    if missing:
        raise FileNotFoundError(f'Original TextAssets not found: {sorted(missing)}')
    sys.path.insert(0, str(args.xl / 'xl_updata_server'))
    from server_app.lua_decoder import classify_lua_bytes, decode_chinese

    java = shutil.which('java')
    if not java:
        raise RuntimeError('Java is required by the original unluac toolchain')
    output_dir = APP / 'local-inputs' / 'ui-decoded'
    fixed_dir = APP / 'local-inputs' / 'ui-fixed'
    output_dir.mkdir(parents=True, exist_ok=True)
    fixed_dir.mkdir(parents=True, exist_ok=True)
    for name in sorted(requested):
        kind, fixed = classify_lua_bytes((raw_dir / name).read_bytes())
        if kind == 'unknown' or fixed is None:
            raise ValueError(f'Unrecognized Lua input: {name}')
        fixed_path = fixed_dir / name
        fixed_path.write_bytes(fixed)
        output = output_dir / name
        result = subprocess.run(
            [java, '-Xmx256m', '-jar', str(args.unluac), str(fixed_path), '--output', str(output), '--opmap', str(args.opmap)],
            capture_output=True,
            timeout=120,
            check=False,
        )
        if result.returncode != 0 or not output.is_file():
            raise RuntimeError(f'Failed to decode {name}: {result.stderr.decode("utf-8", errors="replace")}')
        output.write_text(decode_chinese(output.read_text(encoding='utf-8', errors='replace')), encoding='utf-8')
        metadata[name]['decodedSha256'] = sha(output.read_bytes())
        metadata[name]['toolSha256'] = sha(args.unluac.read_bytes())
    metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Decoded {len(requested)} original UI dependencies: {sorted(requested)}')


if __name__ == '__main__':
    main()
