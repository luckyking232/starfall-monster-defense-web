"""Big-endian byte reader mirroring FairyGUI-unity Utils/ByteBuffer.cs."""
from __future__ import annotations

import struct


class ByteBuffer:
    __slots__ = ('data', 'base', 'ptr', 'length', 'string_table', 'version')

    def __init__(self, data: bytes, offset: int = 0, length: int = -1) -> None:
        self.data = data
        self.base = offset
        self.ptr = 0
        self.length = (len(data) - offset) if length < 0 else length
        self.string_table: list[str] | None = None
        self.version = 0

    @property
    def position(self) -> int:
        return self.ptr

    @position.setter
    def position(self, value: int) -> None:
        self.ptr = value

    def _take(self, count: int) -> bytes:
        if count > self.length - self.ptr:
            raise ValueError('ByteBuffer: read past end')
        chunk = self.data[self.base + self.ptr:self.base + self.ptr + count]
        self.ptr += count
        return chunk

    def read_byte(self) -> int:
        return self._take(1)[0]

    def read_bool(self) -> bool:
        return self.read_byte() == 1

    def read_short(self) -> int:
        return struct.unpack('>h', self._take(2))[0]

    def read_ushort(self) -> int:
        return struct.unpack('>H', self._take(2))[0]

    def read_int(self) -> int:
        return struct.unpack('>i', self._take(4))[0]

    def read_uint(self) -> int:
        return struct.unpack('>I', self._take(4))[0]

    def read_float(self) -> float:
        return struct.unpack('>f', self._take(4))[0]

    def read_string(self, length: int | None = None) -> str:
        if length is None:
            length = self.read_ushort()
        return self._take(length).decode('utf-8')

    def read_s(self) -> str | None:
        index = self.read_ushort()
        if index == 65534:
            return None
        if index == 65533:
            return ''
        assert self.string_table is not None
        return self.string_table[index]

    def read_s_array(self, count: int) -> list[str | None]:
        return [self.read_s() for _ in range(count)]

    def read_buffer(self) -> 'ByteBuffer':
        count = self.read_int()
        chunk = ByteBuffer(self.data, self.base + self.ptr, count)
        chunk.string_table = self.string_table
        chunk.version = self.version
        self.ptr += count
        return chunk

    def read_color(self) -> str:
        r, g, b, a = self._take(4)
        return f'#{r:02x}{g:02x}{b:02x}{a:02x}'

    def seek(self, index_table_pos: int, block_index: int) -> bool:
        """ByteBuffer.Seek: jump to a block of the segment table at index_table_pos."""
        tmp = self.ptr
        self.ptr = index_table_pos
        seg_count = self.read_byte()
        if block_index < seg_count:
            use_short = self.read_byte() == 1
            if use_short:
                self.ptr += 2 * block_index
                new_pos = self.read_short()
            else:
                self.ptr += 4 * block_index
                new_pos = self.read_int()
            if new_pos > 0:
                self.ptr = index_table_pos + new_pos
                return True
            self.ptr = tmp
            return False
        self.ptr = tmp
        return False

    def read_path(self) -> list[dict]:
        """ByteBuffer.ReadPath (used by transition tween configs)."""
        count = self.read_int()
        points = []
        for _ in range(count):
            curve_type = self.read_byte()
            if curve_type == 2:  # Bezier
                points.append({'curveType': 'Bezier', 'point': [self.read_float(), self.read_float()],
                               'control1': [self.read_float(), self.read_float()]})
            elif curve_type == 3:  # CubicBezier
                points.append({'curveType': 'CubicBezier', 'point': [self.read_float(), self.read_float()],
                               'control1': [self.read_float(), self.read_float()],
                               'control2': [self.read_float(), self.read_float()]})
            else:
                points.append({'curveType': curve_type, 'point': [self.read_float(), self.read_float()]})
        return points
