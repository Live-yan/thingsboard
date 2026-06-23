# ThingsBoard SCADA 符号开发指南

## 一、`function(ctx, element)` 参数详解

### 1.1 状态渲染函数（State Render Function）

```javascript
function(ctx, element)
```

### 1.2 点击动作函数（On Click Action）

```javascript
function(ctx, element, event)
```

### 1.3 参数说明

| 参数 | 类型 | 说明 |
|------|------|------|
| `ctx` | `ScadaSymbolContext` | 上下文对象，包含数据、属性、API 等 |
| `element` | SVG.js Element | 当前 tag 对应的 SVG 元素 |
| `event` | Event | 点击事件对象（仅 On Click Action 可用） |

---

## 二、ScadaSymbolContext (`ctx`) 结构

```typescript
interface ScadaSymbolContext {
    api: ScadaSymbolApi;          // API 方法集合
    tags: {[id: string]: Element[]};  // 按 tagId 分组的 SVG 元素（仅全局函数）
    values: {[id: string]: any};      // Behavior 的当前值
    properties: {[id: string]: any};  // 用户配置的属性值
    svg: Svg;                         // 根 SVG 节点（仅全局函数）
}
```

### 2.1 `ctx.values` — 行为数据

访问 Behavior 定义的数据值：

```javascript
ctx.values.fanOn       // Boolean: 风扇开关状态
ctx.values.fanSpeed    // Number: 风扇转速
ctx.values.temperature // Number: 温度值
```

### 2.2 `ctx.properties` — 用户配置属性

访问符号的可配置属性：

```javascript
ctx.properties.onBtnColor        // String: 按钮颜色
ctx.properties.fanOnColor        // String: 风扇开启颜色
ctx.properties.rotationSpeedFont // Object: 字体配置
ctx.properties.rotationSpeedUnit // String: 单位
```

### 2.3 `ctx.tags` — 元素标签（仅全局渲染函数）

```javascript
ctx.tags.rotationSpeedText  // Array: 该 tagId 对应的所有 SVG 元素
ctx.tags.fanElement         // Array: 通常只有一个元素
```

### 2.4 `ctx.svg` — 根 SVG 节点（仅全局渲染函数）

```javascript
ctx.svg  // SVG.js Svg 对象，整个符号的根节点
```

---

## 三、ScadaSymbolApi (`ctx.api`) 方法参考

### 3.1 文本与样式

```javascript
// 设置文本内容
ctx.api.text(element, "Hello World");

// 设置字体和颜色
ctx.api.font(element, fontObject, "#FF0000");

// 设置图标
ctx.api.icon(element, "power_settings_new", 24, "#1C943E", true);

// 格式化数值
ctx.api.formatValue(123.456, 2, "°C");           // "123.46 °C"
ctx.api.formatValue(123.456, { dec: 2, units: "RPM" }); // 使用设置对象

// 单位转换
ctx.api.convertUnitValue(100, "km/h");  // 转换为目标单位
ctx.api.unitSymbol("km/h");              // 获取单位符号
```

### 3.2 动画（推荐使用 CSS 动画）

```javascript
// 创建 CSS 动画
var animation = ctx.api.cssAnimate(element, 2000);

// 获取当前动画实例
var animation = ctx.api.cssAnimation(element);

// 重置动画到初始状态
ctx.api.resetCssAnimation(element);

// 立即完成动画（跳到最终状态）
ctx.api.finishCssAnimation(element);
```

### 3.3 交互控制

```javascript
// 禁用元素（变灰、不可点击）
ctx.api.disable(element);

// 启用元素
ctx.api.enable(element);
```

### 3.4 数据操作

```javascript
// 触发 Behavior 定义的动作
ctx.api.callAction(event, 'behaviorId', undefined, {
    next: () => { /* 成功回调 */ },
    error: () => { /* 失败回调 */ }
});

// 设置 Behavior 值（仅用于预览调试）
ctx.api.setValue('fanOn', true);

// 生成唯一元素 ID
var id = ctx.api.generateElementId();
```

