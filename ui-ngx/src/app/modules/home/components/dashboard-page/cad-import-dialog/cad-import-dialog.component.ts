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

import { AfterViewChecked, Component, ElementRef, Inject, OnDestroy, ViewChild } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import { AppState } from '@core/core.state';
import { Router } from '@angular/router';
import { DialogComponent } from '@shared/components/dialog.component';
import { CadPerEntityResult, CadEntityInfo } from '@shared/models/cad-per-entity.models';
import { Widget, WidgetInfo } from '@shared/models/widget.models';
import { ImportExportService } from '@shared/import-export/import-export.service';
import { WidgetService } from '@core/http/widget.service';
import { DashboardUtilsService } from '@core/services/dashboard-utils.service';
import { DashboardWidgetSelectComponent } from '@home/components/dashboard-page/dashboard-widget-select.component';
import { SVG, Svg, G } from '@svgdotjs/svg.js';
import { forkJoin, Observable, of } from 'rxjs';
import { map } from 'rxjs/operators';
import { UtilsService } from '@core/services/utils.service';

export interface CadImportDialogData {
  dashboard: any;
}

export interface CadImportDashboardResult {
  widgets: Widget[];
  layoutType: string;
  targetColumns: number;
}

const VIEWPORT_WIDTH = 1200;
const VIEWPORT_HEIGHT = 700;
const TARGET_GRID_COLUMNS = 1000;
const TARGET_GRID_ROWS = 1000;
const SCADA_SYMBOL_FQN = 'system.scada_symbol';

@Component({
  selector: 'tb-cad-import-dialog',
  templateUrl: './cad-import-dialog.component.html',
  styleUrls: ['./cad-import-dialog.component.scss'],
  standalone: false
})
export class CadImportDialogComponent extends DialogComponent<CadImportDialogComponent, CadImportDashboardResult> implements AfterViewChecked, OnDestroy {

  @ViewChild('previewCanvas') previewCanvasRef!: ElementRef<HTMLDivElement>;

  step: 'upload' | 'preview' | 'map' | 'review' = 'upload';
  isLoading = false;
  result: CadPerEntityResult | null = null;
  keptEntities: CadEntityInfo[] = [];
  mappings: Map<string, WidgetInfo | null> = new Map();
  selectedEntityIds: Set<string> = new Set();
  deletedEntityIds: Set<string> = new Set();
  errorMessage = '';
  cadBounds: { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number } | null = null;

  private svgCanvas: Svg | null = null;
  private entityGroups: Map<string, G> = new Map();
  private previewRendered = false;
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private selectionRect: any = null;

  constructor(
    protected store: Store<AppState>,
    protected router: Router,
    @Inject(MAT_DIALOG_DATA) public data: CadImportDialogData,
    public dialogRef: MatDialogRef<CadImportDialogComponent, CadImportDashboardResult>,
    private importExport: ImportExportService,
    private widgetService: WidgetService,
    private dashboardUtils: DashboardUtilsService,
    private utils: UtilsService,
    private dialog: MatDialog,
  ) {
    super(store, router, dialogRef);
  }

  ngAfterViewChecked(): void {
    if (this.step === 'preview' && this.result && this.previewCanvasRef && !this.previewRendered) {
      this.renderPreview();
    }
  }

  ngOnDestroy(): void {
    this.svgCanvas?.remove();
  }

  onUploadClick(): void {
    this.isLoading = true;
    this.errorMessage = '';
    this.importExport.importCadFilePerEntity().subscribe({
      next: (result) => {
        if (!result) {
          this.isLoading = false;
          return;
        }
        if (result.manifest.length === 0) {
          this.errorMessage = 'No entities found in the CAD file';
          this.isLoading = false;
          return;
        }
        this.result = result;
        this.computeCadBounds();
        this.keptEntities = [...result.manifest];
        this.deletedEntityIds.clear();
        this.selectedEntityIds.clear();
        this.mappings.clear();
        this.previewRendered = false;
        this.isLoading = false;
        this.step = 'preview';
      },
      error: (err) => {
        this.errorMessage = err?.error?.message || err?.message || 'Conversion failed';
        this.isLoading = false;
      }
    });
  }

