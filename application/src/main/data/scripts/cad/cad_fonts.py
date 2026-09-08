# Copyright © 2016-2026 The Thingsboard Authors
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy at http://www.apache.org/licenses/LICENSE-2.0
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""Resolve font diagnostics using the SAME font face that the renderer uses.

Only operator-configured directories are scanned. A font path embedded in an
uploaded drawing is never opened. Font files are not bundled or downloaded.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path, PureWindowsPath
from ezdxf.fonts import fonts
from ezdxf.addons.drawing import RenderContext


def font_basename(name: str) -> str:
    # Windows DXF font paths must behave identically on Linux workers.
    return PureWindowsPath(str(name)).name.strip()


def load_configured_fonts() -> None:
    """Add trusted SHX/TTF locations; ezdxf already loads its system font cache."""
    directories = os.environ.get('CAD_FONT_DIRS', '').split(os.pathsep)
    if sys.platform == 'win32':
        # Known application install locations only; never scan drives or paths
        # taken from the uploaded DWG. This lets a local AutoCAD install work.
        program_files = Path(os.environ.get('ProgramFiles', 'C:/Program Files'))
        directories += [str(path) for path in program_files.glob('Autodesk/AutoCAD*/Fonts')]
    for directory in dict.fromkeys(directories):
        if directory.strip():
            path = Path(directory.strip()).expanduser()
            if not path.is_dir():
                raise ValueError('A configured CAD_FONT_DIRS directory does not exist')
            fonts.font_manager.scan_folder(path)


def resolve_source_font(name: str) -> tuple[str, bool]:
    """Return (render font, exact-source-available), without a false SHX warning.

    DXF often stores ROMANS or TXT without an extension. has_font('romans')
    alone is NOT an availability check for romans.shx or romans__.ttf.
    TTF equivalents can be used, but remain explicitly reported as substitutes.
    """
    requested = font_basename(name)
    if not requested:
        return '', True
    if fonts.is_shx_font_name(requested):
        exact = requested if requested.lower().endswith('.shx') else requested + '.shx'
        if fonts.font_manager.has_font(exact):
            return exact, True
        resolved = fonts.resolve_shx_font_name(requested, order='stl')
        if fonts.font_manager.has_font(resolved):
            return resolved, False
    elif fonts.font_manager.has_font(requested):
        return requested, True
    return fonts.font_manager.fallback_font_name(), False


class CadFontContext(RenderContext):
    """Resolve once per STYLE, not for every glyph/entity in repeated blocks."""
    def __init__(self, document):
        self.source_fonts: dict[str, tuple[str, str, bool]] = {}
        load_configured_fonts()
        super().__init__(document)

    def add_text_style(self, text_style):
        super().add_text_style(text_style)
        name = text_style.dxf.get('font', '')
        if name:
            resolved, exact = resolve_source_font(name)
            self.fonts[text_style.dxf.name.lower()] = fonts.font_manager.get_font_face(resolved)
            self.source_fonts[text_style.dxf.name.lower()] = (font_basename(name), resolved, exact)

    def font_warning(self, style_name: str):
        resolution = self.source_fonts.get(style_name.lower())
        if resolution and not resolution[2]:
            source, resolved, _ = resolution
            return source, ('Source font ' + source[:160] + ' is unavailable; rendered as vector outlines using '
                            + resolved[:160] + '. SCADA conversion is available; text appearance/metrics may differ. '
                            'Configure CAD_FONT_DIRS with the original licensed font for an exact match.')
        return None
