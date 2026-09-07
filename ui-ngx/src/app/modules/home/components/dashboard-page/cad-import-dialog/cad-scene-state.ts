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

/** A source-scoped edit log, not a mutation of the uploaded CAD document. */
export interface CadSceneSnapshot {
  version: 1;
  sceneId: string;
  deletedEntityIds: string[];
}

export interface CadSceneEntity {
  id: string;
  blockName?: string | null;
  layer?: string;
}

export class CadSceneState<T extends CadSceneEntity> {
  readonly entityById: ReadonlyMap<string, T>;
  private readonly deleted = new Set<string>();
  private readonly history: string[][] = [];
  private retained: T[] | null = null;

  constructor(readonly sceneId: string, readonly entities: readonly T[]) {
    const byId = new Map<string, T>();
    for (const entity of entities) {
      if (!entity.id || byId.has(entity.id)) throw new Error('Missing or duplicate CAD instance ID');
      byId.set(entity.id, entity);
    }
    this.entityById = byId;
  }

  get deletedEntityIds(): ReadonlySet<string> { return this.deleted; }
  get keptEntities(): T[] {
    if (!this.retained) this.retained = this.entities.filter(entity => !this.deleted.has(entity.id));
    return this.retained;
  }
  get canUndo(): boolean { return this.history.length > 0; }

  deleteInstances(ids: Iterable<string>): string[] {
    const unique = [...new Set(ids)];
    // Validate the complete operation before changing anything.
    if (unique.some(id => !this.entityById.has(id))) throw new Error('Unknown CAD instance ID');
    const changed = unique.filter(id => !this.deleted.has(id));
    if (changed.length) {
      changed.forEach(id => this.deleted.add(id));
      this.history.push(changed);
      if (this.history.length > 20) this.history.shift();
      this.retained = null;
    }
    return changed;
  }

  undoDelete(): string[] {
    const changed = this.history.pop() || [];
    changed.forEach(id => this.deleted.delete(id));
    if (changed.length) this.retained = null;
    return changed;
  }

  snapshot(): CadSceneSnapshot {
    if (!/^[0-9a-f]{64}$/.test(this.sceneId)) throw new Error('Reconvert this CAD file before saving edits');
    return {
      version: 1, sceneId: this.sceneId,
      deletedEntityIds: this.entities.filter(entity => this.deleted.has(entity.id)).map(entity => entity.id)
    };
  }

  restore(value: unknown): void {
    const snapshot = value as CadSceneSnapshot | null;
    if (!snapshot || snapshot.version !== 1 || snapshot.sceneId !== this.sceneId ||
        !/^[0-9a-f]{64}$/.test(snapshot.sceneId) || !Array.isArray(snapshot.deletedEntityIds) ||
        snapshot.deletedEntityIds.length > this.entities.length ||
        snapshot.deletedEntityIds.some(id => typeof id !== 'string' || !this.entityById.has(id)) ||
        new Set(snapshot.deletedEntityIds).size !== snapshot.deletedEntityIds.length) {
      throw new Error('CAD edits do not belong to this source or contain invalid instance IDs');
    }
    this.deleted.clear();
    snapshot.deletedEntityIds.forEach(id => this.deleted.add(id));
    this.history.length = 0;
    this.retained = null;
  }
}
