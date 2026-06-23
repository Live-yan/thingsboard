"""
DWG → SVG 转换脚本。
流程: DWG → (ODA File Converter) → DXF → (ezdxf SVGBackend) → SVG

输出:
    output_folder/
    ├── preview.svg        # 总预览图，宽 1920px，等比缩放
    ├── block_name_1.svg   # 块定义 1
    ├── block_name_2.svg   # 块定义 2
    └── ...

用法:
    python dwg_to_svg.py <input.dwg> [--output <output_folder>]
    python dwg_to_svg.py --batch          # 批量转换 files/ 下所有 DWG
    python dwg_to_svg.py --test           # 运行内置测试

依赖: ezdxf, Pillow
外部工具: ODA File Converter (D:\\Tool\\ODA\\ODAFileConverter.exe)
"""

import argparse
import json
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import ezdxf
from ezdxf import bbox as ezdxf_bbox
from ezdxf import colors as ezdxf_colors
from ezdxf.addons.drawing import Frontend, RenderContext, layout, svg

# ── 配置 ──────────────────────────────────────────────────────────────
ODA_PATH = r"D:\Tool\ODA\ODAFileConverter.exe"
FILES_DIR = Path(__file__).parent.parent / "files"
OUTPUT_DIR = Path(__file__).parent / "output_svg"

TEST_FILES = [
    "Drawing1.dwg",
    "DD-DWG-WHPA-PR-0701 UTILITY FLOW DIAGRAM GAS TURBINE GENERATOR SYSTEM (CN-USP-SCS(W)-DF29-1) REV0.dwg",
    "DD-DWG-WHPA-PR-0702 UTILITY FLOW DIAGRAM DIESEL ENGINE GENERATOR SYSTEM (CN-USP-SCS(W)-DF29-1) REV0.dwg",
]

PREVIEW_WIDTH = 1920  # 预览图宽度（px）
PREVIEW_DISPLAY_WIDTH = 1200  # Angular CAD preview viewport width
PREVIEW_DISPLAY_HEIGHT = 700  # Angular CAD preview viewport height
BLOCK_WIDTH = 100    # SCADA 符号 viewBox 宽度（thingsboard 1格=100px）
BLOCK_COORD_SPACE = 1000  # SCADA 符号坐标空间（越小文件越紧凑）
PREVIEW_COORD_SPACE = 100_000  # 高精度预览/导入坐标空间，避免大图细节量化变形
PREVIEW_EDGE_PAD_RATIO = 0.01  # 防止边界线/描边落在 viewBox 外被裁剪
PREVIEW_MIN_STROKE_PX = 1.35  # 高精度 viewBox 下仍保证 CAD 细线在预览中可见


# ── 坐标工具 ──────────────────────────────────────────────────────────
def _entity_points(entity) -> list[tuple[float, float]]:
    """提取实体的 XY 坐标点（忽略 Z 轴）。"""
    pts = []
    d = entity.dxf

    for attr in ("start", "end", "insert", "center"):
        if hasattr(d, attr):
            p = getattr(d, attr)
            pts.append((float(p.x), float(p.y)))

    if entity.dxftype() == "LWPOLYLINE":
        for pt in entity.get_points(format="xy"):
            pts.append((float(pt[0]), float(pt[1])))
    elif entity.dxftype() == "POLYLINE":
        for v in entity.vertices:
            pts.append((float(v.dxf.location.x), float(v.dxf.location.y)))
    elif entity.dxftype() == "SPLINE" and hasattr(d, "control_points"):
        for p in entity.control_points:
            pts.append((float(p.x), float(p.y)))
    elif entity.dxftype() in ("TEXT", "MTEXT") and hasattr(d, "insert"):
        p = d.insert
        pts.append((float(p.x), float(p.y)))

    return pts


def _collect_points(entities) -> list[tuple[float, float]]:
    """收集所有实体的 XY 坐标。"""
    pts = []
    for e in entities:
        pts.extend(_entity_points(e))
    return pts