---

## 四、标签（Tags）与状态渲染函数的关系

### 4.1 数据流

```
SVG 元素 → 打 Tag ID → 定义 Behavior → State Render Function 渲染
```

1. **SVG 元素打标签**：在 SVG 编辑器中给元素设置 `data-tag-id="myTag"`
2. **定义 Behavior**：配置数据源（属性/时序/RPC），关联到 tag
3. **State Render Function**：当 Behavior 值变化时自动调用，修改 SVG 外观

### 4.2 两种渲染模式

**Tag 级别渲染函数**：每个 tag 独立配置

```javascript
// element 是当前 tag 对应的单个 SVG 元素
function(ctx, element) {
    if (ctx.values.fanOn) {
        element.attr({fill: ctx.properties.fanOnColor});
    } else {
        element.attr({fill: ctx.properties.fanOffColor});
    }
}
```

**全局渲染函数**（General State Render Function）：所有 tag 集中处理

```javascript
// svg 是根节点，用 ctx.tags.xxx 获取各 tag 的元素
function(ctx, svg) {
    var fanElements = ctx.tags.fanElement;
    fanElements.forEach(el => {
        if (ctx.values.fanOn) {
            el.attr({fill: ctx.properties.fanOnColor});
        }
    });
}
```

---

## 五、Behavior 配置

### 5.1 数据源类型（读取）

| Action Type | 说明 |
|-------------|------|
| Do nothing | 使用常量值 |
| Execute RPC | 发送 RPC 请求并使用响应 |
| Get attribute | 订阅实体属性 |
| Get time series | 订阅最新时序值 |
| Get alarm status | 订阅告警状态 |
| Get dashboard state | 获取当前仪表板状态名称 |

### 5.2 数据目标类型（写入）

| Action Type | 说明 |
|-------------|------|
| Execute RPC | 发送 RPC 命令到设备 |
| Set attribute | 写入属性值 |
| Add time series | 推送时序数据点 |

### 5.3 Behavior 配置示例

```yaml
# 布尔值行为（开关状态）
Id: fanOn
Name: On/Off state
Type: Value
Value type: Boolean
True label: On
False label: Off
State label: On
Default settings:
  Action: Get attribute
  Attribute scope: Shared
  Attribute key: fanOn

# 数值行为（转速）
Id: fanSpeed
Name: Fan rotation Speed
Hint: Value in RPM
Type: Value
Value type: Double
Default settings:
  Action: Get time series
  Time series key: fanSpeed

# 点击动作行为
Id: onBtnClick
Name: On button click
Type: Action
Value type: Boolean
Default settings:
  Action: Set attribute
  Attribute scope: Shared
  Attribute key: fanOn
  Value: True
```

---

## 六、Property 配置

属性是符号的可配置外观参数，供最终用户在仪表板编辑器中调整。

```yaml
# 文本属性
Id: onBtnLabel
Name: On button
Type: Text
Default value: On

# 颜色属性
Id: onBtnColor
Name: On button
Type: Color
Default value: "#1C943E"

# 开关属性
Id: showRotationSpeed
Name: Rotation speed
Type: Switch
Default value: true

# 单位属性
Id: rotationSpeedUnit
Name: Rotation speed
Type: Units
Default value: RPM

# 字体属性
Id: rotationSpeedFont
Name: Rotation speed
Type: Font
Default value: Roboto Normal 12px
```

---

## 七、配置点击变色

### 7.1 定义 Behavior

```yaml
Id: fanOn
Type: Value
Value type: Boolean
Default settings:
  Action: Get attribute
  Attribute scope: Shared
  Attribute key: fanOn
```

### 7.2 定义颜色 Property

```yaml
Id: fanOnColor
Type: Color
Default value: "#1C943E"    # 绿色

Id: fanOffColor
Type: Color
Default value: "#D12730"    # 红色
```

### 7.3 State Render Function

```javascript
function(ctx, element) {
    if (ctx.values.fanOn) {
        element.attr({fill: ctx.properties.fanOnColor});
    } else {
        element.attr({fill: ctx.properties.fanOffColor});
    }
}
```

