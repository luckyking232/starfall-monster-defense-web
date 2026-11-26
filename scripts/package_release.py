"""Package the playable static site. Run the build first."""
import argparse
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


def package(build, output):
    build = build.resolve(strict=True)
    if not (build / 'index.html').is_file() or not (build / 'assets/ui-host-worker.js').is_file():
        raise ValueError('Expected the compiled game and its UI worker')
    if output.resolve().is_relative_to(build):
        raise ValueError('The output must be outside the build directory')
    files = sorted(path for path in build.rglob('*') if path.is_file() and path.suffix != '.map')
    with ZipFile(output, 'x', compression=ZIP_DEFLATED) as archive:
        for path in files:
            if path.is_symlink() or not path.resolve().is_relative_to(build):
                raise ValueError(f'Unexpected file outside the build: {path}')
            entry = ZipInfo(path.relative_to(build).as_posix(), (1980, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, path.read_bytes(), compress_type=ZIP_DEFLATED, compresslevel=7)
    print(f'{output}: {len(files)} files')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--build', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    package(args.build, args.out)
