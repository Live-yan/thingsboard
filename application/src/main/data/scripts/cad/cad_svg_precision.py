#
# Copyright © 2016-2026 The Thingsboard Authors
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
"""SVG precision and display-lineweight policy for the canonical CAD recorder.

SVGBackend's integer relative commands lose small features and accumulate error
along polylines. Emit absolute, fractional commands instead. A documented 0.5 px
minimum at a 1200x700 fit view keeps CAD hairlines visible; thicker source weights
are retained. Widths remain SVG units so zoom still scales the drawing normally.
"""
import math
from ezdxf.addons.drawing import svg
from ezdxf.addons.drawing.config import LineweightPolicy
from ezdxf.path import Command
from ezdxf.math import Vec2


def number(value):
    if not math.isfinite(value):
        raise ValueError('Non-finite SVG coordinate')
    text = f'{value:.8f}'.rstrip('0').rstrip('.')
    return '0' if text in ('', '-0') else text


def point(value):
    return f'{number(value.x)} {number(value.y)}'


class PrecisionSvgRenderer(svg.SVGRenderBackend):
    origin = Vec2(0, 0)

    def point(self, value):
        return point(value - self.origin)

    def resolve_stroke_width(self, width):
        key = width
        if key in self._stroke_width_cache:
            return self._stroke_width_cache[key]
        if self.lineweight_policy == LineweightPolicy.ABSOLUTE:
            source = max(self.min_lineweight, width) * self.lineweight_scaling if self.lineweight_scaling else self.min_lineweight
            resolved = source * self.stroke_width_scale
        else:
            resolved = super().resolve_stroke_width(width)
        _, _, w, h = map(float, self.root.get('viewBox').split())
        # ViewBox units, NOT CSS px and NOT a non-scaling stroke on every path.
        resolved = max(resolved, max(w / 1200, h / 700) * 0.5)
        self._stroke_width_cache[key] = resolved
        return resolved

    def make_polyline_str(self, points, close=False):
        if len(points) < 2:
            return ''
        return 'M ' + self.point(points[0]) + ''.join(' L ' + self.point(p) for p in points[1:]) + (' Z' if close else '')

    def make_multi_line_str(self, lines):
        return ' '.join('M ' + self.point(start) + ' L ' + self.point(end) for start, end in lines)

    def make_path_str(self, path, close=False):
        if not len(path):
            return ''
        commands = ['M ' + self.point(path.start)]
        for cmd in path.commands():
            if cmd.type == Command.MOVE_TO:
                commands.append('M ' + self.point(cmd.end))
            elif cmd.type == Command.LINE_TO:
                commands.append('L ' + self.point(cmd.end))
            elif cmd.type == Command.CURVE3_TO:
                commands.append('Q ' + self.point(cmd.ctrl) + ' ' + self.point(cmd.end))
            elif cmd.type == Command.CURVE4_TO:
                commands.append('C ' + self.point(cmd.ctrl1) + ' ' + self.point(cmd.ctrl2) + ' ' + self.point(cmd.end))
            else:
                raise ValueError(f'Unsupported recorded path command: {cmd.type}')
        if close:
            commands.append('Z')
        return ' '.join(commands)
