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

import { buildCadSvgBase64, buildCadSvgBase64Async, CadSvgBounds, CadSvgBuildOptions, validateCadSvgBounds } from './cad-import-svg';
import { cadComponentFrame, cadGridFrame } from './cad-import-grid';

export interface CadImportWidgetPlanInput {
  importEntityCount: number;
}

export interface CadImportWidgetPlan {
  totalWorkItems: number;
}

export interface CadMappedScadaWidgetConfigDefaultsInput {
  title: string;
  type: string;
  preserveAspectRatio: boolean;
  stretchToFit?: boolean;
  scadaSymbolUrl?: string;
}

export function cadImportWidgetPlan(input: CadImportWidgetPlanInput): CadImportWidgetPlan {
  return {
    totalWorkItems: input.importEntityCount
  };
}

export interface CadImportWidgetEntity {
  id: string;
  type: string;
  svgBase64: string;
  x: number;
  y: number;
  width: number;
  height: number;
  blockName?: string | null;
  previewX?: number;
  previewY?: number;
  previewWidth?: number;
  previewHeight?: number;
}

export interface CadImportGroupMapping<TWidgetInfo = any> {
  id: string;
  entityIds: string[];
  widgetInfo: TWidgetInfo | null;
}

export interface CadImportWidgetItem<TWidgetInfo = any> {
  id: string;
  entityIds: string[];
  entity: CadImportWidgetEntity;
  mapping: TWidgetInfo | null;
}

export interface CadImportWidgetItemsInput<TWidgetInfo = any> {
  entities: CadImportWidgetEntity[];
  deletedEntityIds: ReadonlySet<string>;
  entityMappings: Map<string, TWidgetInfo | null>;
  groupMappings: CadImportGroupMapping<TWidgetInfo>[];
  /** Default: one widget per CAD instance / explicit group. Legacy background
   * merging is opt-in, never inferred from the presence of a preview frame. */
  importMode?: 'components' | 'background';
  backgroundColor?: string;
  previewViewBox?: { x: number; y: number; width: number; height: number };
}

const UNMAPPED_COMPOSITE_ID = 'cad-unmapped-composite';

function hasPreviewBounds(entity: CadImportWidgetEntity): boolean {
  return Number.isFinite(entity.previewX) && Number.isFinite(entity.previewY) &&
    Number.isFinite(entity.previewWidth) && Number.isFinite(entity.previewHeight) &&
    entity.previewWidth! > 0 && entity.previewHeight! > 0;
}

function unionBounds<T>(
  entities: T[],
  boundsProvider: (entity: T) => { x: number; y: number; width: number; height: number }
): { x: number; y: number; width: number; height: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const entity of entities) {
    const b = boundsProvider(entity);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  return {
    x: minX,
    y: minY,
    width: Math.max(maxX - minX, 1),
    height: Math.max(maxY - minY, 1)
  };
}

interface CadResourceJob {
  members: CadImportWidgetEntity[];
  frame: CadSvgBounds;
  backgroundColor?: string;
}