def _compute_normal_bounds(points: list[tuple[float, float]]) -> tuple[float, float, float, float]:
    """计算正常坐标范围，用间隙检测过滤异常值。"""
    if not points:
        return (0, 100, 0, 100)

    def _find_range(vals: list[float]) -> tuple[float, float]:
        unique = sorted(set(vals))
        if len(unique) <= 1:
            return (unique[0], unique[0])

        gaps = [(unique[i + 1] - unique[i], i) for i in range(len(unique) - 1)]
        gap_sizes = [g[0] for g in gaps]
        median_gap = sorted(gap_sizes)[len(gap_sizes) // 2]
        threshold = max(median_gap * 10, 1000)

        for gap_size, split_idx in gaps:
            if gap_size > threshold:
                return (unique[0], unique[split_idx])

        return (unique[0], unique[-1])

    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    xmin, xmax = _find_range(xs)
    ymin, ymax = _find_range(ys)

    if xmax <= xmin:
        xmax = xmin + 1
    if ymax <= ymin:
        ymax = ymin + 1

    return (xmin, xmax, ymin, ymax)


def _cad_bbox_to_svg_bbox(bbox: tuple[float, float, float, float],
                          cad_bounds: tuple[float, float, float, float],
                          svg_viewbox: tuple[float, float, float, float],
                          min_preview_size: float = 1.0) -> tuple[float, float, float, float]:
    """Map a CAD WCS bbox into the same ezdxf SVG coordinate space as preview.svg."""
    min_x, min_y, max_x, max_y = bbox
    cad_min_x, cad_max_x, cad_min_y, cad_max_y = cad_bounds
    vb_x, vb_y, vb_w, vb_h = svg_viewbox
    cad_w = cad_max_x - cad_min_x or 1.0
    cad_h = cad_max_y - cad_min_y or 1.0

    def map_point(x: float, y: float) -> tuple[float, float]:
        sx = vb_x + ((x - cad_min_x) / cad_w) * vb_w
        sy = vb_y + ((cad_max_y - y) / cad_h) * vb_h
        return sx, sy

    x1, y1 = map_point(min_x, min_y)
    x2, y2 = map_point(max_x, max_y)
    svg_min_x, svg_max_x = min(x1, x2), max(x1, x2)
    svg_min_y, svg_max_y = min(y1, y2), max(y1, y2)

    if svg_max_x - svg_min_x < min_preview_size:
        cx = (svg_min_x + svg_max_x) / 2
        svg_min_x = cx - min_preview_size / 2
        svg_max_x = cx + min_preview_size / 2
    if svg_max_y - svg_min_y < min_preview_size:
        cy = (svg_min_y + svg_max_y) / 2
        svg_min_y = cy - min_preview_size / 2
        svg_max_y = cy + min_preview_size / 2
    return svg_min_x, svg_min_y, svg_max_x, svg_max_y


def _entity_in_bounds(entity, bounds: tuple[float, float, float, float]) -> bool:
    """判断实体是否在正常坐标范围内。"""
    pts = _entity_points(entity)
    if not pts:
        return True
    xmin, xmax, ymin, ymax = bounds
    for x, y in pts:
        if xmin <= x <= xmax and ymin <= y <= ymax:
            return True
    return False


# ── DWG → DXF ────────────────────────────────────────────────────────
def dwg_to_dxf(dwg_path: Path, output_dir: Path | None = None) -> Path:
    """使用 ODA File Converter 将 DWG 转为 DXF。"""
    if not dwg_path.exists():
        raise FileNotFoundError(f"DWG 文件不存在: {dwg_path}")
    if not Path(ODA_PATH).exists():
        raise FileNotFoundError(f"ODA File Converter 不存在: {ODA_PATH}")

    if output_dir is None:
        output_dir = Path(tempfile.mkdtemp(prefix="dwg2svg_"))
    else:
        output_dir.mkdir(parents=True, exist_ok=True)

    args = [
        ODA_PATH,
        str(dwg_path.parent),
        str(output_dir),
        "ACAD2018",
        "DXF",
        "0",
        dwg_path.name,
    ]

    popen_kwargs: dict = {}
    if sys.platform == "win32":
        si = subprocess.STARTUPINFO()
        si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        si.wShowWindow = 0
        popen_kwargs["startupinfo"] = si
        popen_kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW

    result = subprocess.run(
        args, capture_output=True, text=True, timeout=120, check=False, **popen_kwargs
    )
    if result.returncode != 0:
        raise RuntimeError(f"ODA 转换失败 (code {result.returncode}):\n{result.stderr}")

    dxf_path = output_dir / (dwg_path.stem + ".dxf")
    if not dxf_path.exists():
        for f in output_dir.glob(f"{dwg_path.stem}.*"):
            if f.suffix.lower() == ".dxf":
                dxf_path = f
                break
        else:
            raise RuntimeError(f"转换完成但未找到 DXF: {dxf_path}")

    return dxf_path


# ── 渲染工具 ──────────────────────────────────────────────────────────
def _render_msp_to_svg(doc, msp, coord_space: int = 1_000_000) -> str:
    """使用 SVGBackend 渲染 modelspace，自动处理坐标变换和 viewBox。"""
    ctx = RenderContext(doc)
    backend = svg.SVGBackend()
    frontend = Frontend(ctx, backend)
    frontend.draw_layout(msp)
    page = layout.Page(0, 0)
    settings = layout.Settings(fit_page=True, output_coordinate_space=coord_space)
    return backend.get_string(page, settings=settings)


def _strip_xml_prolog(svg_str: str) -> str:
    """移除 <?xml ...?> 声明、<!DOCTYPE ...> 和前导空白，避免下游再包裹导致嵌套 <svg>。"""
    s = svg_str.lstrip()
    # 反复去除可能存在的多段前置标记
    while True:
        if s.startswith("<?xml"):
            end = s.find("?>")
            if end == -1:
                break
            s = s[end + 2:].lstrip()
        elif s.startswith("<!DOCTYPE"):
            end = s.find(">")
            if end == -1:
                break
            s = s[end + 1:].lstrip()
        elif s.startswith("<!--"):
            end = s.find("-->")
            if end == -1:
                break
            s = s[end + 3:].lstrip()
        else:
            break
    return s


def _rewrite_viewbox_to_cad_wcs(svg_str: str, bbox: tuple[float, float, float, float],
                                y_up: bool = True) -> str:
    """
    将 ezdxf 渲染输出的归一化 viewBox 重写为 CAD WCS 坐标 (min_x, min_y, max_x, max_y)。

    ezdxf SVGBackend 在 output_coordinate_space 下输出 0 0 W H 的 viewBox，并已对内容做
    线性映射。我们用 CAD WCS 的 bbox 替换 viewBox，使下游 (Angular/SCADA) 能直接用
    manifest 中的 x/y/width/height 与之对齐。

    Args:
        svg_str: ezdxf 输出的 SVG 字符串（已去 <?xml>）
        bbox: (min_x, min_y, max_x, max_y) in CAD WCS (mm)
        y_up: True=SVG Y 轴向上（与 CAD 一致）；False=翻转 Y 轴（SVG 默认 Y 向下）
    """
    min_x, min_y, max_x, max_y = bbox
    width = max_x - min_x
    height = max_y - min_y
    if width <= 0:
        width = 1.0
    if height <= 0:
        height = 1.0

    # 替换 viewBox="0 0 W H" 为 CAD WCS 坐标
    if y_up:
        new_vb = f'viewBox="{min_x} {min_y} {width} {height}"'
    else:
        # SVG Y 向下：viewBox 原点用左上角 (min_x, -max_y)，高度仍为 height
        new_vb = f'viewBox="{min_x} {-max_y} {width} {height}"'

    svg_str, n = re.subn(r'viewBox="[-\d.]+ [-\d.]+ [\d.]+ [\d.]+"', new_vb, svg_str, count=1)
    return svg_str


def _strip_mm_dimensions(svg_str: str, target_width_px: int | None = None) -> str:
    """去掉 mm 物理尺寸；可选替换为 px 宽度（高度交给 CSS/消费者控制）。"""
    svg_str = re.sub(r'\s+width="[^"]*mm"', '', svg_str)
    svg_str = re.sub(r'\s+height="[^"]*mm"', '', svg_str)
    if target_width_px is not None:
        svg_str = re.sub(r'(<svg\b)([^>]*)(>)',
                         lambda m: f'{m.group(1)}{m.group(2)} width="{target_width_px}px"{m.group(3)}',
                         svg_str, count=1)
    return svg_str


def _remove_background_rect(svg_str: str) -> str:
    """移除 ezdxf 渲染的背景 <rect>，使实体 SVG 透明，便于 SCADA 叠加。
    仅移除第一个 fill-opacity='1.0' 的全不透明 <rect>（即 ezdxf 生成的背景矩形），
    不影响 CAD 图纸中合法的矩形实体。"""
    return re.sub(r'<rect\s+[^>]*fill-opacity="1\.0"[^>]*/>\s*', '', svg_str, count=1)


def _white_svg_paint_to_black(svg_str: str) -> str:
    """Make white CAD strokes/fills visible on the white preview background."""
    white_values = (
        "#fff", "#ffffff", "white",
        "rgb(255,255,255)", "rgb(255, 255, 255)",
    )

    def replace_css_paint(match: re.Match) -> str:
        prefix, value = match.group(1), match.group(2).strip()
        if value.lower() in white_values:
            return f"{prefix}#000000"
        return match.group(0)

    def replace_attr_paint(match: re.Match) -> str:
        name, quote, value = match.group(1), match.group(2), match.group(3).strip()
        if value.lower() in white_values:
            return f'{name}={quote}#000000{quote}'
        return match.group(0)

    svg_str = re.sub(
        r'((?:stroke|fill)\s*:\s*)(#[0-9a-fA-F]{3,6}|white|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\))',
        replace_css_paint,
        svg_str,
        flags=re.IGNORECASE,
    )
    svg_str = re.sub(
        r'\b(stroke|fill)=(["\'])(#[0-9a-fA-F]{3,6}|white|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\))\2',
        replace_attr_paint,
        svg_str,
        flags=re.IGNORECASE,
    )
    return svg_str


def _make_zero_strokes_visible(svg_str: str, min_width: float = 1.0) -> str:
    """Promote ezdxf zero-width visible strokes to a minimum preview/import width."""
    min_width_str = f"{min_width:g}"
    svg_str = re.sub(
        r'(stroke-width\s*:\s*)0+(?:\.0+)?(?=\s*[;}])',
        rf'\g<1>{min_width_str}',
        svg_str,
    )
    svg_str = re.sub(
        r'(stroke-width=)(["\'])0+(?:\.0+)?\2',
        rf'\g<1>\g<2>{min_width_str}\g<2>',
        svg_str,
    )
    return svg_str


def _make_thin_strokes_visible(svg_str: str, min_width: float) -> str:
    """Promote visible CAD strokes that are thinner than the preview visibility threshold."""
    if min_width <= 0:
        return svg_str
    min_width_str = f"{min_width:.6f}".rstrip("0").rstrip(".")

    def replace_css_width(match: re.Match) -> str:
        prefix, value = match.group(1), match.group(2)
        try:
            width = float(value)
        except ValueError:
            return match.group(0)
        if 0 <= width < min_width:
            return f"{prefix}{min_width_str}"
        return match.group(0)

    def replace_attr_width(match: re.Match) -> str:
        prefix, quote, value = match.group(1), match.group(2), match.group(3)
        try:
            width = float(value)
        except ValueError:
            return match.group(0)
        if 0 <= width < min_width:
            return f"{prefix}{quote}{min_width_str}{quote}"
        return match.group(0)

    svg_str = re.sub(
        r'(stroke-width\s*:\s*)([0-9]*\.?[0-9]+)(?=\s*[;}])',
        replace_css_width,
        svg_str,
    )
    svg_str = re.sub(
        r'(stroke-width=)(["\'])([0-9]*\.?[0-9]+)\2',
        replace_attr_width,
        svg_str,
    )
    return svg_str


def _preview_min_stroke_width(viewbox: tuple[float, float, float, float] | None,
                              target_width_px: int = PREVIEW_DISPLAY_WIDTH,
                              target_height_px: int = PREVIEW_DISPLAY_HEIGHT) -> float:
    """Convert the desired screen-pixel stroke width into SVG viewBox units."""
    if not viewbox:
        return 1.0
    _, _, vb_w, vb_h = viewbox
    units_per_px = max(vb_w / max(target_width_px, 1), vb_h / max(target_height_px, 1))
    return max(1.0, units_per_px * PREVIEW_MIN_STROKE_PX)


def _make_svg_visible_on_light_background(svg_str: str) -> str:
    """Prepare CAD SVG content for white preview/dashboard surfaces."""
    return _make_zero_strokes_visible(_white_svg_paint_to_black(svg_str))


def _svg_inner_content(svg_str: str) -> str:
    """提取 <svg> 标签内的内容（不含外层 <svg> 和 </svg>）。"""
    s = svg_str.strip()
    end = s.find('>')
    if end == -1:
        return s
    close = s.rfind('</svg>')
    if close > end:
        return s[end + 1:close]
    return s[end + 1:]


def _entity_display_color(entity, doc, default: str = "#000000") -> str:
    """Resolve a visible CAD entity color for fallback SVG geometry."""
    try:
        color = int(entity.dxf.get("color", 256))
    except Exception:
        color = 256

    if color == 256 and doc is not None:
        try:
            layer_name = entity.dxf.get("layer", "0")
            layer = doc.layers.get(layer_name)
            color = int(layer.dxf.get("color", 7))
        except Exception:
            color = 7
    elif color == 0:
        color = 7

    try:
        if abs(color) == 7:
            return "#000000"
        rgb = ezdxf_colors.aci2rgb(abs(color))
        return f"#{rgb.r:02x}{rgb.g:02x}{rgb.b:02x}"
    except Exception:
        return default


def _extract_svg_viewbox(svg_str: str) -> tuple[float, float, float, float] | None:
    """从 SVG 字符串中提取 viewBox 的 (x, y, w, h)。"""
    m = re.search(r'viewBox="([-\d.]+)\s+([-\d.]+)\s+([\d.]+)\s+([\d.]+)"', svg_str)
    if m:
        return (float(m.group(1)), float(m.group(2)), float(m.group(3)), float(m.group(4)))
    return None


def _entity_preview_hitbox(entity_id: str,
                           ent_min_x: float, ent_min_y: float,
                           ent_max_x: float, ent_max_y: float,
                           min_preview_size: float = 1.0) -> str:
    """Create a transparent SVG-coordinate hit target for preview selection."""
    ent_w = ent_max_x - ent_min_x
    ent_h = ent_max_y - ent_min_y
    if ent_w <= 0:
        ent_min_x -= min_preview_size / 2
        ent_w = min_preview_size
    if ent_h <= 0:
        ent_min_y -= min_preview_size / 2
        ent_max_y += min_preview_size / 2
        ent_h = min_preview_size

    return (
        f'<g data-cad-entity-id="{entity_id}" data-cad-hitbox="true">'
        f'<rect x="{ent_min_x}" y="{ent_min_y}" '
        f'width="{ent_w}" height="{ent_h}" '
        f'fill="#1976d2" fill-opacity="0.001" '
        f'stroke="#1976d2" stroke-width="0" pointer-events="all"/>'
        f'</g>'
    )


def _global_entity_svg(full_preview_inner: str,
                       entity_id: str,
                       preview_bbox: tuple[float, float, float, float],
                       preview_viewbox: tuple[float, float, float, float]) -> str:
    """Build a dashboard entity SVG that keeps the same coordinate system as preview.svg."""
    min_x, min_y, max_x, max_y = preview_bbox
    vb_x, vb_y, vb_w, vb_h = preview_viewbox
    clip_id = f"cad_clip_{entity_id}"
    width = max_x - min_x
    height = max_y - min_y
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="{min_x} {min_y} {width} {height}" '
        f'data-cad-global-entity="true" data-cad-entity-id="{entity_id}">'
        f'<defs><clipPath id="{clip_id}">'
        f'<rect x="{min_x}" y="{min_y}" width="{width}" height="{height}"/>'
        f'</clipPath></defs>'
        f'<g clip-path="url(#{clip_id})">'
        f'<svg x="{vb_x}" y="{vb_y}" width="{vb_w}" height="{vb_h}" '
        f'viewBox="{vb_x} {vb_y} {vb_w} {vb_h}" preserveAspectRatio="none">'
        f'{full_preview_inner}'
        f'</svg></g></svg>'
    )


