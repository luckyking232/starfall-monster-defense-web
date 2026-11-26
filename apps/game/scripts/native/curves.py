"""Decode compiled AnimationClip curve payloads.

Compiled clips store their curves in ``m_MuscleClip.m_Clip.data`` as three
parallel curve stores (Unity ``Clip::Data``):

* ``m_StreamedClip`` -- uint32 word stream of frames; each frame is a float32
  time followed by ``keyCount`` keys of ``(curveIndex, coeff[4])`` where
  ``coeff[3]`` is the value at the key. The leading frame carries the sentinel
  time ``-FLT_MAX`` (value in effect from the clip start) and a trailing frame
  at ``+inf`` closes the stream.
* ``m_DenseClip`` -- ``m_SampleArray`` of ``m_FrameCount * m_CurveCount``
  float32 samples taken at ``m_SampleRate`` starting at ``m_BeginTime``.
* ``m_ConstantClip`` -- one float32 per curve, constant over the whole clip.

Curve indices are global across the three stores in streamed/dense/constant
order and line up with ``m_ClipBindingConstant.genericBindings``. Sprite swap
curves are PPtr bindings (``isPPtrCurve == 1``, ``typeID == 212`` i.e.
SpriteRenderer) whose sampled value is an index into
``m_ClipBindingConstant.pptrCurveMapping``.

Nothing here invents data: curves that cannot be decoded are reported as
unsupported together with their raw payload.
"""
from __future__ import annotations

import math
import struct
from typing import Any

#: Time stored in the leading StreamedClip frame; means "in effect from the start".
SENTINEL_START = -3.4028234663852886e+38  # -FLT_MAX

SPRITE_RENDERER_CLASS_ID = 212


class CurveDecodeError(ValueError):
    """Raised when a curve payload does not match the documented layout."""


def _f32(word: int) -> float:
    return struct.unpack('<f', struct.pack('<I', word & 0xFFFFFFFF))[0]


def parse_streamed_frames(words: list[int]) -> list[tuple[float, list[tuple[int, list[float]]]]]:
    """Parse raw StreamedClip words into ``[(time, [(curveIndex, coeffs)])]``."""
    frames: list[tuple[float, list[tuple[int, list[float]]]]] = []
    index = 0
    total = len(words)
    while index < total:
        if index + 2 > total:
            raise CurveDecodeError(f'streamed clip truncated at word {index}: missing frame header')
        time = _f32(words[index])
        key_count = words[index + 1]
        index += 2
        keys: list[tuple[int, list[float]]] = []
        for _ in range(key_count):
            if index + 5 > total:
                raise CurveDecodeError(f'streamed clip truncated at word {index}: missing curve key')
            keys.append((words[index], [_f32(w) for w in words[index + 1:index + 5]]))
            index += 5
        frames.append((time, keys))
    return frames


def streamed_frames_document(words: list[int]) -> list[dict[str, Any]]:
    """JSON-safe verbatim dump of the parsed streamed frames."""
    frames = []
    for time, keys in parse_streamed_frames(words):
        frames.append({
            'time': time if math.isfinite(time) else ('inf' if time > 0 else '-inf'),
            'keys': [{'curve': curve, 'coefficients': coeffs} for curve, coeffs in keys],
        })
    return frames


def _dense_keys(dense: dict[str, Any], curve: int) -> list[tuple[float, float]]:
    """(time, value) samples of one dense curve."""
    frames = int(dense.get('m_FrameCount', 0) or 0)
    curves = int(dense.get('m_CurveCount', 0) or 0)
    samples = dense.get('m_SampleArray', []) or []
    rate = float(dense.get('m_SampleRate', 0.0) or 0.0)
    begin = float(dense.get('m_BeginTime', 0.0) or 0.0)
    if curves <= 0 or frames <= 0:
        return []
    if len(samples) != frames * curves:
        raise CurveDecodeError(
            f'dense clip holds {len(samples)} samples for {frames} frames x {curves} curves')
    if rate <= 0:
        raise CurveDecodeError('dense clip has samples but no sample rate')
    return [(begin + frame / rate, float(samples[frame * curves + curve])) for frame in range(frames)]


def _curve_samples(data: dict[str, Any], index: int,
                   start_time: float) -> tuple[str, list[tuple[float, float, float]]]:
    """Sample (effectiveTime, rawTime, value) triples of one global curve index."""
    streamed = data['m_StreamedClip']
    dense = data['m_DenseClip']
    constant = data['m_ConstantClip']
    streamed_count = int(streamed.get('curveCount', 0) or 0)
    dense_count = int(dense.get('m_CurveCount', 0) or 0)
    if index < streamed_count:
        samples = []
        for time, keys in parse_streamed_frames(list(streamed.get('data', []))):
            for curve, coeffs in keys:
                if curve == index:
                    samples.append((time, time, coeffs[3]))
        return 'streamed', samples
    if index < streamed_count + dense_count:
        return 'dense', [(time, time, value) for time, value in _dense_keys(dense, index - streamed_count)]
    constant_data = constant.get('data', []) or []
    constant_index = index - streamed_count - dense_count
    if constant_index < len(constant_data):
        # a constant curve holds one value for the whole clip, starting at start_time
        return 'constant', [(start_time, start_time, float(constant_data[constant_index]))]
    raise CurveDecodeError(f'curve index {index} is outside streamed/dense/constant data')