### 7.4 On Click Action

```javascript
function(ctx, element, event) {
    ctx.api.disable(element);
    ctx.api.callAction(event, 'onBtnClick', undefined, {
        next: () => {
            ctx.api.setValue('fanOn', true);
        },
        error: () => {
            ctx.api.enable(element);
        }
    });
}
```

### 7.5 按钮启用/禁用状态渲染

```javascript
// onButton 的 State Render Function
function(ctx, element) {
    if (!ctx.values.fanOn) {
        ctx.api.enable(element);   // 风扇关闭时，ON 按钮可点击
    } else {
        ctx.api.disable(element);  // 风扇开启时，ON 按钮禁用
    }
}

// offButton 的 State Render Function
function(ctx, element) {
    if (ctx.values.fanOn) {
        ctx.api.enable(element);   // 风扇开启时，OFF 按钮可点击
    } else {
        ctx.api.disable(element);  // 风扇关闭时，OFF 按钮禁用
    }
}
```

---

## 八、配置动画

### 8.1 CSS 动画（推荐）

性能更好，适合大多数场景：

```javascript
function(ctx, element) {
    var on = ctx.values.fanOn;
    var speed = ctx.values.fanSpeed ? ctx.values.fanSpeed / 60 : 1;
    var animation = ctx.api.cssAnimation(element);

    if (on) {
        element.attr({fill: ctx.properties.fanOnColor});
        if (!animation) {
            // 创建新动画：2秒一圈，无限循环
            animation = ctx.api.cssAnimate(element, 2000)
                                .rotate(360)
                                .loop()
                                .speed(speed);
        } else {
            animation.speed(speed).play();
        }
    } else {
        element.attr({fill: ctx.properties.fanOffColor});
        if (animation) {
            animation.pause();
        }
    }
}
```

### 8.2 SVG.js 原生动画

使用 `element.remember()` 避免重复初始化：

```javascript
function(ctx, element) {
    var on = ctx.values.fanOn;
    var speed = ctx.values.fanSpeed ? ctx.values.fanSpeed / 60 : 1;
    var hasAnimation = element.remember('hasAnimation');

    if (on) {
        element.attr({fill: ctx.properties.fanOnColor});
        if (!hasAnimation) {
            element.remember('hasAnimation', true);
            element.animate(1000).ease('-').rotate(360).loop();
        } else {
            element.timeline().play();
        }
        element.timeline().speed(speed);
    } else {
        element.attr({fill: ctx.properties.fanOffColor});
        if (hasAnimation) {
            element.timeline().pause();
        }
    }
}
```

### 8.3 ScadaSymbolAnimation 方法链

```javascript
ctx.api.cssAnimate(element, 2000)
    .rotate(360, cx, cy)     // 旋转
    .scale(sx, sy)           // 缩放
    .x(value)                // X 位移
    .y(value)                // Y 位移
    .size(w, h)              // 尺寸变化
    .attr({fill: '#FF0000'}) // 属性变化
    .ease('linear')          // 缓动函数
    .loop(0, false)          // 循环（0=无限, swing=来回）
    .speed(1.5)              // 速度倍率
    .play()                  // 播放
    .pause()                 // 暂停
    .stop()                  // 停止并重置
    .finish()                // 立即完成
```

---

## 九、标签文本动态更新

```javascript
// 显示格式化的转速值
function(ctx, element) {
    var show = ctx.properties.showRotationSpeed && ctx.values.fanOn;
    if (show) {
        var speed = ctx.values.fanSpeed ? ctx.values.fanSpeed : 60;
        var font = ctx.properties.rotationSpeedFont;
        var color = ctx.properties.rotationSpeedColor;
        var text = ctx.api.formatValue(speed, 0, ctx.properties.rotationSpeedUnit);
        ctx.api.text(element, text);
        ctx.api.font(element, font, color);
        element.show();
    } else {
        element.hide();
    }
}

// 动态设置按钮标签
function(ctx, element) {
    ctx.api.text(element, ctx.properties.onBtnLabel);
}
```

