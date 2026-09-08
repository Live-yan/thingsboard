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

import type { CadImportGroupMapping } from './cad-import-widget-generation';

export interface CadComponentSnapshot {
  version: 1;
  sceneId: string;
  mode: 'components' | 'background';
  groups: { id: string; entityIds: string[] }[];
}

/** Groups are disjoint top-level editing units; selecting any member selects
 * its complete group. CAD block definitions / nested geometry are never edited.
 */
export function expandCadGroupSelection<T>(selected: Iterable<string>, groups: CadImportGroupMapping<T>[]): Set<string> {
  const ids = new Set(selected);
  for (const group of groups) {
    if (group.entityIds.some(id => ids.has(id))) group.entityIds.forEach(id => ids.add(id));
  }
  return ids;
}

export function combineCadSelection<T>(knownIds: string[], groups: CadImportGroupMapping<T>[], selected: Iterable<string>, id: string) {
  const known = new Set(knownIds);
  const ids = expandCadGroupSelection(selected, groups);
  if (!id || known.has(id) || groups.some(group => group.id === id)) throw new Error('Invalid CAD group identity');
  if (ids.size < 2 || [...ids].some(member => !known.has(member))) throw new Error('Select at least two retained CAD instances');
  const entityIds = knownIds.filter(member => ids.has(member));
  const next = groups.filter(group => !group.entityIds.some(member => ids.has(member)));
  // Geometry grouping does not require a widget picker or device binding.
  next.push({ id, entityIds, widgetInfo: null });
  return { groups: next, selected: new Set(entityIds) };
}

export function cadComponentSnapshot<T>(sceneId: string, groups: CadImportGroupMapping<T>[], mode: 'components' | 'background'): CadComponentSnapshot {
  return { version: 1, sceneId, mode, groups: groups.map(group => ({ id: group.id, entityIds: [...group.entityIds] })) };
}

export function restoreCadComponentSnapshot(raw: unknown, sceneId: string, knownIds: string[]): CadComponentSnapshot {
  const value = raw as CadComponentSnapshot;
  if (!value || value.version !== 1 || !sceneId || value.sceneId !== sceneId ||
      !['components', 'background'].includes(value.mode) || !Array.isArray(value.groups) || value.groups.length > knownIds.length) {
    throw new Error('Invalid CAD component snapshot or source mismatch');
  }
  const known = new Set(knownIds), members = new Set<string>(), ids = new Set<string>();
  const groups = value.groups.map(group => {
    if (!group || typeof group.id !== 'string' || !group.id || known.has(group.id) || ids.has(group.id) ||
        !Array.isArray(group.entityIds) || group.entityIds.length < 2 || group.entityIds.length > known.size) {
      throw new Error('Invalid saved CAD group');
    }
    ids.add(group.id);
    for (const member of group.entityIds) {
      if (!known.has(member) || members.has(member)) throw new Error('Unknown or overlapping saved CAD group members');
      members.add(member);
    }
    return { id: group.id, entityIds: [...group.entityIds] };
  });
  return { version: 1, sceneId, mode: value.mode, groups };
}
