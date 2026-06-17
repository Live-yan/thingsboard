export interface CadConvertResult {
  blocks: CadBlockInfo[];
  previewSvgBase64: string;
}

export interface CadBlockInfo {
  name: string;
  svgBase64: string;
}
