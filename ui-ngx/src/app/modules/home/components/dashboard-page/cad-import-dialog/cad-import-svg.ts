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

/** Shared SVG scene for the editable preview and the static dashboard background.
 * Entity assets are already positioned by the converter. Never normalize them a
 * second time or paint over a deleted entity's bounding box.
 */
export interface CadSvgBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CadSvgEntity {
  id: string;
  svgBase64: string;
  previewX?: number;
  previewY?: number;
  previewWidth?: number;
  previewHeight?: number;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const GRAPHICS = new Set(['path', 'line', 'polyline', 'polygon', 'rect', 'circle', 'ellipse', 'text', 'tspan', 'use']);
const ELEMENTS = new Set([...GRAPHICS, 'svg', 'g', 'defs', 'style', 'clipPath', 'mask',
  'linearGradient', 'radialGradient', 'stop', 'title', 'desc']);
const PRESENTATION = new Set(['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity',
  'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset',
  'opacity', 'color', 'clip-path', 'clip-rule', 'mask', 'vector-effect', 'paint-order',
  'font-family', 'font-size', 'font-style', 'font-weight', 'text-anchor', 'dominant-baseline',
  'letter-spacing', 'word-spacing', 'visibility', 'display', 'stop-color', 'stop-opacity']);
const ATTRIBUTES = new Set([...PRESENTATION, 'id', 'class', 'style', 'viewBox', 'preserveAspectRatio',
  'x', 'y', 'width', 'height', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'dx', 'dy',
  'd', 'points', 'transform', 'href', 'gradientUnits', 'gradientTransform', 'spreadMethod',
  'fx', 'fy', 'fr', 'offset', 'clipPathUnits', 'maskUnits', 'maskContentUnits', 'pointer-events',
  'version', 'space', 'textLength', 'lengthAdjust']);

export function decodeCadSvg(base64: string): string {
  const binary = atob(base64);
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, char => char.charCodeAt(0)));
}

export function encodeCadSvg(svg: string): string {
  const bytes = new TextEncoder().encode(svg);
  let binary = '';
  // Avoid the argument-count limit of String.fromCharCode(...bytes) on large drawings.
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

export function validateCadSvgBounds(bounds: CadSvgBounds): void {
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) ||
      bounds.width <= 0 || bounds.height <= 0) {
    throw new Error('CAD SVG requires a finite, positive viewBox. Please convert the drawing again.');
  }
}

function viewBoxOf(root: Element): CadSvgBounds {
  const values = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  if (values.length !== 4) {
    throw new Error('CAD entity SVG is missing its viewBox. Please convert the drawing again.');
  }
  const [x, y, width, height] = values;
  const bounds = { x, y, width, height };
  validateCadSvgBounds(bounds);
  return bounds;
}

