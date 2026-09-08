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

import { AfterViewChecked, ChangeDetectorRef, Component, ElementRef, Inject, OnDestroy, OnInit, ViewChild, NgZone, HostListener } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import { AppState } from '@core/core.state';
import { LocalStorageService } from '@core/local-storage/local-storage.service';
import { Router } from '@angular/router';
import { DialogComponent } from '@shared/components/dialog.component';
import { CadPerEntityResult, CadEntityInfo, PreviewTransform } from '@shared/models/cad-per-entity.models';
import { fullWidgetTypeFqn, Widget, WidgetInfo, widgetType, WidgetType } from '@shared/models/widget.models';
import { ImportExportService } from '@shared/import-export/import-export.service';
import { WidgetService } from '@core/http/widget.service';
import { DashboardUtilsService } from '@core/services/dashboard-utils.service';
import { CadWidgetSelectDialogComponent } from './cad-widget-select-dialog.component';
import { SVG, Svg, G, Rect } from '@svgdotjs/svg.js';
import { defer, from, Observable, of, Subject } from 'rxjs';
import { catchError, finalize, map, mergeMap, shareReplay, switchMap, toArray, takeUntil } from 'rxjs/operators';
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
  rectContains,
  screenPointToPreviewSvgCoords,
  shouldIgnoreEntityClickAfterDrag
} from './cad-import-geometry';
import {
  buildCadImportWidgetItemsAsync,
  CadImportGroupMapping,
  CadImportWidgetEntity,
  cadImportWidgetPlan,
  cadMappedScadaWidgetConfigDefaults,
  expandCadGridBounds
} from './cad-import-widget-generation';
import { buildCadSvgSceneAsync, decodeCadSvg } from './cad-import-svg';
import { cadComponentLabels } from './cad-component-labels';
import { combineCadSelection, expandCadGroupSelection, cadComponentSnapshot, restoreCadComponentSnapshot } from './cad-component-groups';
import { cadBoundsToGrid, cadGridFrame } from './cad-import-grid';
import { CadSceneState, CadSceneSnapshot } from './cad-scene-state';
import {
  applyCadMappingScheme,
  CAD_MAPPING_SCHEME_STORAGE_KEY,
  CadMappingScheme,
  createCadMappingScheme,
  loadCadMappingScheme
} from './cad-import-mapping-scheme';

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
  backgroundColor?: string;
}

type CadImportStep = 'upload' | 'preview' | 'map' | 'review';
type CadEntityGroupMapping = CadImportGroupMapping<WidgetInfo>;

