"""Describe the exact reviewed Tide Outpost build for package_zip.py."""

import argparse
from fnmatch import fnmatchcase
import hashlib
import json
from os import fstat
from pathlib import Path


PROVENANCE = Path(__file__).resolve().parents[1] / "apps/game/src/content/asset-provenance.json"


def make_manifest(build: Path) -> dict:
    if not build.is_dir() or build.is_symlink():
        raise ValueError("Expected a real Web game build folder.")

    rules = json.loads(PROVENANCE.read_text(encoding="utf-8"))
    files = {}
    for path in sorted(build.rglob("*")):
        if path.is_symlink():
            raise ValueError(f"Unexpected symlink at {path.name}")
        if path.is_dir():
            continue

        relative_path = path.relative_to(build).as_posix()
        matching = [rule for pattern, rule in rules.items() if fnmatchcase(relative_path, pattern)]
        if len(matching) != 1 or not path.is_file():
            raise ValueError(f"Examine distribution provenance for {relative_path}")

        with path.open("rb") as source:
            digest = hashlib.file_digest(source, "sha256")
            size = fstat(source.fileno()).st_size
        files[relative_path] = {**matching[0], "sha256": digest.hexdigest(), "bytes": size}

    if not {"index.html", "NOTICE.txt"}.issubset(files):
        raise ValueError("Build is missing its entry page or notices.")
    return {"eligibility": "public-playable", "files": files}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    try:
        manifest = make_manifest(args.build)
        with args.out.open("x", encoding="utf-8") as stream:
            json.dump(manifest, stream, indent=2)
            stream.write("\n")
    except (OSError, ValueError) as error:
        parser.exit(2, f"{error}\n")


if __name__ == "__main__":
    main()