function planCadImportWidgetItems<TWidgetInfo = any>(input: CadImportWidgetItemsInput<TWidgetInfo>) {
  if (input.previewViewBox) validateCadSvgBounds(input.previewViewBox);
  const grid = input.previewViewBox ? cadGridFrame(input.previewViewBox) : null;
  const order = new Map(input.entities.map((entity, index) => [entity.id, index]));
  const entityById = new Map(input.entities.map(entity => [entity.id, entity]));
  if (entityById.size !== input.entities.length) throw new Error('Duplicate CAD entity ids.');
  const groupByFirstEntityId = new Map<string, CadImportGroupMapping<TWidgetInfo>>();
  const groupedEntityIds = new Set<string>();
  const groupIds = new Set<string>();
  for (const group of input.groupMappings) {
    if (!group.id || groupIds.has(group.id) || entityById.has(group.id)) throw new Error('Duplicate CAD group id.');
    groupIds.add(group.id);
    if (group.entityIds.some(id => !entityById.has(id))) throw new Error('Unknown CAD group member.');
    const entityIds = [...new Set(group.entityIds)].filter(id => !input.deletedEntityIds.has(id))
      .sort((a, b) => order.get(a)! - order.get(b)!);
    if (entityIds.length < 2) continue;
    if (entityIds.some(id => groupedEntityIds.has(id))) throw new Error('Overlapping CAD group mappings.');
    groupByFirstEntityId.set(entityIds[0], { ...group, entityIds });
    entityIds.forEach(id => groupedEntityIds.add(id));
  }
  const items: CadImportWidgetItem<TWidgetInfo>[] = [];
  const jobs = new Map<string, CadResourceJob>();
  const background: CadImportWidgetEntity[] = [];
  const addItem = (id: string, members: CadImportWidgetEntity[], mapping: TWidgetInfo | null) => {
    let entity = members.length === 1 ? { ...members[0] } : buildCompositeCadEntity(id, members);
    if (!mapping && grid) {
      const original = { x: entity.previewX!, y: entity.previewY!, width: entity.previewWidth!, height: entity.previewHeight! };
      const frame = cadComponentFrame(original, grid).viewBox;
      entity = { ...entity, id, svgBase64: '', previewX: frame.x, previewY: frame.y,
        previewWidth: frame.width, previewHeight: frame.height };
      jobs.set(id, { members, frame }); // transparent; the dashboard owns the canvas color
    } else if (!mapping && members.length > 1) {
      const frame = { x: entity.previewX!, y: entity.previewY!, width: entity.previewWidth!, height: entity.previewHeight! };
      validateCadSvgBounds(frame);
      jobs.set(id, { members, frame });
    }
    items.push({ id, entityIds: members.map(member => member.id), entity, mapping });
  };
  for (const entity of input.entities) {
    if (input.deletedEntityIds.has(entity.id)) continue;
    const group = groupByFirstEntityId.get(entity.id);
    if (group) {
      addItem(group.id, group.entityIds.map(id => entityById.get(id)!), group.widgetInfo || null);
    } else if (!groupedEntityIds.has(entity.id)) {
      const mapping = input.entityMappings.get(entity.id) || null;
      if (!mapping && input.importMode === 'background' && grid) background.push(entity);
      else addItem(entity.id, [entity], mapping);
    }
  }
  if (background.length && grid) {
    const id = UNMAPPED_COMPOSITE_ID;
    if (entityById.has(id) || groupIds.has(id)) throw new Error('Reserved CAD background id.');
    const frame = input.previewViewBox!;
    const entity = { ...buildCompositeCadEntity(id, background), type: 'UNMAPPED_COMPOSITE',
      blockName: `Background (${background.length} entities)`, previewX: frame.x, previewY: frame.y,
      previewWidth: frame.width, previewHeight: frame.height };
    jobs.set(id, { members: background, frame, backgroundColor: input.backgroundColor });
    items.unshift({ id, entityIds: background.map(member => member.id), entity, mapping: null });
  }
  return { items, jobs };
}

export function cadMappedScadaWidgetConfigDefaults(input: CadMappedScadaWidgetConfigDefaultsInput): Record<string, any> {
  const config: Record<string, any> = {
    title: input.title,
    cadImport: true,
    showTitle: false,
    dropShadow: false,
    resizable: true,
    preserveAspectRatio: input.preserveAspectRatio,
    backgroundColor: 'rgba(0,0,0,0)',
    padding: '0',
    margin: '0',
    datasources: [],
    settings: {
      padding: '0',
      background: {
        type: 'color',
        imageUrl: null,
        color: 'rgba(0,0,0,0)',
        overlay: {
          enabled: false,
          color: 'rgba(255,255,255,0.72)',
          blur: 3
        }
      },
      scadaSymbolObjectSettings: {
        behavior: {},
        properties: {},
        stretchToFit: input.stretchToFit ?? !input.preserveAspectRatio
      }
    }
  };
  if (input.type === 'rpc') {
    config.targetDevice = { type: 'device' };
  }
  if (input.scadaSymbolUrl) {
    config.settings.scadaSymbolUrl = input.scadaSymbolUrl;
    config.settings.scadaSymbolContent = null;
  }
  return config;
}

