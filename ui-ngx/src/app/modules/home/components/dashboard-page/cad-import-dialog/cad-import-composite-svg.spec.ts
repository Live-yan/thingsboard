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

import assert from 'node:assert/strict';
import {
  CadImportWidgetEntity,
  CadImportGroupMapping,
} from './cad-import-widget-generation';
import {
  BuildCompositeInput,
  CompositeSvgViewBox,
  BuildCompositeResult,
  decodeSvgBase64,
  extractEntityVisualContent,
  buildCompositeSvg,
  unionPreviewBounds,
  buildCompositeImportItems,
} from './cad-import-composite-svg';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toBase64(str: string): string {
  return Buffer.from(str, 'utf-8').toString('base64');
}

function buildEntitySvg(params: {
  entityId: string;
  layoutX: number;
  layoutY: number;
  layoutW: number;
  layoutH: number;
  visualX: number;
  visualY: number;
  visualW: number;
  visualH: number;
  content: string;
}): string {
  const { entityId, layoutX, layoutY, layoutW, layoutH, visualX, visualY, visualW, visualH, content } = params;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:tb="https://thingsboard.io/svg" viewBox="0 0 ${layoutW} ${layoutH}" width="${layoutW}" height="${layoutH}">` +
    `<tb:metadata><![CDATA[{"title":"${entityId}","width":${layoutW},"height":${layoutH}}]]></tb:metadata>` +
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${layoutX} ${layoutY} ${layoutW} ${layoutH}" width="${layoutW}" height="${layoutH}" data-cad-global-entity="true" data-cad-entity-id="${entityId}">` +
    `<svg x="${visualX}" y="${visualY}" width="${visualW}" height="${visualH}" viewBox="0 0 ${visualW} ${visualH}" preserveAspectRatio="none">` +
    `${content}` +
    `</svg>` +
    `</svg>` +
    `</svg>`;
}

function makeEntity(id: string, previewX: number, previewY: number, previewW: number, previewH: number,
                    layoutX: number, layoutY: number, layoutW: number, layoutH: number,
                    visualX: number, visualY: number, visualW: number, visualH: number,
                    content: string): CadImportWidgetEntity {
  return {
    id,
    type: 'LINE',
    svgBase64: toBase64(buildEntitySvg({
      entityId: id,
      layoutX, layoutY, layoutW, layoutH,
      visualX, visualY, visualW, visualH,
      content
    })),
    x: layoutX,
    y: layoutY,
    width: layoutW,
    height: layoutH,
    previewX,
    previewY,
    previewWidth: previewW,
    previewHeight: previewH,
    blockName: `Entity ${id}`,
  };
}

type WidgetInfo = { title: string; type?: string };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// --- decodeSvgBase64 ---

const decoded = decodeSvgBase64(toBase64('<svg viewBox="0 0 100 200"></svg>'));
assert.equal(decoded, '<svg viewBox="0 0 100 200"></svg>');

// --- extractEntityVisualContent ---

const entitySvgFull = buildEntitySvg({
  entityId: 'ent_1',
  layoutX: 0, layoutY: 0, layoutW: 100, layoutH: 100,
  visualX: 10, visualY: 20, visualW: 30, visualH: 40,
  content: '<line x1="0" y1="0" x2="30" y2="40" stroke="red" stroke-width="2" vector-effect="non-scaling-stroke"/>'
});

const extracted = extractEntityVisualContent(entitySvgFull);
assert.ok(extracted.includes('<svg x="10" y="20"'), 'extracted inner <svg> with x/y');
assert.ok(extracted.includes('stroke="red"'), 'preserved visual content');
assert.ok(extracted.includes('</svg>'), 'extracted has closing tag');
assert.ok(!extracted.includes('<tb:metadata'), 'metadata stripped');
assert.ok(!extracted.includes('data-cad-global-entity'), 'global-entity wrapper stripped');

// --- buildCompositeSvg ---

const entity1Content = '<line x1="0" y1="0" x2="50" y2="50" stroke="red" stroke-width="2" vector-effect="non-scaling-stroke"/>';
const entity2Content = '<circle cx="20" cy="20" r="15" stroke="blue" stroke-width="1" fill="none"/>';

const entitySvg1 = buildEntitySvg({
  entityId: 'e1', layoutX: 0, layoutY: 0, layoutW: 100, layoutH: 100,
  visualX: 10, visualY: 20, visualW: 50, visualH: 50, content: entity1Content
});
const entitySvg2 = buildEntitySvg({
  entityId: 'e2', layoutX: 0, layoutY: 0, layoutW: 80, layoutH: 80,
  visualX: 100, visualY: 200, visualW: 60, visualH: 60, content: entity2Content
});

