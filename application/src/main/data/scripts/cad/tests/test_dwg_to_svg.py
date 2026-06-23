import importlib.util
import pathlib
import unittest


MODULE_PATH = pathlib.Path(__file__).resolve().parents[1] / "dwg_to_svg.py"
SPEC = importlib.util.spec_from_file_location("dwg_to_svg", MODULE_PATH)
DWG_TO_SVG = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(DWG_TO_SVG)


class EntityPreviewGroupTests(unittest.TestCase):

    def test_entity_preview_group_positions_svg_at_bbox_top_left_in_global_wcs(self):
        result = DWG_TO_SVG._entity_preview_group(
            "entity_7",
            '<svg viewBox="0 0 10 20"><path d="M0,0 L10,20"/></svg>',
            100.0,
            200.0,
            110.0,
            220.0,
            0.0,
            500.0,
        )

        self.assertIn('data-cad-entity-id="entity_7"', result)
        self.assertRegex(
            result,
            r'<svg x="100(?:\.0)?" y="-220(?:\.0)?" width="10(?:\.0)?" height="20(?:\.0)?"',
        )


if __name__ == "__main__":
    unittest.main()
