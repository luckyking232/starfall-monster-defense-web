"""Component rawData parsing, mirroring GComponent.ConstructFromResource and the
Setup_BeforeAdd/Setup_AfterAdd of GObject, GTextField, GList, GLoader, GGraph,
GGroup, GMovieClip, GButton, GProgressBar, GSlider plus Controller, Transition,
GearBase and Relations (FairyGUI-unity, binary version 6).
"""
from __future__ import annotations

from .bytebuffer import ByteBuffer
from .format import (
    ALIGN_TYPES,
    AUTO_SIZE_TYPES,
    BLEND_MODES,
    BUTTON_MODES,
    CHILDREN_RENDER_ORDERS,
    CONTROLLER_ACTION_TYPES,
    EASE_TYPES,
    FILL_METHODS,
    FILL_TYPES,
    FLIP_TYPES,
    GEAR_TYPES,
    GROUP_LAYOUT_TYPES,
    LIST_LAYOUT_TYPES,
    LIST_SELECTION_MODES,
    OBJECT_TYPES,
    OVERFLOW_TYPES,
    PROGRESS_TITLE_TYPES,
    RELATION_TYPES,
    SCROLL_BAR_DISPLAY_TYPES,
    SCROLL_TYPES,
    TRANSITION_ACTION_TYPES,
    VERT_ALIGN_TYPES,
    name_of,
)
from .package import FguiFormatError, Package, PackageItem


def _err(package: Package, item: PackageItem, what: str) -> FguiFormatError:
    return FguiFormatError(f'{package.name}:{item.name} ({item.id}): {what}')


def _read_scroll(buffer: ByteBuffer) -> dict:
    scroll = {
        'scrollType': name_of(SCROLL_TYPES, buffer.read_byte(), 'ScrollType'),
        'scrollBarDisplay': name_of(SCROLL_BAR_DISPLAY_TYPES, buffer.read_byte(), 'ScrollBarDisplayType'),
    }
    flags = buffer.read_int()
    if buffer.read_bool():
        scroll['scrollBarMargin'] = [buffer.read_int(), buffer.read_int(), buffer.read_int(), buffer.read_int()]
    scroll['vtScrollBarRes'] = buffer.read_s()
    scroll['hzScrollBarRes'] = buffer.read_s()
    scroll['headerRes'] = buffer.read_s()
    scroll['footerRes'] = buffer.read_s()
    scroll['flags'] = flags
    return scroll


def _read_relations(buffer: ByteBuffer) -> list[dict]:
    relations = []
    for _ in range(buffer.read_byte()):
        target_index = buffer.read_short()
        entries = []
        for _ in range(buffer.read_byte()):
            entries.append({
                'type': name_of(RELATION_TYPES, buffer.read_byte(), 'RelationType'),
                'usePercent': buffer.read_bool(),
            })
        relations.append({'targetIndex': target_index, 'relations': entries})
    return relations


def _read_controller(buffer: ByteBuffer, version: int) -> dict:
    begin = buffer.position
    if not buffer.seek(begin, 0):
        raise FguiFormatError('controller: name block missing')
    controller: dict = {'name': buffer.read_s(), 'autoRadioGroupDepth': buffer.read_bool()}
    if not buffer.seek(begin, 1):
        raise FguiFormatError('controller: page block missing')
    pages = []
    for _ in range(buffer.read_short()):
        pages.append({'id': buffer.read_s(), 'name': buffer.read_s()})
    controller['pages'] = pages
    if version >= 2:
        home_page_type = buffer.read_byte()
        if home_page_type == 1:
            controller['homePageIndex'] = buffer.read_short()
        elif home_page_type == 2:
            controller['homePageType'] = 'branch'
        elif home_page_type == 3:
            controller['homePageType'] = 'var'
            controller['homePageVar'] = buffer.read_s()
    actions = []
    if buffer.seek(begin, 2):
        for _ in range(buffer.read_short()):
            next_pos = buffer.read_ushort() + buffer.position
            action_type = name_of(CONTROLLER_ACTION_TYPES, buffer.read_byte(), 'ControllerActionType')
            action: dict = {
                'type': action_type,
                'fromPage': buffer.read_s_array(buffer.read_short()),
                'toPage': buffer.read_s_array(buffer.read_short()),
            }
            if action_type == 'PlayTransition':
                action['transitionName'] = buffer.read_s()
                action['playTimes'] = buffer.read_int()
                action['delay'] = buffer.read_float()
                action['stopOnExit'] = buffer.read_bool()
            else:  # ChangePage
                action['objectId'] = buffer.read_s()
                action['controllerName'] = buffer.read_s()
                action['targetPage'] = buffer.read_s()
            actions.append(action)
            buffer.position = next_pos
    if actions:
        controller['actions'] = actions
    return controller