---

## 十、连接器动画（Connector Animation）

用于管道/连接器的流体动画效果：

```javascript
// ConnectorScadaSymbolAnimation 方法
animation.flowAppearance(width, color, linecap, dashWidth, dashGap);
animation.duration(speed);
animation.direction(true);   // true=正向, false=反向
animation.play();
animation.stop();
animation.finish();
```

---

## 十一、最佳实践

### DO

- 使用 `ctx.api.callAction()` 触发设备命令
- 使用 RPC 或 Shared Attribute 控制设备状态
- 让设备上报真实状态作为 Behavior 数据源
- 使用 CSS 动画（`cssAnimate`）而非 SVG.js 原生动画
- 使用 `element.remember()` 避免动画重复初始化

### DON'T

- 不要直接 `ctx.api.setValue()` 修改本地状态（仅用于预览调试）
- 不要在 State Render Function 中初始化动画（会导致每次渲染都创建新动画）
- 不要忽略 `disable/enable` 的用户体验优化

### 推荐的设备交互模式

1. **RPC 命令**：用于需要即时响应的在线设备
2. **Shared Attribute**：用于可能离线的设备，上线后自动同步
3. **设备上报数据**：用设备的实际状态（而非命令）驱动 SCADA 符号显示

---

## 十二、CAD 文件导入生成 SCADA 符号

### 12.1 功能概述

从仪表板编辑页面点击"从CAD导入"按钮，选择 `.dwg` 或 `.dxf` 文件后，系统自动将 CAD 图纸转换为逐实体 SVG，注册为 ThingsBoard SCADA 符号资源，并在仪表板上按 CAD 坐标比例布局。

### 12.2 涉及文件

#### 后端（Java + Python）

| 文件 | 作用 |
|------|------|
| `application/src/main/java/org/thingsboard/server/controller/CadController.java` | REST 接口：`POST /api/cad/convert`（block 模式）、`POST /api/cad/convert-per-entity`（逐实体模式） |
| `application/src/main/java/org/thingsboard/server/service/entitiy/cad/DefaultCadService.java` | 调用 Python 脚本、读取转换产物、base64 编码返回 |
| `application/src/main/java/org/thingsboard/server/service/entitiy/cad/CadPerEntityResult.java` | 返回 DTO：previewSvgBase64 + manifest 实体列表 + modelspaceBounds |
| `application/src/main/java/org/thingsboard/server/service/entitiy/cad/CadEntityInfo.java` | 单实体 DTO：id, type, svgBase64, x, y, width, height, blockName |
| `application/src/main/java/org/thingsboard/server/config/CadConfig.java` | 配置：pythonPath, scriptPath, timeout(300s), maxFileSize(50MB), maxEntities(5000) |
| `application/src/main/resources/thingsboard.yml` | `cad.*` 配置段 |
| `application/src/main/data/scripts/cad/dwg_to_svg.py` | **核心 Python 转换脚本**：DWG→DXF(ODA)→SVG(ezdxf) |
| `application/src/main/java/org/thingsboard/server/dao/util/ImageUtils.java` | SVG 上传时的元数据提取与缩略图生成（jsvg 解析） |

#### 前端（Angular）

