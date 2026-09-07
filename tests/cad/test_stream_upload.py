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
"""Compile and exercise the production, dependency-free stream staging helper."""
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]


def test_large_upload_with_heap_smaller_than_file(tmp_path):
    helper = ROOT / 'application/src/main/java/org/thingsboard/server/service/entitiy/cad/CadUploadIO.java'
    regression = ROOT / 'tests/cad/CadUploadIORegression.java'
    subprocess.run(['javac', '-d', str(tmp_path), str(helper), str(regression)], check=True)
    completed = subprocess.run(['java', '-Xmx32m', '-cp', str(tmp_path),
                               'org.thingsboard.server.service.entitiy.cad.CadUploadIORegression',
                               str(tmp_path / 'upload.dxf')], check=True, capture_output=True, text=True, timeout=60)
    report = json.loads(completed.stdout)
    assert report['inputBytes'] == 128 * 1024 * 1024
    assert report['maxHeapBytes'] <= 32 * 1024 * 1024
    artifact = Path(os.environ.get('CAD_TEST_ARTIFACTS', str(tmp_path)))
    artifact.mkdir(parents=True, exist_ok=True)
    (artifact / 'stream-upload-report.json').write_text(json.dumps(report, indent=2))