function safePaintValue(value: string): void {
  // The converter produces static vector graphics only. Do not admit network
  // references, CSS escapes/variables or executable/foreign content into the DOM.
  const withoutFragments = value.replace(/url\(\s*(["']?)#[\w:.-]+\1\s*\)/gi, '');
  if (/url\s*\(|expression\s*\(|var\s*\(|javascript:|[\\@<>]/i.test(withoutFragments)) {
    throw new Error('Unsupported external or dynamic content in CAD SVG.');
  }
}

function readDeclarations(style: CSSStyleDeclaration): Map<string, string> {
  const declarations = new Map<string, string>();
  for (let i = 0; i < style.length; i++) {
    const name = style.item(i);
    if (!PRESENTATION.has(name) || style.getPropertyPriority(name)) {
      throw new Error(`Unsupported CAD SVG style: ${name}`);
    }
    const value = style.getPropertyValue(name);
    safePaintValue(value);
    declarations.set(name, value);
  }
  return declarations;
}

function isolateEntitySvg(source: string, prefix: string): SVGSVGElement {
  const parsed = new DOMParser().parseFromString(source, 'image/svg+xml');
  if (parsed.doctype || parsed.querySelector('parsererror') || parsed.documentElement.localName !== 'svg' ||
      parsed.documentElement.namespaceURI !== SVG_NS) {
    throw new Error('Invalid CAD SVG document. Please convert the drawing again.');
  }
  const root = parsed.documentElement as unknown as SVGSVGElement;
  // SCADA metadata belongs to the resulting resource, not to nested entity assets.
  root.querySelectorAll('*').forEach(node => {
    if (node.localName === 'metadata') node.remove();
  });
  const nodes = [root as Element, ...Array.from(root.querySelectorAll('*'))];
  const rules: { classes: string[]; declarations: Map<string, string> }[] = [];
  for (const node of nodes) {
    if (node.namespaceURI !== SVG_NS || !ELEMENTS.has(node.localName)) {
      throw new Error(`Unsupported CAD SVG element: ${node.localName}`);
    }
    for (const attr of Array.from(node.attributes)) {
      if (attr.namespaceURI === 'http://www.w3.org/2000/xmlns/') continue;
      if (attr.name.startsWith('data-cad-')) continue;
      if (!ATTRIBUTES.has(attr.localName)) throw new Error(`Unsupported CAD SVG attribute: ${attr.name}`);
      if (attr.localName === 'href' && !/^#[\w:.-]+$/.test(attr.value)) {
        throw new Error('External references are not allowed in CAD SVG.');
      }
      if (PRESENTATION.has(attr.localName)) safePaintValue(attr.value);
    }
    if (node.localName === 'style') {
      const css = node.textContent || '';
      if (/[\\@]/.test(css)) throw new Error('Unsupported CAD SVG stylesheet.');
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      for (const rule of Array.from(sheet.cssRules)) {
        if (rule.type !== CSSRule.STYLE_RULE) throw new Error('Unsupported CAD SVG rule.');
        const styleRule = rule as CSSStyleRule;
        const selectors = styleRule.selectorText.split(',').map(selector => selector.trim());
        // ezdxf emits simple class rules. Restrict the grammar instead of letting
        // a drawing stylesheet select other entities or the surrounding page.
        if (!selectors.every(selector => /^\.[a-zA-Z_][\w-]*$/.test(selector))) {
          throw new Error('Unsupported CAD SVG selector.');
        }
        rules.push({ classes: selectors.map(selector => selector.slice(1)), declarations: readDeclarations(styleRule.style) });
      }
    }
  }
  const ids = new Map<string, string>();
  for (const node of nodes) {
    const id = node.getAttribute('id');
    if (id) {
      if (ids.has(id)) throw new Error(`Duplicate CAD SVG id: ${id}`);
      ids.set(id, `${prefix}-${ids.size}`);
    }
  }
  for (const node of nodes) {
    if (node.localName === 'style') {
      node.remove();
      continue;
    }
    const styled = node as SVGElement;
    const inline = readDeclarations(styled.style);
    styled.removeAttribute('style');
    for (const rule of rules) {
      if (rule.classes.some(name => node.classList.contains(name))) {
        rule.declarations.forEach((value, name) => styled.style.setProperty(name, value));
      }
    }
    inline.forEach((value, name) => styled.style.setProperty(name, value));
    node.removeAttribute('class');
    // Only the outer wrapper owns selection identity.
    node.removeAttribute('data-cad-entity-id');
    for (const attr of Array.from(node.attributes)) {
      if (attr.localName === 'id') {
        attr.value = ids.get(attr.value)!;
      } else if (attr.localName === 'href') {
        const target = ids.get(attr.value.slice(1));
        if (!target) throw new Error('Unresolved CAD SVG reference.');
        attr.value = '#' + target;
      } else {
        attr.value = attr.value.replace(/url\(\s*(["']?)#([\w:.-]+)\1\s*\)/gi, (_match, _quote, id) => {
          const target = ids.get(id);
          if (!target) throw new Error('Unresolved CAD SVG reference.');
          return `url(#${target})`;
        });
      }
    }
    if (node.localName === 'svg') node.setAttribute('pointer-events', 'none');
    if (GRAPHICS.has(node.localName)) node.setAttribute('pointer-events', 'visiblePainted');
  }
  return root;
}

export function buildCadSvgScene(entities: CadSvgEntity[], viewBox: CadSvgBounds,
                                 deletedEntityIds: ReadonlySet<string> = new Set()): SVGSVGElement {
  validateCadSvgBounds(viewBox);
  const scene = document.createElementNS(SVG_NS, 'svg');
  scene.setAttribute('viewBox', `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`);
  const seen = new Set<string>();
  const scope = 'cad-' + crypto.getRandomValues(new Uint32Array(4)).join('-');
  entities.forEach((entity, index) => {
    if (deletedEntityIds.has(entity.id)) return;
    if (!entity.id || seen.has(entity.id)) throw new Error('Duplicate or missing CAD entity id.');
    seen.add(entity.id);
    if (!entity.svgBase64) throw new Error(`Missing SVG for CAD entity ${entity.id}.`);
    const svg = isolateEntitySvg(decodeCadSvg(entity.svgBase64), `${scope}-${index}`);
    const local = viewBoxOf(svg);
    const target = svg.getAttribute('data-cad-global-entity') === 'true' ? local : {
      x: entity.previewX!, y: entity.previewY!, width: entity.previewWidth!, height: entity.previewHeight!
    };
    validateCadSvgBounds(target);
    svg.setAttribute('x', String(target.x));
    svg.setAttribute('y', String(target.y));
    svg.setAttribute('width', String(target.width));
    svg.setAttribute('height', String(target.height));
    const group = document.createElementNS(SVG_NS, 'g');
    group.setAttribute('data-cad-entity-id', entity.id);
    group.appendChild(document.importNode(svg, true));
    scene.appendChild(group);
  });
  return scene;
}

export function buildCadSvgBase64(entities: CadSvgEntity[], viewBox: CadSvgBounds): string {
  return encodeCadSvg(new XMLSerializer().serializeToString(buildCadSvgScene(entities, viewBox)));
}
