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
    items.push({
      id: entity.id,
      entityIds: [entity.id],
      entity,
      mapping: input.entityMappings.get(entity.id) || null
    });
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

interface CadEntityBounds {
  x: number;
  y: number;
  width: number;
  height: number;
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
  const modelBounds = unionEntityBounds(entities, entity => ({
    x: entity.x,
    y: entity.y,
    width: entity.width,
    height: entity.height
  }));
  const previewEntities = entities.filter(hasPreviewBounds);
  const previewBounds = previewEntities.length === entities.length
    ? unionEntityBounds(previewEntities, entity => ({
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

function unionEntityBounds<T>(
  entities: T[],
  boundsProvider: (entity: T) => CadEntityBounds
): CadEntityBounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const entity of entities) {
    const bounds = boundsProvider(entity);
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.width);
    maxY = Math.max(maxY, bounds.y + bounds.height);
  }
  return {
    x: minX,
    y: minY,
    width: Math.max(maxX - minX, 1),
    height: Math.max(maxY - minY, 1)
  };
}

function hasPreviewBounds(entity: CadImportWidgetEntity): boolean {
  return Number.isFinite(entity.previewX) && Number.isFinite(entity.previewY) &&
    Number.isFinite(entity.previewWidth) && Number.isFinite(entity.previewHeight) &&
    entity.previewWidth! > 0 && entity.previewHeight! > 0;
}
