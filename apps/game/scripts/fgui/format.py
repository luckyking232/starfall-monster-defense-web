"""Enum name tables from the official FairyGUI-unity FieldTypes.cs / related sources.

Only names are mirrored here so decoded output is self-describing; the numeric
order matches the original enums exactly (they are read as raw bytes/shorts).
"""
from __future__ import annotations

PACKAGE_ITEM_TYPES = [
    'Image', 'MovieClip', 'Sound', 'Component', 'Atlas', 'Font', 'Swf', 'Misc',
    'Unknown', 'Spine', 'DragoneBones',
]

OBJECT_TYPES = [
    'Image', 'MovieClip', 'Swf', 'Graph', 'Loader', 'Group', 'Text', 'RichText',
    'InputText', 'Component', 'List', 'Label', 'Button', 'ComboBox',
    'ProgressBar', 'Slider', 'ScrollBar', 'Tree', 'Loader3D',
]

ALIGN_TYPES = ['Left', 'Center', 'Right']
VERT_ALIGN_TYPES = ['Top', 'Middle', 'Bottom']
OVERFLOW_TYPES = ['Visible', 'Hidden', 'Scroll']
FILL_TYPES = ['None', 'Scale', 'ScaleMatchHeight', 'ScaleMatchWidth', 'ScaleFree', 'ScaleNoBorder']
AUTO_SIZE_TYPES = ['None', 'Both', 'Height', 'Shrink', 'Ellipsis']
SCROLL_TYPES = ['Horizontal', 'Vertical', 'Both']
SCROLL_BAR_DISPLAY_TYPES = ['Default', 'Visible', 'Auto', 'Hidden']
LIST_LAYOUT_TYPES = ['SingleColumn', 'SingleRow', 'FlowHorizontal', 'FlowVertical', 'Pagination']
LIST_SELECTION_MODES = ['Single', 'Multiple', 'Multiple_SingleClick', 'None']
PROGRESS_TITLE_TYPES = ['Percent', 'ValueAndMax', 'Value', 'Max']
BUTTON_MODES = ['Common', 'Check', 'Radio']
TRANSITION_ACTION_TYPES = [
    'XY', 'Size', 'Scale', 'Pivot', 'Alpha', 'Rotation', 'Color', 'Animation',
    'Visible', 'Sound', 'Transition', 'Shake', 'ColorFilter', 'Skew', 'Text',
    'Icon', 'Unknown',
]
GROUP_LAYOUT_TYPES = ['None', 'Horizontal', 'Vertical']
CHILDREN_RENDER_ORDERS = ['Ascent', 'Descent', 'Arch']
FLIP_TYPES = ['None', 'Horizontal', 'Vertical', 'Both']
FILL_METHODS = ['None', 'Horizontal', 'Vertical', 'Radial90', 'Radial180', 'Radial360']
RELATION_TYPES = [
    'Left_Left', 'Left_Center', 'Left_Right', 'Center_Center', 'Right_Left',
    'Right_Center', 'Right_Right', 'Top_Top', 'Top_Middle', 'Top_Bottom',
    'Middle_Middle', 'Bottom_Top', 'Bottom_Middle', 'Bottom_Bottom', 'Width',
    'Height', 'LeftExt_Left', 'LeftExt_Right', 'RightExt_Left', 'RightExt_Right',
    'TopExt_Top', 'TopExt_Bottom', 'BottomExt_Top', 'BottomExt_Bottom', 'Size',
]
GEAR_TYPES = ['Display', 'XY', 'Size', 'Look', 'Color', 'Animation', 'Text', 'Icon', 'Display2']
CONTROLLER_ACTION_TYPES = ['PlayTransition', 'ChangePage']
# Assets/Scripts/Tween/EaseType.cs
EASE_TYPES = [
    'Linear', 'SineIn', 'SineOut', 'SineInOut', 'QuadIn', 'QuadOut', 'QuadInOut',
    'CubicIn', 'CubicOut', 'CubicInOut', 'QuartIn', 'QuartOut', 'QuartInOut',
    'QuintIn', 'QuintOut', 'QuintInOut', 'ExpoIn', 'ExpoOut', 'ExpoInOut',
    'CircIn', 'CircOut', 'CircInOut', 'ElasticIn', 'ElasticOut', 'ElasticInOut',
    'BackIn', 'BackOut', 'BackInOut', 'BounceIn', 'BounceOut', 'BounceInOut',
    'Custom',
]
# Assets/Scripts/Core/BlendMode.cs
BLEND_MODES = [
    'Normal', 'None', 'Add', 'Multiply', 'Screen', 'Erase', 'Mask', 'Below',
    'Off', 'One_OneMinusSrcAlpha', 'Custom1', 'Custom2', 'Custom3',
]


def name_of(table: list[str], value: int, what: str) -> str:
    if not 0 <= value < len(table):
        raise ValueError(f'{what}: enum value {value} out of range')
    return table[value]