def _read_gear_status(buffer: ByteBuffer, gear_type: str):
    if gear_type == 'XY':
        return {'x': buffer.read_int(), 'y': buffer.read_int()}
    if gear_type == 'Size':
        return {
            'width': buffer.read_int(), 'height': buffer.read_int(),
            'scaleX': buffer.read_float(), 'scaleY': buffer.read_float(),
        }
    if gear_type == 'Look':
        return {
            'alpha': buffer.read_float(), 'rotation': buffer.read_float(),
            'grayed': buffer.read_bool(), 'touchable': buffer.read_bool(),
        }
    if gear_type == 'Color':
        return {'color': buffer.read_color(), 'strokeColor': buffer.read_color()}
    if gear_type == 'Animation':
        return {'playing': buffer.read_bool(), 'frame': buffer.read_int()}
    if gear_type in ('Text', 'Icon'):
        return buffer.read_s()
    raise FguiFormatError(f'gear {gear_type}: no per-page status')


def _read_gear(buffer: ByteBuffer, version: int) -> dict:
    gear_type = name_of(GEAR_TYPES, buffer.read_byte(), 'GearType')
    gear: dict = {'type': gear_type, 'controllerIndex': buffer.read_short()}
    count = buffer.read_short()
    if gear_type in ('Display', 'Display2'):
        gear['pages'] = buffer.read_s_array(count)
    else:
        pages = {}
        for _ in range(count):
            page = buffer.read_s()
            if page is None:
                continue
            pages[page] = _read_gear_status(buffer, gear_type)
        gear['pages'] = pages
        if buffer.read_bool():
            gear['default'] = _read_gear_status(buffer, gear_type)
    if buffer.read_bool():
        gear['tween'] = {
            'easeType': name_of(EASE_TYPES, buffer.read_byte(), 'EaseType'),
            'duration': buffer.read_float(),
            'delay': buffer.read_float(),
        }
    if version >= 2:
        if gear_type == 'XY':
            if buffer.read_bool():
                gear['positionsInPercent'] = True
                percent = {}
                for _ in range(count):
                    page = buffer.read_s()
                    if page is None:
                        continue
                    percent[page] = [buffer.read_float(), buffer.read_float()]
                gear['percentPages'] = percent
                if buffer.read_bool():
                    gear['defaultPercent'] = [buffer.read_float(), buffer.read_float()]
        elif gear_type == 'Display2':
            gear['condition'] = buffer.read_byte()
    if version >= 4 and gear.get('tween', {}).get('easeType') == 'Custom':
        gear['tween']['customEase'] = buffer.read_path()
    if version >= 6 and gear_type == 'Animation':
        ext = {}
        for _ in range(count):
            page = buffer.read_s()
            if page is None:
                continue
            ext[page] = {'animationName': buffer.read_s(), 'skinName': buffer.read_s()}
        gear['animationNames'] = ext
        if buffer.read_bool():
            gear['defaultAnimationName'] = {'animationName': buffer.read_s(), 'skinName': buffer.read_s()}
    return gear