const compositeSvg = buildCompositeSvg([
  { entityId: 'e1', svgBase64: toBase64(entitySvg1) },
  { entityId: 'e2', svgBase64: toBase64(entitySvg2) },
], { x: 0, y: 0, width: 500, height: 400 });

// test: merged SVG has exactly one root <svg> at the start, no SCADA wrapper duplication
assert.ok(compositeSvg.indexOf('<svg') === 0, 'composite starts with root <svg>');
// one xmlns:tb (root only — per-entity SCADA wrappers stripped)
const xmlnsCount = (compositeSvg.match(/xmlns:tb=/g) || []).length;
assert.equal(xmlnsCount, 1, `exactly one xmlns:tb (root only), got ${xmlnsCount}`);

// test: root viewBox matches provided full preview viewBox
assert.ok(compositeSvg.includes('viewBox="0 0 500 400"'), 'root viewBox matches preview viewBox');

// test: merged SVG has only one <tb:metadata> (zero, since we don't add metadata in buildCompositeSvg)
const metadataCount = (compositeSvg.match(/<tb:metadata/g) || []).length;
assert.equal(metadataCount, 0, `expected 0 <tb:metadata>, got ${metadataCount}`);

// test: preserves vector-effect="non-scaling-stroke"
assert.ok(compositeSvg.includes('vector-effect="non-scaling-stroke"'), 'preserves vector-effect');

// test: preserves color and stroke-width
assert.ok(compositeSvg.includes('stroke="red"'), 'preserves stroke color');
assert.ok(compositeSvg.includes('stroke-width="2"'), 'preserves stroke-width');

// test: child entities keep original global preview coordinates
assert.ok(compositeSvg.includes('x="10"') || compositeSvg.includes('x="10 "'), 'entity 1 visual x');
assert.ok(compositeSvg.includes('y="20"') || compositeSvg.includes('y="20 "'), 'entity 1 visual y');
assert.ok(compositeSvg.includes('x="100"') || compositeSvg.includes('x="100 "'), 'entity 2 visual x');
assert.ok(compositeSvg.includes('y="200"') || compositeSvg.includes('y="200 "'), 'entity 2 visual y');

// --- unionPreviewBounds ---

const unioned = unionPreviewBounds([
  { id: 'a', type: 'LINE', svgBase64: '', x: 0, y: 0, width: 10, height: 10, previewX: 100, previewY: 200, previewWidth: 30, previewHeight: 20 },
  { id: 'b', type: 'CIRCLE', svgBase64: '', x: 0, y: 0, width: 10, height: 10, previewX: 150, previewY: 180, previewWidth: 50, previewHeight: 60 },
]);
assert.deepEqual(unioned, { x: 100, y: 180, width: 100, height: 60 });

// empty entities returns default bounds
const emptyUnion = unionPreviewBounds([]);
assert.equal(emptyUnion.width >= 1, true);
assert.equal(emptyUnion.height >= 1, true);

// --- buildCompositeImportItems ---

// Shortcut to build input
function buildInput(overrides: Partial<BuildCompositeInput<WidgetInfo>> = {}): BuildCompositeInput<WidgetInfo> {
  return {
    entities: [],
    deletedEntityIds: new Set<string>(),
    entityMappings: new Map<string, WidgetInfo | null>(),
    groupMappings: [],
    previewViewBox: { x: 0, y: 0, width: 500, height: 400 },
    ...overrides,
  };
}

// test: empty entity list produces empty composite
{
  const result = buildCompositeImportItems(buildInput({ entities: [] }));
  assert.equal(result.unmappedCompositeItem, null, 'empty entities → null unmapped composite');
  assert.equal(result.mappedItems.length, 0, 'empty entities → no mapped items');
  assert.equal(result.allItems.length, 0, 'empty entities → no items');
}

// test: all entities mapped produces no unmapped composite
{
  const e1 = makeEntity('e1', 10, 20, 30, 40, 10, 20, 30, 40, 10, 20, 30, 40,
    '<line x1="0" y1="0" x2="30" y2="40" stroke="red" stroke-width="2"/>');
  const result = buildCompositeImportItems(buildInput({
    entities: [e1],
    entityMappings: new Map([['e1', { title: 'Widget A' }]]),
  }));
  assert.equal(result.unmappedCompositeItem, null, 'all mapped → no unmapped composite');
  assert.equal(result.mappedItems.length, 1, '1 mapped item');
  assert.equal(result.mappedItems[0].entity.id, 'e1');
  assert.equal(result.allItems.length, 1);
}

