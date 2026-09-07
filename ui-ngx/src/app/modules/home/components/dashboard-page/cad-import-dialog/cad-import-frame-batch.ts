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

export interface WidgetBatchItem {
  widget: any;
  row: number;
  col: number;
}

export const CAD_IMPORT_WIDGET_BATCH_SIZE = 25;

export function insertWidgetsInFrames<TContext>(
  items: WidgetBatchItem[],
  context: TContext,
  insertFn: (context: TContext, item: WidgetBatchItem, batchIndex: number) => void,
  batchCompleteFn: (context: TContext, batchIndex: number) => void,
  allCompleteFn: (context: TContext) => void,
  batchSize: number = CAD_IMPORT_WIDGET_BATCH_SIZE,
  requestAnimationFrameFn: (cb: () => void) => number = requestAnimationFrame,
  cancelAnimationFrameFn?: (id: number) => void
): { cancel: () => void; promise: Promise<void> } {
  const cancelFn = cancelAnimationFrameFn ?? (() => {});
  let cancelled = false;
  let rafId: number | null = null;

  const promise = new Promise<void>((resolve) => {
    let currentIndex = 0;
    let batchIndex = 0;

    const processBatch = (): void => {
      if (cancelled) {
        resolve();
        return;
      }

      const start = currentIndex;
      const end = Math.min(start + batchSize, items.length);

      for (let i = start; i < end; i++) {
        insertFn(context, items[i], batchIndex);
      }
      currentIndex = end;

      batchCompleteFn(context, batchIndex);
      batchIndex++;

      if (currentIndex < items.length) {
        rafId = requestAnimationFrameFn(processBatch);
      } else {
        rafId = null;
        allCompleteFn(context);
        resolve();
      }
    };

    if (items.length === 0) {
      allCompleteFn(context);
      resolve();
      return;
    }

    rafId = requestAnimationFrameFn(processBatch);
  });

  const cancel = (): void => {
    cancelled = true;
    if (rafId !== null) {
      cancelFn(rafId);
      rafId = null;
    }
  };

  return { cancel, promise };
}
