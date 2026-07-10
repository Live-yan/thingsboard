# CAD Import Dashboard Interaction and Mapping Design

## Goal

让 CAD 导入仪表板流程支持可靠的完全包含框选、组合实体映射、可复用的 CAD 映射方案、可拖动的小型 widget，并验证短线/斜线在预览和 SCADA 仪表板中的显示配置一致。

## Scope and storage assumption

本次实现覆盖现有 `ui-ngx` CAD 导入对话框、CAD widget 生成、Gridster 编辑交互和 SCADA 显示配置。映射方案先保存在当前浏览器的 ThingsBoard 命名空间中，作为一个默认方案跨多次导入复用；当前分支没有可直接复用的租户级 CAD 方案 API，因此不在本次增加后端实体和权限模型。保存的数据只包含映射特征和 `WidgetInfo`，不包含 SVG 内容。

方案通过 `LocalStorageService` 使用 key `cad-import.mapping-scheme.v1` 持久化，实际浏览器 key 为 `TB-cad-import.mapping-scheme.v1`。该 key 明确是 browser-global（不按租户或用户隔离），数据根对象包含 `version: 1`、`name`、`updatedAt`、`entityRules` 和 `groupRules`；加载时只接受 version 1，其他版本按没有方案处理。

## Design

### Preview selection and mapping

`CadImportDialogComponent` 使用待拖状态区分点击和拖框。左键按下时无论起点是否落在实体上都记录起点；移动超过阈值后创建选择框，释放时只选择实体 preview bbox 完全位于选择框内的实体。拖框完成后抑制同一 pointer sequence 产生的实体 click，避免框选后又切换单实体选择。

工具栏的“映射已选中”按钮对一个或多个实体都可用。单实体写入普通 mapping；多个实体删除其已有分组关系和单项 mapping 后写入 `groupMappings`，随后打开现有部件库选择对话框。组合实体继续由 widget generation 的 union bbox 生成一个 widget，因此四条边可以映射成一个部件。

### Reusable mapping scheme

新增纯函数映射方案模块，负责：

- 从实体类型、SVG 中的 stroke/stroke-width、实体 bbox 和线段端点提取稳定特征；长度和绝对位置不进入单实体键。
- 用方向桶（水平、垂直、按角度量化的斜线）、颜色和描边宽度构造单实体规则。
- 用成员特征多重集、组合 bbox 形状类别和相邻连通关系构造组合规则。
- 导入完成后先尝试组合规则，再将剩余实体匹配到单实体规则；匹配成功的结果直接写入当前映射状态，用户仍可覆盖。

组合候选由未使用实体按 manifest 顺序建立：实体 bbox 相交或在由候选 union bbox 最大边长的 2%（至少 1 个 SVG 单位）扩展后的 bbox 内即视为相邻，并按连通分量生成候选。只有候选成员特征多重集与规则完全一致、且形状类别一致时才匹配。规则按成员数量降序、保存顺序升序处理；同一实体最多被第一个匹配规则使用，后续重叠候选跳过，因此结果确定且不会重复组合。

对外暴露的方案包括版本号、名称、更新时间、单实体规则和组合规则。保存按钮写入 `LocalStorageService`；加载失败、旧版本或单条坏规则只会忽略方案，不阻塞 CAD 导入。对单实体重新映射时，先移除包含该实体的现有组合映射，再写入单实体 mapping；多实体映射也会先移除所有涉及实体的旧分组和单项 mapping。

### SCADA visibility and generated widget configuration

继续使用已有的 dashboard entity SVG root viewBox、`data-cad-global-entity`、`vector-effect="non-scaling-stroke"` 和 `stretchToFit` 原生 SVG 缩放路径。所有 CAD 生成 widget 统一写入 CAD 导入标记，并通过 `cadMappedScadaWidgetConfigDefaults` 保持透明背景、零 padding、无标题、无阴影、可调整和正确的 RPC target device；映射部件与未映射 `system.scada_symbol` 都显式启用原生填充缩放。

### Edit-mode interaction

Gridster resize handle 不再用四条覆盖小组件大部分面积的边缘 handle。普通 widget 使用角点 handle；保持宽高比的 widget 保留右下角角点，非保持比例的 widget 使用四个角点。标记为 CAD 导入且 `sizeX <= 24 && sizeY <= 24` 的 widget 关闭 resize handle，确保整个 widget 可以拖动；用户仍可通过后续放大/配置调整尺寸。位置变化继续走现有 Gridster `updatePosition` 和 layout 持久化链路。

## Error handling

- 缺失或非法 SVG 特征降级为实体类型和 bbox 方向，不能因此阻止导入。
- 映射方案 JSON 解析失败时清除坏数据并按未应用方案继续。
- Widget type 或 SVG 上传失败沿用现有并发生成的逐项错误隔离，其他 widget 继续导入。
- 组合候选不满足成员数量、方向或连通条件时不自动组合，只保留单实体匹配。

## Tests

- 纯几何测试：完全包含、相交但不完全包含、反向拖框、从实体起点拖框。
- 映射方案测试：单实体特征忽略长度、颜色/描边/方向区分；四边组合在长度变化后仍能匹配；组合优先于单实体匹配。
- widget generation 测试：映射和未映射配置都启用 `stretchToFit`，写入 CAD 标记，组合 bbox 和映射保持一个 widget。
- Gridster 编辑策略测试：小型 CAD widget 不显示覆盖式 resize handle，中心拖动可用；普通 widget 和较大 CAD widget 保留角点缩放。
- 运行现有 Python CAD SVG 测试、前端纯 TypeScript specs、Angular lint/typecheck，并在可用环境执行完整构建。

## Risks and follow-up

浏览器本地方案不会跨浏览器共享，但会在同一浏览器 profile 的不同租户/用户会话之间复用；若产品需要隔离或团队共享，应复用本方案 JSON 结构新增租户级 REST 存储，而不改变匹配算法。组合自动匹配依赖 CAD 实体 bbox 的连通关系，复杂、重叠或间距很大的组合需要用户在预览中重新框选。
