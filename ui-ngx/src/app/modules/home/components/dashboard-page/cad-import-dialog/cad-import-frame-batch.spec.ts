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
import {
  insertWidgetsInFrames,
  WidgetBatchItem
} from './cad-import-frame-batch';

interface TestContext {
  inserted: { row: number; col: number; batchIndex: number }[];
  batchStartIndices: number[];
  allCompleteCalled: boolean;
}

function makeItems(count: number): WidgetBatchItem[] {
  return Array.from({length: count}, (_, i) => ({
    widget: {id: `widget-${i}`},
    row: i * 2,
    col: i * 3
  }));
}

function makeContext(): TestContext {
  return { inserted: [], batchStartIndices: [], allCompleteCalled: false };
}

function insertFn(ctx: TestContext, item: WidgetBatchItem, batchIndex: number): void {
  ctx.inserted.push({ row: item.row, col: item.col, batchIndex });
}

function batchCompleteFn(ctx: TestContext, batchIndex: number): void {
  ctx.batchStartIndices.push(batchIndex);
}

function allCompleteFn(ctx: TestContext): void {
  ctx.allCompleteCalled = true;
}

{
  const ctx = makeContext();
  const items = makeItems(5);
  const rAF = (cb: () => void) => { cb(); return 1; };
  const handle = insertWidgetsInFrames(items, ctx, insertFn, batchCompleteFn, allCompleteFn, 25, rAF);
  handle.promise.then(() => {
    assert.equal(ctx.inserted.length, 5);
    assert.equal(ctx.batchStartIndices.length, 1);
    assert.equal(ctx.batchStartIndices[0], 0);
    assert.ok(ctx.allCompleteCalled);
    assert.equal(ctx.inserted[0].row, 0);
    assert.equal(ctx.inserted[4].row, 8);
    assert.equal(ctx.inserted[0].batchIndex, 0);
    console.log('PASS: small batch (5 items) processes in one frame');
  });
}

{
  const ctx = makeContext();
  const items = makeItems(60);
  let rafCounter = 0;
  const rAF = (cb: () => void) => { rafCounter++; cb(); return rafCounter; };
  const handle = insertWidgetsInFrames(items, ctx, insertFn, batchCompleteFn, allCompleteFn, 25, rAF);
  handle.promise.then(() => {
    assert.equal(ctx.inserted.length, 60);
    assert.equal(ctx.batchStartIndices.length, 3);
    assert.deepEqual(ctx.batchStartIndices, [0, 1, 2]);
    assert.ok(ctx.allCompleteCalled);
    assert.equal(rafCounter, 3);
    console.log('PASS: large batch (60 items, batchSize=25) processes across 3 frames');
  });
}

{
  const ctx = makeContext();
  const items = makeItems(52);
  const rAF = (cb: () => void) => { cb(); return 1; };
  const handle = insertWidgetsInFrames(items, ctx, insertFn, batchCompleteFn, allCompleteFn, 25, rAF);
  handle.promise.then(() => {
    assert.equal(ctx.inserted[0].row, 0);
    assert.equal(ctx.inserted[0].col, 0);
    assert.equal(ctx.inserted[25].row, 50);
    assert.equal(ctx.inserted[25].col, 75);
    assert.equal(ctx.inserted[51].row, 102);
    assert.equal(ctx.inserted[51].col, 153);
    console.log('PASS: widget order is preserved across batches');
  });
}

{
  const ctx = makeContext();
  const items = makeItems(30);
  let rafCount = 0;
  const rAF = (cb: () => void) => { rafCount++; cb(); return rafCount; };
  const handle = insertWidgetsInFrames(items, ctx, insertFn, batchCompleteFn, allCompleteFn, 25, rAF);
  handle.promise.then(() => {
    assert.equal(ctx.batchStartIndices.length, 2);
    assert.equal(ctx.batchStartIndices[0], 0);
    assert.equal(ctx.batchStartIndices[1], 1);
    assert.ok(ctx.allCompleteCalled);
    console.log('PASS: batchCompleteFn called after each frame');
  });
}

{
  const ctx = makeContext();
  const items = makeItems(25);
  const rAF = (cb: () => void) => { cb(); return 1; };
  const handle = insertWidgetsInFrames(items, ctx, insertFn, batchCompleteFn, allCompleteFn, 25, rAF);
  handle.promise.then(() => {
    assert.ok(ctx.allCompleteCalled);
    assert.equal(ctx.inserted.length, 25);
    console.log('PASS: allCompleteFn called after all items processed');
  });
}

{
  const ctx = makeContext();
  const items = makeItems(100);
  let rafCounter = 0;
  const scheduledCbs: Array<() => void> = [];
  const rAF = (cb: () => void) => {
    rafCounter++;
    scheduledCbs.push(cb);
    return rafCounter;
  };
  const handle = insertWidgetsInFrames(items, ctx, insertFn, batchCompleteFn, allCompleteFn, 25, rAF, () => {});
  scheduledCbs[0]();
  scheduledCbs[1]();
  handle.cancel();
  scheduledCbs[2]();
  handle.promise.then(() => {
    assert.equal(ctx.inserted.length, 50);
    assert.equal(ctx.batchStartIndices.length, 2);
    assert.ok(!ctx.allCompleteCalled);
    console.log('PASS: cancel() stops remaining work');
  });
}

{
  const ctx = makeContext();
  const items = makeItems(40);
  let rafCounter = 0;
  const rAF = (cb: () => void) => { rafCounter++; cb(); return rafCounter; };
  const customBatchSize = 10;
  const handle = insertWidgetsInFrames(items, ctx, insertFn, batchCompleteFn, allCompleteFn, customBatchSize, rAF);
  handle.promise.then(() => {
    assert.equal(ctx.inserted.length, 40);
    assert.equal(ctx.batchStartIndices.length, 4);
    assert.equal(rafCounter, 4);
    assert.ok(ctx.allCompleteCalled);
    console.log('PASS: custom batch size works (10 items per frame)');
  });
}

{
  const ctx = makeContext();
  const items = makeItems(0);
  const rAF = (cb: () => void) => { cb(); return 1; };
  const handle = insertWidgetsInFrames(items, ctx, insertFn, batchCompleteFn, allCompleteFn, 25, rAF);
  handle.promise.then(() => {
    assert.ok(ctx.allCompleteCalled);
    assert.equal(ctx.inserted.length, 0);
    assert.equal(ctx.batchStartIndices.length, 0);
    console.log('PASS: empty batch completes immediately');
  });
}
