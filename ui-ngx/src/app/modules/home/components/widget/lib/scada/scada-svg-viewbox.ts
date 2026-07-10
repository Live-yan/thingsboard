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

export interface SvgViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

const trimNumber = (value: number): string => {
  const normalized = Object.is(value, -0) ? 0 : value;
  return Number.isInteger(normalized) ? String(normalized) : String(normalized);
};

export const isFiniteSvgViewBox = (box: SvgViewBox | null | undefined): box is SvgViewBox =>
  !!box &&
  Number.isFinite(box.x) &&
  Number.isFinite(box.y) &&
  Number.isFinite(box.width) &&
  Number.isFinite(box.height) &&
  box.width > 0 &&
  box.height > 0;

export const svgViewBoxAttribute = (box: SvgViewBox): string =>
  `${trimNumber(box.x)} ${trimNumber(box.y)} ${trimNumber(box.width)} ${trimNumber(box.height)}`;