| 文件 | 作用 |
|------|------|
| `ui-ngx/src/app/modules/home/components/dashboard-page/dashboard-page.component.ts` | `importFromCad()` — 打开 CAD 导入对话框，接收 widget 结果并布局到仪表板 |
| `ui-ngx/src/app/modules/home/components/dashboard-page/dashboard-page.component.html` | "从CAD导入"按钮（`architecture` 图标），点击触发文件选择 |
| `ui-ngx/src/app/modules/home/components/dashboard-page/cad-import-dialog/cad-import-dialog.component.ts` | 4 步导入对话框：upload→preview→map→review，生成 widget |
| `ui-ngx/src/app/modules/home/components/dashboard-page/cad-import-dialog/cad-import-dialog.component.html` | 对话框模板 |
| `ui-ngx/src/app/modules/home/components/dashboard-page/cad-import-dialog/cad-widget-select-dialog.component.ts` | 实体映射到已有 widget 的选择对话框 |
| `ui-ngx/src/app/shared/import-export/import-export.service.ts` | `importCadFilePerEntity()` — 创建隐藏 `<input type="file">` 并 POST 到后端 |
| `ui-ngx/src/app/shared/models/cad-per-entity.models.ts` | 前端 TypeScript 接口定义 |
| `ui-ngx/src/app/core/http/image.service.ts` | `uploadImage()` — 上传 SVG 为 SCADA_SYMBOL 图片资源 |
| `ui-ngx/src/app/modules/home/components/widget/lib/scada/scada-symbol-widget.component.ts` | SCADA 符号 widget 渲染组件 |
| `ui-ngx/src/app/modules/home/components/widget/lib/scada/scada-symbol.models.ts` | `ScadaSymbolObject` 核心引擎、`removeScadaSymbolMetadata` 等工具函数 |
| `ui-ngx/src/app/shared/components/image/image-gallery.component.ts` | `/resources/scada-symbols` 页面的"从CAD文件导入"按钮（block 模式，参考实现） |

### 12.3 转换流程

```
DWG 文件
  → Python: DWG→DXF (ODA File Converter)
  → Python: DXF→逐实体 SVG (ezdxf SVGBackend)
    → 每个实体: _render_msp_to_svg → 检测退化 → fallback → _resize_svg → _wrap_scada_symbol
  → 后端: 读取 SVG + manifest.json，base64 编码，返回 CadPerEntityResult
  → 前端对话框: preview→map→review
  → 导入: 未映射实体 → uploadEntityAsScadaSymbol(POST /api/image) → 获取 scadaSymbolUrl
  → 仪表板: 按 CAD 坐标比例布局 widget 到 1000×1000 SCADA 网格
```

### 12.4 Python 脚本关键函数

| 函数 | 作用 |
|------|------|
| `dwg_to_dxf()` | 调用 ODA File Converter 将 DWG 转 DXF |
| `_render_msp_to_svg(doc, msp, coord_space)` | 用 ezdxf SVGBackend 渲染 modelspace 为 SVG |
| `_strip_xml_prolog(svg_str)` | 移除 `<?xml?>` / `<!DOCTYPE>` / 注释 |
| `_strip_mm_dimensions(svg_str)` | 移除 mm 物理尺寸属性 |
| `_remove_background_rect(svg_str)` | 移除 ezdxf 渲染的背景 rect |
| `_resize_svg(svg_str, target_width, transparent_bg, invert_colors)` | 调整尺寸、加 viewBox padding、反转颜色 |
| `_build_fallback_svg(entity, doc)` | 退化实体的 fallback：手动从几何数据构建归一化 SVG |
| `_wrap_scada_symbol(svg_str, title)` | 添加 `xmlns:tb` 命名空间 + `<tb:metadata>` 元数据 |
| `dxf_to_per_entity_svgs(dxf_path, output_folder)` | 逐实体转换主函数 |

### 12.5 SCADA 符号 SVG 格式要求

ThingsBoard 的 SCADA 符号 SVG 必须满足：

```xml
<svg xmlns="http://www.w3.org/2000/svg" xmlns:tb="https://thingsboard.io/svg"
     viewBox="0 0 W H">
  <tb:metadata><![CDATA[{"title":"...","widgetSizeX":3,"widgetSizeY":3,"tags":[],"behavior":[],"properties":[]}]]></tb:metadata>
  <!-- SVG 图形内容 -->
</svg>
```

- **`xmlns:tb`** 命名空间必须存在
- **`<tb:metadata>`** 不能有 `xmlns=""` 属性（会导致 Java StAX 解析器报错）
- **`viewBox`** 必须使用归一化坐标 `0 0 W H`，不能用 CAD 世界坐标
- **`width`/`height`** 根标签属性会被 `_wrap_scada_symbol` 移除（由 ThingsBoard 控制尺寸）
- **`stroke-width`** 需相对于归一化空间设置（1000 单位空间中 5.0 为合理值）
- **viewBox padding** 必须大于 `stroke-width / 2`，否则线条边缘被裁剪

