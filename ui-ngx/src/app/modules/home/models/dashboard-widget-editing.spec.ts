import assert from 'node:assert/strict';
import {
  CAD_IMPORT_RESIZE_SUPPRESSION_MAX_SIZE,
  dashboardWidgetResizePolicy,
  isSmallCadImportWidget
} from './dashboard-widget-editing';

const ordinaryWidget = { config: {} } as any;
const cadWidget = { config: { cadImport: true } } as any;

assert.equal(CAD_IMPORT_RESIZE_SUPPRESSION_MAX_SIZE, 24);
assert.equal(isSmallCadImportWidget(cadWidget, { sizeX: 24, sizeY: 24 }), true);
assert.equal(isSmallCadImportWidget(cadWidget, { sizeX: 25, sizeY: 24 }), false);
assert.equal(isSmallCadImportWidget(ordinaryWidget, { sizeX: 10, sizeY: 10 }), false);

assert.deepEqual(
  dashboardWidgetResizePolicy(cadWidget, { sizeX: 10, sizeY: 10, preserveAspectRatio: true }),
  {
    resizeEnabled: false,
    resizableHandles: { n: false, e: false, s: false, w: false, ne: false, se: false, sw: false, nw: false }
  }
);

const preservedPolicy = dashboardWidgetResizePolicy(ordinaryWidget, {
  sizeX: 100,
  sizeY: 100,
  preserveAspectRatio: true
});
assert.equal(preservedPolicy.resizeEnabled, true);
assert.deepEqual(preservedPolicy.resizableHandles, {
  n: true,
  e: true,
  s: true,
  w: true,
  ne: false,
  se: true,
  sw: false,
  nw: false
});

assert.deepEqual(
  dashboardWidgetResizePolicy(ordinaryWidget, { sizeX: 100, sizeY: 100, preserveAspectRatio: false }).resizableHandles,
  { n: true, e: true, s: true, w: true, ne: true, se: true, sw: true, nw: true }
);