def _read_text_format(buffer: ByteBuffer, version: int, node: dict) -> None:
    text_format = {
        'font': buffer.read_s(),
        'fontSize': buffer.read_short(),
        'color': buffer.read_color(),
        'align': name_of(ALIGN_TYPES, buffer.read_byte(), 'AlignType'),
        'verticalAlign': name_of(VERT_ALIGN_TYPES, buffer.read_byte(), 'VertAlignType'),
        'lineSpacing': buffer.read_short(),
        'letterSpacing': buffer.read_short(),
    }
    node['ubbEnabled'] = buffer.read_bool()
    node['autoSize'] = name_of(AUTO_SIZE_TYPES, buffer.read_byte(), 'AutoSizeType')
    text_format['underline'] = buffer.read_bool()
    text_format['italic'] = buffer.read_bool()
    text_format['bold'] = buffer.read_bool()
    node['singleLine'] = buffer.read_bool()
    if buffer.read_bool():
        text_format['outlineColor'] = buffer.read_color()
        text_format['outline'] = buffer.read_float()
    if buffer.read_bool():
        text_format['shadowColor'] = buffer.read_color()
        text_format['shadowOffset'] = [buffer.read_float(), buffer.read_float()]
    if buffer.read_bool():
        node['templateVars'] = True
    if version >= 3:
        text_format['strikethrough'] = buffer.read_bool()
        buffer.position += 12  # faceDilate/outlineSoftness/underlaySoftness (TMPRO only)
    node['textFormat'] = text_format


