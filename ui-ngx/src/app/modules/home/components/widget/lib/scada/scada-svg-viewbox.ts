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
