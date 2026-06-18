export interface CadPerEntityResult {
  previewSvgBase64: string;
  manifest: CadEntityInfo[];
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
}