def _sprite_keys(samples: list[tuple[float, float, float]], start_time: float,
                 mapping_size: int) -> list[dict[str, Any]]:
    keys = []
    for effective, raw, value in samples:
        sprite_index = int(round(value))
        if not 0 <= sprite_index < mapping_size:
            raise CurveDecodeError(
                f'sprite curve value {value!r} indexes outside pptrCurveMapping[{mapping_size}]')
        key: dict[str, Any] = {
            'time': start_time if effective == SENTINEL_START else effective,
            'rawTime': raw,
            'clampedToStart': effective == SENTINEL_START,
            'spriteIndex': sprite_index,
        }
        keys.append(key)
    return keys


def decode_clip(tree: dict[str, Any]) -> dict[str, Any]:
    """Decode one AnimationClip typetree into a JSON-safe curve document.

    Returns ``curves`` (with per-key sprite PPtrs still unresolved -- the caller
    fills ``sprite``/``spriteName``/``frame`` from the sprite table),
    ``clipData`` (verbatim payload), ``pptrCurveMapping``, ``decodeStatus`` and
    ``decodeNote``.
    """
    muscle = tree['m_MuscleClip']
    data = muscle['m_Clip']['data']
    streamed = data['m_StreamedClip']
    dense = data['m_DenseClip']
    constant = data['m_ConstantClip']
    binding_constant = tree.get('m_ClipBindingConstant', {})
    bindings = binding_constant.get('genericBindings', []) or []
    mapping = binding_constant.get('pptrCurveMapping', []) or []
    start_time = float(muscle.get('m_StartTime', 0.0) or 0.0)
    words = list(streamed.get('data', []))

    clip_data = {
        'streamed': {
            'curveCount': int(streamed.get('curveCount', 0) or 0),
            'wordCount': len(words),
            'words': words,
            'frames': streamed_frames_document(words),
        },
        'dense': {
            'frameCount': int(dense.get('m_FrameCount', 0) or 0),
            'curveCount': int(dense.get('m_CurveCount', 0) or 0),
            'sampleRate': float(dense.get('m_SampleRate', 0.0) or 0.0),
            'beginTime': float(dense.get('m_BeginTime', 0.0) or 0.0),
            'sampleArray': list(dense.get('m_SampleArray', []) or []),
        },
        'constant': {
            'valueCount': len(constant.get('data', []) or []),
            'values': list(constant.get('data', []) or []),
        },
    }
    mapping_document = [str(int(p.get('m_PathID', 0))) for p in mapping]
    external_mapping = [p for p in mapping if int(p.get('m_FileID', 0) or 0) != 0]

    if not bindings:
        has_payload = bool(words) or clip_data['dense']['sampleArray'] or clip_data['constant']['values']
        note = 'no curves: genericBindings is empty'
        if has_payload:
            note += ' but raw payload is present; kept verbatim in clipData'
        return {
            'curves': [],
            'clipData': clip_data,
            'pptrCurveMapping': mapping_document,
            'decodeStatus': 'empty' if not has_payload else 'partial-unsupported',
            'decodeNote': note,
        }

    curves: list[dict[str, Any]] = []
    problems: list[str] = []
    if external_mapping:
        problems.append(f'{len(external_mapping)} pptrCurveMapping entr(ies) point at external files')
    for index, binding in enumerate(bindings):
        entry: dict[str, Any] = {
            'index': index,
            'binding': {
                'path': int(binding.get('path', 0)),
                'attribute': int(binding.get('attribute', 0)),
                'typeId': int(binding.get('typeID', 0)),
                'customType': int(binding.get('customType', 0)),
                'isPPtrCurve': bool(binding.get('isPPtrCurve', 0)),
                'script': {
                    'fileId': int((binding.get('script') or {}).get('m_FileID', 0)),
                    'pathId': str(int((binding.get('script') or {}).get('m_PathID', 0))),
                },
            },
        }
        try:
            source, samples = _curve_samples(data, index, start_time)
        except CurveDecodeError as exc:
            entry.update(kind='unknown', source=None, keys=[], unsupported=str(exc))
            problems.append(f'curve {index}: {exc}')
            curves.append(entry)
            continue
        entry['source'] = source
        is_sprite = entry['binding']['isPPtrCurve'] and entry['binding']['typeId'] == SPRITE_RENDERER_CLASS_ID
        if not is_sprite:
            entry.update(kind='unsupported', keys=[{'time': e, 'rawTime': r, 'value': v}
                                                   for e, r, v in samples],
                         unsupported=f'binding typeId {entry["binding"]["typeId"]} '
                                     f'isPPtrCurve {entry["binding"]["isPPtrCurve"]} is not a sprite curve')
            problems.append(f'curve {index}: unsupported binding type {entry["binding"]["typeId"]}')
            curves.append(entry)
            continue
        try:
            keys = _sprite_keys(samples, start_time, len(mapping))
        except CurveDecodeError as exc:
            entry.update(kind='pptrSprite', keys=[], unsupported=str(exc))
            problems.append(f'curve {index}: {exc}')
            curves.append(entry)
            continue
        entry.update(kind='pptrSprite', keys=keys)
        curves.append(entry)

    return {
        'curves': curves,
        'clipData': clip_data,
        'pptrCurveMapping': mapping_document,
        'decodeStatus': 'decoded' if not problems else 'partial-unsupported',
        'decodeNote': '; '.join(problems) if problems else 'all curves decoded',
    }
