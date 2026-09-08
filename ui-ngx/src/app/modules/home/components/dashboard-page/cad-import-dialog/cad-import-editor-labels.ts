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

const english = {
  applyScheme: 'Apply saved mappings (optional)',
  group: 'Group as one SCADA', ungroup: 'Ungroup', map: 'Map (optional)',
  rawGroup: 'Original CAD group (no mapping)', rawEntity: 'Original CAD symbol',
  clearMapping: 'Remove mapping, keep geometry group',
  hint: 'Hold the left mouse button and drag to select. Grouping is optional; ungrouped CAD instances become separate editable SCADA widgets. Ctrl / middle button pans.',
  directImport: 'Import without further mapping',
  background: 'Performance mode: merge ungrouped, unmapped entities into one background',
  planned: 'SCADA widgets to create',
  many: 'Many independent widgets use more browser resources. Group related geometry or explicitly enable background mode. No entities will be silently merged.',
  fonts: 'Font substitution notice — text is vectorized; SCADA import is available',
  timing: 'Conversion stage timings (ms; server staging is not network upload)',
  cached: 'Reused a recent conversion for this tenant',
  preparing: 'Preparing independent SCADA content'
};
const chinese: typeof english = {
  applyScheme: '应用已保存映射（可选）',
  group: '组合为一个 SCADA', ungroup: '取消组合', map: '映射（可选）',
  rawGroup: '原始 CAD 组合（未映射）', rawEntity: '原始 CAD 符号',
  clearMapping: '取消映射，保留图形组合',
  hint: '按住鼠标左键拖动框选，再点击“组合为一个 SCADA”。未组合元件默认各自生成可编辑 SCADA；映射可选。Ctrl / 鼠标中键可平移。',
  directImport: '直接导入，无需映射',
  background: '性能模式：将未组合、未映射的元件合并为一个背景',
  planned: '预计生成 SCADA 控件数',
  many: '独立控件较多，会增加浏览器开销。可先组合相关图形，或主动启用背景模式；系统不会自动合并你的元件。',
  fonts: '字体替代提示：文字已转矢量路径，可以继续生成 SCADA',
  timing: '转换分阶段耗时（毫秒；服务端落盘不等于网络上传耗时）',
  cached: '已复用本租户最近的转换结果',
  preparing: '正在准备独立 SCADA 组件'
};
export const cadEditorLabels = (language?: string) => language?.toLowerCase().startsWith('zh') ? chinese : english;