def _render_block_to_svg(block_def, doc) -> str:
    """
    渲染块定义为 SVG。
    通过创建临时文档，把块实体复制到 modelspace 再用 SVGBackend 渲染。
    跳过 ATTDEF（属性定义模板，在 CAD 中不可见）。
    使用较小的坐标空间，生成紧凑的 SCADA 符号。
    """
    tmp_doc = ezdxf.new(doc.dxfversion)
    tmp_msp = tmp_doc.modelspace()

    for entity in block_def:
        # ATTDEF 是属性定义模板，CAD 中不显示，跳过
        if entity.dxftype() == "ATTDEF":
            continue
        try:
            tmp_msp.add_foreign_entity(entity)
        except Exception:
            pass

    return _render_msp_to_svg(tmp_doc, tmp_msp, coord_space=BLOCK_COORD_SPACE)


def _resize_svg(svg_str: str, target_width_px: int, padding_pct: float = 5.0,
                transparent_bg: bool = False, invert_colors: bool = False) -> str:
    """
    调整 SVG 的显示尺寸，并给 viewBox 加内边距防止边缘裁剪。
    内边距 = max(百分比边距, 最大线宽/2)，确保粗线不会被裁剪。
    同步更新背景 <rect> 使其与新 viewBox 一致。
    transparent_bg: 移除背景 rect（透明背景）。
    invert_colors: 将白色线条反转为黑色（适用于浅色 SCADA 背景）。
    """
    # 0. 透明背景时强制反转颜色，否则白线不可见
    if transparent_bg:
        invert_colors = True
    if invert_colors:
        svg_str = _white_svg_paint_to_black(svg_str)
    svg_str = _make_zero_strokes_visible(svg_str)

    # 1. 提取最大 stroke-width（兼容 CSS 风格 stroke-width:5 和 XML 属性 stroke-width="5.00"）
    max_sw = 0.0
    for m in re.finditer(r'stroke-width(?::\s*|=")(\d+(?:\.\d+)?)', svg_str):
        max_sw = max(max_sw, float(m.group(1)))

    # 2. 给 viewBox 加内边距，同步更新背景 rect
    vb_match = re.search(r'viewBox="0 0 (\d+) (\d+)"', svg_str)
    if vb_match:
        vw = int(vb_match.group(1))
        vh = int(vb_match.group(2))
        pad_pct_x = int(vw * padding_pct / 100)
        pad_pct_y = int(vh * padding_pct / 100)
        pad_sw = int(max_sw / 2 + 1)
        pad_x = max(pad_pct_x, pad_sw)
        pad_y = max(pad_pct_y, pad_sw)
        new_vw = vw + pad_x * 2
        new_vh = vh + pad_y * 2
        svg_str = svg_str.replace(
            vb_match.group(0),
            f'viewBox="{-pad_x} {-pad_y} {new_vw} {new_vh}"',
        )
        # 更新背景 rect 匹配新 viewBox（匹配完整 <rect ... /> 标签）
        rect_match = re.search(r'<rect\s+[^>]*/>', svg_str)
        if rect_match:
            if transparent_bg:
                svg_str = svg_str[:rect_match.start()] + svg_str[rect_match.end():]
            else:
                new_rect = (
                    f'<rect fill="#ffffff" '
                    f'x="{-pad_x}" y="{-pad_y}" '
                    f'width="{new_vw}" height="{new_vh}" fill-opacity="1.0" />'
                )
                svg_str = svg_str[:rect_match.start()] + new_rect + svg_str[rect_match.end():]

    # 3. 替换物理尺寸
    svg_str = re.sub(r'width="[^"]*mm"', f'width="{target_width_px}px"', svg_str)
    svg_str = re.sub(r'height="[^"]*mm"', 'height="auto"', svg_str)

    return svg_str


