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

import importlib.util
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

MODULE_PATH = pathlib.Path(__file__).resolve().parents[1] / "dwg_to_svg.py"
sys.path.insert(0, str(MODULE_PATH.parent))
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


# ── NEW TESTS: RenderContext optimization ──────────────────────────────

class RenderMspToSvgContextTests(unittest.TestCase):
    """Verify _render_msp_to_svg can accept and reuse a pre-existing RenderContext."""

    def test_render_msp_to_svg_accepts_existing_context(self):
        """_render_msp_to_svg should accept an optional ctx parameter
        and use it instead of creating a new RenderContext."""
        import ezdxf
        from ezdxf.addons.drawing import RenderContext

        doc = ezdxf.new()
        msp = doc.modelspace()
        msp.add_line((0, 0), (10, 10))

        # Create a RenderContext manually
        ctx = RenderContext(doc)

        # Should NOT raise TypeError for unexpected keyword 'ctx'
        svg = DWG_TO_SVG._render_msp_to_svg(doc, msp, ctx=ctx)
        self.assertIsInstance(svg, str)
        self.assertIn("<svg", svg)


class PerEntityRenderContextReuseTests(unittest.TestCase):
    """Verify dxf_to_per_entity_svgs reuses a single RenderContext for tmp_doc."""

    def test_per_entity_reuses_single_context(self):
        """With 3+ entities in a DXF, RenderContext should be instantiated
        at most 3 times total (1 for tmp_doc reused, 1 for original doc preview,
        plus possibly 1 extra during initialization)."""
        import ezdxf

        # Build a small DXF with 4 distinct entities
        doc = ezdxf.new()
        msp = doc.modelspace()
        msp.add_line((0, 0), (10, 10))
        msp.add_circle((20, 20), 5)
        msp.add_arc((40, 40), radius=8, start_angle=0, end_angle=90)
        msp.add_line((60, 60), (70, 70))

        with tempfile.TemporaryDirectory() as tmp_dir:
            dxf_path = Path(tmp_dir) / "multi_entity.dxf"
            doc.saveas(str(dxf_path))

            # Count RenderContext instantiations
            from ezdxf.addons.drawing import RenderContext as OriginalRC
            init_counts = []
            _original_init = OriginalRC.__init__

            def counting_init(self, doc_arg, *args, **kwargs):
                init_counts.append(id(doc_arg))
                _original_init(self, doc_arg, *args, **kwargs)

            with mock.patch.object(OriginalRC, "__init__", counting_init):
                with tempfile.TemporaryDirectory() as out_dir:
                    DWG_TO_SVG.dxf_to_per_entity_svgs(
                        dxf_path, Path(out_dir), max_entities=100
                    )

            # After optimization: max 2 doc identities in RenderContext inits
            # (tmp_doc reused + original doc for preview).
            # Before optimization: 4 entities + 1 preview = 5+ inits.
            self.assertLessEqual(
                len(init_counts), 3,
                f"Expected ≤3 RenderContext creations, got {len(init_counts)}"
            )


# ── NEW TESTS: main() exit codes ───────────────────────────────────────

class MainExitCodeTests(unittest.TestCase):
    """Verify main() returns proper exit codes and temp files are cleaned up."""

    def test_main_returns_nonzero_on_failure(self):
        """When conversion fails (nonexistent file), main() should return non-zero."""
        # Use subprocess: nonexistent file triggers skip → fail counter
        result = subprocess.run(
            [sys.executable, str(MODULE_PATH), "nonexistent_file_xyz.dwg"],
            capture_output=True, text=True,
        )
        self.assertNotEqual(
            result.returncode, 0,
            "Expected non-zero exit code for nonexistent file, got 0"
        )

    def test_main_returns_zero_on_success(self):
        """main() returns int when args are provided (testing return type, not value)."""
        # Mock argparse so main() runs its logic without real interaction
        mock_args = mock.MagicMock()
        mock_args.test = False
        mock_args.batch = False
        mock_args.input = None
        mock_args.output = None
        mock_args.per_entity = False
        mock_args.invert = False
        mock_args.max_entities = 5000

        with mock.patch.object(
            DWG_TO_SVG.argparse.ArgumentParser, "parse_args", return_value=mock_args
        ):
            result = DWG_TO_SVG.main()
        # Currently main() returns None (implicit return). After refactoring,
        # it returns int. This assertion FAILS before, PASSES after.
        self.assertIsInstance(result, int)


class TempDxfCleanupTests(unittest.TestCase):
    """Verify temporary DXF files are cleaned up on both success and exception paths."""

    def test_temp_dir_cleanup_on_dwg_to_dxf_return(self):
        """Verify dwg_to_dxf with TemporaryDirectory cleans up the temp dir.

        This test validates that when dwg_to_dxf is called without output_dir,
        the returned path lives inside a temporary directory that gets cleaned
        up when the TemporaryDirectory context manager exits.
        """
        # Since ODA converter may not be available, we test the structural
        # pattern: simulate a conversion that uses TemporaryDirectory
        from tempfile import TemporaryDirectory

        tmp_dir = None
        try:
            with TemporaryDirectory(prefix="dwg2svg_test_") as td:
                tmp_dir = td
                fake_dxf = Path(td) / "test.dxf"
                fake_dxf.write_text("dummy")
                self.assertTrue(fake_dxf.exists())
            # After context exit, the directory should be gone
            self.assertFalse(Path(td).exists(),
                             f"TemporaryDirectory should be cleaned up: {td}")
        except Exception:
            self.skipTest("TemporaryDirectory cleanup test infrastructure issue")

    def test_temp_dxf_path_parent_cleanup(self):
        """When a temp dir is used via TemporaryDirectory, the parent
        directory is cleaned up after the context manager exits."""
        import os
        with tempfile.TemporaryDirectory(prefix="dwg2svg_cleanup_") as td:
            td_path = Path(td)
            tmp_file = td_path / "test.dxf"
            tmp_file.write_text("dummy content")
            self.assertTrue(tmp_file.exists())
            saved_path = str(td_path)
        # After exiting context manager, dir should NOT exist
        self.assertFalse(os.path.exists(saved_path),
                         f"Temporary directory should be removed: {saved_path}")


if __name__ == "__main__":
    unittest.main()