// test: 763 unmapped entities produce 1 composite item
{
  const entities: CadImportWidgetEntity[] = [];
  for (let i = 0; i < 763; i++) {
    entities.push(makeEntity(`e${i}`, i * 10, 0, 9, 9, i * 10, 0, 9, 9, i * 10, 0, 9, 9,
      `<rect x="0" y="0" width="9" height="9" stroke="black" stroke-width="1"/>`));
  }
  const result = buildCompositeImportItems(buildInput({ entities }));
  assert.notEqual(result.unmappedCompositeItem, null, '763 entities → has unmapped composite');
  assert.equal(result.unmappedCompositeItem!.id, 'cad-unmapped-composite');
  assert.equal(result.unmappedCompositeItem!.entityIds.length, 763, '763 entity IDs in composite');
  assert.equal(result.unmappedCompositeItem!.entity.type, 'UNMAPPED_COMPOSITE');
  assert.equal(result.mappedItems.length, 0, 'no mapped items');
  assert.equal(result.allItems.length, 1, 'exactly 1 item total');
}

// test: mapped entities NOT in unmapped composite
{
  const e1 = makeEntity('e1', 10, 20, 30, 40, 10, 20, 30, 40, 10, 20, 30, 40,
    '<line x1="0" y1="0" x2="30" y2="40" stroke="red" stroke-width="2"/>');
  const e2 = makeEntity('e2', 50, 60, 70, 80, 50, 60, 70, 80, 50, 60, 70, 80,
    '<circle cx="35" cy="40" r="30" stroke="blue" stroke-width="1"/>');
  const e3 = makeEntity('e3', 100, 110, 30, 30, 100, 110, 30, 30, 100, 110, 30, 30,
    '<rect x="0" y="0" width="30" height="30" stroke="green" stroke-width="1"/>');
  const result = buildCompositeImportItems(buildInput({
    entities: [e1, e2, e3],
    entityMappings: new Map([['e2', { title: 'Widget B' }]]),
  }));
  assert.notEqual(result.unmappedCompositeItem, null);
  assert.equal(result.unmappedCompositeItem!.entityIds.length, 2, '2 unmapped: e1 + e3');
  assert.ok(result.unmappedCompositeItem!.entityIds.includes('e1'));
  assert.ok(result.unmappedCompositeItem!.entityIds.includes('e3'));
  assert.ok(!result.unmappedCompositeItem!.entityIds.includes('e2'), 'e2 is mapped, not in composite');
  assert.equal(result.mappedItems.length, 1);
  assert.equal(result.mappedItems[0].entity.id, 'e2');
  assert.equal(result.allItems.length, 2);
}

// test: group mapping members NOT in unmapped composite
{
  const e1 = makeEntity('g1-e1', 0, 0, 10, 10, 0, 0, 10, 10, 0, 0, 10, 10,
    '<line x1="0" y1="0" x2="10" y2="10" stroke="red" stroke-width="2"/>');
  const e2 = makeEntity('g1-e2', 20, 0, 10, 10, 20, 0, 10, 10, 20, 0, 10, 10,
    '<line x1="0" y1="0" x2="10" y2="10" stroke="blue" stroke-width="2"/>');
  const e3 = makeEntity('g1-e3', 50, 0, 10, 10, 50, 0, 10, 10, 50, 0, 10, 10,
    '<line x1="0" y1="0" x2="10" y2="10" stroke="green" stroke-width="2"/>');
  const result = buildCompositeImportItems(buildInput({
    entities: [e1, e2, e3],
    groupMappings: [{
      id: 'cad-group-1',
      entityIds: ['g1-e1', 'g1-e2'],
      widgetInfo: { title: 'Group Widget' },
    }],
  }));
  assert.notEqual(result.unmappedCompositeItem, null);
  assert.equal(result.unmappedCompositeItem!.entityIds.length, 1, 'only g1-e3 unmapped');
  assert.ok(result.unmappedCompositeItem!.entityIds.includes('g1-e3'));
  assert.ok(!result.unmappedCompositeItem!.entityIds.includes('g1-e1'), 'g1-e1 in group, not unmapped');
  assert.ok(!result.unmappedCompositeItem!.entityIds.includes('g1-e2'), 'g1-e2 in group, not unmapped');
  assert.equal(result.mappedItems.length, 1, '1 group mapped item');
  assert.equal(result.mappedItems[0].id, 'cad-group-1');
  assert.equal(result.mappedItems[0].entityIds.length, 2);
  assert.equal(result.allItems.length, 2);
}

