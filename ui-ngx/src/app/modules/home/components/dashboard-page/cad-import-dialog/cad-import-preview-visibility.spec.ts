///
/// Copyright © 2016-2026 The Thingsboard Authors
///
/// Licensed under the Apache License, Version 2.0 (the "License");
/// you may not use this file except in compliance with the License.
/// You may obtain a copy of the License at
///
///     http://www.apache.org/licenses/LICENSE-2.0
///
/// Unless required by applicable law or agreed to in writing, software
/// distributed under the License is distributed on an "AS IS" BASIS,
/// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
/// See the License for the specific language governing permissions and
/// limitations under the License.
///

import assert from 'node:assert/strict';
import { buildDeletedPreviewMask } from './cad-import-preview-visibility';

assert.deepEqual(
  buildDeletedPreviewMask({
    previewX: 10,
    previewY: 20,
    previewWidth: 30,
    previewHeight: 40
  }),
  {
    x: 10,
    y: 20,
    width: 30,
    height: 40
  }
);

assert.equal(
  buildDeletedPreviewMask({
    previewX: 10,
    previewY: 20,
    previewWidth: 0,
    previewHeight: 40
  }),
  null
);
