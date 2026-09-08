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

/** A presentation choice, never a mutation of the uploaded CAD geometry. */
export interface CadBackgroundSettings {
  mode: 'preserve' | 'remove';
  /** Opaque destination canvas used for contrast correction. Not an SVG fill. */
  canvasColor: string;
}

export function cadCanvasColor(source = '#ffffff', settings?: CadBackgroundSettings): string {
  if (settings && settings.mode !== 'preserve' && settings.mode !== 'remove') throw new Error('Invalid CAD background mode.');
  const color = settings?.mode === 'remove' ? settings.canvasColor : source;
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error('Invalid CAD canvas color.');
  return color;
}

type RGB = [number, number, number];
const NAMED: Record<string, string> = {
  white: '#ffffff', black: '#000000', red: '#ff0000', green: '#008000', blue: '#0000ff',
  yellow: '#ffff00', cyan: '#00ffff', aqua: '#00ffff', magenta: '#ff00ff', fuchsia: '#ff00ff',
  gray: '#808080', grey: '#808080', silver: '#c0c0c0', lime: '#00ff00', maroon: '#800000',
  navy: '#000080', olive: '#808000', purple: '#800080', teal: '#008080'
};
const GRAPHICS = new Set(['path', 'line', 'polyline', 'polygon', 'rect', 'circle', 'ellipse', 'text', 'tspan', 'use']);

function rgb(value: string): RGB | null {
  const text = NAMED[value.trim().toLowerCase()] || value.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(text)) return [...text.slice(1)].map(c => parseInt(c + c, 16)) as RGB;
  if (/^#[0-9a-f]{6}$/.test(text)) return [1, 3, 5].map(i => parseInt(text.slice(i, i + 2), 16)) as RGB;
  const match = /^rgb\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*\)$/.exec(text);
  if (match && match.slice(1).every(v => +v >= 0 && +v <= 255)) return match.slice(1).map(Number) as RGB;
  // Keep alpha paints, gradients, none and unknown paints unchanged. In particular,
  // never turn intentional transparent or mask geometry into opaque geometry.
  return null;
}
function luminance(color: RGB): number {
  const c = color.map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
}
function contrast(a: RGB, b: RGB): number {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
function hex(c: RGB): string { return '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join(''); }

/** Only low-contrast solid paints change. Neutral whites/grays become a clear
 * dark/light neutral; vivid colors are shaded/tinted without hue inversion. */
export function cadReadablePaint(paint: string, canvasColor: string): string {
  const target = rgb(cadCanvasColor(canvasColor));
  const color = rgb(paint);
  if (!color || !target || contrast(color, target) >= 3) return paint;
  const black: RGB = [0, 0, 0], white: RGB = [255, 255, 255];
  const end = contrast(black, target) >= contrast(white, target) ? black : white;
  if (Math.max(...color) - Math.min(...color) <= 24) {
    const neutral: RGB = end === black ? [48, 52, 59] : [243, 244, 246];
    return hex(contrast(neutral, target) >= 3 ? neutral : end);
  }
  let low = 0, high = 1;
  const mix = (amount: number) => color.map((v, i) => Math.round(v + (end[i] - v) * amount)) as RGB;
  for (let i = 0; i < 12; i++) {
    const middle = (low + high) / 2;
    if (contrast(mix(middle), target) >= 3) high = middle; else low = middle;
  }
  return hex(mix(high));
}

/** Runs AFTER SVG validation/style isolation, while entity DOM is still detached.
 * It visits each node once, memoizes each paint, and does not change IDs, geometry,
 * opacity, defs, clipping or masks. Only the pipeline's tagged canvas is removable.
 */
export function cadBackgroundTransform(settings?: CadBackgroundSettings): (root: SVGSVGElement) => void {
  if (!settings || settings.mode === 'preserve') return () => {};
  const canvas = cadCanvasColor('#ffffff', settings);
  const cache = new Map<string, string>();
  const adapted = (paint: string) => {
    if (!cache.has(paint)) cache.set(paint, cadReadablePaint(paint, canvas));
    return cache.get(paint)!;
  };
  return root => {
    root.querySelectorAll('[data-cad-background="true"]').forEach(node => node.remove());
    const visit = (node: Element, inherited: Record<string, string>) => {
      if (['defs', 'mask', 'clipPath'].includes(node.localName)) return;
      const element = node as SVGElement;
      const original = { ...inherited };
      for (const key of ['color', 'fill', 'stroke']) {
        const own = element.style.getPropertyValue(key) || node.getAttribute(key);
        if (own && own !== 'inherit') original[key] = own;
      }
      if (GRAPHICS.has(node.localName)) {
        for (const key of ['fill', 'stroke']) {
          const paint = original[key] === 'currentColor' ? original.color : original[key];
          const replacement = adapted(paint);
          if (replacement !== paint) {
            // CSS beats presentation attributes: remove the isolated declaration too.
            element.style.removeProperty(key);
            node.setAttribute(key, replacement);
          }
        }
      }
      Array.from(node.children).forEach(child => visit(child, original));
    };
    visit(root, { color: 'black', fill: 'black', stroke: 'none' });
  };
}