### 12.6 退化实体处理

当 ezdxf 渲染零宽度/零高度的单一实体（如垂直线 `bb_w=0`、水平线 `bb_h=0`）时，`SVGBackend` 输出空的自闭合 `<svg />`，导致 SCADA 符号残缺。

`_build_fallback_svg()` 函数手动从实体几何构建 SVG：

1. **坐标归一化** — CAD 世界坐标 → `0 0 W H` 空间（`nx(x) = (x - min_x) * scale`，`ny(y) = (max_y - y) * scale`）
2. **标准尺寸** — 较大边归一化到 1000 单位，最小 10 单位
3. **stroke-width** — `max(norm_w, norm_h) * 0.005`（在 1000 空间中为 5.0）
4. **支持类型** — LINE, LWPOLYLINE, POLYLINE, CIRCLE, ARC, TEXT, MTEXT, ELLIPSE

### 12.7 `_resize_svg` padding 修复

`_resize_svg` 的 stroke-width 提取正则需同时匹配 CSS 风格和 XML 属性：

```python
# 兼容 stroke-width:5 (CSS) 和 stroke-width="5.00" (XML 属性)
for m in re.finditer(r'stroke-width(?::\s*|=")(\d+(?:\.\d+)?)', svg_str):
    max_sw = max(max_sw, float(m.group(1)))
pad_sw = int(max_sw / 2 + 1)
```

### 12.8 前端导入流程优化

- **按钮直接触发文件选择** — `importFromCad()` 传 `autoUpload: true`，对话框 `ngOnInit` 自动调用 `onUploadClick()`
- **顺序上传** — `forkJoin` 改为 `concatMap` + `toArray`，避免 100+ 并发 HTTP 请求耗尽浏览器连接池
- **单实体容错** — `catchError` 返回 `null`，`filter` 过滤，单个失败不中断整体导入
- **进度条** — `importProgress` / `importTotal` 实时显示 `N / total`
- **`finalize`** — 确保 `isLoading` 在任何情况下重置

### 12.9 缩略图渲染

`getEntityThumbnailUrl()` 函数为映射步骤生成 `<img>` 可显示的缩略图：

- 调用 `removeScadaSymbolMetadata()` 剥离 `<tb:metadata>`
- 补回 `width="120" height="120"` 属性（`_wrap_scada_symbol` 移除了根标签的 width/height）
- 生成 `data:image/svg+xml;base64,...` data URL

### 12.10 已知问题与修复记录

| 问题 | 根因 | 修复 |
|------|------|------|
| 部件列表为空 | `dashboard-widget-select.component.scss` 布局塌陷 | 还原 `position: absolute; inset: 0` |
| SCADA 符号只有 `</svg>` | ezdxf 退化实体输出 `<svg />` 自闭合标签 | `_build_fallback_svg()` 手动构建 SVG |
| Java StAX 解析报错 | `<tb:metadata xmlns="">` 的 `xmlns=""` 属性 | 移除 `xmlns=""` |
| stroke-width 被破坏 | `_wrap_scada_symbol` 正则匹配到内部元素的 `stroke-width` | 限定正则仅作用于 `<svg>` 根标签 |
| viewBox 坐标极端 | fallback 直接使用 CAD 世界坐标 | 归一化到 `0 0 W H` 空间 |
| 线条边缘被裁剪 | `_resize_svg` 正则不匹配 XML 属性和小数 stroke-width | 正则兼容 CSS/XML + 浮点除法 |
| 导入卡住 | `forkJoin` 100+ 并发上传 | `concatMap` 顺序执行 + 进度条 |
| 预览图形不可见 | 预览 SVG 未反转白色线条 | 预览追加颜色反转 |
| 映射缩略图不可见 | `<img>` 无法渲染无 width/height 的 SVG | `removeScadaSymbolMetadata` + 补 width/height |