const VIEWPORT_WIDTH = 1200;
const VIEWPORT_HEIGHT = 700;
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

  importMode: 'components' | 'background' = 'components';
  savedComponents: unknown = null;
  get labels() { return cadComponentLabels(this.translate.getCurrentLang()); }
  step: CadImportStep = 'upload';
  previewMode: 'select' | 'map' = 'select';
  isLoading = false;
  uploadPercent: number | null = null;
  importProgress = 0;
  importTotal = 0;
  importFailedCount = 0;
  importFailedIds: string[] = [];
  result: CadPerEntityResult | null = null;
  private scene: CadSceneState<CadEntityInfo> | null = null;
  private readonly emptyIds = new Set<string>();
  private readonly destroyed$ = new Subject<void>();
  private processing: AbortController | null = null;
  private thumbnailUrls = new Map<string, string>();
  private entityOrder = new Map<string, number>();
  private widgetTypes = new Map<string, Observable<WidgetType>>();
  private summary: { groups: CadEntityGroupMapping[]; entities: CadEntityInfo[]; groupedIds: Set<string>; mapped: number; groupByEntityId: Map<string, CadEntityGroupMapping> } | null = null;
  savedEdits: CadSceneSnapshot | null = null;
  sceneWarning = '';
  conversionWarnings: { type: string; handle: string; reason: string }[] = [];
  fidelityAcknowledged = false;
  pageIndex = 0;
  readonly pageSize = 50;
  get keptEntities(): CadEntityInfo[] { return this.scene?.keptEntities || []; }
  get canUndoDelete(): boolean { return !!this.scene?.canUndo; }
  get pageCount(): number { return Math.max(1, Math.ceil(Math.max(this.mappedGroups.length, this.mapStepEntities.length) / this.pageSize)); }
  get pageEntities(): CadEntityInfo[] { return this.mapStepEntities.slice(this.pageIndex * this.pageSize, (this.pageIndex + 1) * this.pageSize); }
  get pageGroups(): CadEntityGroupMapping[] { return this.mappedGroups.slice(this.pageIndex * this.pageSize, (this.pageIndex + 1) * this.pageSize); }
  mappings: Map<string, WidgetInfo | null> = new Map<string, WidgetInfo | null>();
  groupMappings: CadEntityGroupMapping[] = [];
  mappingSchemeName = '';
  mappingSchemeStatus: 'loaded' | 'saved' | 'error' | null = null;
  selectedEntityIds: Set<string> = new Set<string>();
  get deletedEntityIds(): ReadonlySet<string> { return this.scene?.deletedEntityIds || this.emptyIds; }
  errorMessage = '';
  cadBounds: { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number } | null = null;
  private msBounds: { minX: number; maxX: number; minY: number; maxY: number } | null = null;
  private previewTransform: PreviewTransform | null = null;

  private svgCanvas: Svg | null = null;
  private entityGroups: Map<string, G> = new Map<string, G>();
  private selectionHighlights: Map<string, Rect> = new Map<string, Rect>();
  private highlightLayer: G | null = null;
  private previewRendered = false;
  private viewDestroyed = false;
  private isDragging = false;
  private selectionMoved = false;
  private suppressNextEntityClickId: string | null = null;
  private dragStartEntityId: string | null = null;
  private selectionRect: any = null;

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
    private localStorageService: LocalStorageService,
    private cd: ChangeDetectorRef,
    private zone: NgZone,
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
      // Do not change template-bound loading state in the view-check hook.
      this.previewRendered = true;
      queueMicrotask(() => {
        if (!this.viewDestroyed && this.step === 'preview') void this.renderPreview();
      });
    }
  }

  ngOnDestroy(): void {
    this.viewDestroyed = true;
    this.processing?.abort();
    this.destroyed$.next();
    this.destroyed$.complete();
    this.clearThumbnails();
    this.svgCanvas?.remove();
  }

  onUploadClick(): void {
    this.isLoading = true;
    this.errorMessage = '';
    this.uploadPercent = null;
    this.importExport.importCadFilePerEntity(percent => { this.uploadPercent = percent; this.cd.markForCheck(); }).pipe(takeUntil(this.destroyed$)).subscribe({
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
    try {
      this.initializeConversionResult(result);
    } catch (error) {
      this.scene = null;
      this.result = null;
      this.summary = null;
      this.errorMessage = error instanceof Error ? error.message : String(error);
      this.isLoading = false;
      this.step = 'upload';
    }
  }

  private initializeConversionResult(result: CadPerEntityResult): void {
    this.processing?.abort();
    this.scene = null;
    this.result = null;
    this.summary = null;
    this.clearThumbnails();
    this.widgetTypes.clear();
    this.sceneWarning = '';
    this.conversionWarnings = (result.warnings || []).slice(0, 100);
    this.fidelityAcknowledged = false;
    this.importMode = 'components';
    this.savedComponents = null;
    this.pageIndex = 0;
    if (result.manifest.length === 0) {
      this.errorMessage = this.translate.instant('dashboard.cad-import-dialog.no-entities');
      this.step = 'upload';
      return;
    }
    this.errorMessage = '';
    this.zoomLevel = 1;
    this.panX = 0;
    this.panY = 0;
    this.result = result;
    this.computeCadBounds();
    this.msBounds = result.modelspaceBounds || null;
    this.previewTransform = result.previewTransform || null;
    this.scene = new CadSceneState(result.sceneId || '', result.manifest);
    this.entityOrder = new Map(result.manifest.map((entity, index) => [entity.id, index]));
    const saved = Object.values(this.data.dashboard?.configuration?.widgets || {})
      .map((widget: any) => widget.config?.cadSceneEdits)
      .filter((value: any) => value?.sceneId === result.sceneId);
    // Do not silently reapply deletions to a fresh upload. Restoration is explicit.
    this.savedEdits = saved.length === 1 ? saved[0] as CadSceneSnapshot : null;
    const components = Object.values(this.data.dashboard?.configuration?.widgets || {})
      .map((widget: any) => widget.config?.cadComponents)
      .filter((value: any) => value?.sceneId === result.sceneId);
    this.savedComponents = components.length === 1 ? components[0] : null;
    if (result.unrenderedEntityCount) {
      this.sceneWarning = `${result.unrenderedEntityCount} CAD instances were hidden, empty or unsupported; inspect the source before importing.`;
    }
    if (result.skippedPrimitiveCount) {
      this.sceneWarning += ` ${result.skippedPrimitiveCount} primitives were unsupported or skipped by the renderer.`;
    }
    this.selectedEntityIds.clear();
    this.mappings.clear();
    this.groupMappings = [];
    const mappingScheme = this.readMappingScheme();
    this.mappingSchemeName = mappingScheme?.name || '';
    this.mappingSchemeStatus = mappingScheme ? 'loaded' : null;
    if (mappingScheme) {
      const application = applyCadMappingScheme(this.keptEntities, mappingScheme);
      this.groupMappings = application.groupMappings;
      if (application.groupMatchingLimited) this.sceneWarning += ' Automatic group matching reached its safety limit; map remaining groups manually.';
      application.entityMappings.forEach((widgetInfo, entityId) => this.mappings.set(entityId, widgetInfo));
    }
    this.previewRendered = false;
    this.step = 'preview';
  }

  private readMappingScheme(): CadMappingScheme | null {
    try {
      return loadCadMappingScheme(this.localStorageService.getItem(CAD_MAPPING_SCHEME_STORAGE_KEY));
    } catch {
      return null;
    }
  }

  saveMappingScheme(): void {
    const entities = this.keptEntities.filter(entity => !this.deletedEntityIds.has(entity.id));
    const scheme = createCadMappingScheme(
      this.mappingSchemeName,
      entities,
      this.mappings,
      this.activeGroupMappings()
    );
    try {
      this.localStorageService.setItem(CAD_MAPPING_SCHEME_STORAGE_KEY, scheme);
      this.mappingSchemeName = scheme.name;
      this.mappingSchemeStatus = 'saved';
    } catch {
      this.mappingSchemeStatus = 'error';
    }
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

  private async renderPreview(): Promise<void> {
    if (!this.previewCanvasRef?.nativeElement || !this.result || !this.cadBounds) return;

    this.previewRendered = true;
    this.processing?.abort();
    const processing = new AbortController();
    this.processing = processing;
    this.isLoading = true;
    this.errorMessage = '';
    const container = this.previewCanvasRef.nativeElement;
    container.innerHTML = '';

    const frame = this.derivePreviewViewBox();
    if (!frame) {
      this.errorMessage = 'CAD preview transform is missing. Please convert the drawing again.';
      this.isLoading = false;
      return;
    }
    let outerSvg: SVGSVGElement;
    try {
      // Preview the exact assets that will be imported, not a separately rendered
      // full drawing plus hitboxes. Rebuilding also reapplies all deletions.
      outerSvg = await this.zone.runOutsideAngular(() => buildCadSvgSceneAsync(
        this.keptEntities, frame, this.deletedEntityIds, { signal: processing.signal, backgroundColor: this.result?.backgroundColor || '#ffffff' }));
      if (processing.signal.aborted) return;
    } catch (error) {
      if (processing.signal.aborted) return;
      this.errorMessage = error instanceof Error ? error.message : String(error);
      this.isLoading = false;
      this.cd.markForCheck();
      return;
    }
    this.isLoading = false;
    outerSvg.setAttribute('width', String(VIEWPORT_WIDTH));
    outerSvg.setAttribute('height', String(VIEWPORT_HEIGHT));
    outerSvg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    outerSvg.style.display = 'block';
    container.appendChild(outerSvg);

    this.svgCanvas = SVG(outerSvg) as Svg;

    this.entityGroups.clear();
    this.selectionHighlights.clear();
    this.highlightLayer = this.svgCanvas.group().addClass('cad-selection-highlight-layer');
    this.bindPreviewEntityGroups();

    this.setupDragSelect();
    this.applyTransform();
    this.cd.markForCheck();
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
        const suppressClick = this.suppressNextEntityClickId === entityId;
        this.suppressNextEntityClickId = null;
        if (suppressClick) {
          return;
        }
        if (this.previewMode === 'map') {
          const entity = this.scene?.entityById.get(entityId);
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

  @HostListener('document:mousemove', ['$event'])
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
    this.selectionMoved = this.selectionMoved || Math.hypot(event.clientX - this.dragScreenStartX, event.clientY - this.dragScreenStartY) >= 4;
    this.selectionRect.move(x, y).size(w, h);
  }

  @HostListener('document:mouseup', ['$event'])
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

    if (shouldIgnoreEntityClickAfterDrag(this.selectionMoved, { width: selW, height: selH })) {
      this.selectEntitiesInRect(selX, selY, selW, selH);
      if (this.dragStartEntityId) {
        const draggedEntityId = this.dragStartEntityId;
        this.suppressNextEntityClickId = draggedEntityId;
        setTimeout(() => {
          if (this.suppressNextEntityClickId === draggedEntityId) {
            this.suppressNextEntityClickId = null;
          }
        });
      }
    }

    this.selectionRect.remove();
    this.selectionRect = null;
    this.selectionMoved = false;
    this.dragStartEntityId = null;
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
      if (this.isLoading || event.ctrlKey || event.button !== 0) return;
      this.isDragging = true;
      this.selectionMoved = false;
      this.dragStartEntityId = (event.target as Element | null)
        ?.closest('.cad-entity')?.getAttribute('data-cad-entity-id') || null;
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
      if (bbox && rectContains({ x, y, width: w, height: h }, bbox)) {
        this.selectedEntityIds.add(id);
      }
    }
    this.selectedEntityIds = expandCadGroupSelection(this.selectedEntityIds, this.activeGroupMappings());
    this.updateSelectionVisuals();
  }

  private entitySelectionBounds(entityId: string, group: G): CadRect | null {
    const entity = this.scene?.entityById.get(entityId);
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
    const ids = expandCadGroupSelection([entityId], this.activeGroupMappings());
    const remove = [...ids].every(id => this.selectedEntityIds.has(id));
    ids.forEach(id => remove ? this.selectedEntityIds.delete(id) : this.selectedEntityIds.add(id));
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
    const entity = this.scene?.entityById.get(entityId);
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

  deleteSelected(): void {
    if (this.isLoading || !this.scene) return;
    this.selectedEntityIds = expandCadGroupSelection(this.selectedEntityIds, this.activeGroupMappings());
    this.scene.deleteInstances(this.selectedEntityIds);
    this.removeGroupsContaining(this.selectedEntityIds);
    for (const id of this.selectedEntityIds) {
      this.mappings.delete(id);
      this.selectionHighlights.get(id)?.remove();
      this.selectionHighlights.delete(id);
      const group = this.entityGroups.get(id);
      if (group) {
        group.remove();
        this.entityGroups.delete(id);
      }
    }
    this.selectedEntityIds.clear();
    this.updateMappingVisuals();
  }

  undoDelete(): void {
    if (this.isLoading || !this.scene) return;
    this.scene.undoDelete();
    this.summary = null;
    this.selectedEntityIds.clear();
    this.previewRendered = false;
  }

  restoreSavedEdits(): void {
    if (this.isLoading || !this.scene || !this.savedEdits) return;
    try {
      // Validate grouping against the future retained set BEFORE mutating deletion state.
      const futureIds = this.result!.manifest.filter(entity => !this.savedEdits!.deletedEntityIds.includes(entity.id)).map(entity => entity.id);
      const components = this.savedComponents ? restoreCadComponentSnapshot(this.savedComponents, this.scene.sceneId, futureIds) : null;
      this.scene.restore(this.savedEdits);
      if (components) {
        this.groupMappings = components.groups.map(group => ({ ...group, widgetInfo: null }));
        this.importMode = components.mode;
      }
      this.removeGroupsContaining(new Set(this.deletedEntityIds));
      this.deletedEntityIds.forEach(id => this.mappings.delete(id));
      this.selectedEntityIds.clear();
      this.summary = null;
      this.previewRendered = false;
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : String(error);
    }
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
      this.assignWidget(entity, widgetInfo);
    });
  }

  groupSelected(): void {
    if (this.isLoading) return;
    try {
      const grouped = combineCadSelection(this.keptEntities.map(entity => entity.id), this.activeGroupMappings(),
        this.selectedEntityIds, this.utils.guid());
      this.groupMappings = grouped.groups;
      this.selectedEntityIds = grouped.selected;
      this.updateMappingVisuals();
      this.updateSelectionVisuals();
    } catch (error) { this.errorMessage = error instanceof Error ? error.message : String(error); }
  }

  ungroupSelected(): void {
    if (this.isLoading) return;
    this.removeGroupsContaining(this.selectedEntityIds);
    this.updateMappingVisuals();
  }

  ungroup(group: CadEntityGroupMapping): void {
    if (this.isLoading) return;
    this.groupMappings = this.groupMappings.filter(existing => existing.id !== group.id);
    this.updateMappingVisuals();
  }

  mapGroup(group: CadEntityGroupMapping): void {
    this.openWidgetSelectDialog(widgetInfo => {
      const current = this.groupMappings.find(existing => existing.id === group.id);
      if (current) current.widgetInfo = widgetInfo;
      this.updateMappingVisuals();
    });
  }

  get canUngroupSelected(): boolean {
    return this.activeGroupMappings().some(group => group.entityIds.some(id => this.selectedEntityIds.has(id)));
  }

  mapSelectedGroup(): void {
    const selectedIds = this.sortEntityIdsByManifest(
      Array.from(expandCadGroupSelection(this.selectedEntityIds, this.activeGroupMappings())).filter(id => !this.deletedEntityIds.has(id))
    );
    if (selectedIds.length === 0) {
      return;
    }
    this.openWidgetSelectDialog(widgetInfo => {
      const selectedIdSet = new Set(selectedIds);
      this.removeGroupsContaining(selectedIdSet);
      if (selectedIds.length === 1) {
        this.mappings.set(selectedIds[0], widgetInfo);
      } else {
        selectedIds.forEach(id => this.mappings.delete(id));
        this.groupMappings.push({
          id: this.utils.guid(),
          entityIds: selectedIds,
          widgetInfo
        });
      }
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
    dialogRef.afterClosed().pipe(takeUntil(this.destroyed$)).subscribe((widgetInfo: WidgetInfo | undefined) => {
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
      this.assignWidget(entity, widgetInfo);
    });
  }

  private updateMappingVisuals(): void {
    this.summary = null;
    this.pageIndex = 0;
    const groupedEntityIds = this.currentGroupedEntityIds();
    for (const [id, group] of this.entityGroups) {
      const node = group.node as SVGGElement;
      if (!node) continue;
      const owner = this.findGroupByEntityId(id);
      node.classList.toggle('grouped', groupedEntityIds.has(id));
      if (owner ? !!owner.widgetInfo : !!this.mappings.get(id)) {
        node.classList.add('mapped');
      } else {
        node.classList.remove('mapped');
      }
    }
  }

  assignWidget(entity: CadEntityInfo, widgetInfo: WidgetInfo | null): void {
    this.removeGroupsContaining(new Set([entity.id]));
    this.mappings.set(entity.id, widgetInfo);
    this.updateMappingVisuals();
  }

  removeMapping(entity: CadEntityInfo): void {
    this.mappings.set(entity.id, null);
    this.updateMappingVisuals();
  }

  removeGroupMapping(group: CadEntityGroupMapping): void {
    const current = this.groupMappings.find(existing => existing.id === group.id);
    if (current) current.widgetInfo = null;
    this.updateMappingVisuals();
  }

  private findGroupByEntityId(entityId: string): CadEntityGroupMapping | undefined {
    return this.mappingSummary().groupByEntityId.get(entityId);
  }

  private removeGroupsContaining(entityIds: Set<string>): void {
    if (!entityIds.size) {
      return;
    }
    this.groupMappings = this.groupMappings.filter(group =>
      !group.entityIds.some(id => entityIds.has(id))
    );
    this.summary = null;
  }

  private sortEntityIdsByManifest(entityIds: string[]): string[] {
    const order = this.entityOrder;
    return [...entityIds].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  }

  private mappingSummary() {
    if (!this.summary) {
      const keptIds = new Set(this.keptEntities.map(entity => entity.id));
      const groupedIds = new Set<string>();
      const groups = this.groupMappings.map(group => ({
        ...group, entityIds: this.sortEntityIdsByManifest(group.entityIds.filter(id => keptIds.has(id)))
      })).filter(group => group.entityIds.length >= 2);
      groups.forEach(group => group.entityIds.forEach(id => groupedIds.add(id)));
      const entities = this.keptEntities.filter(entity => !groupedIds.has(entity.id));
      const mapped = groups.filter(group => !!group.widgetInfo).length + entities.filter(entity => !!this.mappings.get(entity.id)).length;
      const originalGroups = new Map(this.groupMappings.map(group => [group.id, group]));
      const groupByEntityId = new Map<string, CadEntityGroupMapping>();
      groups.forEach(group => group.entityIds.forEach(id => groupByEntityId.set(id, originalGroups.get(group.id)!)));
      this.summary = { groups, entities, groupedIds, mapped, groupByEntityId };
    }
    return this.summary;
  }

  private activeGroupMappings(): CadEntityGroupMapping[] { return this.mappingSummary().groups; }
  private currentGroupedEntityIds(): Set<string> { return this.mappingSummary().groupedIds; }
  get mappedGroups(): CadEntityGroupMapping[] { return this.mappingSummary().groups; }
  get mapStepEntities(): CadEntityInfo[] { return this.mappingSummary().entities; }
  get mappedCount(): number { return this.mappingSummary().mapped; }
  get unmappedCount(): number { return this.mapStepEntities.length + this.mappedGroups.length - this.mappedCount; }

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
    const cached = this.thumbnailUrls.get(entity.id);
    if (cached) return cached;
    let svg = decodeCadSvg(entity.svgBase64);
    try {
      svg = removeScadaSymbolMetadata(svg);
    } catch {
      svg = this.ensureCompleteSvg(svg, entity);
    }
    if (!svg.match(/\swidth=/)) {
      svg = svg.replace(/<svg/, '<svg width="120" height="120"');
    }
    if (this.thumbnailUrls.size >= 200) this.clearThumbnails();
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    this.thumbnailUrls.set(entity.id, url);
    return url;
  }

  private clearThumbnails(): void {
    this.thumbnailUrls.forEach(url => URL.revokeObjectURL(url));
    this.thumbnailUrls.clear();
  }

  private scaleCadToGrid(entity: CadEntityInfo | CadImportWidgetEntity): { col: number; row: number; sizeX: number; sizeY: number } {
    return cadBoundsToGrid({
      x: entity.previewX!, y: entity.previewY!, width: entity.previewWidth!, height: entity.previewHeight!
    }, this.targetGrid());
  }

  private targetGrid() {
    const frame = this.derivePreviewViewBox();
    if (!frame) throw new Error('CAD scene transform is missing. Please convert the drawing again.');
    return cadGridFrame(frame);
  }

  private cachedWidgetType(fqn: string): Observable<WidgetType> {
    if (!this.widgetTypes.has(fqn)) {
      this.widgetTypes.set(fqn, this.widgetService.getWidgetType(fqn).pipe(shareReplay({ bufferSize: 1, refCount: true })));
    }
    return this.widgetTypes.get(fqn)!;
  }

  private getScadaSymbolWidgetType(): Observable<WidgetType> { return this.cachedWidgetType(SCADA_SYMBOL_FQN); }

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
    const rawSvg = entity.svgBase64 ? decodeCadSvg(entity.svgBase64) : '';
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

  private targetGridRows(): number { return this.targetGrid().rows; }

  private createScadaSymbolWidget(entity: CadEntityInfo | CadImportWidgetEntity, scadaSymbolUrl: string, scadaWidgetType: WidgetType): Widget {
    const { col, row, sizeX, sizeY } = expandCadGridBounds(
      this.scaleCadToGrid(entity),
      this.targetGrid().columns,
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
        stretchToFit: false,
        scadaSymbolUrl
      }))
    };
    return this.dashboardUtils.prepareWidgetForScadaLayout(widget, true);
  }

  private createWidgetForEntity(entity: CadEntityInfo | CadImportWidgetEntity, mapping: WidgetInfo | null): Observable<Widget> {
    const { col, row, sizeX, sizeY } = expandCadGridBounds(
      this.scaleCadToGrid(entity),
      this.targetGrid().columns,
      this.targetGridRows(),
      MIN_CAD_VISUAL_WIDGET_SIZE_X,
      MIN_CAD_VISUAL_WIDGET_SIZE_Y
    );

    if (mapping) {
      return this.cachedWidgetType(mapping.typeFullFqn).pipe(
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
              preserveAspectRatio: false,
              stretchToFit: true
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

  private derivePreviewViewBox(): { x: number; y: number; width: number; height: number } | undefined {
    if (this.previewTransform) {
      return {
        x: this.previewTransform.x,
        y: this.previewTransform.y,
        width: this.previewTransform.width,
        height: this.previewTransform.height
      };
    }
    return undefined;
  }

  generateWidgets(): Observable<Widget[]> {
    const previewViewBox = this.derivePreviewViewBox();
    if (!previewViewBox || !this.scene) throw new Error('CAD scene is missing. Please convert the drawing again.');
    const snapshot = this.scene.snapshot();
    this.processing?.abort();
    const processing = new AbortController();
    this.processing = processing;
    return defer(() => this.zone.runOutsideAngular(() => buildCadImportWidgetItemsAsync<WidgetInfo>({
      entities: this.keptEntities,
      deletedEntityIds: this.deletedEntityIds,
      entityMappings: this.mappings,
      groupMappings: this.activeGroupMappings(),
      importMode: this.importMode,
      previewViewBox: this.targetGrid().viewBox,
      backgroundColor: this.result?.backgroundColor || '#ffffff'
    }, { signal: processing.signal, backgroundColor: this.result?.backgroundColor || '#ffffff' }))).pipe(
      switchMap(widgetItems => {
        this.importTotal = cadImportWidgetPlan({ importEntityCount: widgetItems.length }).totalWorkItems;
        this.importProgress = 0;
        this.importFailedCount = 0;
        this.importFailedIds = [];
        return from(widgetItems).pipe(
          mergeMap((item, index) => defer(() => this.createWidgetForEntity(item.entity, item.mapping)).pipe(
            map(widget => {
              widget.config['cadComponent'] = { version: 1, sceneId: this.result?.sceneId, id: item.id, entityIds: item.entityIds };
              return { index, widget };
            }),
            catchError(error => {
              console.warn(`Failed to create CAD item ${item.id}:`, error);
              this.importFailedCount++;
              this.importFailedIds.push(item.id);
              return of({ index, widget: null });
            }),
            finalize(() => { this.importProgress++; this.cd.markForCheck(); })
          ), CAD_IMPORT_WIDGET_CONCURRENCY),
          toArray(),
          map(results => {
            const widgets = results.sort((a, b) => a.index - b.index)
              .map(result => result.widget).filter((widget): widget is Widget => !!widget);
            // Saved/exported with the actual retained SVG resource, without
            // duplicating the CAD geometry in every widget configuration.
            if (widgets.length) Object.assign(widgets[0].config, {
              cadSceneEdits: snapshot,
              cadComponents: cadComponentSnapshot(snapshot.sceneId, this.activeGroupMappings(), this.importMode),
              cadConversionWarnings: this.conversionWarnings,
              cadFidelityAcknowledged: this.fidelityAcknowledged
            });
            return widgets;
          })
        );
      }),
      takeUntil(this.destroyed$)
    );
  }

  onImportClick(): void {
    if (this.conversionWarnings.length && !this.fidelityAcknowledged) {
      this.errorMessage = this.translate.instant('dashboard.cad-import-dialog.fidelity-acknowledge');
      return;
    }
    this.isLoading = true;
    this.errorMessage = '';
    defer(() => this.generateWidgets()).pipe(
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
        if (this.importFailedCount > 0) {
          const failedMessage = this.translate.instant('dashboard.cad-import-dialog.partial-import-failed',
            { count: this.importFailedCount });
          this.errorMessage = failedMessage;
          return; // Never silently commit an incomplete drawing.
        }
        this.dialogRef.close({
          widgets,
          layoutType: 'scada',
          backgroundColor: this.result?.backgroundColor || '#ffffff',
          targetColumns: this.targetGrid().columns,
          cadAspectRatio: this.previewTransform
            ? this.previewTransform.height / this.previewTransform.width
            : (this.cadBounds ? this.cadBounds.height / this.cadBounds.width : undefined)
        });
      },
      error: (error) => {
        this.errorMessage = error instanceof Error ? error.message : String(error);
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
    return this.keptEntities.length;
  }

  goBack(): void {
    if (this.isLoading) return;
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
    if (this.isLoading) return;
    if (this.step === 'preview') {
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
        if (this.errorMessage || (this.conversionWarnings.length && !this.fidelityAcknowledged)) return false;
        return this.result ? this.result.manifest.filter(e => !this.deletedEntityIds.has(e.id)).length > 0 : false;
      case 'map':
        return true;
      default:
        return false;
    }
  }
}
