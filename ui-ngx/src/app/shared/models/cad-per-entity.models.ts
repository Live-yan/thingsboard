export interface CadPerEntityResult {
  previewSvgBase64: string;
  manifest: CadEntityInfo[];
  modelspaceBounds?: { minX: number; maxX: number; minY: number; maxY: number };
  previewTransform?: PreviewTransform;
}

export interface PreviewTransform {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  translateX: number;
  translateY: number;
  yFlip: boolean;
}

export interface CadEntityInfo {
  id: string;
  type: 'LINE' | 'CIRCLE' | 'ARC' | 'ELLIPSE' | 'SPLINE' | 'LWPOLYLINE' | 'POLYLINE' | 'TEXT' | 'MTEXT' | 'INSERT' | string;
  svgBase64: string;
  x: number;
  y: number;
  width: number;
  height: number;
  blockName?: string | null;
  previewX?: number;
  previewY?: number;
  previewWidth?: number;
  previewHeight?: number;
}