// test: deleted entities NOT in any output
{
  const e1 = makeEntity('del-e1', 0, 0, 10, 10, 0, 0, 10, 10, 0, 0, 10, 10,
    '<line x1="0" y1="0" x2="10" y2="10" stroke="red" stroke-width="1"/>');
  const e2 = makeEntity('del-e2', 20, 0, 10, 10, 20, 0, 10, 10, 20, 0, 10, 10,
    '<line x1="0" y1="0" x2="10" y2="10" stroke="blue" stroke-width="1"/>');
  const result = buildCompositeImportItems(buildInput({
    entities: [e1, e2],
    deletedEntityIds: new Set(['del-e1']),
  }));
  assert.notEqual(result.unmappedCompositeItem, null, 'one kept entity → composite exists');
  assert.ok(!result.unmappedCompositeItem!.entityIds.includes('del-e1'), 'deleted entity excluded from composite');
  assert.ok(result.unmappedCompositeItem!.entityIds.includes('del-e2'), 'kept entity included');
  // verify deleted not in mapped items either
  const allEntityIds = result.allItems.flatMap(item => item.entityIds);
  assert.ok(!allEntityIds.includes('del-e1'), 'deleted entity nowhere in output');
}

// test: same entity never appears twice
{
  const entities: CadImportWidgetEntity[] = [];
  for (let i = 0; i < 50; i++) {
    entities.push(makeEntity(`dup-${i}`, i * 10, 0, 9, 9, i * 10, 0, 9, 9, i * 10, 0, 9, 9,
      `<rect x="0" y="0" width="9" height="9" fill="none" stroke="gray"/>`));
  }
  const mappedIds = new Set(['dup-5', 'dup-15', 'dup-25']);
  const groupIds = new Set(['dup-10', 'dup-11', 'dup-12']);
  const result = buildCompositeImportItems(buildInput({
    entities,
    entityMappings: new Map([...mappedIds].map(id => [id, { title: `W-${id}` }])),
    groupMappings: [{
      id: 'cad-dup-group',
      entityIds: [...groupIds],
      widgetInfo: { title: 'Dup Group' },
    }],
  }));

  const allEntityIds: string[] = [];
  for (const item of result.allItems) {
    for (const eid of item.entityIds) {
      allEntityIds.push(eid);
    }
  }
  const idSet = new Set(allEntityIds);
  assert.equal(allEntityIds.length, idSet.size, `no duplicates: ${allEntityIds.length} occurrences, ${idSet.size} unique`);

  // mapped entities not in composite
  if (result.unmappedCompositeItem) {
    for (const mid of mappedIds) {
      assert.ok(!result.unmappedCompositeItem.entityIds.includes(mid), `mapped ${mid} not in unmapped composite`);
    }
  }
}

// test: short lines and degenerate bbox don't disappear
{
  const tiny = makeEntity('tiny', 0, 0, 0.01, 0.01, 0, 0, 0.01, 0.01, 0, 0, 0.01, 0.01,
    '<line x1="0" y1="0" x2="0.01" y2="0.01" stroke="black" stroke-width="0.5"/>');
  const result = buildCompositeImportItems(buildInput({ entities: [tiny] }));
  assert.notEqual(result.unmappedCompositeItem, null, 'tiny entity included');
  assert.equal(result.unmappedCompositeItem!.entityIds.length, 1);
  assert.ok(result.unmappedCompositeItem!.entity.svgBase64.length > 0, 'composite has SVG content');
}