def _build_fallback_svg(entity, doc) -> str | None:
    bb = _entity_bbox(entity, doc)
    if bb is None:
        return None
    min_x, min_y, max_x, max_y = bb
    raw_w = max(max_x - min_x, 0.001)
    raw_h = max(max_y - min_y, 0.001)

    target_size = 1000.0
    if raw_w >= raw_h:
        norm_w = target_size
        norm_h = max(target_size * (raw_h / raw_w), 10.0)
    else:
        norm_h = target_size
        norm_w = max(target_size * (raw_w / raw_h), 10.0)

    norm_w = int(round(norm_w))
    norm_h = int(round(norm_h))

    sx = norm_w / raw_w
    sy = norm_h / raw_h

    def nx(x: float) -> float:
        return (x - min_x) * sx

    def ny(y: float) -> float:
        return (max_y - y) * sy

    stroke_w = max(norm_w, norm_h) * 0.005

    import math
    d = entity.dxf
    etype = entity.dxftype()
    elements = []
    stroke_color = _entity_display_color(entity, doc)

    if etype == "LINE":
        x1, y1 = float(d.start.x), float(d.start.y)
        x2, y2 = float(d.end.x), float(d.end.y)
        elements.append(f'<line x1="{nx(x1):.2f}" y1="{ny(y1):.2f}" x2="{nx(x2):.2f}" y2="{ny(y2):.2f}" stroke="{stroke_color}" stroke-width="{stroke_w:.2f}"/>')
    elif etype in ("LWPOLYLINE", "POLYLINE"):
        pts = []
        if etype == "LWPOLYLINE":
            for pt in entity.get_points(format="xy"):
                pts.append((float(pt[0]), float(pt[1])))
        else:
            for v in entity.vertices:
                pts.append((float(v.dxf.location.x), float(v.dxf.location.y)))
        if pts:
            points_str = " ".join(f"{nx(x):.2f},{ny(y):.2f}" for x, y in pts)
            closed = entity.closed if hasattr(entity, 'closed') else False
            tag = "polygon" if closed else "polyline"
            elements.append(f'<{tag} points="{points_str}" fill="none" stroke="{stroke_color}" stroke-width="{stroke_w:.2f}"/>')
    elif etype == "CIRCLE":
        cx, cy = float(d.center.x), float(d.center.y)
        r = float(d.radius)
        elements.append(f'<circle cx="{nx(cx):.2f}" cy="{ny(cy):.2f}" r="{r*sx:.2f}" fill="none" stroke="{stroke_color}" stroke-width="{stroke_w:.2f}"/>')
    elif etype == "ARC":
        cx, cy = float(d.center.x), float(d.center.y)
        r = float(d.radius)
        start_a = math.radians(float(d.start_angle))
        end_a = math.radians(float(d.end_angle))
        x1 = nx(cx + r * math.cos(start_a))
        y1 = ny(cy + r * math.sin(start_a))
        x2 = nx(cx + r * math.cos(end_a))
        y2 = ny(cy + r * math.sin(end_a))
        angle_diff = end_a - start_a
        while angle_diff < 0:
            angle_diff += 2 * math.pi
        large_arc = 1 if angle_diff > math.pi else 0
        elements.append(
            f'<path d="M {x1:.2f} {y1:.2f} A {r*sx:.2f} {r*sy:.2f} 0 {large_arc} 0 {x2:.2f} {y2:.2f}" '
            f'fill="none" stroke="{stroke_color}" stroke-width="{stroke_w:.2f}"/>'
        )
    elif etype in ("TEXT", "MTEXT"):
        x, y = float(d.insert.x), float(d.insert.y)
        text = entity.text if etype == "TEXT" else entity.text
        font_h = float(getattr(d, 'height', 10))
        elements.append(f'<text x="{nx(x):.2f}" y="{ny(y):.2f}" font-size="{font_h*sy:.2f}" fill="{stroke_color}">{text}</text>')
    elif etype == "ELLIPSE":
        cx, cy = float(d.center.x), float(d.center.y)
        rx = float(d.major_axis[0]) if hasattr(d, 'major_axis') else raw_w / 2
        ry = float(d.minor_axis[0]) if hasattr(d, 'minor_axis') else raw_h / 2
        elements.append(f'<ellipse cx="{nx(cx):.2f}" cy="{ny(cy):.2f}" rx="{rx*sx:.2f}" ry="{ry*sy:.2f}" fill="none" stroke="{stroke_color}" stroke-width="{stroke_w:.2f}"/>')
    else:
        return None

    if not elements:
        return None

    inner = "".join(elements)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="0 0 {norm_w} {norm_h}">'
        f'{inner}</svg>'
    )


