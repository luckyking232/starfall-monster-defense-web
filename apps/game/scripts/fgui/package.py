"""FGUI package index parsing, mirroring UIPackage.LoadPackage (FairyGUI-unity)."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from .bytebuffer import ByteBuffer
from .format import OBJECT_TYPES, PACKAGE_ITEM_TYPES, name_of

MAGIC = 0x46475549  # 'FGUI'


class FguiFormatError(ValueError):
    pass


@dataclass
class PackageItem:
    type: str
    id: str
    name: str | None
    path: str | None
    file: str | None
    exported: bool
    width: int
    height: int
    object_type: str | None = None
    scale9_grid: list[int] | None = None
    tile_grid_indice: int | None = None
    scale_by_tile: bool = False
    raw: ByteBuffer | None = None
    raw_length: int = 0
    branch: str | None = None
    branches: list[str | None] | None = None
    high_resolution: list[str | None] | None = None


@dataclass
class Sprite:
    atlas_id: str
    x: int
    y: int
    width: int
    height: int
    rotated: bool
    offset: list[int] | None
    original_size: list[int]


@dataclass
class Package:
    id: str
    name: str
    version: int
    compressed: bool
    dependencies: list[dict]
    branches: list[str]
    items: list[PackageItem]
    items_by_id: dict[str, PackageItem]
    sprites: dict[str, Sprite]  # keyed by image/movieclip item id
    string_table: list[str] = field(repr=False, default_factory=list)
    has_pixel_hit_test: bool = False

    @property
    def asset_prefix(self) -> str:
        # UIPackage.LoadPackage: assetNamePrefix = "<package asset name>_" for
        # atlas/sound/misc files; the original assets ship as <name>_fui.bytes.
        return f'{self.name}_'


def load_package(path: Path) -> Package:
    data = Path(path).read_bytes()
    buffer = ByteBuffer(data)
    if buffer.read_uint() != MAGIC:
        raise FguiFormatError(f'{path}: not a FairyGUI package (bad magic)')
    version = buffer.read_int()
    buffer.version = version
    compressed = buffer.read_bool()
    package_id = buffer.read_string()
    name = buffer.read_string()

    buffer.position += 20
    index_table_pos = buffer.position

    # block 4: string table
    if not buffer.seek(index_table_pos, 4):
        raise FguiFormatError(f'{path}: string table block missing')
    count = buffer.read_int()
    string_table = [buffer.read_string() for _ in range(count)]
    buffer.string_table = string_table
    # block 5: string table patch
    if buffer.seek(index_table_pos, 5):
        count = buffer.read_int()
        for _ in range(count):
            index = buffer.read_ushort()
            length = buffer.read_int()
            string_table[index] = buffer.read_string(length)

    # block 0: dependencies
    if not buffer.seek(index_table_pos, 0):
        raise FguiFormatError(f'{path}: dependency block missing')
    dependencies = []
    for _ in range(buffer.read_short()):
        dependencies.append({'id': buffer.read_s(), 'name': buffer.read_s()})

    branches: list[str] = []
    branch_included = False
    if version >= 2:
        count = buffer.read_short()
        if count > 0:
            branches = [s for s in buffer.read_s_array(count) if s is not None]
        branch_included = count > 0

    # block 1: package items
    if not buffer.seek(index_table_pos, 1):
        raise FguiFormatError(f'{path}: package item block missing')
    items: list[PackageItem] = []
    items_by_id: dict[str, PackageItem] = {}
    for _ in range(buffer.read_short()):
        next_pos = buffer.read_int() + buffer.position
        item_type = name_of(PACKAGE_ITEM_TYPES, buffer.read_byte(), 'PackageItemType')
        item = PackageItem(
            type=item_type,
            id=buffer.read_s(),
            name=buffer.read_s(),
            path=buffer.read_s(),
            file=buffer.read_s(),
            exported=buffer.read_bool(),
            width=buffer.read_int(),
            height=buffer.read_int(),
        )
        if item_type == 'Image':
            scale_option = buffer.read_byte()
            if scale_option == 1:
                item.scale9_grid = [buffer.read_int(), buffer.read_int(), buffer.read_int(), buffer.read_int()]
                item.tile_grid_indice = buffer.read_int()
            elif scale_option == 2:
                item.scale_by_tile = True
            buffer.read_bool()  # smoothing
        elif item_type == 'MovieClip':
            buffer.read_bool()  # smoothing
            item.raw = buffer.read_buffer()
            item.raw_length = item.raw.length
        elif item_type == 'Font':
            item.raw = buffer.read_buffer()
            item.raw_length = item.raw.length
        elif item_type == 'Component':
            extension = buffer.read_byte()
            item.object_type = name_of(OBJECT_TYPES, extension, 'ObjectType') if extension > 0 else 'Component'
            item.raw = buffer.read_buffer()
            item.raw_length = item.raw.length
        elif item_type in ('Atlas', 'Sound', 'Misc'):
            pass  # item.file stays the original file name
        elif item_type in ('Spine', 'DragoneBones'):
            buffer.read_float()
            buffer.read_float()
        if version >= 2:
            branch = buffer.read_s()
            if branch is not None:
                item.branch = branch
            branch_count = buffer.read_byte()
            if branch_count > 0:
                if branch_included:
                    item.branches = buffer.read_s_array(branch_count)
                else:
                    buffer.read_s()
            high_res_count = buffer.read_byte()
            if high_res_count > 0:
                item.high_resolution = buffer.read_s_array(high_res_count)
        items.append(item)
        items_by_id[item.id] = item
        buffer.position = next_pos

    # block 2: sprites (atlas UVs)
    if not buffer.seek(index_table_pos, 2):
        raise FguiFormatError(f'{path}: sprite block missing')
    sprites: dict[str, Sprite] = {}
    for _ in range(buffer.read_short()):
        next_pos = buffer.read_ushort() + buffer.position
        item_id = buffer.read_s()
        atlas_id = buffer.read_s()
        if atlas_id not in items_by_id:
            raise FguiFormatError(f'{path}: sprite {item_id} references unknown atlas {atlas_id}')
        x = buffer.read_int()
        y = buffer.read_int()
        width = buffer.read_int()
        height = buffer.read_int()
        rotated = buffer.read_bool()
        offset = None
        if version >= 2 and buffer.read_bool():
            offset = [buffer.read_int(), buffer.read_int()]
            original_size = [buffer.read_int(), buffer.read_int()]
        elif rotated:
            original_size = [height, width]
        else:
            original_size = [width, height]
        sprites[item_id] = Sprite(atlas_id, x, y, width, height, rotated, offset, original_size)
        buffer.position = next_pos

    # block 3: pixel hit test data (presence recorded; glyph-level decoding is
    # called out as unsupported by the document builder instead of being
    # silently dropped)
    has_pixel_hit_test = buffer.seek(index_table_pos, 3)

    return Package(
        id=package_id,
        name=name,
        version=version,
        compressed=compressed,
        dependencies=dependencies,
        branches=branches,
        items=items,
        items_by_id=items_by_id,
        sprites=sprites,
        string_table=string_table,
        has_pixel_hit_test=has_pixel_hit_test,
    )
