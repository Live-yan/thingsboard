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

/** Selecting one member of an existing group selects that logical component.
 * Groups must already be disjoint (the planner also validates this invariant).
 */
export function expandCadGroupSelection<T>(selected: ReadonlySet<string>, groups: CadImportGroupMapping<T>[]): Set<string> {
  const result = new Set(selected);
  for (const group of groups) {
    if (group.entityIds.some(id => selected.has(id))) group.entityIds.forEach(id => result.add(id));
  }
  return result;
}

export function combineCadSelection<T>(selected: ReadonlySet<string>, groups: CadImportGroupMapping<T>[],
                                       entityIds: string[], groupId: string): CadImportGroupMapping<T>[] {
  const known = new Set(entityIds);
  if (!groupId || known.has(groupId) || groups.some(group => group.id === groupId)) throw new Error('Invalid group identity.');
  const members = expandCadGroupSelection(selected, groups);
  if ([...members].some(id => !known.has(id))) throw new Error('Unknown CAD instance selected.');
  if (members.size < 2) throw new Error('Select at least two CAD instances to group.');
  return [...groups.filter(group => !group.entityIds.some(id => members.has(id))), {
    id: groupId, entityIds: entityIds.filter(id => members.has(id)), widgetInfo: null
  }];
}

export interface CadImportWarning { type: string; handle: string; reason: string; }

/** Font substitution is not lost geometry: glyphs are already vector paths.
 * Keep the warning visible/saved, but only actual loss/unsupported content gates import.
 */
export function cadImportWarnings(warnings: CadImportWarning[] = []) {
  const seen = new Set<string>();
  const unique = warnings.filter(warning => {
    const key = [warning.type, warning.handle, warning.reason].join('\u0000');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 100);
  return { warnings: unique, needsAcknowledgement: unique.some(warning => warning.type.toUpperCase() !== 'FONT') };
}

export function cadDragMoved(startX: number, startY: number, clientX: number, clientY: number): boolean {
  // CSS pixels, not drawing units: behavior is stable at every zoom level.
  return Math.hypot(clientX - startX, clientY - startY) >= 4;
}
