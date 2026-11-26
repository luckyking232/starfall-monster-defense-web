"""Build the starfall-fgui-package/1 JSON document from a parsed FGUI package."""
from __future__ import annotations

from .component import parse_component
from .package import FguiFormatError, Package, PackageItem

SCHEMA = 'starfall-fgui-package/1'
FORMAT_REFERENCE_URL = 'https://raw.githubusercontent.com/fairygui/FairyGUI-unity/master/Assets/Scripts/UI/UIPackage.cs'

# Item types fully decoded into structured output. Everything else must be
# called out explicitly instead of being silently dropped.
_DECODED_ITEM_TYPES = {'Image', 'Component', 'Atlas', 'Font'}


def _image_bitmap_font(item: PackageItem, package: Package) -> dict | None:
    buffer = item.raw
    if buffer is None or not buffer.seek(0, 0):
        raise FguiFormatError(f'{package.name}:{item.id}: bitmap font header is missing')
    is_truetype = buffer.read_bool()
    tintable = buffer.read_bool()
    resizable = buffer.read_bool()
    uses_channels = buffer.read_bool()
    size = buffer.read_int()
    default_advance = buffer.read_int()
    buffer.read_int()  # The authored line height applies to TrueType glyphs.
    if is_truetype or uses_channels:
        return None
    if not buffer.seek(0, 1):
        raise FguiFormatError(f'{package.name}:{item.id}: bitmap font glyph block is missing')
    glyphs = {}
    line_height = size
    for _ in range(buffer.read_int()):
        end = buffer.read_ushort() + buffer.position
        character = chr(buffer.read_ushort())
        image_id = buffer.read_s()
        buffer.position += 8  # Atlas positions are stored on the individual image items.
        x = buffer.read_int()
        y = buffer.read_int()
        buffer.position += 8  # Use the original dimensions from the image item.
        advance = buffer.read_int()
        image = package.items_by_id.get(image_id or '')
        if image is None or image.type != 'Image':
            raise FguiFormatError(f'{package.name}:{item.id}: image glyph {character!r} was unresolved')
        size = size or image.height
        line_height = max(line_height, image.height + max(y, 0), size)
        glyphs[character] = {'image': image.id, 'x': x, 'y': y, 'advance': advance or default_advance or x + image.width}
        buffer.position = end
    return {'size': size, 'lineHeight': line_height, 'tintable': tintable, 'resizable': resizable, 'glyphs': glyphs}


def _item_entry(item: PackageItem, package: Package) -> dict:
    entry: dict = {
        'id': item.id,
        'name': item.name,
        'path': item.path,
        'type': item.type,
        'exported': item.exported,
        'width': item.width,
        'height': item.height,
    }
    if item.type == 'Image':
        if item.scale9_grid is not None:
            entry['scale9Grid'] = item.scale9_grid
            entry['tileGridIndice'] = item.tile_grid_indice
        if item.scale_by_tile:
            entry['scaleByTile'] = True
        sprite = package.sprites.get(item.id)
        if sprite is None:
            raise FguiFormatError(f'{package.name}:{item.name} ({item.id}): image has no atlas sprite')
        atlas_item = package.items_by_id[sprite.atlas_id]
        entry['sprite'] = {
            'atlasId': sprite.atlas_id,
            'atlasFile': package.asset_prefix + (atlas_item.file or ''),
            'x': sprite.x,
            'y': sprite.y,
            'width': sprite.width,
            'height': sprite.height,
            'rotated': sprite.rotated,
            'originalSize': sprite.original_size,
        }
        if sprite.offset is not None:
            entry['sprite']['offset'] = sprite.offset
    elif item.type == 'Component':
        entry['objectType'] = item.object_type or 'Component'
    elif item.type == 'Atlas':
        entry['file'] = item.file
        entry['resolvedFile'] = package.asset_prefix + (item.file or '')
    elif item.type == 'Font':
        bitmap_font = _image_bitmap_font(item, package)
        entry['decoded'] = bitmap_font is not None
        entry['rawLength'] = item.raw_length
        if bitmap_font is not None:
            entry['bitmapFont'] = bitmap_font
    else:
        raise FguiFormatError(
            f'{package.name}:{item.name} ({item.id}): package item type {item.type!r} '
            'is not present in the scoped original packages; extend the decoder instead of skipping it'
        )
    return entry


def build_package_document(package: Package, source_file: str, source_sha256: str, source_size: int) -> dict:
    items: dict[str, dict] = {}
    component_index: dict[str, str] = {}
    components: dict[str, dict] = {}
    unsupported: list[str] = []

    for item in package.items:
        items[item.id] = _item_entry(item, package)
        if item.type == 'Component':
            if item.name in component_index:
                raise FguiFormatError(f'{package.name}: duplicate component name {item.name!r}')
            component_index[item.name] = item.id
            components[item.id] = parse_component(item, package)

    font_count = sum(1 for item in items.values() if item['type'] == 'Font' and not item['decoded'])
    if font_count:
        unsupported.append(
            f'font-bitmap-glyphs: {font_count} Font package item(s) need TrueType or packed-channel glyph rendering'
        )
    if package.has_pixel_hit_test:
        unsupported.append('pixel-hit-test: package contains pixel hit test data which is not decoded')

    document = {
        'schema': SCHEMA,
        'package': {
            'id': package.id,
            'name': package.name,
            'version': package.version,
            'compressed': package.compressed,
            'dependencies': package.dependencies,
            'branches': package.branches,
        },
        'source': {
            'file': source_file,
            'sha256': source_sha256,
            'size': source_size,
            'format': {
                'magic': 'FGUI',
                'version': package.version,
                'endianness': 'big',
                'reference': 'FairyGUI-unity UIPackage.LoadPackage (master)',
                'referenceUrl': FORMAT_REFERENCE_URL,
            },
        },
        'items': items,
        'componentIndex': component_index,
        'components': components,
        'unsupported': unsupported,
    }
    return document


def resolve_cross_package_names(documents: dict[str, dict]) -> None:
    """Resolve cross-package child references against the other decoded packages.

    UIPackage.GetItem + UIObjectFactory.NewObject(pi) ignore the declared child
    type byte when the source item resolves, so objectType/refName must come
    from the target package item, not from the declared byte.
    """
    by_package_id = {doc['package']['id']: doc for doc in documents.values()}

    def walk(node: dict) -> None:
        package_id = node.get('packageId')
        if package_id and node.get('src'):
            other = by_package_id.get(package_id)
            if other is not None:
                target = other['items'].get(node['src'])
                if target is not None:
                    if target.get('name') is not None:
                        node['refName'] = target['name']
                    if target['type'] == 'Component':
                        node['objectType'] = target.get('objectType') or 'Component'
                    elif target['type'] in ('Image', 'MovieClip'):
                        node['objectType'] = target['type']
        for child in node.get('children', []):
            walk(child)

    for doc in documents.values():
        for component in doc['components'].values():
            walk(component)
