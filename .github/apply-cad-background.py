"""One-time, source-hash-guarded integration of the reviewed CAD background patch.
Removed after applying; the final PR contains ordinary source edits, not this script.
"""
from pathlib import Path
import subprocess
D = Path('ui-ngx/src/app/modules/home/components/dashboard-page/cad-import-dialog')
expected = {
    'tests/cad/conftest.py': 'c71c337b0a6b21377d256b32a41bfe84d8bd87da',
    str(D/'cad-import-dialog.component.html'): '09392a6e912b000176ed529ec3fbe09efb4062a6',
    str(D/'cad-import-dialog.component.scss'): 'ba2e14c820b98fcba1b47d1d2454a6fe80cab713',
    str(D/'cad-import-dialog.component.ts'): '3ec868267e72e20ef0abf06c08826d43254d8a44',
    str(D/'cad-import-svg.ts'): 'c68c27aa891bfa6f04e647b0cc17cfe80eb96cd6',
    str(D/'cad-import-widget-generation.ts'): '67fc3ff5d57379f8425ddb0a28ebc6ecf73a8d34'
}
for path, sha in expected.items():
    assert subprocess.check_output(['git','hash-object',path],text=True).strip() == sha, path
p=D/'cad-import-svg.ts';s=p.read_text();pos=s.index('/** Shared')
s=s[:pos]+"import { CadBackgroundSettings, cadBackgroundTransform, cadCanvasColor } from './cad-import-background';\n\n"+s[pos:]
s=s.replace('  backgroundColor?: string;','  backgroundColor?: string;\n  background?: CadBackgroundSettings;')
s=s.replace('function* sceneGroups(entities: CadSvgEntity[], deleted: ReadonlySet<string>)','function* sceneGroups(entities: CadSvgEntity[], deleted: ReadonlySet<string>, options: CadSvgBuildOptions)')
s=s.replace('  const seen = new Set<string>();\n  const scope','  const transform = cadBackgroundTransform(options.background);\n  const seen = new Set<string>();\n  const scope')
s=s.replace('    const local = viewBoxOf(svg);','    transform(svg);\n    const local = viewBoxOf(svg);')
s=s.replace('  if (options.backgroundColor) {',"  cadCanvasColor(options.backgroundColor || '#ffffff', options.background);\n  if (options.backgroundColor && options.background?.mode !== 'remove') {")
s=s.replace('sceneGroups(entities, deletedEntityIds)','sceneGroups(entities, deletedEntityIds, options)');p.write_text(s)
p=D/'cad-import-widget-generation.ts';s=p.read_text();pos=s.index('import {')
s=s[:pos]+"import type { CadBackgroundSettings } from './cad-import-background';\n"+s[pos:]
s=s.replace('  backgroundColor?: string;','  backgroundColor?: string;\n  background?: CadBackgroundSettings;')
s=s.replace('{ backgroundColor: item.id === UNMAPPED_COMPOSITE_ID ? input.backgroundColor : undefined }','{ background: input.background, backgroundColor: item.id === UNMAPPED_COMPOSITE_ID ? input.backgroundColor : undefined }')
s=s.replace('{ signal: options.signal, backgroundColor: item.id === UNMAPPED_COMPOSITE_ID ? input.backgroundColor : undefined }','{ signal: options.signal, background: input.background, backgroundColor: item.id === UNMAPPED_COMPOSITE_ID ? input.backgroundColor : undefined }');p.write_text(s)
p=D/'cad-import-dialog.component.ts';s=p.read_text()
s=s.replace('import { buildCadSvgSceneAsync, decodeCadSvg }','import { buildCadSvgScene, buildCadSvgSceneAsync, decodeCadSvg }')
s=s.replace('import { cadImportWarnings,',"import { CadBackgroundSettings, cadCanvasColor } from './cad-import-background';\nimport { cadImportWarnings,")
pos=s.index('  mergeStaticBackground = false;')
s=s[:pos]+'''  backgroundMode: 'preserve' | 'remove' = 'preserve';
  targetCanvasColor = '#ffffff';
  get backgroundSettings(): CadBackgroundSettings {
    return { mode: this.backgroundMode, canvasColor: this.targetCanvasColor };
  }
  get canvasColor(): string {
    return cadCanvasColor(this.result?.backgroundColor || '#ffffff', this.backgroundSettings);
  }
  get backgroundLabels() {
    return this.translate.currentLang?.startsWith('zh') ? {
      title: 'CAD 背景', preserve: '保留背景与原色', remove: '去除 CAD 背景（自动适配颜色）',
      target: '目标画布颜色', hint: '去除的是 CAD 画布底色，不删除实体。低对比白线、文字等会适配目标画布；原图数据不变。'
    } : {
      title: 'CAD background', preserve: 'Keep background and original colors', remove: 'Remove CAD background (adapt colors)',
      target: 'Destination canvas color', hint: 'Only the CAD canvas is removed, not entities. Low-contrast lines and text adapt to this canvas; source data stays unchanged.'
    };
  }
  backgroundChanged(): void {
    if (this.isLoading) return;
    this.clearThumbnails();
    this.previewRendered = false;
    this.cd.markForCheck();
  }
'''+s[pos:]
s=s.replace("{ signal: processing.signal, backgroundColor: this.result?.backgroundColor || '#ffffff' }","{ signal: processing.signal, background: this.backgroundSettings, backgroundColor: this.result?.backgroundColor || '#ffffff' }")
s=s.replace("      backgroundColor: this.result?.backgroundColor || '#ffffff'\n","      background: this.backgroundSettings,\n      backgroundColor: this.result?.backgroundColor || '#ffffff'\n")
s=s.replace("          backgroundColor: this.result?.backgroundColor || '#ffffff',","          backgroundColor: this.canvasColor,")
s=s.replace('Object.assign(widget.config, { cadEntityIds:','Object.assign(widget.config, { cadBackground: this.backgroundSettings, cadEntityIds:')
s=s.replace('    let svg = decodeCadSvg(entity.svgBase64);', '''    let svg = new XMLSerializer().serializeToString(buildCadSvgScene([entity], {
      x: entity.previewX, y: entity.previewY, width: entity.previewWidth, height: entity.previewHeight
    }, new Set(), { background: this.backgroundSettings, backgroundColor: this.canvasColor }));''');p.write_text(s)
