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

import { AfterViewChecked, ChangeDetectorRef, Component, ElementRef, Inject, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import { AppState } from '@core/core.state';
import { Router } from '@angular/router';
import { DialogComponent } from '@shared/components/dialog.component';
import { CadPerEntityResult, CadEntityInfo, PreviewTransform } from '@shared/models/cad-per-entity.models';
import { fullWidgetTypeFqn, Widget, WidgetInfo, widgetType, WidgetType } from '@shared/models/widget.models';
import { ImportExportService } from '@shared/import-export/import-export.service';
import { WidgetService } from '@core/http/widget.service';
import { DashboardUtilsService } from '@core/services/dashboard-utils.service';
import { CadWidgetSelectDialogComponent } from './cad-widget-select-dialog.component';
import { SVG, Svg, G, Rect } from '@svgdotjs/svg.js';
import { from, Observable, of } from 'rxjs';
import { catchError, finalize, map, mergeMap, shareReplay, switchMap, toArray } from 'rxjs/operators';
import { UtilsService } from '@core/services/utils.service';
import { TranslateService } from '@ngx-translate/core';
import { ImageService } from '@core/http/image.service';
import {
  emptyMetadata,
  removeScadaSymbolMetadata,
  updateScadaSymbolMetadataInContent
} from '@home/components/widget/lib/scada/scada-symbol.models';
import { mergeDeep } from '@core/utils';
import { ResourceSubType, prependTbImagePrefix } from '@shared/models/resource.models';
import {
  buildPreviewCssTransform,
  buildSelectionHighlight,
  CadRect,
  screenPointToPreviewSvgCoords
} from './cad-import-geometry';
import {
  buildCadImportWidgetItems,
  CadImportGroupMapping,
  CadImportWidgetEntity,
  cadImportWidgetPlan,
  cadMappedScadaWidgetConfigDefaults,
  expandCadGridBounds
} from './cad-import-widget-generation';
import { buildDeletedPreviewMask } from './cad-import-preview-visibility';

export interface CadImportDialogData {
  dashboard: any;
  autoUpload?: boolean;
  result?: CadPerEntityResult;
}

export interface CadImportDashboardResult {
  widgets: Widget[];
  layoutType: string;
  targetColumns: number;
  cadAspectRatio?: number;
}

type CadImportStep = 'upload' | 'preview' | 'map' | 'review';
type CadEntityGroupMapping = CadImportGroupMapping<WidgetInfo>;

const VIEWPORT_WIDTH = 1200;
const VIEWPORT_HEIGHT = 700;
const TARGET_GRID_COLUMNS = 1000;
const MIN_CAD_VISUAL_WIDGET_SIZE_X = 4;
const MIN_CAD_VISUAL_WIDGET_SIZE_Y = 4;
const SCADA_SYMBOL_FQN = 'system.scada_symbol';
const CAD_IMPORT_WIDGET_CONCURRENCY = 8;

@Component({
  selector: 'tb-cad-import-dialog',
  templateUrl: './cad-import-dialog.component.html',
  styleUrls: ['./cad-import-dialog.component.scss'],
  standalone: false
})
export class CadImportDialogComponent extends DialogComponent<CadImportDialogComponent, CadImportDashboardResult> implements AfterViewChecked, OnInit, OnDestroy {

  @ViewChild('previewCanvas') previewCanvasRef!: ElementRef<HTMLDivElement>;

  step: CadImportStep = 'upload';
  previewMode: 'select' | 'map' = 'select';
  isLoading = false;
  importProgress = 0;
  importTotal = 0;
  result: CadPerEntityResult | null = null;
  keptEntities: CadEntityInfo[] = [];
  mappings: Map<string, WidgetInfo | null> = new Map<string, WidgetInfo | null>();
  groupMappings: CadEntityGroupMapping[] = [];
  selectedEntityIds: Set<string> = new Set<string>();
  deletedEntityIds: Set<string> = new Set<string>();
  errorMessage = '';
  cadBounds: { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number } | null = null;
  private msBounds: { minX: number; maxX: number; minY: number; maxY: number } | null = null;
  private previewTransform: PreviewTransform | null = null;

  private svgCanvas: Svg | null = null;
  private entityGroups: Map<string, G> = new Map<string, G>();
  private selectionHighlights: Map<string, Rect> = new Map<string, Rect>();
  private highlightLayer: G | null = null;
  private deletedMaskLayer: G | null = null;
  private deletedMasks: Map<string, Rect> = new Map<string, Rect>();
  private previewRendered = false;
  private isDragging = false;
  private selectionRect: any = null;
  private scadaSymbolWidgetType$: Observable<WidgetType> | null = null;

  zoomLevel = 1;
  private panX = 0;
  private panY = 0;
  private isPanning = false;
  private panStartX = 0;
  private panStartY = 0;
  private panStartPanX = 0;
  private panStartPanY = 0;

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
    private translate: TranslateService,
    private imageService: ImageService,
    private cd: ChangeDetectorRef,
  ) {
    super(store, router, dialogRef);
  }

  ngOnInit(): void {
    if (this.data.result) {
      this.applyConversionResult(this.data.result);
    } else if (this.data.autoUpload) {
      this.onUploadClick();
    }
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
        this.isLoading = false;
        if (!result) {
          if (this.data.autoUpload) {
            this.dialogRef.close(null);
          }
          return;
        }
        this.applyConversionResult(result);
      },
      error: (err) => {
        this.errorMessage = err?.error?.message || err?.message || this.translate.instant('dashboard.cad-import-dialog.converting');
        this.isLoading = false;
      }
    });
  }

  private applyConversionResult(result: CadPerEntityResult): void {
    if (result.manifest.length === 0) {
      this.errorMessage = this.translate.instant('dashboard.cad-import-dialog.no-entities');
      this.step = 'upload';
      return;
    }
    this.result = result;
    this.computeCadBounds();
    this.msBounds = result.modelspaceBounds || null;
    this.previewTransform = result.previewTransform || null;
    this.keptEntities = [...result.manifest];
    this.deletedEntityIds.clear();
    this.selectedEntityIds.clear();
    this.deletedMasks.forEach(mask => mask.remove());
    this.deletedMasks.clear();
    this.deletedMaskLayer = null;
    this.mappings.clear();
    this.groupMappings = [];
    this.previewRendered = false;
    this.step = 'preview';
  }

  private computeCadBounds(): void {
    if (this.result?.modelspaceBounds) {
      const ms = this.result.modelspaceBounds;
      this.cadBounds = {
        minX: ms.minX,
        minY: ms.minY,
        maxX: ms.maxX,
        maxY: ms.maxY,
        width: ms.maxX - ms.minX || 1,
        height: ms.maxY - ms.minY || 1
      };
      return;
    }
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

    const svgNs = 'http://www.w3.org/2000/svg';
    const outerSvg = document.createElementNS(svgNs, 'svg');
    outerSvg.setAttribute('width', String(VIEWPORT_WIDTH));
    outerSvg.setAttribute('height', String(VIEWPORT_HEIGHT));
    outerSvg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    outerSvg.style.display = 'block';

    if (this.previewTransform) {
      outerSvg.setAttribute('viewBox',
        `${this.previewTransform.x} ${this.previewTransform.y} ${this.previewTransform.width} ${this.previewTransform.height}`);
    } else {
      outerSvg.setAttribute('viewBox', `0 0 ${VIEWPORT_WIDTH} ${VIEWPORT_HEIGHT}`);
    }

    container.appendChild(outerSvg);

    if (this.result.previewSvgBase64) {
      const previewSvg = atob(this.result.previewSvgBase64);
      const bg = document.createElementNS(svgNs, 'g');
      bg.setAttribute('class', 'cad-preview-bg');
      bg.innerHTML = this.extractSvgContent(previewSvg);
      outerSvg.appendChild(bg);
    }

    this.svgCanvas = SVG(outerSvg) as Svg;

    this.entityGroups.clear();
    this.selectionHighlights.clear();
    this.deletedMasks.clear();
    this.deletedMaskLayer = this.svgCanvas.group().addClass('cad-delete-mask-layer').attr({
      'pointer-events': 'none'
    });
    this.renderDeletedPreviewMasks();
    this.highlightLayer = this.svgCanvas.group().addClass('cad-selection-highlight-layer');
    this.bindPreviewEntityGroups();

    this.setupDragSelect();
  }

  private bindPreviewEntityGroups(): void {
    if (!this.previewCanvasRef?.nativeElement) return;
    const groups = this.previewCanvasRef.nativeElement.querySelectorAll('g[data-cad-entity-id]');
    groups.forEach(groupEl => {
      const g = groupEl as SVGGElement;
      const entityId = g.getAttribute('data-cad-entity-id');
      if (!entityId || this.deletedEntityIds.has(entityId)) return;
      g.style.cursor = 'pointer';
      g.classList.add('cad-entity');
      g.addEventListener('click', (event: Event) => {
        event.stopPropagation();
        if (this.previewMode === 'map') {
          const entity = this.result?.manifest.find(e => e.id === entityId);
          if (entity) this.mapEntityFromPreview(entity);
        } else {
          this.toggleEntitySelection(entityId);
        }
      });
      const svgGroup = SVG(g) as G;
      this.entityGroups.set(entityId, svgGroup);
    });
    this.updateSelectionVisuals();
    this.updateMappingVisuals();
  }

  private extractSvgContent(svgStr: string): string {
    const s = svgStr.trim();
    const svgTagEnd = s.indexOf('>');
    if (svgTagEnd === -1) return s;
    const closeTag = '</svg>';
    const closeIdx = s.lastIndexOf(closeTag);
    if (closeIdx > svgTagEnd) {
      return s.substring(svgTagEnd + 1, closeIdx);
    }
    return s.substring(svgTagEnd + 1);
  }

  private toSvgCoords(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.previewCanvasRef.nativeElement.getBoundingClientRect();
    return screenPointToPreviewSvgCoords(
      clientX,
      clientY,
      { left: rect.left, top: rect.top },
      this.zoomLevel,
      this.panX,
      this.panY,
      this.previewTransform,
      VIEWPORT_WIDTH,
      VIEWPORT_HEIGHT
    );
  }

  private applyTransform(): void {
    const svgEl = this.previewCanvasRef?.nativeElement?.querySelector('svg');
    if (!svgEl) return;
    svgEl.style.transformOrigin = '0 0';
    svgEl.style.transform = buildPreviewCssTransform(this.zoomLevel, this.panX, this.panY);
  }

  onPreviewWheel(event: WheelEvent): void {
    event.preventDefault();
    const container = this.previewCanvasRef.nativeElement;
    const rect = container.getBoundingClientRect();
    const mouseX = (event.clientX - rect.left) / this.zoomLevel - this.panX;
    const mouseY = (event.clientY - rect.top) / this.zoomLevel - this.panY;

    const oldZoom = this.zoomLevel;
    const delta = event.deltaY > 0 ? 0.9 : 1.1;
    this.zoomLevel = Math.max(0.1, Math.min(5, this.zoomLevel * delta));

    // ponytail: zoom-to-point — keep the SVG point under the cursor fixed on screen
    // screen = zoom*(svgX + panX); solving newPan = (oldZoom/newZoom)*(mx+oldPan) - mx
    this.panX = (mouseX + this.panX) * (oldZoom / this.zoomLevel) - mouseX;
    this.panY = (mouseY + this.panY) * (oldZoom / this.zoomLevel) - mouseY;

    this.applyTransform();
  }

  onPreviewMouseDown(event: MouseEvent): void {
    if (event.ctrlKey || event.button === 1 || event.button === 2) {
      event.preventDefault();
      this.isPanning = true;
      this.isDragging = false;
      this.panStartX = event.clientX;
      this.panStartY = event.clientY;
      this.panStartPanX = this.panX;
      this.panStartPanY = this.panY;
      if (this.previewCanvasRef) {
        this.previewCanvasRef.nativeElement.style.cursor = 'grabbing';
      }
    }
  }

  onPreviewMouseMove(event: MouseEvent): void {
    if (this.isPanning) {
      const dx = (event.clientX - this.panStartX) / this.zoomLevel;
      const dy = (event.clientY - this.panStartY) / this.zoomLevel;
      this.panX = this.panStartPanX + dx;
      this.panY = this.panStartPanY + dy;
      this.applyTransform();
      return;
    }
    if (!this.isDragging || !this.selectionRect) return;
    const svgCoords = this.toSvgCoords(event.clientX, event.clientY);
    const startCoords = this.toSvgCoords(this.dragScreenStartX, this.dragScreenStartY);
    const x = Math.min(startCoords.x, svgCoords.x);
    const y = Math.min(startCoords.y, svgCoords.y);
    const w = Math.abs(svgCoords.x - startCoords.x);
    const h = Math.abs(svgCoords.y - startCoords.y);
    this.selectionRect.move(x, y).size(w, h);
  }

  onPreviewMouseUp(event: MouseEvent): void {
    if (this.isPanning) {
      this.isPanning = false;
      if (this.previewCanvasRef) {
        this.previewCanvasRef.nativeElement.style.cursor = 'default';
      }
      return;
    }
    if (!this.isDragging || !this.selectionRect) return;
    this.isDragging = false;
    const svgCoords = this.toSvgCoords(event.clientX, event.clientY);
    const startCoords = this.toSvgCoords(this.dragScreenStartX, this.dragScreenStartY);
    const selX = Math.min(startCoords.x, svgCoords.x);
    const selY = Math.min(startCoords.y, svgCoords.y);
    const selW = Math.abs(svgCoords.x - startCoords.x);
    const selH = Math.abs(svgCoords.y - startCoords.y);

    if (selW > 5 && selH > 5) {
      this.selectEntitiesInRect(selX, selY, selW, selH);
    }

    this.selectionRect.remove();
    this.selectionRect = null;
  }

  zoomIn(): void {
    this.zoomLevel = Math.min(5, this.zoomLevel * 1.3);
    this.applyTransform();
  }

  zoomOut(): void {
    this.zoomLevel = Math.max(0.1, this.zoomLevel / 1.3);
    this.applyTransform();
  }

  resetZoom(): void {
    this.zoomLevel = 1;
    this.panX = 0;
    this.panY = 0;
    this.applyTransform();
  }

  private dragScreenStartX = 0;
  private dragScreenStartY = 0;

  private setupDragSelect(): void {
    if (!this.svgCanvas) return;

    this.svgCanvas.on('mousedown', (event: MouseEvent) => {
      if ((event.target as HTMLElement).closest('.cad-entity')) return;
      if (event.ctrlKey || event.button !== 0) return;
      this.isDragging = true;
      this.dragScreenStartX = event.clientX;
      this.dragScreenStartY = event.clientY;
      const svgCoords = this.toSvgCoords(event.clientX, event.clientY);
      this.selectionRect = this.svgCanvas!.rect(0, 0)
        .move(svgCoords.x, svgCoords.y)
        .fill({ color: '#1976d2', opacity: 0.2 })
        .stroke({ color: '#1976d2', width: 1, dasharray: '4,4' })
        .attr({
          'pointer-events': 'none',
          'vector-effect': 'non-scaling-stroke'
        });
    });
  }

  private selectEntitiesInRect(x: number, y: number, w: number, h: number): void {
    this.selectedEntityIds.clear();
    for (const [id, group] of this.entityGroups) {
      const bbox = this.entitySelectionBounds(id, group);
      if (bbox && bbox.x < x + w && bbox.x + bbox.width > x &&
          bbox.y < y + h && bbox.y + bbox.height > y) {
        this.selectedEntityIds.add(id);
      }
    }
    this.updateSelectionVisuals();
  }

  private entitySelectionBounds(entityId: string, group: G): CadRect | null {
    const entity = this.result?.manifest.find(e => e.id === entityId);
    const bbox = entity && this.hasPreviewBounds(entity)
      ? {
          x: entity.previewX!,
          y: entity.previewY!,
          width: entity.previewWidth!,
          height: entity.previewHeight!
        }
      : group.bbox();
    if (!Number.isFinite(bbox.x) || !Number.isFinite(bbox.y) ||
        !Number.isFinite(bbox.width) || !Number.isFinite(bbox.height) ||
        bbox.width <= 0 || bbox.height <= 0) {
      return null;
    }
    return bbox;
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
    this.selectionHighlights.forEach(highlight => highlight.remove());
    this.selectionHighlights.clear();
    for (const [id, group] of this.entityGroups) {
      const node = group.node as SVGGElement;
      if (!node) continue;
      node.classList.remove('selected');
      if (this.selectedEntityIds.has(id)) {
        node.classList.add('selected');
        this.addSelectionHighlight(id, group);
      }
    }
  }

  private addSelectionHighlight(entityId: string, group: G): void {
    if (!this.highlightLayer) return;
    const entity = this.result?.manifest.find(e => e.id === entityId);
    const bbox = entity && this.hasPreviewBounds(entity)
      ? {
          x: entity.previewX,
          y: entity.previewY,
          width: entity.previewWidth,
          height: entity.previewHeight
        }
      : group.bbox();
    if (!isFinite(bbox.width) || !isFinite(bbox.height) || bbox.width <= 0 || bbox.height <= 0) return;
    const highlightBox = buildSelectionHighlight(
      bbox,
      this.previewTransform,
      VIEWPORT_WIDTH,
      VIEWPORT_HEIGHT,
      this.zoomLevel
    );
    const highlight = this.highlightLayer.rect(highlightBox.width, highlightBox.height)
      .move(highlightBox.x, highlightBox.y)
      .fill({ color: '#ffeb3b', opacity: 0.14 })
      .stroke({ color: '#ff3d00', width: highlightBox.strokeWidth, dasharray: highlightBox.dasharray })
      .attr({
        'pointer-events': 'none',
        'vector-effect': 'non-scaling-stroke',
        'rx': highlightBox.cornerRadius,
        'ry': highlightBox.cornerRadius
      });
    this.selectionHighlights.set(entityId, highlight);
  }

  private hasPreviewBounds(entity: CadEntityInfo): boolean {
    return Number.isFinite(entity.previewX) && Number.isFinite(entity.previewY) &&
      Number.isFinite(entity.previewWidth) && Number.isFinite(entity.previewHeight) &&
      entity.previewWidth > 0 && entity.previewHeight > 0;
  }

  private renderDeletedPreviewMasks(): void {
    for (const id of this.deletedEntityIds) {
      this.addDeletedPreviewMask(id);
    }
  }

  private addDeletedPreviewMask(entityId: string): void {
    if (!this.deletedMaskLayer || this.deletedMasks.has(entityId)) return;
    const entity = this.result?.manifest.find(e => e.id === entityId);
    if (!entity) return;
    const mask = buildDeletedPreviewMask(entity);
    if (!mask) return;
    const rect = this.deletedMaskLayer.rect(mask.width, mask.height)
      .move(mask.x, mask.y)
      .fill({ color: '#ffffff', opacity: 1 })
      .stroke({ width: 0 })
      .attr({
        'data-cad-deleted-mask-id': entityId,
        'pointer-events': 'none'
      });
    this.deletedMasks.set(entityId, rect);
  }

  deleteSelected(): void {
    this.removeGroupsContaining(this.selectedEntityIds);
    for (const id of this.selectedEntityIds) {
      this.deletedEntityIds.add(id);
      this.mappings.delete(id);
      this.selectionHighlights.get(id)?.remove();
      this.selectionHighlights.delete(id);
      this.addDeletedPreviewMask(id);
      const group = this.entityGroups.get(id);
      if (group) {
        group.remove();
        this.entityGroups.delete(id);
      }
    }
    this.selectedEntityIds.clear();
    this.updateMappingVisuals();
  }

  keepSelected(): void {
    this.selectedEntityIds.clear();
    this.updateSelectionVisuals();
  }

  onEntityClick(entity: CadEntityInfo): void {
    const group = this.findGroupByEntityId(entity.id);
    if (group) {
      this.openWidgetSelectDialog(widgetInfo => {
        group.widgetInfo = widgetInfo;
        this.updateMappingVisuals();
      });
      return;
    }
    this.openWidgetSelectDialog(widgetInfo => {
      this.mappings.set(entity.id, widgetInfo);
      this.updateMappingVisuals();
    });
  }

  mapSelectedGroup(): void {
    const selectedIds = this.sortEntityIdsByManifest(
      Array.from(this.selectedEntityIds).filter(id => !this.deletedEntityIds.has(id))
    );
    if (selectedIds.length < 2) {
      return;
    }
    this.openWidgetSelectDialog(widgetInfo => {
      const selectedIdSet = new Set(selectedIds);
      this.removeGroupsContaining(selectedIdSet);
      selectedIds.forEach(id => this.mappings.delete(id));
      this.groupMappings.push({
        id: this.utils.guid(),
        entityIds: selectedIds,
        widgetInfo
      });
      this.selectedEntityIds.clear();
      this.updateSelectionVisuals();
      this.updateMappingVisuals();
    });
  }

  private openWidgetSelectDialog(onSelected: (widgetInfo: WidgetInfo) => void): void {
    const dialogRef = this.dialog.open(CadWidgetSelectDialogComponent, {
      panelClass: ['tb-dialog', 'tb-fullscreen-dialog'],
      data: { scadaFirst: true }
    });
    dialogRef.afterClosed().subscribe((widgetInfo: WidgetInfo | undefined) => {
      if (widgetInfo) {
        onSelected(widgetInfo);
      }
    });
  }

  private mapEntityFromPreview(entity: CadEntityInfo): void {
    const group = this.findGroupByEntityId(entity.id);
    if (group) {
      this.openWidgetSelectDialog(widgetInfo => {
        group.widgetInfo = widgetInfo;
        this.updateMappingVisuals();
      });
      return;
    }
    this.openWidgetSelectDialog(widgetInfo => {
      this.mappings.set(entity.id, widgetInfo);
      this.updateMappingVisuals();
    });
  }

  private updateMappingVisuals(): void {
    const groupedEntityIds = this.currentGroupedEntityIds();
    for (const [id, group] of this.entityGroups) {
      const node = group.node as SVGGElement;
      if (!node) continue;
      if (groupedEntityIds.has(id) || (this.mappings.has(id) && this.mappings.get(id))) {
        node.classList.add('mapped');
      } else {
        node.classList.remove('mapped');
      }
    }
  }

  assignWidget(entity: CadEntityInfo, widgetInfo: WidgetInfo | null): void {
    this.mappings.set(entity.id, widgetInfo);
    this.updateMappingVisuals();
  }

  removeMapping(entity: CadEntityInfo): void {
    this.mappings.set(entity.id, null);
    this.updateMappingVisuals();
  }

  removeGroupMapping(group: CadEntityGroupMapping): void {
    this.groupMappings = this.groupMappings.filter(existing => existing.id !== group.id);
    this.updateMappingVisuals();
  }

  private findGroupByEntityId(entityId: string): CadEntityGroupMapping | undefined {
    const activeGroupIds = new Set(this.activeGroupMappings().map(group => group.id));
    return this.groupMappings.find(group => activeGroupIds.has(group.id) && group.entityIds.includes(entityId));
  }

  private removeGroupsContaining(entityIds: Set<string>): void {
    if (!entityIds.size) {
      return;
    }
    this.groupMappings = this.groupMappings.filter(group =>
      !group.entityIds.some(id => entityIds.has(id))
    );
  }

  private sortEntityIdsByManifest(entityIds: string[]): string[] {
    const order = new Map((this.result?.manifest || []).map((entity, index) => [entity.id, index]));
    return [...entityIds].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  }

  private activeGroupMappings(): CadEntityGroupMapping[] {
    const keptIds = new Set(this.keptEntities
      .filter(entity => !this.deletedEntityIds.has(entity.id))
      .map(entity => entity.id));
    return this.groupMappings
      .map(group => ({
        ...group,
        entityIds: this.sortEntityIdsByManifest(group.entityIds.filter(id => keptIds.has(id)))
      }))
      .filter(group => group.entityIds.length >= 2);
  }

  private currentGroupedEntityIds(): Set<string> {
    const ids = new Set<string>();
    this.activeGroupMappings().forEach(group => {
      group.entityIds.forEach(id => ids.add(id));
    });
    return ids;
  }

  get mappedGroups(): CadEntityGroupMapping[] {
    return this.activeGroupMappings();
  }

  get mapStepEntities(): CadEntityInfo[] {
    const groupedEntityIds = this.currentGroupedEntityIds();
    return this.keptEntities.filter(entity =>
      !this.deletedEntityIds.has(entity.id) && !groupedEntityIds.has(entity.id)
    );
  }

  get mappedCount(): number {
    const groupedEntityIds = this.currentGroupedEntityIds();
    let count = this.activeGroupMappings().length;
    for (const entity of this.keptEntities) {
      if (!this.deletedEntityIds.has(entity.id) && !groupedEntityIds.has(entity.id) && this.mappings.get(entity.id)) {
        count++;
      }
    }
    return count;
  }

  get unmappedCount(): number {
    const groupedEntityIds = this.currentGroupedEntityIds();
    let count = 0;
    for (const entity of this.keptEntities) {
      if (!this.deletedEntityIds.has(entity.id) && !groupedEntityIds.has(entity.id) && !this.mappings.get(entity.id)) {
        count++;
      }
    }
    return count;
  }

  private ensureCompleteSvg(svgContent: string, entity: CadEntityInfo): string {
    if (!svgContent) return '';
    let trimmed = svgContent.trim();
    while (true) {
      if (trimmed.startsWith('<?xml')) {
        const end = trimmed.indexOf('?>');
        if (end === -1) break;
        trimmed = trimmed.slice(end + 2).trim();
      } else if (trimmed.startsWith('<!DOCTYPE')) {
        const end = trimmed.indexOf('>');
        if (end === -1) break;
        trimmed = trimmed.slice(end + 1).trim();
      } else if (trimmed.startsWith('<!--')) {
        const end = trimmed.indexOf('-->');
        if (end === -1) break;
        trimmed = trimmed.slice(end + 3).trim();
      } else {
        break;
      }
    }
    if (trimmed.startsWith('<svg')) {
      if (!/viewBox\s*=/.test(trimmed)) {
        const wMatch = /width\s*=\s*["']?(\d+\.?\d*)/.exec(trimmed);
        const hMatch = /height\s*=\s*["']?(\d+\.?\d*)/.exec(trimmed);
        const w = wMatch ? parseFloat(wMatch[1]) : entity.width;
        const h = hMatch ? parseFloat(hMatch[1]) : entity.height;
        return trimmed.replace(/<svg/, `<svg viewBox="0 0 ${w} ${h}"`);
      }
      return trimmed;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${entity.width} ${entity.height}">${trimmed}</svg>`;
  }

  getEntityThumbnailUrl(entity: CadEntityInfo): string {
    if (!entity.svgBase64) return '';
    let svg = atob(entity.svgBase64);
    try {
      svg = removeScadaSymbolMetadata(svg);
    } catch {
      svg = this.ensureCompleteSvg(svg, entity);
    }
    if (!svg.match(/\swidth=/)) {
      svg = svg.replace(/<svg/, '<svg width="120" height="120"');
    }
    try {
      const bytes = new TextEncoder().encode(svg);
      let binary = '';
      for (const byte of bytes) {
        binary += String.fromCharCode(byte);
      }
      return 'data:image/svg+xml;base64,' + btoa(binary);
    } catch {
      return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
    }
  }

  private scaleCadToGrid(entity: CadEntityInfo | CadImportWidgetEntity): { col: number; row: number; sizeX: number; sizeY: number } {
    if (this.previewTransform && entity.previewX !== undefined && entity.previewY !== undefined &&
        entity.previewWidth !== undefined && entity.previewHeight !== undefined) {
      const t = this.previewTransform;
      const targetCols = TARGET_GRID_COLUMNS;
      const targetRows = Math.max(1, Math.round(targetCols * (t.height / t.width)));
      const col = Math.floor(((entity.previewX - t.x) / t.width) * targetCols);
      const row = Math.floor(((entity.previewY - t.y) / t.height) * targetRows);
      const sizeX = Math.max(1, Math.ceil((entity.previewWidth / t.width) * targetCols));
      const sizeY = Math.max(1, Math.ceil((entity.previewHeight / t.height) * targetRows));
      return {
        col: Math.max(0, Math.min(col, targetCols - sizeX)),
        row: Math.max(0, Math.min(row, targetRows - sizeY)),
        sizeX: Math.min(sizeX, targetCols),
        sizeY: Math.min(sizeY, targetRows)
      };
    }
    if (!this.cadBounds) {
      return { col: 0, row: 0, sizeX: 1, sizeY: 1 };
    }
    const targetCols = TARGET_GRID_COLUMNS;
    const targetRows = Math.max(1, Math.round(targetCols * (this.cadBounds.height / this.cadBounds.width)));
    const col = Math.floor(((entity.x - this.cadBounds.minX) / this.cadBounds.width) * targetCols);
    const row = Math.floor(((this.cadBounds.maxY - (entity.y + entity.height)) / this.cadBounds.height) * targetRows);
    const sizeX = Math.max(1, Math.ceil((entity.width / this.cadBounds.width) * targetCols));
    const sizeY = Math.max(1, Math.ceil((entity.height / this.cadBounds.height) * targetRows));
    return {
      col: Math.max(0, Math.min(col, targetCols - sizeX)),
      row: Math.max(0, Math.min(row, targetRows - sizeY)),
      sizeX: Math.min(sizeX, targetCols),
      sizeY: Math.min(sizeY, targetRows)
    };
  }

  private getScadaSymbolWidgetType(): Observable<WidgetType> {
    if (!this.scadaSymbolWidgetType$) {
      this.scadaSymbolWidgetType$ = this.widgetService.getWidgetType(SCADA_SYMBOL_FQN).pipe(
        shareReplay({ bufferSize: 1, refCount: true })
      );
    }
    return this.scadaSymbolWidgetType$;
  }

  private scadaSymbolTitle(entity: CadEntityInfo | CadImportWidgetEntity): string {
    return `CAD ${entity.blockName || entity.type || 'entity'} ${entity.id}`;
  }

  private scadaSymbolFileName(entity: CadEntityInfo): string {
    return this.sanitizeScadaSymbolName(this.scadaSymbolTitle(entity)) + '.svg';
  }

  private sanitizeScadaSymbolName(value: string): string {
    const sanitized = Array.from(value)
      .map(char => char.charCodeAt(0) < 32 || /[<>:"/\\|?*]/.test(char) ? '_' : char)
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    return sanitized || 'CAD entity';
  }

  private createScadaSymbolContent(entity: CadEntityInfo): string {
    const rawSvg = entity.svgBase64 ? atob(entity.svgBase64) : '';
    const svgContent = this.ensureCompleteSvg(rawSvg, entity);
    const metadata = emptyMetadata(entity.previewWidth || entity.width, entity.previewHeight || entity.height);
    metadata.title = this.scadaSymbolTitle(entity);
    metadata.description = `Imported from CAD entity ${entity.id}`;
    metadata.searchTags = ['cad-import', entity.type].filter(Boolean);
    return updateScadaSymbolMetadataInContent(svgContent, metadata);
  }

  private uploadScadaSymbol(entity: CadEntityInfo): Observable<string> {
    const symbolContent = this.createScadaSymbolContent(entity);
    const file = new File(
      [new Blob([symbolContent], { type: 'image/svg+xml' })],
      this.scadaSymbolFileName(entity),
      { type: 'image/svg+xml' }
    );
    return this.imageService.uploadImage(file, this.scadaSymbolTitle(entity), ResourceSubType.SCADA_SYMBOL).pipe(
      map(imageInfo => prependTbImagePrefix(imageInfo.link))
    );
  }

  private targetGridRows(): number {
    const aspectRatio = this.previewTransform
      ? this.previewTransform.height / this.previewTransform.width
      : (this.cadBounds ? this.cadBounds.height / this.cadBounds.width : 1);
    return Math.max(1, Math.round(TARGET_GRID_COLUMNS * aspectRatio));
  }

  private createScadaSymbolWidget(entity: CadEntityInfo | CadImportWidgetEntity, scadaSymbolUrl: string, scadaWidgetType: WidgetType): Widget {
    const { col, row, sizeX, sizeY } = expandCadGridBounds(
      this.scaleCadToGrid(entity),
      TARGET_GRID_COLUMNS,
      this.targetGridRows(),
      MIN_CAD_VISUAL_WIDGET_SIZE_X,
      MIN_CAD_VISUAL_WIDGET_SIZE_Y
    );
    const defaultConfig = JSON.parse(scadaWidgetType.descriptor.defaultConfig || '{}');
    const widget: Widget = {
      id: this.utils.guid(),
      typeFullFqn: fullWidgetTypeFqn(scadaWidgetType),
      type: scadaWidgetType.descriptor.type || widgetType.rpc,
      sizeX,
      sizeY,
      row,
      col,
      config: mergeDeep({} as any, defaultConfig, cadMappedScadaWidgetConfigDefaults({
        title: this.scadaSymbolTitle(entity),
        type: scadaWidgetType.descriptor.type || widgetType.rpc,
        preserveAspectRatio: true,
        stretchToFit: true,
        scadaSymbolUrl
      }))
    };
    return this.dashboardUtils.prepareWidgetForScadaLayout(widget, true);
  }

  private createWidgetForEntity(entity: CadEntityInfo | CadImportWidgetEntity, mapping: WidgetInfo | null): Observable<Widget> {
    const { col, row, sizeX, sizeY } = expandCadGridBounds(
      this.scaleCadToGrid(entity),
      TARGET_GRID_COLUMNS,
      this.targetGridRows(),
      MIN_CAD_VISUAL_WIDGET_SIZE_X,
      MIN_CAD_VISUAL_WIDGET_SIZE_Y
    );

    if (mapping) {
      return this.widgetService.getWidgetType(mapping.typeFullFqn).pipe(
        map((widgetType) => {
          const defaultConfig = this.dashboardUtils.widgetConfigFromWidgetType(widgetType.descriptor);
          const widget: Widget = {
            id: this.utils.guid(),
            typeFullFqn: mapping.typeFullFqn,
            type: mapping.type,
            sizeX,
            sizeY,
            row,
            col,
            config: mergeDeep({} as any, defaultConfig, cadMappedScadaWidgetConfigDefaults({
              title: mapping.title,
              type: mapping.type,
              preserveAspectRatio: false
            }))
          };
          return this.dashboardUtils.validateAndUpdateWidget(widget);
        })
      );
    } else {
      return this.getScadaSymbolWidgetType().pipe(
        switchMap(scadaWidgetType => this.uploadScadaSymbol(entity as CadEntityInfo).pipe(
          map(scadaSymbolUrl => this.createScadaSymbolWidget(entity, scadaSymbolUrl, scadaWidgetType))
        ))
      );
    }
  }

  generateWidgets(): Observable<Widget[]> {
    const importEntities = this.keptEntities.filter(entity => !this.deletedEntityIds.has(entity.id));
    const widgetItems = buildCadImportWidgetItems<WidgetInfo>({
      entities: importEntities,
      deletedEntityIds: this.deletedEntityIds,
      entityMappings: this.mappings,
      groupMappings: this.activeGroupMappings()
    });
    const plan = cadImportWidgetPlan({
      importEntityCount: widgetItems.length
    });
    this.importTotal = plan.totalWorkItems;
    this.importProgress = 0;

    return from(widgetItems).pipe(
      mergeMap((item, index) => {
        return this.createWidgetForEntity(item.entity, item.mapping).pipe(
          map(widget => ({ index, widget })),
          catchError(err => {
            console.warn(`Failed to create widget for CAD import item ${item.id}:`, err);
            return of({ index, widget: null });
          }),
          finalize(() => {
            this.importProgress++;
            this.cd.markForCheck();
          })
        );
      }, CAD_IMPORT_WIDGET_CONCURRENCY),
      toArray(),
      map(results => results
        .sort((a, b) => a.index - b.index)
        .map(result => result.widget)
        .filter((widget): widget is Widget => !!widget))
    );
  }

  onImportClick(): void {
    this.isLoading = true;
    this.generateWidgets().pipe(
      finalize(() => {
        this.isLoading = false;
        this.importProgress = 0;
        this.importTotal = 0;
      })
    ).subscribe({
      next: (widgets) => {
        if (widgets.length === 0) {
          this.errorMessage = this.translate.instant('dashboard.cad-import-dialog.no-entities');
          return;
        }
        this.dialogRef.close({
          widgets,
          layoutType: 'scada',
          targetColumns: TARGET_GRID_COLUMNS,
          cadAspectRatio: this.previewTransform
            ? this.previewTransform.height / this.previewTransform.width
            : (this.cadBounds ? this.cadBounds.height / this.cadBounds.width : undefined)
        });
      }
    });
  }

  get hasResult(): boolean {
    return !!this.result;
  }

  get entityCountWarning(): string | null {
    if (this.result && this.result.manifest.length > 500) {
      return this.translate.instant('dashboard.cad-import-dialog.too-many-entities', { count: this.result.manifest.length });
    }
    return null;
  }

  get keptEntityCount(): number {
    return this.result ? this.result.manifest.filter(e => !this.deletedEntityIds.has(e.id)).length : 0;
  }

  goBack(): void {
    const steps: CadImportStep[] = ['upload', 'preview', 'map', 'review'];
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
      this.groupMappings = this.activeGroupMappings();
      const groupedEntityIds = this.currentGroupedEntityIds();
      for (const entity of this.keptEntities) {
        if (!groupedEntityIds.has(entity.id) && !this.mappings.has(entity.id)) {
          this.mappings.set(entity.id, null);
        }
      }
    } else if (this.step === 'map') {
      this.onImportClick();
      return;
    }
    const steps: CadImportStep[] = ['upload', 'preview', 'map', 'review'];
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
