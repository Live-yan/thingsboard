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

import { CadEntityInfo } from '@shared/models/cad-per-entity.models';
import { WidgetInfo } from '@shared/models/widget.models';
import { CadImportGroupMapping } from './cad-import-widget-generation';

export const CAD_MAPPING_SCHEME_STORAGE_KEY = 'cad-import.mapping-scheme.v1';
export const CAD_MAPPING_SCHEME_VERSION = 1;

export interface CadMappingEntityRule {
  signature: string;
  widgetInfo: WidgetInfo;
}

export interface CadMappingGroupRule {
  signature: string;
  memberSignatures: string[];
  widgetInfo: WidgetInfo;
}

export interface CadMappingScheme {
  version: number;
  name: string;
  updatedAt: number;
  entityRules: CadMappingEntityRule[];
  groupRules: CadMappingGroupRule[];
}

export interface CadMappingSchemeApplication {
  entityMappings: Map<string, WidgetInfo>;
  groupMappings: CadImportGroupMapping<WidgetInfo>[];
}

interface CadEntityBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const numericAttribute = (svg: string, name: string): number | null => {
  const value = svgAttribute(svg, name);
  if (value === null) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const svgAttribute = (svg: string, name: string): string | null => {
  const attribute = new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i').exec(svg)?.[1];
  if (attribute) {
    return attribute.trim();
  }
  return new RegExp(`(?:^|[;\\s])${name}\\s*:\\s*([^;"'}]+)`, 'i').exec(svg)?.[1]?.trim() || null;
};

const decodeSvg = (svgBase64: string): string => {
  if (!svgBase64) {
    return '';
  }
  try {
    return atob(svgBase64);
  } catch {
    return '';
  }
};

const normalizeColor = (value: string | null): string =>
  (value || 'default').trim().toLowerCase().replace(/\s+/g, '');

const normalizeStrokeWidth = (value: string | null): string => {
  const width = value === null ? null : Number(value);
  return width !== null && Number.isFinite(width) ? width.toFixed(2) : 'default';
};

const orientationBucket = (entity: CadEntityInfo, svg: string): string => {
  const line = /<line\b[^>]*>/i.exec(svg)?.[0] || svg;
  const x1 = numericAttribute(line, 'x1');
  const y1 = numericAttribute(line, 'y1');
  const x2 = numericAttribute(line, 'x2');
  const y2 = numericAttribute(line, 'y2');
  const width = Math.max(Math.abs(x2 ?? entity.width), 0.0001);
  const height = Math.max(Math.abs(y2 ?? entity.height), 0.0001);
  const dx = x1 !== null && x2 !== null ? x2 - x1 : entity.width;
  const dy = y1 !== null && y2 !== null ? y2 - y1 : entity.height;
  const angle = Math.atan2(Math.abs(dy), Math.abs(dx || width)) * 180 / Math.PI;
  const fallbackAngle = Math.atan2(Math.abs(entity.height), Math.abs(entity.width || height)) * 180 / Math.PI;
  const normalizedAngle = Number.isFinite(angle) ? angle : fallbackAngle;
  return `angle:${Math.min(90, Math.max(0, Math.round(normalizedAngle / 10) * 10))}`;
};

export const createCadEntitySignature = (entity: CadEntityInfo): string => {
  const svg = decodeSvg(entity.svgBase64);
  return [
    `type:${String(entity.type || 'UNKNOWN').toUpperCase()}`,
    `direction:${orientationBucket(entity, svg)}`,
    `color:${normalizeColor(svgAttribute(svg, 'stroke'))}`,
    `stroke:${normalizeStrokeWidth(svgAttribute(svg, 'stroke-width'))}`
  ].join('|');
};

const entityBounds = (entity: CadEntityInfo): CadEntityBounds => ({
  x: Number.isFinite(entity.previewX) ? entity.previewX! : entity.x,
  y: Number.isFinite(entity.previewY) ? entity.previewY! : entity.y,
  width: Number.isFinite(entity.previewWidth) && entity.previewWidth! > 0 ? entity.previewWidth! : entity.width,
  height: Number.isFinite(entity.previewHeight) && entity.previewHeight! > 0 ? entity.previewHeight! : entity.height
});

const unionBounds = (entities: CadEntityInfo[]): CadEntityBounds => {
  const bounds = entities.map(entityBounds);
  const minX = Math.min(...bounds.map(value => value.x));
  const minY = Math.min(...bounds.map(value => value.y));
  const maxX = Math.max(...bounds.map(value => value.x + value.width));
  const maxY = Math.max(...bounds.map(value => value.y + value.height));
  return { x: minX, y: minY, width: Math.max(maxX - minX, 1), height: Math.max(maxY - minY, 1) };
};

const shapeCategory = (bounds: CadEntityBounds): string => {
  const aspect = bounds.width / Math.max(bounds.height, 1);
  if (aspect >= 0.75 && aspect <= 1.333) {
    return 'near-square';
  }
  return aspect > 1.333 ? 'wide' : 'tall';
};

const sortedSignatures = (signatures: string[]): string[] => [...signatures].sort();

export const createCadGroupSignature = (entities: CadEntityInfo[]): string => {
  const members = sortedSignatures(entities.map(createCadEntitySignature));
  return `members:${members.join('||')}|shape:${shapeCategory(unionBounds(entities))}`;
};

const multisetEqual = (left: string[], right: string[]): boolean => {
  const a = sortedSignatures(left);
  const b = sortedSignatures(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
};

const ruleShape = (signature: string): string | null => /\|shape:([^|]+)$/.exec(signature)?.[1] || null;

const boxesNear = (left: CadEntityBounds, right: CadEntityBounds, threshold: number): boolean => {
  const horizontalGap = Math.max(0, Math.max(left.x, right.x) - Math.min(left.x + left.width, right.x + right.width));
  const verticalGap = Math.max(0, Math.max(left.y, right.y) - Math.min(left.y + left.height, right.y + right.height));
  return horizontalGap <= threshold && verticalGap <= threshold;
};

const connectedComponents = (entities: CadEntityInfo[]): CadEntityInfo[][] => {
  const components: CadEntityInfo[][] = [];
  const visited = new Set<string>();
  entities.forEach((entity, index) => {
    if (visited.has(entity.id)) {
      return;
    }
    const component: CadEntityInfo[] = [];
    const pending = [index];
    visited.add(entity.id);
    while (pending.length) {
      const current = entities[pending.shift()!];
      component.push(current);
      const currentBounds = entityBounds(current);
      const componentBounds = unionBounds(component);
      const threshold = Math.max(1, Math.max(componentBounds.width, componentBounds.height) * 0.02);
      entities.forEach((candidate, candidateIndex) => {
        if (!visited.has(candidate.id) && boxesNear(currentBounds, entityBounds(candidate), threshold)) {
          visited.add(candidate.id);
          pending.push(candidateIndex);
        }
      });
    }
    components.push(component);
  });
  return components;
};

const findMatchingGroupMembers = (
  candidates: CadEntityInfo[],
  requiredSignatures: string[],
  signatures: Map<string, string>,
  expectedShape: string | null
): CadEntityInfo[] | null => {
  const overlapArea = (left: CadEntityBounds, right: CadEntityBounds): number => {
    const width = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
    const height = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
    return width * height;
  };
  const overlapScore = (members: CadEntityInfo[]): number => members.reduce((score, member, index) => {
    for (let otherIndex = index + 1; otherIndex < members.length; otherIndex++) {
      score += overlapArea(entityBounds(member), entityBounds(members[otherIndex]));
    }
    return score;
  }, 0);
  let bestMatch: CadEntityInfo[] | null = null;
  let bestScore = Infinity;
  const search = (start: number, selected: CadEntityInfo[]): CadEntityInfo[] | null => {
    if (selected.length === requiredSignatures.length) {
      const selectedSignatures = selected.map(entity => signatures.get(entity.id)!);
      if (multisetEqual(selectedSignatures, requiredSignatures) &&
        (expectedShape === null || ruleShape(createCadGroupSignature(selected)) === expectedShape)
      ) {
        const score = overlapScore(selected);
        if (score < bestScore) {
          bestScore = score;
          bestMatch = selected;
        }
      }
      return null;
    }
    for (let index = start; index < candidates.length; index++) {
      const candidate = candidates[index];
      const signature = signatures.get(candidate.id)!;
      if (requiredSignatures.includes(signature)) {
        search(index + 1, [...selected, candidate]);
      }
    }
    return null;
  };
  search(0, []);
  return bestMatch;
};

const validWidgetInfo = (value: any): value is WidgetInfo => !!value &&
  typeof value === 'object' && typeof value.title === 'string' &&
  typeof value.typeFullFqn === 'string' && typeof value.type === 'string';

export const loadCadMappingScheme = (value: any): CadMappingScheme | null => {
  if (!value || value.version !== CAD_MAPPING_SCHEME_VERSION ||
      !Array.isArray(value.entityRules) || !Array.isArray(value.groupRules)) {
    return null;
  }
  const entityRules = value.entityRules.filter(rule =>
    typeof rule?.signature === 'string' && validWidgetInfo(rule.widgetInfo)
  );
  const groupRules = value.groupRules.filter(rule =>
    typeof rule?.signature === 'string' && Array.isArray(rule.memberSignatures) &&
    rule.memberSignatures.every(member => typeof member === 'string') && validWidgetInfo(rule.widgetInfo)
  );
  return {
    version: CAD_MAPPING_SCHEME_VERSION,
    name: typeof value.name === 'string' ? value.name : 'CAD mapping scheme',
    updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : 0,
    entityRules,
    groupRules
  };
};

export const applyCadMappingScheme = (
  entities: CadEntityInfo[],
  scheme: CadMappingScheme | null
): CadMappingSchemeApplication => {
  const entityMappings = new Map<string, WidgetInfo>();
  const groupMappings: CadImportGroupMapping<WidgetInfo>[] = [];
  const loaded = loadCadMappingScheme(scheme);
  if (!loaded) {
    return { entityMappings, groupMappings };
  }

  const signatures = new Map(entities.map(entity => [entity.id, createCadEntitySignature(entity)]));
  const order = new Map(entities.map((entity, index) => [entity.id, index]));
  const used = new Set<string>();
  const groupRules = loaded.groupRules
    .map((rule, index) => ({ rule, index }))
    .sort((left, right) => right.rule.memberSignatures.length - left.rule.memberSignatures.length || left.index - right.index);

  groupRules.forEach(({ rule, index }) => {
    const requiredSignatures = sortedSignatures(rule.memberSignatures);
    const candidates = entities.filter(entity => !used.has(entity.id) && requiredSignatures.includes(signatures.get(entity.id)!));
    connectedComponents(candidates).forEach(component => {
      const matchedMembers = findMatchingGroupMembers(
        component,
        requiredSignatures,
        signatures,
        ruleShape(rule.signature)
      );
      if (!matchedMembers) {
        return;
      }
      const signature = createCadGroupSignature(matchedMembers);
      if (signature !== rule.signature && ruleShape(signature) !== ruleShape(rule.signature)) {
        return;
      }
      const entityIds = matchedMembers.map(entity => entity.id)
        .sort((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0));
      entityIds.forEach(id => used.add(id));
      groupMappings.push({
        id: `cad-scheme-group-${index}-${entityIds[0]}`,
        entityIds,
        widgetInfo: rule.widgetInfo
      });
    });
  });

  const entityRules = new Map<string, WidgetInfo>();
  loaded.entityRules.forEach(rule => {
    if (!entityRules.has(rule.signature)) {
      entityRules.set(rule.signature, rule.widgetInfo);
    }
  });
  entities.forEach(entity => {
    if (!used.has(entity.id)) {
      const widgetInfo = entityRules.get(signatures.get(entity.id)!);
      if (widgetInfo) {
        entityMappings.set(entity.id, widgetInfo);
      }
    }
  });
  return { entityMappings, groupMappings };
};

export const createCadMappingScheme = (
  name: string,
  entities: CadEntityInfo[],
  entityMappings: Map<string, WidgetInfo | null>,
  groupMappings: CadImportGroupMapping<WidgetInfo>[]
): CadMappingScheme => {
  const entityById = new Map(entities.map(entity => [entity.id, entity]));
  const entityRules: CadMappingEntityRule[] = [];
  entityMappings.forEach((widgetInfo, entityId) => {
    const entity = entityById.get(entityId);
    if (entity && widgetInfo) {
      entityRules.push({ signature: createCadEntitySignature(entity), widgetInfo });
    }
  });
  const groupRules: CadMappingGroupRule[] = groupMappings.flatMap(group => {
    const groupEntities = group.entityIds.map(id => entityById.get(id)).filter(Boolean) as CadEntityInfo[];
    return groupEntities.length >= 2 ? [{
      signature: createCadGroupSignature(groupEntities),
      memberSignatures: groupEntities.map(createCadEntitySignature),
      widgetInfo: group.widgetInfo
    }] : [];
  });
  return {
    version: CAD_MAPPING_SCHEME_VERSION,
    name: name.trim() || 'CAD mapping scheme',
    updatedAt: Date.now(),
    entityRules,
    groupRules
  };
};
