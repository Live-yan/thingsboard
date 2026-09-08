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

/** Prepare the actual runtime root without dropping SVG viewport/presentation attributes.
 * IDs and fragment references are rewritten exactly: #clip must not corrupt
 * #clip-long or a paint color. Metadata is not renderable geometry.
 */
export function prepareScadaSvgDocument(doc: XMLDocument, suffix: string): SVGSVGElement {
  const root = document.importNode(doc.documentElement, true) as unknown as SVGSVGElement;
  const nodes = [root as Element, ...Array.from(root.querySelectorAll('*'))];
  const ids = new Map<string, string>();
  for (const node of nodes) {
    if (node.localName === 'metadata') { node.remove(); continue; }
    const id = node.getAttribute('id');
    if (id) ids.set(id, id + '_' + suffix);
  }
  const rewriteUrls = (value: string) => value.replace(/url\(\s*(["']?)#([^\s)"']+)\1\s*\)/g,
    (match, _quote: string, id: string) => ids.has(id) ? `url(#${ids.get(id)})` : match);
  for (const node of nodes) {
    for (const attr of Array.from(node.attributes)) {
      if (attr.localName === 'id') attr.value = ids.get(attr.value) || attr.value;
      else if (attr.localName === 'href' && attr.value.startsWith('#')) {
        const mapped = ids.get(attr.value.slice(1));
        if (mapped) attr.value = '#' + mapped;
      } else attr.value = rewriteUrls(attr.value);
    }
    if (node.localName === 'style') {
      const css = rewriteUrls(node.textContent || '');
      // Rewrite selector preludes only, never declaration values such as #fff.
      node.textContent = css.replace(/([^{}]+)\{/g, (match, selector: string) =>
        selector.replace(/#([a-zA-Z_][\w-]*)/g, (token, id: string) => ids.has(id) ? '#' + ids.get(id) : token) + '{');
    }
  }
  return root;
}

export function scadaSvgAspectRatio(root: Element, stretchToFit: boolean): string {
  const cad = root.getAttribute('data-cad-scene') === 'true' || root.getAttribute('data-cad-global-entity') === 'true' || root.getAttribute('data-cad-local-entity') === 'true';
  return cad || !stretchToFit ? 'xMidYMid meet' : 'none';
}