p=D/'cad-import-dialog.component.html';s=p.read_text();needle='  @switch (step) {'
s=s.replace(needle,'''  @if (step !== 'upload') {
    <div class="cad-background-controls">
      <mat-form-field subscriptSizing="dynamic">
        <mat-label>{{ backgroundLabels.title }}</mat-label>
        <mat-select [(ngModel)]="backgroundMode" (ngModelChange)="backgroundChanged()" [disabled]="isLoading">
          <mat-option value="preserve">{{ backgroundLabels.preserve }}</mat-option>
          <mat-option value="remove">{{ backgroundLabels.remove }}</mat-option>
        </mat-select>
      </mat-form-field>
      @if (backgroundMode === 'remove') {
        <label>{{ backgroundLabels.target }}
          <input type="color" [(ngModel)]="targetCanvasColor" (ngModelChange)="backgroundChanged()"
                 [disabled]="isLoading" [attr.aria-label]="backgroundLabels.target">
        </label>
      }
      <span class="cad-background-hint">{{ backgroundLabels.hint }}</span>
    </div>
  }
'''+needle)
s=s.replace('class="preview-canvas-wrapper"','class="preview-canvas-wrapper" [style.background-color]="canvasColor"')
s=s.replace('class="entity-thumbnail"','class="entity-thumbnail" [style.background-color]="canvasColor"');p.write_text(s)
p=D/'cad-import-dialog.component.scss';p.write_text(p.read_text()+'''
.cad-background-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin: 8px 0 16px;
  mat-form-field { min-width: 260px; }
  label { display: flex; align-items: center; gap: 8px; }
  .cad-background-hint { flex: 1 1 280px; font-size: 12px; }
}
''')
p=Path('tests/cad/conftest.py');p.write_text(p.read_text().replace("for name in ('cad-import-svg',","for name in ('cad-import-background', 'cad-import-svg',"))
print('Applied reviewed CAD presentation integration to six expected source files.')
