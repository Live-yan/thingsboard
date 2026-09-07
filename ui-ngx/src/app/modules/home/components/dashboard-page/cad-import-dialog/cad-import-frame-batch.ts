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

/** Bounded dashboard insertion. Keep source order and refresh only after the last item. */
export interface CadFrameBatchOptions {
  batchSize?: number;
  frameBudgetMs?: number;
  requestFrame?: (callback: () => void) => number;
  cancelFrame?: (handle: number) => void;
  now?: () => number;
}

export function insertWidgetsInFrames<T, S>(
  items: readonly T[],
  context: S,
  insert: (context: S, item: T) => void,
  onBatch: (context: S, batchIndex: number) => void,
  onComplete: (context: S) => void,
  options: CadFrameBatchOptions = {}
): { cancel(): void } {
  const batchSize = options.batchSize ?? 32;
  const budget = options.frameBudgetMs ?? 8;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || !Number.isFinite(budget) || budget <= 0) {
    throw new Error('CAD insertion batch size and frame budget must be positive');
  }
  const request = options.requestFrame ?? (callback => window.requestAnimationFrame(callback));
  const cancel = options.cancelFrame ?? (handle => window.cancelAnimationFrame(handle));
  const now = options.now ?? (() => performance.now());
  let index = 0;
  let batchIndex = 0;
  let stopped = false;
  let pending: number | null = null;
  const tick = () => {
    pending = null;
    if (stopped) return;
    const started = now();
    let count = 0;
    // Always advance by at least one item; no giant synchronous insertion loop.
    while (!stopped && index < items.length && count < batchSize && (count === 0 || now() - started < budget)) {
      insert(context, items[index]);
      index++;
      count++;
    }
    if (stopped) return;
    if (count) onBatch(context, batchIndex++);
    if (stopped) return;
    if (index === items.length) {
      stopped = true;
      onComplete(context);
    } else {
      pending = request(tick);
    }
  };
  pending = request(tick);
  return {
    cancel() {
      stopped = true;
      if (pending !== null) cancel(pending);
      pending = null;
    }
  };
}
