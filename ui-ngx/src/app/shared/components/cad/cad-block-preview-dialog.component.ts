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

import { Component, Inject, OnInit, OnDestroy } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { DialogComponent } from '@shared/components/dialog.component';
import { AppState } from '@core/core.state';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { FormControl } from '@angular/forms';
import { debounceTime, takeUntil } from 'rxjs/operators';
import { Subject } from 'rxjs';
import { CadBlockInfo, CadConvertResult } from '@shared/models/cad-block-preview.models';

export interface CadBlockPreviewDialogData {
  convertResult: CadConvertResult;
}

// @dynamic
@Component({
    selector: 'tb-cad-block-preview-dialog',
    templateUrl: './cad-block-preview-dialog.component.html',
    styleUrls: ['./cad-block-preview-dialog.component.scss'],
    standalone: false
})
export class CadBlockPreviewDialogComponent extends DialogComponent<CadBlockPreviewDialogComponent, CadBlockInfo[]> implements OnInit, OnDestroy {

  blocks: CadBlockInfo[] = [];
  filteredBlocks: CadBlockInfo[] = [];
  selectedBlocks = new Set<string>();
  searchControl = new FormControl('');
  previewSvgBase64: string;

  get isAllSelected(): boolean {
    return this.filteredBlocks.length > 0 &&
      this.filteredBlocks.every(b => this.selectedBlocks.has(b.name));
  }

  private destroy$ = new Subject<void>();

  constructor(protected store: Store<AppState>,
              protected router: Router,
              public dialogRef: MatDialogRef<CadBlockPreviewDialogComponent>,
              @Inject(MAT_DIALOG_DATA) public data: CadBlockPreviewDialogData) {
    super(store, router, dialogRef);
  }

  ngOnInit(): void {
    this.blocks = this.data.convertResult.blocks ?? [];
    this.filteredBlocks = this.blocks;
    this.previewSvgBase64 = this.data.convertResult.previewSvgBase64;

    this.searchControl.valueChanges.pipe(
      debounceTime(200),
      takeUntil(this.destroy$)
    ).subscribe(query => this.filterBlocks(query ?? ''));
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    super.ngOnDestroy();
  }

  filterBlocks(query: string): void {
    const lowerQuery = query.toLowerCase();
    if (!lowerQuery) {
      this.filteredBlocks = this.blocks;
    } else {
      this.filteredBlocks = this.blocks.filter(b => b.name.toLowerCase().includes(lowerQuery));
    }
  }

  toggleBlock(blockName: string): void {
    const updated = new Set(this.selectedBlocks);
    if (updated.has(blockName)) {
      updated.delete(blockName);
    } else {
      updated.add(blockName);
    }
    this.selectedBlocks = updated;
  }

  toggleAll(): void {
    const updated = new Set(this.selectedBlocks);
    if (this.isAllSelected) {
      this.filteredBlocks.forEach(b => updated.delete(b.name));
    } else {
      this.filteredBlocks.forEach(b => updated.add(b.name));
    }
    this.selectedBlocks = updated;
  }

  importSelected(): void {
    const selected = this.blocks.filter(b => this.selectedBlocks.has(b.name));
    this.dialogRef.close(selected);
  }

  onCancel(): void {
    this.dialogRef.close(null);
  }
}
