import importlib.util
import pathlib
import unittest


MODULE_PATH = pathlib.Path(__file__).resolve().parents[1] / "dwg_to_svg.py"
SPEC = importlib.util.spec_from_file_location("dwg_to_svg", MODULE_PATH)
DWG_TO_SVG = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(DWG_TO_SVG)


class EntityPreviewGroupTests(unittest.TestCase):

    def test_entity_preview_hitbox_uses_preview_bbox(self):
        result = DWG_TO_SVG._entity_preview_hitbox(
            "entity_7",
            100.0,
            200.0,
            110.0,
            220.0,
        )

        self.assertIn('data-cad-entity-id="entity_7"', result)
        self.assertRegex(
            result,
            r'<rect x="100(?:\.0)?" y="200(?:\.0)?" width="10(?:\.0)?" height="20(?:\.0)?"',
        )


class GlobalEntitySvgTests(unittest.TestCase):

    def test_global_entity_svg_wraps_only_the_entity_svg(self):
        result = DWG_TO_SVG._global_entity_svg(
            '<svg viewBox="0 0 10 10"><path id="entity_a"/></svg>',
            "entity_a",
            (10.0, 20.0, 30.0, 40.0),
            (10.0, 20.0, 30.0, 40.0),
            (0.0, 0.0, 100.0, 100.0),
        )

        self.assertIn("entity_a", result)
        self.assertNotIn("unrelated_entity", result)

    def test_global_entity_svg_uses_viewbox_without_extra_invisible_bounds(self):
        result = DWG_TO_SVG._global_entity_svg(
            '<svg viewBox="0 0 1000 1000"><path d="M 0 1000 l 1000 -1000" stroke="#000" stroke-width="45"/></svg>',
            "diagonal_line",
            (10.0, 20.0, 30.0, 40.0),
            (10.0, 20.0, 30.0, 40.0),
            (0.0, 0.0, 100.0, 100.0),
        )

        self.assertNotIn('data-cad-bounds="true"', result)
        self.assertRegex(result, r'viewBox="-23(?:\.0)? -23(?:\.0)? 1046(?:\.0)? 1046(?:\.0)?"')
        self.assertIn('vector-effect="non-scaling-stroke"', result)

    def test_global_entity_svg_uses_preview_bbox_as_root_viewbox_for_dashboard_scaling(self):
        result = DWG_TO_SVG._global_entity_svg(
            '<svg viewBox="0 0 1000 10"><line x1="0" y1="5" x2="1000" y2="5" stroke="#000" stroke-width="5"/></svg>',
            "short_line",
            (10.0, 20.0, 14.0, 24.0),
            (11.0, 22.0, 11.4, 22.0),
            (0.0, 0.0, 1200.0, 700.0),
        )

        self.assertRegex(result, r'<svg[^>]+viewBox="10(?:\.0)? 20(?:\.0)? 4(?:\.0)? 4(?:\.0)?"')
        self.assertRegex(result, r'<svg x="11(?:\.0)?" y="21\.325" width="0\.4000')
        self.assertRegex(result, r'height="1\.3500?')
        self.assertIn('preserveAspectRatio="none"', result)

    def test_global_entity_svg_uses_real_preview_geometry_inside_expanded_layout_bbox(self):
        result = DWG_TO_SVG._global_entity_svg(
            '<svg viewBox="0 0 1000 10"><line x1="0" y1="5" x2="1000" y2="5" stroke="#000" stroke-width="5"/></svg>',
            "short_line",
            (10.0, 20.0, 14.0, 24.0),
            (11.0, 22.0, 11.4, 22.0),
            (0.0, 0.0, 100000.0, 70000.0),
        )

        self.assertRegex(result, r'<svg[^>]+viewBox="10(?:\.0)? 20(?:\.0)? 4(?:\.0)? 4(?:\.0)?"')
        self.assertIn('x="11.0"', result)
        self.assertRegex(result, r'width="0\.4000')

    def test_global_entity_svg_converts_short_line_stroke_to_preview_pixel_width(self):
        result = DWG_TO_SVG._global_entity_svg(
            '<svg viewBox="0 0 1000 10"><line x1="0" y1="5" x2="1000" y2="5" stroke="#000" stroke-width="5"/></svg>',
            "short_line",
            (10.0, 20.0, 14.0, 24.0),
            (10.0, 20.0, 14.0, 24.0),
            (0.0, 0.0, 100000.0, 70000.0),
        )

        self.assertIn('vector-effect="non-scaling-stroke"', result)
        self.assertIn('stroke-width="1.35"', result)
        self.assertIn('width="4.0" height="4.0"', result)
        self.assertIn('viewBox="-3.0 -3.0 1006.0 16.0" preserveAspectRatio="none"', result)


if __name__ == "__main__":
    unittest.main()