  private computeCadBounds(): void {
    if (!this.result?.manifest?.length) return;
    const entities = this.result.manifest;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const e of entities) {
      minX = Math.min(minX, e.x);
      minY = Math.min(minY, e.y);
      maxX = Math.max(maxX, e.x + e.width);
      maxY = Math.max(maxY, e.y + e.height);
    }
    const width = maxX - minX || 1;
    const height = maxY - minY || 1;
    this.cadBounds = { minX, minY, maxX, maxY, width, height };
  }

  private renderPreview(): void {
    if (!this.previewCanvasRef?.nativeElement || !this.result || !this.cadBounds) return;

    this.previewRendered = true;
    const container = this.previewCanvasRef.nativeElement;
    container.innerHTML = '';

    this.svgCanvas = SVG().addTo(container).size(VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
    this.svgCanvas.css({ border: '1px solid #ccc', background: '#1a1a2e' });

    if (this.result.previewSvgBase64) {
      const previewSvg = atob(this.result.previewSvgBase64);
      const bgGroup = this.svgCanvas.group();
      bgGroup.svg(previewSvg);
      bgGroup.opacity(0.3);
    }

    this.entityGroups.clear();
    for (const entity of this.result.manifest) {
      if (this.deletedEntityIds.has(entity.id)) continue;
      this.renderEntity(entity);
    }

    this.setupDragSelect();
  }

  private renderEntity(entity: CadEntityInfo): void {
    if (!this.svgCanvas || !this.cadBounds) return;

    const displayX = ((entity.x - this.cadBounds.minX) / this.cadBounds.width) * VIEWPORT_WIDTH;
    const displayY = VIEWPORT_HEIGHT - ((entity.y + entity.height - this.cadBounds.minY) / this.cadBounds.height) * VIEWPORT_HEIGHT;
    const displayW = Math.max(2, (entity.width / this.cadBounds.width) * VIEWPORT_WIDTH);
    const displayH = Math.max(2, (entity.height / this.cadBounds.height) * VIEWPORT_HEIGHT);

    const group = this.svgCanvas.group()
      .addClass('cad-entity')
      .data('entity-id', entity.id);

    group.rect(displayW, displayH)
      .move(displayX, displayY)
      .fill('transparent')
      .stroke({ width: 0 });

    if (entity.svgBase64) {
      try {
        const entitySvg = atob(entity.svgBase64);
        const innerGroup = this.svgCanvas.group();
        innerGroup.svg(entitySvg);
        innerGroup.move(displayX, displayY);
        const bbox = innerGroup.bbox();
        if (bbox.width > 0 && bbox.height > 0) {
          const scaleX = displayW / bbox.width;
          const scaleY = displayH / bbox.height;
          const scale = Math.min(scaleX, scaleY);
          innerGroup.transform({ scale, origin: [displayX, displayY] });
        }
        group.add(innerGroup);
      } catch (e) {
      }
    }

    group.css({ cursor: 'pointer' });
    group.on('click', (event: Event) => {
      event.stopPropagation();
      this.toggleEntitySelection(entity.id);
    });

    this.entityGroups.set(entity.id, group);
  }

  private setupDragSelect(): void {
    if (!this.svgCanvas) return;

    this.svgCanvas.on('mousedown', (event: MouseEvent) => {
      if ((event.target as HTMLElement).closest('.cad-entity')) return;
      this.isDragging = true;
      const rect = this.previewCanvasRef.nativeElement.getBoundingClientRect();
      this.dragStartX = event.clientX - rect.left;
      this.dragStartY = event.clientY - rect.top;
      this.selectionRect = this.svgCanvas!.rect(0, 0)
        .move(this.dragStartX, this.dragStartY)
        .fill({ color: '#1976d2', opacity: 0.2 })
        .stroke({ color: '#1976d2', width: 1, dasharray: '4,4' });
    });

    this.svgCanvas.on('mousemove', (event: MouseEvent) => {
      if (!this.isDragging || !this.selectionRect) return;
      const rect = this.previewCanvasRef.nativeElement.getBoundingClientRect();
      const currentX = event.clientX - rect.left;
      const currentY = event.clientY - rect.top;
      const x = Math.min(this.dragStartX, currentX);
      const y = Math.min(this.dragStartY, currentY);
      const w = Math.abs(currentX - this.dragStartX);
      const h = Math.abs(currentY - this.dragStartY);
      this.selectionRect.move(x, y).size(w, h);
    });

    this.svgCanvas.on('mouseup', (event: MouseEvent) => {
      if (!this.isDragging || !this.selectionRect) return;
      this.isDragging = false;
      const rect = this.previewCanvasRef.nativeElement.getBoundingClientRect();
      const endX = event.clientX - rect.left;
      const endY = event.clientY - rect.top;
      const selX = Math.min(this.dragStartX, endX);
      const selY = Math.min(this.dragStartY, endY);
      const selW = Math.abs(endX - this.dragStartX);
      const selH = Math.abs(endY - this.dragStartY);

      if (selW > 5 && selH > 5) {
        this.selectEntitiesInRect(selX, selY, selW, selH);
      }

      this.selectionRect.remove();
      this.selectionRect = null;
    });
  }

  private selectEntitiesInRect(x: number, y: number, w: number, h: number): void {
    this.selectedEntityIds.clear();
    for (const [id, group] of this.entityGroups) {
      const bbox = group.bbox();
      if (bbox.x < x + w && bbox.x + bbox.width > x &&
          bbox.y < y + h && bbox.y + bbox.height > y) {
        this.selectedEntityIds.add(id);
      }
    }
    this.updateSelectionVisuals();
  }

  private toggleEntitySelection(entityId: string): void {
    if (this.selectedEntityIds.has(entityId)) {
      this.selectedEntityIds.delete(entityId);
    } else {
      this.selectedEntityIds.add(entityId);
    }
    this.updateSelectionVisuals();
  }

  private updateSelectionVisuals(): void {
    for (const [id, group] of this.entityGroups) {
      if (this.selectedEntityIds.has(id)) {
        group.addClass('selected');
      } else {
        group.removeClass('selected');
      }
    }
  }

  deleteSelected(): void {
    for (const id of this.selectedEntityIds) {
      this.deletedEntityIds.add(id);
      const group = this.entityGroups.get(id);
      if (group) {
        group.remove();
        this.entityGroups.delete(id);
      }
    }
    this.selectedEntityIds.clear();
  }

  keepSelected(): void {
    this.selectedEntityIds.clear();
    this.updateSelectionVisuals();
  }

  onEntityClick(entity: CadEntityInfo): void {
    const dialogRef = this.dialog.open(DashboardWidgetSelectComponent, {
      panelClass: ['tb-dialog', 'tb-fullscreen-dialog'],
      data: { scadaFirst: true }
    });
    dialogRef.componentInstance.widgetSelected.subscribe((widgetInfo: WidgetInfo) => {
      this.mappings.set(entity.id, widgetInfo);
      dialogRef.close();
    });
  }

  assignWidget(entity: CadEntityInfo, widgetInfo: WidgetInfo | null): void {
    this.mappings.set(entity.id, widgetInfo);
  }

  removeMapping(entity: CadEntityInfo): void {
    this.mappings.set(entity.id, null);
  }

  get mappedCount(): number {
    let count = 0;
    for (const mapping of this.mappings.values()) {
      if (mapping) count++;
    }
    return count;
  }

  get unmappedCount(): number {
    return this.keptEntities.length - this.mappedCount;
  }

  private scaleCadToGrid(entity: CadEntityInfo): { col: number; row: number; sizeX: number; sizeY: number } {
    if (!this.cadBounds) {
      return { col: 0, row: 0, sizeX: 1, sizeY: 1 };
    }
    const col = Math.floor(((entity.x - this.cadBounds.minX) / this.cadBounds.width) * TARGET_GRID_COLUMNS);
    const row = Math.floor(((this.cadBounds.maxY - (entity.y + entity.height)) / this.cadBounds.height) * TARGET_GRID_ROWS);
    const sizeX = Math.max(1, Math.ceil((entity.width / this.cadBounds.width) * TARGET_GRID_COLUMNS));
    const sizeY = Math.max(1, Math.ceil((entity.height / this.cadBounds.height) * TARGET_GRID_ROWS));
    return {
      col: Math.max(0, Math.min(col, TARGET_GRID_COLUMNS - sizeX)),
      row: Math.max(0, Math.min(row, TARGET_GRID_ROWS - sizeY)),
      sizeX: Math.min(sizeX, TARGET_GRID_COLUMNS),
      sizeY: Math.min(sizeY, TARGET_GRID_ROWS)
    };
  }

  private createWidgetForEntity(entity: CadEntityInfo, mapping: WidgetInfo | null): Observable<Widget> {
    const { col, row, sizeX, sizeY } = this.scaleCadToGrid(entity);

    if (mapping) {
      return this.widgetService.getWidgetType(mapping.typeFullFqn).pipe(
        map((widgetType) => {
          const defaultConfig = JSON.parse(widgetType.descriptor.defaultConfig);
          const widget: Widget = {
            id: this.utils.guid(),
            typeFullFqn: mapping.typeFullFqn,
            type: mapping.type as any,
            sizeX,
            sizeY,
            row,
            col,
            config: {
              ...defaultConfig,
              title: mapping.title,
              showTitle: false,
              dropShadow: false,
              preserveAspectRatio: true,
              backgroundColor: 'rgba(0,0,0,0)',
              padding: '0',
              margin: '0'
            }
          };
          return this.dashboardUtils.prepareWidgetForScadaLayout(widget, true);
        })
      );
    } else {
      const svgContent = entity.svgBase64 ? atob(entity.svgBase64) : '';
      const widget: Widget = {
        id: this.utils.guid(),
        typeFullFqn: SCADA_SYMBOL_FQN,
        type: 'widget' as any,
        sizeX,
        sizeY,
        row,
        col,
        config: {
          title: entity.id,
          showTitle: false,
          dropShadow: false,
          preserveAspectRatio: true,
          backgroundColor: 'rgba(0,0,0,0)',
          padding: '0',
          margin: '0',
          settings: {
            scadaSymbolContent: svgContent
          }
        } as any
      };
      return of(widget);
    }
  }

  generateWidgets(): Observable<Widget[]> {
    const widgetObservables = this.keptEntities.map(entity => {
      const mapping = this.mappings.get(entity.id) || null;
      return this.createWidgetForEntity(entity, mapping);
    });
    return forkJoin(widgetObservables);
  }

  onImportClick(): void {
    this.isLoading = true;
    this.generateWidgets().subscribe({
      next: (widgets) => {
        this.dialogRef.close({
          widgets,
          layoutType: 'scada',
          targetColumns: TARGET_GRID_COLUMNS
        });
      },
      error: () => {
        this.isLoading = false;
      }
    });
  }

  get hasResult(): boolean {
    return !!this.result;
  }

  get entityCountWarning(): string | null {
    if (this.result && this.result.manifest.length > 500) {
      return `Large number of entities (${this.result.manifest.length}). Performance may be affected.`;
    }
    return null;
  }

  get keptEntityCount(): number {
    return this.result ? this.result.manifest.filter(e => !this.deletedEntityIds.has(e.id)).length : 0;
  }

  goBack(): void {
    const steps: Array<typeof this.step> = ['upload', 'preview', 'map', 'review'];
    const index = steps.indexOf(this.step);
    if (index > 0) {
      this.step = steps[index - 1];
      if (this.step === 'preview') {
        this.previewRendered = false;
      }
    }
  }

  goNext(): void {
    if (this.step === 'preview') {
      this.keptEntities = this.result!.manifest.filter(e => !this.deletedEntityIds.has(e.id));
      for (const entity of this.keptEntities) {
        if (!this.mappings.has(entity.id)) {
          this.mappings.set(entity.id, null);
        }
      }
    }
    const steps: Array<typeof this.step> = ['upload', 'preview', 'map', 'review'];
    const index = steps.indexOf(this.step);
    if (index < steps.length - 1) {
      this.step = steps[index + 1];
    }
  }

  canProceed(): boolean {
    switch (this.step) {
      case 'upload':
        return !!this.result;
      case 'preview':
        return this.result ? this.result.manifest.filter(e => !this.deletedEntityIds.has(e.id)).length > 0 : false;
      case 'map':
        return true;
      default:
        return false;
    }
  }
}