def _wrap_scada_symbol(svg_str: str, title: str) -> str:
    """
    将 SVG 包装为 thingsboard SCADA 符号格式：
    - 添加 xmlns:tb 命名空间
    - 添加 <tb:metadata> 元数据
    - 移除 width/height 属性（由 thingsboard 控制）
    """
    import json

    # 1. 提取 viewBox 尺寸
    vb_match = re.search(r'viewBox="([^"]+)"', svg_str)
    vb = vb_match.group(1) if vb_match else "0 0 100 100"
    vb_parts = vb.split()
    vb_w = int(float(vb_parts[2])) if len(vb_parts) > 2 else 100
    vb_h = int(float(vb_parts[3])) if len(vb_parts) > 3 else 100

    # 2. 计算 thingsboard 网格尺寸（1格=100px）
    grid_x = max(1, round(vb_w / 100))
    grid_y = max(1, round(vb_h / 100))

    # 3. 构建元数据
    metadata = {
        "title": title,
        "description": f"Converted from CAD block: {title}",
        "widgetSizeX": grid_x,
        "widgetSizeY": grid_y,
        "tags": [],
        "behavior": [],
        "properties": []
    }
    metadata_json = json.dumps(metadata, ensure_ascii=False)
    metadata_xml = f'<tb:metadata><![CDATA[{metadata_json}]]></tb:metadata>'

    # 4. 添加 xmlns:tb 命名空间
    if 'xmlns:tb=' not in svg_str:
        svg_str = svg_str.replace(
            'xmlns="http://www.w3.org/2000/svg"',
            'xmlns="http://www.w3.org/2000/svg" xmlns:tb="https://thingsboard.io/svg"',
            1
        )

    # 5. 移除 <svg> 根标签上的 width/height 属性（仅根标签，不影响内部元素的 stroke-width 等）
    svg_tag_match = re.search(r'<svg[^>]*>', svg_str)
    if svg_tag_match:
        svg_tag = svg_tag_match.group(0)
        cleaned_tag = re.sub(r'\s+(?:width|height)="[^"]*"', '', svg_tag)
        svg_str = svg_str[:svg_tag_match.start()] + cleaned_tag + svg_str[svg_tag_match.end():]

    svg_tag_match = re.search(r'<svg[^>]*>', svg_str)
    if svg_tag_match:
        insert_pos = svg_tag_match.end()
        svg_str = svg_str[:insert_pos] + metadata_xml + svg_str[insert_pos:]

    return svg_str