export interface CadGridBounds {
  col: number;
  row: number;
  sizeX: number;
  sizeY: number;
}

export function expandCadGridBounds(bounds: CadGridBounds,
                                    targetColumns: number,
                                    targetRows: number,
                                    minSizeX: number,
                                    minSizeY: number): CadGridBounds {
  const sizeX = Math.min(targetColumns, Math.max(bounds.sizeX, minSizeX));
  const sizeY = Math.min(targetRows, Math.max(bounds.sizeY, minSizeY));
  const col = clamp(Math.round(bounds.col - (sizeX - bounds.sizeX) / 2), 0, Math.max(0, targetColumns - sizeX));
  const row = clamp(Math.round(bounds.row - (sizeY - bounds.sizeY) / 2), 0, Math.max(0, targetRows - sizeY));
  return { col, row, sizeX, sizeY };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function buildCompositeCadEntity(id: string, entities: CadImportWidgetEntity[]): CadImportWidgetEntity {
  const modelBounds = unionBounds(entities, entity => ({
    x: entity.x,
    y: entity.y,
    width: entity.width,
    height: entity.height
  }));
  const previewEntities = entities.filter(hasPreviewBounds);
  const previewBounds = previewEntities.length === entities.length
    ? unionBounds(previewEntities, entity => ({
        x: entity.previewX!,
        y: entity.previewY!,
        width: entity.previewWidth!,
        height: entity.previewHeight!
      }))
    : null;
  return {
    id,
    type: 'GROUP',
    svgBase64: '',
    x: modelBounds.x,
    y: modelBounds.y,
    width: modelBounds.width,
    height: modelBounds.height,
    blockName: `Group (${entities.length})`,
    ...(previewBounds ? {
      previewX: previewBounds.x,
      previewY: previewBounds.y,
      previewWidth: previewBounds.width,
      previewHeight: previewBounds.height
    } : {})
  };
}

export function buildCadImportWidgetItems<TWidgetInfo = any>(input: CadImportWidgetItemsInput<TWidgetInfo>): CadImportWidgetItem<TWidgetInfo>[] {
  const { items, jobs } = planCadImportWidgetItems(input);
  for (const item of items) {
    const job = jobs.get(item.id);
    if (job) item.entity.svgBase64 = buildCadSvgBase64(job.members, job.frame, { backgroundColor: job.backgroundColor });
  }
  return items;
}

export async function buildCadImportWidgetItemsAsync<TWidgetInfo = any>(input: CadImportWidgetItemsInput<TWidgetInfo>,
    options: CadSvgBuildOptions = {}): Promise<CadImportWidgetItem<TWidgetInfo>[]> {
  if (options.signal?.aborted) throw new DOMException('CAD processing cancelled', 'AbortError');
  const { items, jobs } = planCadImportWidgetItems(input);
  let completed = 0;
  let started = performance.now();
  for (const item of items) {
    if (options.signal?.aborted) throw new DOMException('CAD processing cancelled', 'AbortError');
    const job = jobs.get(item.id);
    if (job) item.entity.svgBase64 = await buildCadSvgBase64Async(job.members, job.frame,
      { signal: options.signal, backgroundColor: job.backgroundColor });
    options.onProgress?.(++completed, items.length);
    if (performance.now() - started >= 8 || completed % 32 === 0) {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      started = performance.now();
    }
  }
  if (options.signal?.aborted) throw new DOMException('CAD processing cancelled', 'AbortError');
  return items;
}
