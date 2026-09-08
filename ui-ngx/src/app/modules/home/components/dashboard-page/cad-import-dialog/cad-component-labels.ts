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

/** Labels for the CAD component editor; independent of the large app locale bundles. */
export const cadComponentLabels = (language: string) => language?.toLowerCase().startsWith('zh') ? {
  group: '组合为 SCADA', ungroup: '取消组合', original: '保留 CAD 图形（不映射）',
  map: '映射组件', removeMapping: '取消映射（保留组合）',
  hint: '按住左键拖动框选；点击可多选。组合无需映射，未组合的元件默认独立导入。Ctrl/中键拖动平移。',
  background: '将未组合、未映射的元件合并为只读背景（可选）',
  componentCount: '独立组件 / 组合', importProgress: '正在生成独立 SCADA 组件',
  restoring: '恢复删除和组合记录；设备映射需重新检查',
  noMapping: '映射不是必选项；直接导入会保留原 CAD 矢量图形。'
} : {
  group: 'Group as SCADA', ungroup: 'Ungroup', original: 'Original CAD artwork (unmapped)',
  map: 'Map component', removeMapping: 'Remove mapping (keep group)',
  hint: 'Hold and drag the left mouse button to box-select; click to multi-select. Grouping needs no mapping. Ungrouped instances import separately. Ctrl/middle-drag pans.',
  background: 'Merge ungrouped, unmapped instances into a static background (optional)',
  componentCount: 'Individual components / groups', importProgress: 'Creating SCADA components',
  restoring: 'Restore deletion and grouping records; review device mappings again',
  noMapping: 'Mapping is optional. Import directly to retain the original CAD vector artwork.'
};