# ── DXF → SVG 文件夹 ─────────────────────────────────────────────────
def dxf_to_svg_folder(dxf_path: Path, output_folder: Path,
                      invert_block_colors: bool = False) -> dict:
    """
    将 DXF 转换为 SVG 文件夹。

    输出:
    ├── preview.svg        # 总预览图，宽 1920px
    ├── block_name_1.svg   # 块定义 1
    ├── block_name_2.svg   # 块定义 2
    └── ...
    """
    doc = ezdxf.readfile(str(dxf_path))
    msp = doc.modelspace()
    output_folder.mkdir(parents=True, exist_ok=True)

    info = {
        "preview": None,
        "blocks": [],
        "total_entities": 0,
        "filtered_entities": 0,
    }

    # ── 1. 收集实体并过滤异常坐标 ────────────────────────────────────
    all_entities = list(msp)
    info["total_entities"] = len(all_entities)

    all_pts = _collect_points(all_entities)
    if not all_pts:
        print("      警告: 无坐标数据")
        return info

    bounds = _compute_normal_bounds(all_pts)

    # 删除异常实体
    to_delete = [e for e in all_entities if not _entity_in_bounds(e, bounds)]
    for e in to_delete:
        e.destroy()
    if to_delete:
        print(f"      删除: {len(to_delete)} 个坐标异常实体")

    all_entities = list(msp)
    info["filtered_entities"] = len(all_entities)

    # ── 2. 渲染总预览图 ──────────────────────────────────────────────
    print(f"      渲染预览图...")
    svg_str = _render_msp_to_svg(doc, msp)
    svg_str = _resize_svg(svg_str, PREVIEW_WIDTH)

    preview_path = output_folder / "preview.svg"
    preview_path.write_text(svg_str, encoding="utf-8")
    info["preview"] = str(preview_path)
    print(f"      preview.svg: {len(svg_str):,} 字符")

    # ── 3. 遍历块定义，为每个块渲染 SVG ──────────────────────────────
    block_defs = [b for b in doc.blocks if not b.name.startswith("*")]
    if not block_defs:
        print("      无自定义块定义")
        return info

    blocks_dir = output_folder / "blocks"
    blocks_dir.mkdir(exist_ok=True)

    print(f"      发现 {len(block_defs)} 个块定义")

    for block_def in block_defs:
        block_name = block_def.name
        block_entities = list(block_def)

        if not block_entities:
            continue

        # 安全文件名
        safe_name = "".join(c if c.isalnum() or c in "._-" else "_" for c in block_name)
        safe_name = safe_name[:50]

        # 渲染块
        try:
            block_svg = _render_block_to_svg(block_def, doc)
            block_svg = _resize_svg(block_svg, BLOCK_WIDTH, transparent_bg=True,
                                    invert_colors=invert_block_colors)
            # 包装为 thingsboard SCADA 符号格式
            block_svg = _wrap_scada_symbol(block_svg, block_name)

            block_path = blocks_dir / f"{safe_name}.svg"
            block_path.write_text(block_svg, encoding="utf-8")

            info["blocks"].append({
                "name": block_name,
                "file": str(block_path),
                "entities": len(block_entities),
            })

            print(f"      blocks/{safe_name}.svg: {len(block_entities)} 个实体, {len(block_svg):,} 字符")
        except Exception as e:
            print(f"      跳过块 '{block_name}': {e}")

    return info


# ── DXF → 逐实体 SVG ─────────────────────────────────────────────────
SUPPORTED_ENTITY_TYPES = {
    "LINE", "CIRCLE", "ARC", "ELLIPSE", "SPLINE",
    "LWPOLYLINE", "POLYLINE", "TEXT", "MTEXT",
    "INSERT", "HATCH", "DIMENSION",
}


def _entity_bbox(entity, doc=None):
    """计算单个实体的 bbox，返回 (min_x, min_y, max_x, max_y) 或 None。"""
    try:
        bb = ezdxf_bbox.extents([entity])
        if bb.has_data:
            return (bb.extmin[0], bb.extmin[1], bb.extmax[0], bb.extmax[1])
    except Exception as e:
        print(f"      bbox.extents 失败 ({entity.dxftype()}): {e}")

    d = entity.dxf
    etype = entity.dxftype()

    if etype == "CIRCLE" and hasattr(d, "center") and hasattr(d, "radius"):
        cx, cy = float(d.center.x), float(d.center.y)
        r = float(d.radius)
        return (cx - r, cy - r, cx + r, cy + r)
    elif etype == "ARC" and hasattr(d, "center") and hasattr(d, "radius"):
        import math
        cx, cy = float(d.center.x), float(d.center.y)
        r = float(d.radius)
        start_a = math.radians(float(d.start_angle))
        end_a = math.radians(float(d.end_angle))
        pts = [(cx + r * math.cos(start_a), cy + r * math.sin(start_a)),
               (cx + r * math.cos(end_a), cy + r * math.sin(end_a))]
        for a_deg in [0, 90, 180, 270]:
            a_rad = math.radians(a_deg)
            if start_a <= a_rad <= end_a or (start_a > end_a and (a_rad >= start_a or a_rad <= end_a)):
                pts.append((cx + r * math.cos(a_rad), cy + r * math.sin(a_rad)))
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        return (min(xs), min(ys), max(xs), max(ys))
    elif etype == "LINE":
        if hasattr(d, "start") and hasattr(d, "end"):
            return (min(float(d.start.x), float(d.end.x)),
                    min(float(d.start.y), float(d.end.y)),
                    max(float(d.start.x), float(d.end.x)),
                    max(float(d.start.y), float(d.end.y)))
    elif etype in ("LWPOLYLINE", "POLYLINE"):
        pts = []
        if etype == "LWPOLYLINE":
            for pt in entity.get_points(format="xy"):
                pts.append((float(pt[0]), float(pt[1])))
        else:
            for v in entity.vertices:
                pts.append((float(v.dxf.location.x), float(v.dxf.location.y)))
        if pts:
            xs = [p[0] for p in pts]
            ys = [p[1] for p in pts]
            return (min(xs), min(ys), max(xs), max(ys))
    elif etype in ("TEXT", "MTEXT") and hasattr(d, "insert"):
        px, py = float(d.insert.x), float(d.insert.y)
        height = float(getattr(d, "height", 10))
        return (px, py, px + height * 5, py + height)

    return None


def _expand_insert(entity, doc, depth=0, max_depth=3):
    """递归展开 INSERT 实体，返回子实体列表（深度限制）。"""
    if depth >= max_depth:
        return []
    children = []
    try:
        for ve in entity.virtual_entities():
            if ve.dxftype() == "INSERT":
                children.extend(_expand_insert(ve, doc, depth + 1, max_depth))
            else:
                children.append(ve)
    except Exception as e:
        print(f"      INSERT 展开失败: {e}")
    return children


