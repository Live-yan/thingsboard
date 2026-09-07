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

import {
  CadImportWidgetEntity, CadImportWidgetItem, CadImportGroupMapping
} from './cad-import-widget-generation';

export interface CompositeSvgViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BuildCompositeInput<TWidgetInfo = any> {
  entities: CadImportWidgetEntity[];
  deletedEntityIds: Set<string>;
  entityMappings: Map<string, TWidgetInfo | null>;
  groupMappings: CadImportGroupMapping<TWidgetInfo>[];
  previewViewBox: CompositeSvgViewBox;
}

export interface BuildCompositeResult<TWidgetInfo = any> {
  unmappedCompositeItem: CadImportWidgetItem<TWidgetInfo> | null;
  mappedItems: CadImportWidgetItem<TWidgetInfo>[];
  allItems: CadImportWidgetItem<TWidgetInfo>[];
}

interface EntityBounds { x: number; y: number; width: number; height: number; }

function svgInnerContent(svgStr: string): string {
  const openTagStart = svgStr.indexOf('<svg');
  if (openTagStart === -1) return '';
  const openTagEnd = svgStr.indexOf('>', openTagStart);
  if (openTagEnd === -1) return '';
  const closeIdx = svgStr.lastIndexOf('</svg>');
  if (closeIdx === -1) return '';
  return svgStr.slice(openTagEnd + 1, closeIdx).trim();
}

function unionEntityBounds<T>(entities: T[], provider: (e: T) => EntityBounds): EntityBounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const e of entities) {
    const b = provider(e);
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

function hasPreviewBounds(e: CadImportWidgetEntity): boolean {
  return Number.isFinite(e.previewX) && Number.isFinite(e.previewY) &&
    Number.isFinite(e.previewWidth) && Number.isFinite(e.previewHeight) &&
    e.previewWidth! > 0 && e.previewHeight! > 0;
}

function buildGroupEntity(id: string, entities: CadImportWidgetEntity[]): CadImportWidgetEntity {
  const modelBounds = unionEntityBounds(entities, e => ({
    x: e.x, y: e.y, width: e.width, height: e.height
  }));
  const previewEntities = entities.filter(hasPreviewBounds);
  const previewBounds = previewEntities.length === entities.length
    ? unionEntityBounds(previewEntities, e => ({
        x: e.previewX!, y: e.previewY!,
        width: e.previewWidth!, height: e.previewHeight!
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

export function decodeSvgBase64(svgBase64: string): string {
  return atob(svgBase64);
}

export function extractEntityVisualContent(svgStr: string): string {
  let content = svgStr;
  content = content.replace(/<\?xml[^>]*\?>[\r\n]*/g, '');
  content = content.replace(/<tb:metadata[\s\S]*?<\/tb:metadata>/g, '');
  content = content.replace(/<!--[\s\S]*?-->/g, '');
  content = svgInnerContent(content);
  content = svgInnerContent(content);
  return content.trim();
}

export function buildCompositeSvg(
  entitySvgs: { entityId: string; svgBase64: string }[],
  viewBox: CompositeSvgViewBox
): string {
  const parts: string[] = [];
  for (const { svgBase64 } of entitySvgs) {
    const svgText = atob(svgBase64);
    const content = extractEntityVisualContent(svgText);
    if (content) {
      parts.push(content);
    }
  }
  const vb = `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:tb="https://thingsboard.io/svg" viewBox="${vb}">\n` +
    parts.join('\n') +
    `\n</svg>`;
}

export function unionPreviewBounds(entities: CadImportWidgetEntity[]): CompositeSvgViewBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const e of entities) {
    const px = Number.isFinite(e.previewX) ? e.previewX! : e.x;
    const py = Number.isFinite(e.previewY) ? e.previewY! : e.y;
    const pw = Number.isFinite(e.previewWidth) ? e.previewWidth! : e.width;
    const ph = Number.isFinite(e.previewHeight) ? e.previewHeight! : e.height;
    minX = Math.min(minX, px);
    minY = Math.min(minY, py);
    maxX = Math.max(maxX, px + pw);
    maxY = Math.max(maxY, py + ph);
  }
  if (!isFinite(minX)) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }
  return {
    x: minX,
    y: minY,
    width: Math.max(maxX - minX, 1),
    height: Math.max(maxY - minY, 1)
  };
}

export function buildCompositeImportItems<TWidgetInfo = any>(
  input: BuildCompositeInput<TWidgetInfo>
): BuildCompositeResult<TWidgetInfo> {
  const { entities, deletedEntityIds, entityMappings, groupMappings, previewViewBox } = input;

  const entityById = new Map(entities.map(e => [e.id, e]));

  const groupedEntityIds = new Set<string>();
  for (const group of groupMappings) {
    for (const id of group.entityIds) {
      groupedEntityIds.add(id);
    }
  }

  const unmappedEntities = entities.filter(e =>
    !deletedEntityIds.has(e.id) &&
    !entityMappings.has(e.id) &&
    !groupedEntityIds.has(e.id)
  );

  let unmappedCompositeItem: CadImportWidgetItem<TWidgetInfo> | null = null;
  if (unmappedEntities.length > 0) {
    const entitySvgs = unmappedEntities.map(e => ({ entityId: e.id, svgBase64: e.svgBase64 }));
    const mergedSvg = buildCompositeSvg(entitySvgs, previewViewBox);
    const unionBounds = unionPreviewBounds(unmappedEntities);

    const compositeEntity: CadImportWidgetEntity = {
      id: 'cad-unmapped-composite',
      type: 'UNMAPPED_COMPOSITE',
      svgBase64: btoa(mergedSvg),
      x: unionBounds.x,
      y: unionBounds.y,
      width: unionBounds.width,
      height: unionBounds.height,
      previewX: unionBounds.x,
      previewY: unionBounds.y,
      previewWidth: unionBounds.width,
      previewHeight: unionBounds.height,
      blockName: `Background (${unmappedEntities.length} entities)`
    };

    unmappedCompositeItem = {
      id: 'cad-unmapped-composite',
      entityIds: unmappedEntities.map(e => e.id),
      entity: compositeEntity,
      mapping: null
    };
  }

  const consumedIds = new Set<string>(groupedEntityIds);
  const mappedItems: CadImportWidgetItem<TWidgetInfo>[] = [];

  for (const group of groupMappings) {
    const groupEntities = group.entityIds
      .filter(id => entityById.has(id) && !deletedEntityIds.has(id))
      .map(id => entityById.get(id)!);
    if (groupEntities.length === 0) continue;

    mappedItems.push({
      id: group.id,
      entityIds: groupEntities.map(e => e.id),
      entity: buildGroupEntity(group.id, groupEntities),
      mapping: group.widgetInfo
    });
  }

  for (const entity of entities) {
    if (deletedEntityIds.has(entity.id)) continue;
    if (consumedIds.has(entity.id)) continue;

    const mapping = entityMappings.get(entity.id);
    if (mapping !== undefined) {
      mappedItems.push({
        id: entity.id,
        entityIds: [entity.id],
        entity,
        mapping
      });
      consumedIds.add(entity.id);
    }
  }

  const allItems = unmappedCompositeItem
    ? [unmappedCompositeItem, ...mappedItems]
    : [...mappedItems];

  return { unmappedCompositeItem, mappedItems, allItems };
}
