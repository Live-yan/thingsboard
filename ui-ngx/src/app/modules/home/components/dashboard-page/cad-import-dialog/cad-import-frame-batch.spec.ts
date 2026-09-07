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
import { insertWidgetsInFrames } from './cad-import-frame-batch';

function scheduler() {
  const queue = new Map<number, () => void>();
  let next = 0;
  let time = 0;
  return {
    options: {
      requestFrame: (callback: () => void) => { queue.set(++next, callback); return next; },
      cancelFrame: (handle: number) => { queue.delete(handle); },
      now: () => time
    },
    work(ms: number) { time += ms; },
    get pending() { return queue.size; },
    tick() {
      const entry = queue.entries().next().value;
      assert.ok(entry, 'expected another animation frame');
      queue.delete(entry[0]);
      entry[1]();
    }
  };
}

const frames = scheduler();
const state = { inserted: [] as number[], batches: [] as number[], completed: 0 };
const input = Array.from({length: 5000}, (_, index) => index);
insertWidgetsInFrames(input, state,
  (self, item) => { self.inserted.push(item); frames.work(3); },
  (self, batch) => self.batches.push(batch),
  self => self.completed++, frames.options);
assert.equal(state.inserted.length, 0, 'initial insertion must yield');
frames.tick();
assert.equal(state.inserted.length, 3, 'work must stop at the frame budget');
assert.equal(state.completed, 0);
while (frames.pending) frames.tick();
assert.deepEqual(state.inserted, input, 'insertion order must match source order');
assert.equal(state.completed, 1);
assert.deepEqual(state.batches, state.batches.map((_, index) => index));

const cheap = scheduler();
let count = 0;
insertWidgetsInFrames(input, null, () => count++, () => {}, () => {}, cheap.options);
cheap.tick();
assert.equal(count, 32, 'cheap items are also limited by a batch-size cap');

const canceled = scheduler();
let canceledComplete = false;
const operation = insertWidgetsInFrames(input, null, () => {}, () => {},
  () => { canceledComplete = true; }, canceled.options);
operation.cancel();
operation.cancel();
assert.equal(canceled.pending, 0);
assert.equal(canceledComplete, false);

const during = scheduler();
let duringCount = 0;
const mid = insertWidgetsInFrames(input, null, () => { duringCount++; mid.cancel(); },
  () => assert.fail('no batch callback after cancellation'),
  () => assert.fail('no completion after cancellation'), during.options);
during.tick();
assert.equal(duringCount, 1);
assert.equal(during.pending, 0);

const empty = scheduler();
let emptyCount = 0;
insertWidgetsInFrames([], null, () => assert.fail('empty input'),
  () => assert.fail('empty batch'), () => emptyCount++, empty.options);
empty.tick();
assert.equal(emptyCount, 1);
assert.equal(empty.pending, 0);

const failed = scheduler();
insertWidgetsInFrames([1, 2], null, () => { throw new Error('insertion failed'); },
  () => assert.fail('failed batch'), () => assert.fail('failed completion'), failed.options);
assert.throws(() => failed.tick(), /insertion failed/);
assert.equal(failed.pending, 0, 'do not continue or report success after insertion failure');
for (const options of [{batchSize: 0}, {batchSize: Infinity}, {batchSize: 1.5}, {frameBudgetMs: -1}]) {
  assert.throws(() => insertWidgetsInFrames([], null, () => {}, () => {}, () => {}, options), /must be positive/);
}