def dxf_to_per_entity_svgs(dxf_path: Path, output_folder: Path,
                            *, max_entities: int = 5000,
                            invert_block_colors: bool = False) -> dict:
    """
    将 DXF 转换为逐实体 SVG 文件夹。

    输出:
    ├── preview.svg        # 总预览图
    ├── manifest.json      # 实体清单
    └── entities/
        ├── entity_0.svg
        ├── entity_1.svg
        └── ...
    """
    doc = ezdxf.readfile(str(dxf_path))
    msp = doc.modelspace()
    output_folder.mkdir(parents=True, exist_ok=True)

    all_entities = list(msp)
    total_count = len(all_entities)

    if total_count > max_entities:
        raise ValueError(
            f"Entity count {total_count} exceeds max {max_entities}"
        )

    entities_dir = output_folder / "entities"
    entities_dir.mkdir(exist_ok=True)

    manifest_entries = []
    preview_entity_svgs = []
    entity_outputs = []
    skipped = 0

    tmp_doc = ezdxf.new(doc.dxfversion)
    tmp_msp = tmp_doc.modelspace()

    for i, entity in enumerate(all_entities):
        etype = entity.dxftype()

        if etype not in SUPPORTED_ENTITY_TYPES:
            print(f"      跳过不支持的实体类型: {etype}")
            skipped += 1
            continue

        if etype == "INSERT":
            sub_entities = _expand_insert(entity, doc)
            if not sub_entities:
                print(f"      跳过空 INSERT: {entity.dxf.get('name', '?')}")
                skipped += 1
                continue
            entities_to_render = sub_entities
        else:
            entities_to_render = [entity]

        bb = _entity_bbox(entities_to_render[0] if etype != "INSERT" else entity, doc)
        if bb is None:
            print(f"      跳过无法计算 bbox 的实体: {etype}")
            skipped += 1
            continue

        try:
            for e in list(tmp_msp):
                e.destroy()

            for sub_e in entities_to_render:
                try:
                    tmp_msp.add_foreign_entity(sub_e)
                except Exception as e:
                    print(f"      跳过无法添加的子实体: {e}")

            entity_svg = _render_msp_to_svg(tmp_doc, tmp_msp, coord_space=BLOCK_COORD_SPACE)
            entity_svg = _strip_xml_prolog(entity_svg)

            if entity_svg.strip().endswith("/>") or "</svg>" not in entity_svg or len(entity_svg) < 50:
                fallback = _build_fallback_svg(entity, doc)
                if fallback:
                    entity_svg = fallback
                else:
                    print(f"      跳过无法渲染的退化实体: {etype}")
                    skipped += 1
                    continue

            entity_svg = _strip_mm_dimensions(entity_svg, target_width_px=None)
            entity_svg = _remove_background_rect(entity_svg)
            entity_svg = _make_svg_visible_on_light_background(entity_svg)

            entity_id = f"entity_{len(manifest_entries)}"
            preview_entity_svgs.append((entity_id, entity_svg, bb))

            entity_title = entity.dxf.name if etype == "INSERT" and entity.dxf.get('name') else f"{etype}_{len(manifest_entries)}"
            entity_outputs.append((entity_id, entity_svg, bb, entity_title))
        except Exception as e:
            print(f"      跳过渲染失败的实体 {etype}: {e}")
            skipped += 1
            continue

        min_x, min_y, max_x, max_y = bb
        svg_filename = f"{entity_id}.svg"
        entry = {
            "id": entity_id,
            "type": etype,
            "svgFile": f"entities/{svg_filename}",
            "x": round(min_x, 6),
            "y": round(min_y, 6),
            "width": round(max_x - min_x, 6),
            "height": round(max_y - min_y, 6),
            "blockName": entity.dxf.name if etype == "INSERT" else None,
        }
        manifest_entries.append(entry)

    if not manifest_entries:
        print("      警告: 无可用实体，跳过预览图")
        manifest = {
            "preview": "preview.svg",
            "totalCount": 0,
            "entities": [],
        }
        manifest_path = output_folder / "manifest.json"
        manifest_path.write_text(
            json.dumps(manifest, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        return {
            "preview": None,
            "manifest": str(manifest_path),
            "totalCount": 0,
            "entities": [],
        }

    overall_min_x = min(e["x"] for e in manifest_entries)
    overall_min_y = min(e["y"] for e in manifest_entries)
    overall_max_x = max(e["x"] + e["width"] for e in manifest_entries)
    overall_max_y = max(e["y"] + e["height"] for e in manifest_entries)

    ms_bounds = (overall_min_x, overall_max_x, overall_min_y, overall_max_y)
    ms_min_x, ms_max_x, ms_min_y, ms_max_y = ms_bounds

    print(f"      渲染预览图 ({len(preview_entity_svgs)} 个实体组)...")
    full_preview_svg = _render_msp_to_svg(doc, msp, coord_space=PREVIEW_COORD_SPACE)
    full_preview_svg = _strip_xml_prolog(full_preview_svg)
    full_preview_svg = _strip_mm_dimensions(full_preview_svg, target_width_px=None)
    full_preview_svg = _remove_background_rect(full_preview_svg)
    full_preview_svg = _make_svg_visible_on_light_background(full_preview_svg)
    full_preview_viewbox = _extract_svg_viewbox(full_preview_svg) or (0, 0, BLOCK_COORD_SPACE, BLOCK_COORD_SPACE)
    full_preview_svg = _make_thin_strokes_visible(
        full_preview_svg, _preview_min_stroke_width(full_preview_viewbox)
    )
    full_preview_inner = _svg_inner_content(full_preview_svg)
    svg_edge_pad = max(full_preview_viewbox[2], full_preview_viewbox[3], 1.0) * PREVIEW_EDGE_PAD_RATIO
    preview_vb_x = full_preview_viewbox[0] - svg_edge_pad
    preview_vb_y = full_preview_viewbox[1] - svg_edge_pad
    preview_vb_w = full_preview_viewbox[2] + (svg_edge_pad * 2)
    preview_vb_h = full_preview_viewbox[3] + (svg_edge_pad * 2)

    entity_hitboxes = []
    preview_bboxes = {}
    for eid, esvg, ebb in preview_entity_svgs:
        ex_min, ey_min, ex_max, ey_max = _cad_bbox_to_svg_bbox(
            ebb, ms_bounds, full_preview_viewbox, svg_edge_pad
        )
        preview_bboxes[eid] = (ex_min, ey_min, ex_max, ey_max)
        group = _entity_preview_hitbox(
            eid, ex_min, ey_min, ex_max, ey_max, svg_edge_pad
        )
        entity_hitboxes.append(group)
    all_hitboxes = "\n".join(entity_hitboxes)
    preview_svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="{preview_vb_x} {preview_vb_y} {preview_vb_w} {preview_vb_h}">'
        f'<rect x="{preview_vb_x}" y="{preview_vb_y}" width="{preview_vb_w}" height="{preview_vb_h}" '
        f'fill="#ffffff" data-cad-background="true"/>'
        f'<g data-cad-visual-layer="true" pointer-events="none">{full_preview_inner}</g>'
        f'<g data-cad-hitbox-layer="true">{all_hitboxes}</g></svg>'
    )

    preview_path = output_folder / "preview.svg"
    preview_path.write_text(preview_svg, encoding="utf-8")

    for entity_id, entity_svg, bb, entity_title in entity_outputs:
        if entity_id in preview_bboxes:
            entity_svg = _global_entity_svg(
                full_preview_inner, entity_id, preview_bboxes[entity_id], full_preview_viewbox
            )
        else:
            entity_svg = _resize_svg(entity_svg, BLOCK_WIDTH, transparent_bg=True, invert_colors=True)
        entity_svg = _wrap_scada_symbol(entity_svg, entity_title)
        svg_filename = f"{entity_id}.svg"
        svg_path = entities_dir / svg_filename
        svg_path.write_text(entity_svg, encoding="utf-8")

    for entry in manifest_entries:
        pb = preview_bboxes.get(entry["id"])
        if pb:
            px1, py1, px2, py2 = pb
            entry["previewX"] = round(px1, 6)
            entry["previewY"] = round(py1, 6)
            entry["previewWidth"] = round(px2 - px1, 6)
            entry["previewHeight"] = round(py2 - py1, 6)

    manifest = {
        "preview": "preview.svg",
        "totalCount": len(manifest_entries),
        "entities": manifest_entries,
        "modelspaceBounds": {
            "minX": round(ms_min_x, 6),
            "maxX": round(ms_max_x, 6),
            "minY": round(ms_min_y, 6),
            "maxY": round(ms_max_y, 6),
        },
        "previewViewBox": {
            "x": round(preview_vb_x, 6),
            "y": round(preview_vb_y, 6),
            "width": round(preview_vb_w, 6),
            "height": round(preview_vb_h, 6),
        },
        "scale": round(min(BLOCK_COORD_SPACE / max(ms_max_x - ms_min_x, 1),
                           BLOCK_COORD_SPACE / max(ms_max_y - ms_min_y, 1)), 6),
        "translateX": round(ms_min_x, 6),
        "translateY": round(-ms_max_y, 6),
        "yFlip": True,
    }
    manifest_path = output_folder / "manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    print(f"      完成: {len(manifest_entries)} 个实体, 跳过 {skipped}")

    return {
        "preview": str(preview_path),
        "manifest": str(manifest_path),
        "totalCount": len(manifest_entries),
        "entities": manifest_entries,
    }


# ── 一步到位 ──────────────────────────────────────────────────────────
def dwg_to_svg(dwg_path: Path, output_folder: Path | None = None,
               invert_block_colors: bool = False) -> dict:
    """DWG → DXF → SVG 文件夹。"""
    print(f"[1/2] DWG → DXF: {dwg_path.name}")
    t0 = time.time()
    dxf_path = dwg_to_dxf(dwg_path)
    t1 = time.time()
    print(f"      DXF 完成: {dxf_path.name} ({t1 - t0:.1f}s)")

    if output_folder is None:
        output_folder = OUTPUT_DIR / dwg_path.stem
    output_folder.mkdir(parents=True, exist_ok=True)

    print(f"[2/2] DXF → SVG 文件夹: {output_folder}")
    info = dxf_to_svg_folder(dxf_path, output_folder,
                             invert_block_colors=invert_block_colors)
    t2 = time.time()
    print(f"      完成 ({t2 - t1:.1f}s)")
    print(f"      总耗时: {t2 - t0:.1f}s")

    return info


# ── 命令行 ────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="DWG → SVG 转换工具")
    parser.add_argument("input", nargs="?", help="输入 DWG 文件路径")
    parser.add_argument("-o", "--output", help="输出文件夹路径")
    parser.add_argument("--batch", action="store_true", help="批量转换 files/ 下所有 DWG")
    parser.add_argument("--test", action="store_true", help="运行内置测试")
    parser.add_argument("--invert", action="store_true",
                        help="反转块颜色（白→黑，透明背景，适合浅色 SCADA）")
    parser.add_argument("--per-entity", action="store_true",
                        help="逐实体导出 SVG（每个实体独立 SVG + manifest.json）")
    parser.add_argument("--max-entities", type=int, default=5000,
                        help="最大实体数量限制（默认 5000）")
    args = parser.parse_args()

    if args.test:
        files = [FILES_DIR / f for f in TEST_FILES]
    elif args.batch:
        files = sorted(FILES_DIR.glob("*.dwg"))
    elif args.input:
        files = [Path(args.input)]
    else:
        parser.print_help()
        return

    success, fail = 0, 0
    for dwg_file in files:
        if not dwg_file.exists():
            print(f"[跳过] 文件不存在: {dwg_file.name}")
            fail += 1
            continue

        out_folder = Path(args.output) if args.output else None

        print(f"\n{'='*60}")
        print(f"处理: {dwg_file.name}")
        print(f"{'='*60}")
        try:
            if args.per_entity:
                dxf_path = dwg_file
                if dwg_file.suffix.lower() == ".dwg":
                    dxf_path = dwg_to_dxf(dwg_file)
                if out_folder is None:
                    out_folder = OUTPUT_DIR / dwg_file.stem / "per_entity"
                dxf_to_per_entity_svgs(
                    dxf_path, out_folder,
                    max_entities=args.max_entities,
                    invert_block_colors=args.invert,
                )
            else:
                dwg_to_svg(dwg_file, out_folder,
                           invert_block_colors=args.invert)
            success += 1
        except Exception as e:
            print(f"[错误] {e}")
            fail += 1

    print(f"\n{'='*60}")
    print(f"完成: {success} 成功, {fail} 失败")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
