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

import type { CadBackgroundSettings } from './cad-import-background';
import { buildCadSvgBase64, buildCadSvgBase64Async, CadSvgBuildOptions, validateCadSvgBounds } from './cad-import-svg';
import { cadBoundsToGrid, cadGridFrame } from './cad-import-grid';

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
  scadaSymbolContent?: string;
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
  /** Editable components are the default. Background merging is an explicit opt-in. */
  outputMode?: 'components' | 'background';
  backgroundColor?: string;
  background?: CadBackgroundSettings;
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

function planCadImportWidgetItems<TWidgetInfo = any>(
  input: CadImportWidgetItemsInput<TWidgetInfo>
): CadImportWidgetItem<TWidgetInfo>[] {
  if (input.previewViewBox) validateCadSvgBounds(input.previewViewBox);
  const order = new Map(input.entities.map((entity, index) => [entity.id, index]));
  const entityById = new Map(input.entities.map(entity => [entity.id, entity]));
  if (entityById.size !== input.entities.length) throw new Error('Duplicate CAD entity ids.');
  const groupByFirstEntityId = new Map<string, CadImportGroupMapping<TWidgetInfo>>();
  const groupedEntityIds = new Set<string>();
  const groupIds = new Set<string>();

  for (const group of input.groupMappings) {
    if (!group.id || groupIds.has(group.id) || entityById.has(group.id) || group.id === UNMAPPED_COMPOSITE_ID) {
      throw new Error('Duplicate or invalid CAD group identity.');
    }
    groupIds.add(group.id);
    const entityIds = [...new Set(group.entityIds)]
      .filter(id => entityById.has(id) && !input.deletedEntityIds.has(id))
      .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    if (entityIds.length < 2) {
      continue;
    }
    // A stale/imported mapping scheme must not duplicate a device or silently
    // discard another group's members. Let the user resolve the ambiguity.
    if (entityIds.some(id => groupedEntityIds.has(id))) {
      throw new Error('Overlapping CAD group mappings. Remove the conflicting mapping before importing.');
    }
    const normalizedGroup = { ...group, entityIds };
    groupByFirstEntityId.set(entityIds[0], normalizedGroup);
    entityIds.forEach(id => groupedEntityIds.add(id));
  }

  const items: CadImportWidgetItem<TWidgetInfo>[] = [];
  const unmappedEntities: CadImportWidgetEntity[] = [];

  for (const entity of input.entities) {
    if (input.deletedEntityIds.has(entity.id)) {
      continue;
    }
    const group = groupByFirstEntityId.get(entity.id);
    if (group) {
      const groupEntities = group.entityIds.map(id => entityById.get(id)!);
      items.push({
        id: group.id,
        entityIds: group.entityIds,
        entity: buildCompositeCadEntity(group.id, groupEntities),
        mapping: group.widgetInfo
      });
      continue;
    }
    if (groupedEntityIds.has(entity.id)) {
      continue;
    }
    const mapping = input.entityMappings.get(entity.id) || null;
    if (mapping) {
      items.push({ id: entity.id, entityIds: [entity.id], entity, mapping });
    } else if (input.previewViewBox && input.outputMode === 'background') {
      unmappedEntities.push(entity);
    } else {
      items.push({ id: entity.id, entityIds: [entity.id], entity, mapping: null });
    }
  }

  if (unmappedEntities.length > 0 && input.previewViewBox) {
    const frame = input.previewViewBox;
    const compositeEntity: CadImportWidgetEntity = {
      id: UNMAPPED_COMPOSITE_ID,
      type: 'UNMAPPED_COMPOSITE',
      svgBase64: '',
      ...unionBounds(unmappedEntities, entity => ({
        x: entity.x, y: entity.y, width: entity.width, height: entity.height
      })),
      blockName: `Background (${unmappedEntities.length} entities)`,
      // Geometry, resource viewBox and dashboard layout MUST use the same frame.
      // Using the retained-entity union here shrinks/moves the drawing whenever
      // an exterior entity is deleted or replaced with a live widget.
      previewX: frame.x,
      previewY: frame.y,
      previewWidth: frame.width,
      previewHeight: frame.height
    };
    return [{
      id: UNMAPPED_COMPOSITE_ID,
      entityIds: unmappedEntities.map(entity => entity.id),
      entity: compositeEntity,
      mapping: null
    }, ...items];
  }

  return items;
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
  if (input.scadaSymbolContent) {
    config.settings.scadaSymbolContent = input.scadaSymbolContent;
    config.settings.scadaSymbolUrl = null;
  } else if (input.scadaSymbolUrl) {
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

/** Snap the RESOURCE viewport to the same cell envelope as its widget.
 * Never enlarge the widget then stretch its original SVG: small circles/lines
 * would change size and alignment relative to neighboring components.
 */
function resourceFrame(item: CadImportWidgetItem, frame: { x: number; y: number; width: number; height: number }) {
  if (item.id === UNMAPPED_COMPOSITE_ID) return frame;
  if (!hasPreviewBounds(item.entity)) throw new Error('CAD component preview bounds are missing.');
  const grid = cadGridFrame(frame);
  const cell = expandCadGridBounds(cadBoundsToGrid({
    x: item.entity.previewX!, y: item.entity.previewY!,
    width: item.entity.previewWidth!, height: item.entity.previewHeight!
  }, grid), grid.columns, grid.rows, 4, 4);
  return { x: grid.viewBox.x + cell.col / grid.scale,
    y: grid.viewBox.y + cell.row / grid.scale,
    width: cell.sizeX / grid.scale, height: cell.sizeY / grid.scale };
}

function setResource(item: CadImportWidgetItem, frame: { x: number; y: number; width: number; height: number }, svgBase64: string) {
  item.entity = { ...item.entity, svgBase64, previewX: frame.x, previewY: frame.y,
    previewWidth: frame.width, previewHeight: frame.height };
}

export function buildCadImportWidgetItems<TWidgetInfo = any>(input: CadImportWidgetItemsInput<TWidgetInfo>): CadImportWidgetItem<TWidgetInfo>[] {
  const items = planCadImportWidgetItems(input);
  const source = new Map(input.entities.map(entity => [entity.id, entity]));
  for (const item of items) {
    if (item.mapping || !input.previewViewBox) continue;
    const frame = resourceFrame(item, input.previewViewBox);
    setResource(item, frame, buildCadSvgBase64(item.entityIds.map(id => source.get(id)!), frame,
      { background: input.background, backgroundColor: item.id === UNMAPPED_COMPOSITE_ID ? input.backgroundColor : undefined }));
  }
  return items;
}

export async function buildCadImportWidgetItemsAsync<TWidgetInfo = any>(input: CadImportWidgetItemsInput<TWidgetInfo>,
    options: CadSvgBuildOptions = {}): Promise<CadImportWidgetItem<TWidgetInfo>[]> {
  if (options.signal?.aborted) throw new DOMException('CAD processing cancelled', 'AbortError');
  const items = planCadImportWidgetItems(input);
  const source = new Map(input.entities.map(entity => [entity.id, entity]));
  let started = performance.now();
  for (let index = 0; index < items.length; index++) {
    if (options.signal?.aborted) throw new DOMException('CAD processing cancelled', 'AbortError');
    const item = items[index];
    if (!item.mapping && input.previewViewBox) {
      const frame = resourceFrame(item, input.previewViewBox);
      setResource(item, frame, await buildCadSvgBase64Async(item.entityIds.map(id => source.get(id)!), frame,
        { signal: options.signal, background: input.background, backgroundColor: item.id === UNMAPPED_COMPOSITE_ID ? input.backgroundColor : undefined }));
    }
    options.onProgress?.(index + 1, items.length);
    if (performance.now() - started >= 8 || (index + 1) % 50 === 0) {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      started = performance.now();
    }
  }
  if (options.signal?.aborted) throw new DOMException('CAD processing cancelled', 'AbortError');
  return items;
}

/** Yield to input/paint during widget configuration as well as SVG preparation. */
export async function* cadImportBatches<T>(items: T[], signal?: AbortSignal): AsyncGenerator<T> {
  let started = performance.now();
  for (let index = 0; index < items.length; index++) {
    if (signal?.aborted) throw new DOMException('CAD processing cancelled', 'AbortError');
    yield items[index];
    if ((index + 1) % 32 === 0 || performance.now() - started >= 8) {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      started = performance.now();
    }
  }
}