def _read_child_before_add(buffer: ByteBuffer, begin: int, node: dict, package: Package, item: PackageItem) -> None:
    object_type = node['objectType']
    version = buffer.version
    if object_type in ('Text', 'RichText', 'InputText'):
        if not buffer.seek(begin, 5):
            raise _err(package, item, f'{node.get("name")}: text format block missing')
        _read_text_format(buffer, version, node)
    elif object_type == 'Loader':
        if not buffer.seek(begin, 5):
            raise _err(package, item, f'{node.get("name")}: loader block missing')
        node['url'] = buffer.read_s()
        node['align'] = name_of(ALIGN_TYPES, buffer.read_byte(), 'AlignType')
        node['verticalAlign'] = name_of(VERT_ALIGN_TYPES, buffer.read_byte(), 'VertAlignType')
        node['fill'] = name_of(FILL_TYPES, buffer.read_byte(), 'FillType')
        node['shrinkOnly'] = buffer.read_bool()
        node['autoSize'] = buffer.read_bool()
        node['showErrorSign'] = buffer.read_bool()
        node['playing'] = buffer.read_bool()
        node['frame'] = buffer.read_int()
        if buffer.read_bool():
            node['color'] = buffer.read_color()
        fill_method = name_of(FILL_METHODS, buffer.read_byte(), 'FillMethod')
        node['fillMethod'] = fill_method
        if fill_method != 'None':
            node['fillOrigin'] = buffer.read_byte()
            node['fillClockwise'] = buffer.read_bool()
            node['fillAmount'] = buffer.read_float()
        if version >= 7:
            node['useResize'] = buffer.read_bool()
    elif object_type == 'MovieClip':
        if not buffer.seek(begin, 5):
            raise _err(package, item, f'{node.get("name")}: movieclip block missing')
        if buffer.read_bool():
            node['color'] = buffer.read_color()
        node['flip'] = name_of(FLIP_TYPES, buffer.read_byte(), 'FlipType')
        node['frame'] = buffer.read_int()
        node['playing'] = buffer.read_bool()
    elif object_type == 'Graph':
        if not buffer.seek(begin, 5):
            raise _err(package, item, f'{node.get("name")}: graph block missing')
        graph_type = buffer.read_byte()
        node['graphType'] = ['None', 'Rect', 'Ellipse', 'Polygon', 'RegularPolygon'][graph_type] if graph_type <= 4 else graph_type
        if graph_type != 0:
            node['lineSize'] = buffer.read_int()
            node['lineColor'] = buffer.read_color()
            node['fillColor'] = buffer.read_color()
            if buffer.read_bool():
                node['cornerRadius'] = [buffer.read_float() for _ in range(4)]
            if graph_type == 3:
                node['points'] = [[buffer.read_float(), buffer.read_float()] for _ in range(buffer.read_short() // 2)]
            elif graph_type == 4:
                node['sides'] = buffer.read_short()
                node['startAngle'] = buffer.read_float()
                count = buffer.read_short()
                if count > 0:
                    node['distances'] = [buffer.read_float() for _ in range(count)]
    elif object_type == 'Group':
        if not buffer.seek(begin, 5):
            raise _err(package, item, f'{node.get("name")}: group block missing')
        node['layout'] = name_of(GROUP_LAYOUT_TYPES, buffer.read_byte(), 'GroupLayoutType')
        node['lineGap'] = buffer.read_int()
        node['columnGap'] = buffer.read_int()
        if version >= 2:
            node['excludeInvisibles'] = buffer.read_bool()
            node['autoSizeDisabled'] = buffer.read_bool()
            node['mainGridIndex'] = buffer.read_short()
    elif object_type == 'List':
        if not buffer.seek(begin, 5):
            raise _err(package, item, f'{node.get("name")}: list block missing')
        node['layout'] = name_of(LIST_LAYOUT_TYPES, buffer.read_byte(), 'ListLayoutType')
        node['selectionMode'] = name_of(LIST_SELECTION_MODES, buffer.read_byte(), 'ListSelectionMode')
        node['align'] = name_of(ALIGN_TYPES, buffer.read_byte(), 'AlignType')
        node['verticalAlign'] = name_of(VERT_ALIGN_TYPES, buffer.read_byte(), 'VertAlignType')
        node['lineGap'] = buffer.read_short()
        node['columnGap'] = buffer.read_short()
        node['lineCount'] = buffer.read_short()
        node['columnCount'] = buffer.read_short()
        node['autoResizeItem'] = buffer.read_bool()
        node['childrenRenderOrder'] = name_of(CHILDREN_RENDER_ORDERS, buffer.read_byte(), 'ChildrenRenderOrder')
        node['apexIndex'] = buffer.read_short()
        if buffer.read_bool():
            node['margin'] = [buffer.read_int(), buffer.read_int(), buffer.read_int(), buffer.read_int()]
        overflow = name_of(OVERFLOW_TYPES, buffer.read_byte(), 'OverflowType')
        node['overflow'] = overflow
        if overflow == 'Scroll':
            saved = buffer.position
            if not buffer.seek(begin, 7):
                raise _err(package, item, f'{node.get("name")}: list scroll block missing')
            node['scroll'] = _read_scroll(buffer)
            buffer.position = saved
        if buffer.read_bool():
            node['clipSoftness'] = [buffer.read_int(), buffer.read_int()]
        if version >= 2:
            node['scrollItemToViewOnClick'] = buffer.read_bool()
            node['foldInvisibleItems'] = buffer.read_bool()
        if not buffer.seek(begin, 8):
            raise _err(package, item, f'{node.get("name")}: list item block missing')
        node['defaultItem'] = buffer.read_s()
        items = []
        for _ in range(buffer.read_short()):
            next_pos = buffer.read_ushort() + buffer.position
            entry: dict = {'url': buffer.read_s()}
            for key in ('text', 'selectedTitle', 'icon', 'selectedIcon', 'name'):
                value = buffer.read_s()
                if value is not None:
                    entry[key] = value
            controllers = []
            for _ in range(buffer.read_short()):
                controllers.append({'controller': buffer.read_s(), 'pageId': buffer.read_s()})
            if controllers:
                entry['controllers'] = controllers
            if version >= 2:
                overrides = []
                for _ in range(buffer.read_short()):
                    overrides.append({
                        'target': buffer.read_s(),
                        'propertyId': buffer.read_short(),
                        'value': buffer.read_s(),
                    })
                if overrides:
                    entry['propertyOverrides'] = overrides
            items.append(entry)
            buffer.position = next_pos
        if items:
            node['listItems'] = items
    elif object_type in ('Image', 'Component', 'Button', 'ProgressBar', 'ScrollBar', 'Label', 'ComboBox', 'Slider'):
        pass  # no extra before-add data for these object types
    else:
        raise _err(package, item, f'{node.get("name")}: unsupported child object type {object_type!r}')


def _read_child_after_add(buffer: ByteBuffer, begin: int, node: dict, package: Package, item: PackageItem) -> None:
    object_type = node['objectType']
    version = buffer.version
    if object_type in ('Text', 'RichText', 'InputText'):
        if buffer.seek(begin, 6):
            text = buffer.read_s()
            if text is not None:
                node['text'] = text
        return
    if object_type == 'List':
        if buffer.seek(begin, 6):
            index = buffer.read_short()
            if index != -1:
                node['selectionControllerIndex'] = index
        return
    if object_type in ('Button', 'ProgressBar', 'Slider', 'ComboBox', 'Label', 'ScrollBar'):
        if node.get('src') is None:
            return
        if not buffer.seek(begin, 6):
            return
        stored_type = name_of(OBJECT_TYPES, buffer.read_byte(), 'ObjectType')
        if stored_type != object_type:
            return
        if object_type == 'Button':
            for key in ('title', 'selectedTitle', 'icon', 'selectedIcon'):
                value = buffer.read_s()
                if value is not None:
                    node[key] = value
            if buffer.read_bool():
                node['titleColor'] = buffer.read_color()
            value = buffer.read_int()
            if value != 0:
                node['titleFontSize'] = value
            value = buffer.read_short()
            if value >= 0:
                node['relatedControllerIndex'] = value
            node['relatedPageId'] = buffer.read_s()
            sound = buffer.read_s()
            if sound is not None:
                node['sound'] = sound
            if buffer.read_bool():
                node['soundVolumeScale'] = buffer.read_float()
            node['selected'] = buffer.read_bool()
        elif object_type == 'ProgressBar':
            node['value'] = buffer.read_int()
            node['max'] = buffer.read_int()
            if version >= 2:
                node['min'] = buffer.read_int()
            if version >= 5:
                sound = buffer.read_s()
                if sound:
                    node['sound'] = sound
                    node['volumeScale'] = buffer.read_float()
                else:
                    buffer.position += 4
        elif object_type == 'Slider':
            node['value'] = buffer.read_int()
            node['max'] = buffer.read_int()
            if version >= 2:
                node['min'] = buffer.read_int()
        elif object_type == 'ComboBox':
            raise _err(package, item, f'{node.get("name")}: ComboBox instance data unsupported')
        return
    if object_type in ('Image', 'Component', 'Loader', 'Graph', 'Group', 'MovieClip'):
        return
    raise _err(package, item, f'{node.get("name")}: unsupported child object type {object_type!r}')


def _parse_child(buffer: ByteBuffer, begin: int, package: Package, item: PackageItem) -> dict:
    if not buffer.seek(begin, 0):
        raise _err(package, item, 'child: type block missing')
    declared_type = name_of(OBJECT_TYPES, buffer.read_byte(), 'ObjectType')
    src = buffer.read_s()
    package_id = buffer.read_s()

    object_type = declared_type
    ref_name = None
    ref_item = None
    if src is not None and package_id is None:
        ref_item = package.items_by_id.get(src)
        if ref_item is None:
            raise _err(package, item, f'child references unknown item {src!r}')
        if ref_item.type == 'Component':
            object_type = ref_item.object_type or 'Component'
        elif ref_item.type in ('Image', 'MovieClip'):
            object_type = ref_item.type
        else:
            raise _err(package, item, f'child references unsupported item type {ref_item.type!r}')
        ref_name = ref_item.name

    # GObject.Setup_BeforeAdd (block 0)
    buffer.seek(begin, 0)
    buffer.position += 5
    node: dict = {
        'id': buffer.read_s(),
        'name': buffer.read_s(),
        'type': declared_type,
        'objectType': object_type,
        'x': buffer.read_int(),
        'y': buffer.read_int(),
    }
    if src is not None:
        node['src'] = src
        node['packageId'] = package_id
        node['refUrl'] = f'ui://{package_id or package.id}{src}'
        if ref_name is not None:
            node['refName'] = ref_name
    if buffer.read_bool():
        node['width'] = buffer.read_int()
        node['height'] = buffer.read_int()
    if buffer.read_bool():
        node['minWidth'] = buffer.read_int()
        node['maxWidth'] = buffer.read_int()
        node['minHeight'] = buffer.read_int()
        node['maxHeight'] = buffer.read_int()
    if buffer.read_bool():
        node['scale'] = [buffer.read_float(), buffer.read_float()]
    if buffer.read_bool():
        node['skew'] = [buffer.read_float(), buffer.read_float()]
    if buffer.read_bool():
        node['pivot'] = [buffer.read_float(), buffer.read_float()]
        node['pivotAsAnchor'] = buffer.read_bool()
    node['alpha'] = buffer.read_float()
    node['rotation'] = buffer.read_float()
    node['visible'] = buffer.read_bool()
    node['touchable'] = buffer.read_bool()
    node['grayed'] = buffer.read_bool()
    node['blendMode'] = name_of(BLEND_MODES, buffer.read_byte(), 'BlendMode')
    filter_type = buffer.read_byte()
    if filter_type == 1:
        node['colorFilter'] = [buffer.read_float() for _ in range(4)]
    elif filter_type != 0:
        raise _err(package, item, f'{node["name"]}: unknown filter type {filter_type}')
    data = buffer.read_s()
    if data is not None:
        node['data'] = data

    # block 1: tooltips / group
    if buffer.seek(begin, 1):
        tooltips = buffer.read_s()
        if tooltips is not None:
            node['tooltips'] = tooltips
        group_id = buffer.read_short()
        if group_id >= 0:
            node['groupIndex'] = group_id

    # block 2: gears
    if buffer.seek(begin, 2):
        gears = []
        for _ in range(buffer.read_short()):
            next_pos = buffer.read_ushort() + buffer.position
            gears.append(_read_gear(buffer, buffer.version))
            buffer.position = next_pos
        if gears:
            node['gears'] = gears

    # block 3: relations
    if buffer.seek(begin, 3):
        relations = _read_relations(buffer)
        if relations:
            node['relations'] = relations

    if object_type == 'InputText':
        if buffer.seek(begin, 4):
            prompt = buffer.read_s()
            if prompt is not None:
                node['promptText'] = prompt
            restrict = buffer.read_s()
            if restrict is not None:
                node['restrict'] = restrict
            value = buffer.read_int()
            if value != 0:
                node['maxLength'] = value
            value = buffer.read_int()
            if value != 0:
                node['keyboardType'] = value
            if buffer.read_bool():
                node['displayAsPassword'] = True

    _read_child_before_add(buffer, begin, node, package, item)
    _read_child_after_add(buffer, begin, node, package, item)
    return node


def _decode_transition_value(buffer: ByteBuffer, action_type: str) -> dict:
    version = buffer.version
    if action_type in ('XY', 'Size', 'Pivot', 'Skew'):
        value = {'b1': buffer.read_bool(), 'b2': buffer.read_bool(),
                 'f1': buffer.read_float(), 'f2': buffer.read_float()}
        if version >= 2 and action_type == 'XY':
            value['percent'] = buffer.read_bool()
        return value
    if action_type in ('Alpha', 'Rotation'):
        return {'f1': buffer.read_float()}
    if action_type == 'Scale':
        return {'f1': buffer.read_float(), 'f2': buffer.read_float()}
    if action_type == 'Color':
        return {'color': buffer.read_color()}
    if action_type == 'Animation':
        value = {'playing': buffer.read_bool(), 'frame': buffer.read_int()}
        if version >= 6:
            value['animationName'] = buffer.read_s()
            value['skinName'] = buffer.read_s()
        return value
    if action_type == 'Visible':
        return {'visible': buffer.read_bool()}
    if action_type == 'Sound':
        return {'sound': buffer.read_s(), 'volume': buffer.read_float()}
    if action_type == 'Transition':
        return {'transitionName': buffer.read_s(), 'playTimes': buffer.read_int()}
    if action_type == 'Shake':
        return {'amplitude': buffer.read_float(), 'duration': buffer.read_float()}
    if action_type == 'ColorFilter':
        return {'brightness': buffer.read_float(), 'contrast': buffer.read_float(),
                'saturation': buffer.read_float(), 'hue': buffer.read_float()}
    if action_type in ('Text', 'Icon'):
        return {'text': buffer.read_s()}
    raise FguiFormatError(f'transition: cannot decode value for action {action_type!r}')


def _read_transition(buffer: ByteBuffer, package: Package, item: PackageItem) -> dict:
    transition = {
        'name': buffer.read_s(),
        'options': buffer.read_int(),
        'autoPlay': buffer.read_bool(),
        'autoPlayTimes': buffer.read_int(),
        'autoPlayDelay': buffer.read_float(),
    }
    items = []
    for _ in range(buffer.read_short()):
        data_len = buffer.read_short()
        begin = buffer.position
        if not buffer.seek(begin, 0):
            raise _err(package, item, 'transition item: header block missing')
        entry: dict = {
            'type': name_of(TRANSITION_ACTION_TYPES, buffer.read_byte(), 'TransitionActionType'),
            'time': buffer.read_float(),
        }
        target_index = buffer.read_short()
        entry['targetIndex'] = target_index
        label = buffer.read_s()
        if label is not None:
            entry['label'] = label
        if buffer.read_bool():
            if not buffer.seek(begin, 1):
                raise _err(package, item, 'transition item: tween block missing')
            tween = {
                'duration': buffer.read_float(),
                'easeType': name_of(EASE_TYPES, buffer.read_byte(), 'EaseType'),
                'repeat': buffer.read_int(),
                'yoyo': buffer.read_bool(),
            }
            end_label = buffer.read_s()
            if end_label is not None:
                tween['endLabel'] = end_label
            if not buffer.seek(begin, 2):
                raise _err(package, item, 'transition item: start value block missing')
            tween['startValue'] = _decode_transition_value(buffer, entry['type'])
            if not buffer.seek(begin, 3):
                raise _err(package, item, 'transition item: end value block missing')
            tween['endValue'] = _decode_transition_value(buffer, entry['type'])
            if buffer.version >= 2:
                path = buffer.read_path()
                if path:
                    tween['path'] = path
            if buffer.version >= 4 and tween['easeType'] == 'Custom':
                custom = buffer.read_path()
                if custom:
                    tween['customEase'] = custom
            entry['tween'] = tween
        else:
            if not buffer.seek(begin, 2):
                raise _err(package, item, 'transition item: value block missing')
            entry['value'] = _decode_transition_value(buffer, entry['type'])
        items.append(entry)
        buffer.position = begin + data_len
    transition['items'] = items
    return transition


def parse_component(item: PackageItem, package: Package) -> dict:
    """GComponent.ConstructFromResource for one component package item."""
    buffer = item.raw
    if buffer is None:
        raise _err(package, item, 'component has no raw data')
    assert buffer.string_table is not None
    component: dict = {
        'id': item.id,
        'name': item.name,
        'objectType': item.object_type or 'Component',
        'url': f'ui://{package.id}{item.id}',
    }

    # block 0: header
    if not buffer.seek(0, 0):
        raise _err(package, item, 'header block missing')
    component['width'] = buffer.read_int()
    component['height'] = buffer.read_int()
    if buffer.read_bool():
        component['minWidth'] = buffer.read_int()
        component['maxWidth'] = buffer.read_int()
        component['minHeight'] = buffer.read_int()
        component['maxHeight'] = buffer.read_int()
    if buffer.read_bool():
        component['pivot'] = [buffer.read_float(), buffer.read_float()]
        component['pivotAsAnchor'] = buffer.read_bool()
    if buffer.read_bool():
        component['margin'] = [buffer.read_int(), buffer.read_int(), buffer.read_int(), buffer.read_int()]
    overflow = name_of(OVERFLOW_TYPES, buffer.read_byte(), 'OverflowType')
    component['overflow'] = overflow
    if overflow == 'Scroll':
        saved = buffer.position
        if not buffer.seek(0, 7):
            raise _err(package, item, 'scroll block missing')
        component['scroll'] = _read_scroll(buffer)
        buffer.position = saved
    if buffer.read_bool():
        component['clipSoftness'] = [buffer.read_int(), buffer.read_int()]

    # block 1: controllers
    controllers = []
    if not buffer.seek(0, 1):
        raise _err(package, item, 'controller block missing')
    for _ in range(buffer.read_short()):
        next_pos = buffer.read_ushort() + buffer.position
        controllers.append(_read_controller(buffer, buffer.version))
        buffer.position = next_pos
    if controllers:
        component['controllers'] = controllers
    controller_names = [c['name'] for c in controllers]

    # block 2: children (two passes like the original: before-add, then after-add)
    if not buffer.seek(0, 2):
        raise _err(package, item, 'child block missing')
    spans = []
    for _ in range(buffer.read_short()):
        data_len = buffer.read_short()
        begin = buffer.position
        spans.append((begin, data_len))
        buffer.position = begin + data_len
    children = [_parse_child(buffer, begin, package, item) for begin, _ in spans]
    component['children'] = children

    # block 3: component relations (parent to child)
    if buffer.seek(0, 3):
        relations = _read_relations(buffer)
        if relations:
            for relation in relations:
                index = relation['targetIndex']
                if 0 <= index < len(children):
                    relation['targetName'] = children[index]['name']
            component['relations'] = relations

    # resolve child relation target names (siblings; -1 is the parent component)
    for node in children:
        for relation in node.get('relations', []):
            index = relation['targetIndex']
            if index == -1:
                relation['targetName'] = item.name
            elif 0 <= index < len(children):
                relation['targetName'] = children[index]['name']

    # resolve gear controller names
    for node in children:
        for gear in node.get('gears', []):
            index = gear['controllerIndex']
            if 0 <= index < len(controller_names):
                gear['controllerName'] = controller_names[index]

    # block 4: misc
    if not buffer.seek(0, 4):
        raise _err(package, item, 'misc block missing')
    buffer.position += 2  # customData
    component['opaque'] = buffer.read_bool()
    mask_id = buffer.read_short()
    if mask_id != -1:
        component['maskIndex'] = mask_id
        if 0 <= mask_id < len(children):
            component['maskName'] = children[mask_id]['name']
        if buffer.read_bool():
            component['reversedMask'] = True
    hit_test_id = buffer.read_s()
    hit_i1 = buffer.read_int()
    hit_i2 = buffer.read_int()
    if hit_test_id is not None:
        component['hitTestImage'] = hit_test_id
    elif hit_i1 != 0 and hit_i2 != -1:
        component['hitTestChildIndex'] = hit_i2
        if 0 <= hit_i2 < len(children):
            component['hitTestChildName'] = children[hit_i2]['name']
    if buffer.version >= 5:
        added_sound = buffer.read_s()
        if added_sound:
            component['addedSound'] = added_sound
        removed_sound = buffer.read_s()
        if removed_sound:
            component['removedSound'] = removed_sound

    # block 5: transitions
    transitions = []
    if not buffer.seek(0, 5):
        raise _err(package, item, 'transition block missing')
    for _ in range(buffer.read_short()):
        next_pos = buffer.read_ushort() + buffer.position
        transitions.append(_read_transition(buffer, package, item))
        buffer.position = next_pos
    for transition in transitions:
        for entry in transition['items']:
            index = entry['targetIndex']
            if index == -1:
                entry['targetName'] = item.name
                entry['targetId'] = item.id
            elif 0 <= index < len(children):
                entry['targetName'] = children[index]['name']
                entry['targetId'] = children[index]['id']
    if transitions:
        component['transitions'] = transitions

    # extension data (block 6) for non-plain component object types
    object_type = component['objectType']
    if object_type == 'Component':
        return component
    if not buffer.seek(0, 6):
        raise _err(package, item, f'{object_type} extension block missing')
    if object_type == 'Button':
        component['extension'] = {
            'buttonMode': name_of(BUTTON_MODES, buffer.read_byte(), 'ButtonMode'),
        }
        sound = buffer.read_s()
        if sound is not None:
            component['extension']['sound'] = sound
        component['extension']['soundVolumeScale'] = buffer.read_float()
        component['extension']['downEffect'] = buffer.read_byte()
        component['extension']['downEffectValue'] = buffer.read_float()
    elif object_type == 'ProgressBar':
        component['extension'] = {
            'titleType': name_of(PROGRESS_TITLE_TYPES, buffer.read_byte(), 'ProgressTitleType'),
            'reverse': buffer.read_bool(),
        }
    elif object_type == 'ScrollBar':
        component['extension'] = {'fixedGripSize': buffer.read_bool()}
    else:
        raise _err(package, item, f'unsupported component extension {object_type!r}')
    return component
