# Copyright © 2016-2026 The Thingsboard Authors
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy at http://www.apache.org/licenses/LICENSE-2.0
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""Same-input, same-process file/bundle regression; decoder warnings stay separate.

The fixture comes from a test-only LibreDWG conversion. This cannot establish
ODA/AutoCAD equivalence. Nothing in production selects LibreDWG.
"""
import base64
import cProfile
import hashlib
import json
import pstats
import statistics
import sys
import time
from collections import Counter
from pathlib import Path

import ezdxf

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'application/src/main/data/scripts/cad'))
from cad_scene import convert_scene


def main():
    source, output = map(Path, sys.argv[1:3])
    output.mkdir(parents=True, exist_ok=True)
    doc = ezdxf.readfile(source)
    types = dict(Counter(e.dxftype() for e in doc.modelspace()))
    # Detect decoder regressions on this committed fixture; these are decoded
    # counts, not a claim that LibreDWG recovered every object in the original.
    assert sum(types.values()) == 73, types
    assert types['TEXT'] == 11 and types['LINE'] == 57, types
    samples = {'files': [], 'bundle': []}
    manifests = {}
    for index in range(5):
        # Alternate order; neither time includes DWG decoding or HTTP transfer.
        for mode in (('files', 'bundle') if index % 2 == 0 else ('bundle', 'files')):
            destination = output / f'{mode}-{index}'
            started = time.perf_counter()
            convert_scene(source, destination, web_bundle=mode == 'bundle')
            samples[mode].append((time.perf_counter() - started) * 1000)
            manifests[mode] = json.loads((destination / 'manifest.json').read_text())
            assert manifests[mode]['totalCount'] == 73
        file_result, bundle_result = manifests['files'], manifests['bundle']
        assert file_result['previewViewBox'] == bundle_result['previewViewBox']
        assert file_result['modelToSvg'] == bundle_result['modelToSvg']
        for previous, current in zip(file_result['entities'], bundle_result['entities']):
            assert previous['id'] == current['id']
            assert (output / f'files-{index}' / previous['svgFile']).read_bytes() == base64.b64decode(current['svgBase64'])
        assert len(list((output / f'bundle-{index}').iterdir())) == 1
    profiler = cProfile.Profile()
    profiler.runcall(convert_scene, source, output / 'profile', web_bundle=True)
    with (output / 'profile.txt').open('w') as stream:
        pstats.Stats(profiler, stream=stream).sort_stats('cumulative').print_stats(45)
    report = {
        'decoder': 'LibreDWG 0.13.3; inspect decoder logs; NOT ODA/AutoCAD equivalence',
        'dwgSha256': hashlib.sha256((ROOT / 'files/testfile.dwg').read_bytes()).hexdigest(),
        'dwgBytes': (ROOT / 'files/testfile.dwg').stat().st_size,
        'dxfBytes': source.stat().st_size, 'decodedTypes': types,
        'sceneCount': manifests['bundle']['totalCount'],
        'fileModeOutputFiles': len(list((output / 'files-0').rglob('*.svg'))) + 1,
        'bundleModeOutputFiles': 1,
        'sceneMilliseconds': samples,
        'medianMilliseconds': {mode: statistics.median(values) for mode, values in samples.items()},
        'timings': manifests['bundle']['timings'],
        'warnings': manifests['bundle']['warnings'],
        'scope': 'DXF read + scene conversion + output, not startup/ODA/HTTP/widget rendering'
    }
    (output / 'measurement.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    main()