// test: mixed mapped, group, unmapped, and deleted
{
  const e1 = makeEntity('mix-e1', 0, 0, 20, 20, 0, 0, 20, 20, 0, 0, 20, 20,
    '<rect x="0" y="0" width="20" height="20" stroke="red" stroke-width="2"/>');
  const e2 = makeEntity('mix-e2', 30, 0, 20, 20, 30, 0, 20, 20, 30, 0, 20, 20,
    '<rect x="0" y="0" width="20" height="20" stroke="blue" stroke-width="2"/>');
  const e3 = makeEntity('mix-e3', 60, 0, 20, 20, 60, 0, 20, 20, 60, 0, 20, 20,
    '<rect x="0" y="0" width="20" height="20" stroke="green" stroke-width="2"/>');
  const e4 = makeEntity('mix-e4', 90, 0, 20, 20, 90, 0, 20, 20, 90, 0, 20, 20,
    '<rect x="0" y="0" width="20" height="20" stroke="yellow" stroke-width="2"/>');
  const e5 = makeEntity('mix-e5', 120, 0, 20, 20, 120, 0, 20, 20, 120, 0, 20, 20,
    '<rect x="0" y="0" width="20" height="20" stroke="purple" stroke-width="2"/>');

  const result = buildCompositeImportItems(buildInput({
    entities: [e1, e2, e3, e4, e5],
    deletedEntityIds: new Set(['mix-e2']),
    entityMappings: new Map([['mix-e3', { title: 'Solo Widget' }]]),
    groupMappings: [{
      id: 'mix-group',
      entityIds: ['mix-e4', 'mix-e5'],
      widgetInfo: { title: 'Group Widget' },
    }],
  }));

  // unmapped: e1 only (e2 deleted, e3 mapped, e4+e5 in group)
  assert.notEqual(result.unmappedCompositeItem, null);
  assert.deepEqual([...result.unmappedCompositeItem!.entityIds].sort(), ['mix-e1']);

  // mapped: e3 + group(e4,e5)
  assert.equal(result.mappedItems.length, 2);
  const mappedIds = result.mappedItems.map(i => i.id);
  assert.ok(mappedIds.includes('mix-e3'));
  assert.ok(mappedIds.includes('mix-group'));

  // all items: composite + 2 mapped
  assert.equal(result.allItems.length, 3);

  // deleted nowhere
  const allIds = result.allItems.flatMap(i => i.entityIds);
  assert.ok(!allIds.includes('mix-e2'), 'deleted e2 nowhere');
}

// test: composite svg is valid base64 and decodes
{
  const e1 = makeEntity('svg-e1', 0, 0, 100, 100, 0, 0, 100, 100, 0, 0, 100, 100,
    '<line x1="0" y1="0" x2="100" y2="100" stroke="red" stroke-width="2" vector-effect="non-scaling-stroke"/>');
  const result = buildCompositeImportItems(buildInput({ entities: [e1] }));
  assert.notEqual(result.unmappedCompositeItem, null);
  const decodedSvg = decodeSvgBase64(result.unmappedCompositeItem!.entity.svgBase64);
  assert.ok(decodedSvg.startsWith('<svg'), 'decoded content starts with <svg');
  assert.ok(decodedSvg.includes('stroke="red"'), 'decoded preserves visual content');
  assert.equal(decodedSvg.match(/<svg/g)?.length ?? 0, 2, 'composite has root + visual <svg>');
}

// test: composite entity has correct bounds
{
  const e1 = makeEntity('bound-e1', 100, 50, 200, 150, 100, 50, 200, 150, 100, 50, 200, 150,
    '<rect x="0" y="0" width="200" height="150" stroke="red" stroke-width="1"/>');
  const e2 = makeEntity('bound-e2', 350, 100, 80, 60, 350, 100, 80, 60, 350, 100, 80, 60,
    '<circle cx="40" cy="30" r="25" stroke="blue" stroke-width="1"/>');
  const result = buildCompositeImportItems(buildInput({ entities: [e1, e2] }));
  assert.notEqual(result.unmappedCompositeItem, null);
  assert.equal(result.unmappedCompositeItem!.entity.x, 100);
  assert.equal(result.unmappedCompositeItem!.entity.y, 50);
  assert.equal(result.unmappedCompositeItem!.entity.width, 330); // 350+80-100
  assert.equal(result.unmappedCompositeItem!.entity.height, 150);
}

// test: group mapped entity that overlaps with individual mapping is still excluded from unmapped
{
  const e1 = makeEntity('overlap-e1', 0, 0, 10, 10, 0, 0, 10, 10, 0, 0, 10, 10,
    '<rect x="0" y="0" width="10" height="10" stroke="red" stroke-width="1"/>');
  const e2 = makeEntity('overlap-e2', 20, 0, 10, 10, 20, 0, 10, 10, 20, 0, 10, 10,
    '<rect x="0" y="0" width="10" height="10" stroke="blue" stroke-width="1"/>');
  const result = buildCompositeImportItems(buildInput({
    entities: [e1, e2],
    entityMappings: new Map([['overlap-e1', { title: 'Individual' }]]),
    groupMappings: [{
      id: 'overlap-group',
      entityIds: ['overlap-e1', 'overlap-e2'],
      widgetInfo: { title: 'Group' },
    }],
  }));
  // Group takes precedence: e1 and e2 are both in group, so no unmapped entities remain
  assert.equal(result.unmappedCompositeItem, null, 'no unmapped entities when all are in a group');
}
