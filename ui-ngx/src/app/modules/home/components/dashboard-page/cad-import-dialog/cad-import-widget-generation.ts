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
  widgetInfo: TWidgetInfo;
}

export interface CadImportWidgetItem<TWidgetInfo = any> {
  id: string;
  entityIds: string[];
  entity: CadImportWidgetEntity;
  mapping: TWidgetInfo | null;
}

export interface CadImportWidgetItemsInput<TWidgetInfo = any> {
  entities: CadImportWidgetEntity[];
  deletedEntityIds: Set<string>;
  entityMappings: Map<string, TWidgetInfo | null>;
  groupMappings: CadImportGroupMapping<TWidgetInfo>[];
  /** When supplied, all unmapped entities are merged into ONE composite item using this preview viewBox. */
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

function decodeBase64Safe(value: string): string {
  if (!value) return '';
  try { return atob(value); } catch { return ''; }
}

function stripOuterSvg(svg: string): string {
  let s = svg.trim();
  if (s.startsWith('<?xml')) {
    const end = s.indexOf('?>');
    if (end !== -1) s = s.slice(end + 2).trim();
  }
  s = s.replace(/<tb:metadata[\s\S]*?<\/tb:metadata>/g, '');
  const openIdx = s.indexOf('<svg');
  if (openIdx === -1) return s;
  const openEnd = s.indexOf('>', openIdx);
  if (openEnd === -1) return s;
  const closeIdx = s.lastIndexOf('</svg>');
  if (closeIdx === -1 || closeIdx <= openEnd) return s;
  return s.slice(openEnd + 1, closeIdx).trim();
}

function buildCompositeSvgBase64(
  entities: CadImportWidgetEntity[],
  viewBox: { x: number; y: number; width: number; height: number }
): string {
  const parts: string[] = [];
  for (const entity of entities) {
    const inner = stripOuterSvg(decodeBase64Safe(entity.svgBase64));
    if (inner) parts.push(inner);
  }
  const vb = `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`;
  const merged = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:tb="https://thingsboard.io/svg" viewBox="${vb}">${parts.join('\n')}</svg>`;
  try { return btoa(merged); } catch { return ''; }
}

export function buildCadImportWidgetItems<TWidgetInfo = any>(
  input: CadImportWidgetItemsInput<TWidgetInfo>
): CadImportWidgetItem<TWidgetInfo>[] {
  const order = new Map(input.entities.map((entity, index) => [entity.id, index]));
  const entityById = new Map(input.entities.map(entity => [entity.id, entity]));
  const groupByFirstEntityId = new Map<string, CadImportGroupMapping<TWidgetInfo>>();
  const groupedEntityIds = new Set<string>();

  for (const group of input.groupMappings) {
    const entityIds = group.entityIds
      .filter(id => entityById.has(id) && !input.deletedEntityIds.has(id))
      .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    if (entityIds.length < 2) {
      continue;
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
      items.push({
        id: entity.id,
        entityIds: [entity.id],
        entity,
        mapping
      });
    } else if (input.previewViewBox) {
      unmappedEntities.push(entity);
    } else {
      items.push({
        id: entity.id,
        entityIds: [entity.id],
        entity,
        mapping: null
      });
    }
  }

  if (unmappedEntities.length > 0 && input.previewViewBox) {
    const compositeViewBox = input.previewViewBox;
    const compositeEntity: CadImportWidgetEntity = {
      id: UNMAPPED_COMPOSITE_ID,
      type: 'UNMAPPED_COMPOSITE',
      svgBase64: buildCompositeSvgBase64(unmappedEntities, compositeViewBox),
      ...unionBounds(unmappedEntities, entity => ({
        x: entity.x, y: entity.y, width: entity.width, height: entity.height
      })),
      blockName: `Background (${unmappedEntities.length} entities)`,
      ...(() => {
        if (unmappedEntities.every(hasPreviewBounds)) {
          const pb = unionBounds(unmappedEntities, entity => ({
            x: entity.previewX!, y: entity.previewY!,
            width: entity.previewWidth!, height: entity.previewHeight!
          }));
          return { previewX: pb.x, previewY: pb.y, previewWidth: pb.width, previewHeight: pb.height };
        }
        return {};
      })()
    };
    const compositeItem: CadImportWidgetItem<TWidgetInfo> = {
      id: UNMAPPED_COMPOSITE_ID,
      entityIds: unmappedEntities.map(e => e.id),
      entity: compositeEntity,
      mapping: null
    };
    return [compositeItem, ...items];
  }

  return items;
}

function unionPreviewBoundsOf(entities: CadImportWidgetEntity[]): { x: number; y: number; width: number; height: number } {
  if (entities.every(hasPreviewBounds)) {
    return unionBounds(entities, entity => ({
      x: entity.previewX!, y: entity.previewY!,
      width: entity.previewWidth!, height: entity.previewHeight!
    }));
  }
  return unionBounds(entities, entity => ({
    x: entity.x, y: entity.y, width: entity.width, height: entity.height
  }));
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
    config.targetDevice = {
      type: 'device'
    };
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
