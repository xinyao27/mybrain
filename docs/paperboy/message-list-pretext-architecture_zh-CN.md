# Message List Architecture: Pretext + Custom Virtualization

> 决策日期: 2026-03-29
> 状态: 技术选型确认
> 关联: [Pretext repo](https://github.com/chenglou/pretext) | Phase 2 核心 UI 重建

## 决策

采用 **Pretext** (`@chenglou/pretext`) 作为 message list 的文本测量与布局引擎，**不使用 virtua**，自行实现轻量虚拟滚动层。

## 为什么选 Pretext

Pretext 是 Cheng Lou 开发的纯 JS/TS 多行文本测量与布局库，核心能力：

1. **零 DOM reflow 测量** — `prepare()` + `layout()` 纯算术算出文本高度，不触发浏览器 layout
2. **极快热路径** — `layout()` 对 500 条文本 ~0.10ms，`prepare()` ~17ms（一次性）
3. **完整多语言支持** — CJK、emoji、mixed-bidi、Arabic、Thai 等
4. **浏览器引擎校准** — Safari vs Chromium 的 emoji 测量差异自动修正
5. **Shrink-wrap** — `walkLineRanges()` 支持二分搜索最优容器宽度，实现消息气泡自适应宽度（纯 CSS 做不到）
6. **逐行流式布局** — `layoutNextLine()` 每行可给不同宽度，支持绕障碍物排版

## 为什么不需要 virtua

Pretext 的 masonry demo (`pages/demos/masonry/`) 证明了完整的自实现虚拟化模式：

- 不依赖任何外部虚拟滚动库
- 测量问题解决后，虚拟滚动只是一层很薄的逻辑
- mount/unmount 而非 node pooling — 因为测量已脱离 DOM，创建/销毁 div 的开销可忽略

### Masonry Demo 虚拟化模式

```
数据到达 → prepare(text, font) [一次性]
    ↓
容器宽度确定 → layout(prepared, maxWidth, lineHeight) [纯算术]
    ↓
scroll 事件 + rAF → 计算视口内可见 item
    ↓
只挂载可见节点 (position: absolute) + 200px buffer
    ↓
resize → 只重跑 layout()（prepare 缓存还在）
```

## Message List 实现方案

### 渲染管线

```
消息到达
  → prepare(message.text, font) — 一次性预处理 + 测量
  → 缓存 PreparedText 对象

容器宽度变化 / 窗口 resize
  → layout(prepared, containerWidth, lineHeight) — 纯算术重算高度
  → 更新所有消息的 y 坐标

滚动
  → rAF 回调读取 scrollTop
  → 二分查找可见区域内的消息
  → 只挂载/卸载可见消息的 DOM 节点
  → position: absolute, 容器高度 = 总内容高度
```

### 关键 API 使用

```typescript
import { prepare, layout, prepareWithSegments, walkLineRanges } from "@chenglou/pretext";

// 1. 消息到达时预处理
const prepared = prepare(message.text, "16px Inter");

// 2. 计算高度（每次宽度变化时调用，极快）
const { height, lineCount } = layout(prepared, containerWidth, 24);

// 3. 消息气泡 shrink-wrap（可选，优化气泡宽度）
const preparedRich = prepareWithSegments(message.text, "16px Inter");
let optimalWidth = containerWidth;
walkLineRanges(preparedRich, containerWidth, (line) => {
  // 二分搜索最紧凑的宽度
});
```

### 额外需要自行实现的逻辑

1. **视口管理** — scroll 监听 + 可见区域计算 + absolute positioning
2. **Scroll-to-bottom / Auto-follow** — 新消息到达时自动滚动到底部
3. **Buffer zone** — 视口上下各 200-300px 预渲染，防快速滚动闪烁
4. **非文本内容高度** — 代码块、图片、附件等需要额外的高度计算逻辑
5. **Streaming 消息** — 流式输出时需要增量 prepare + layout

### 优势

- **比 virtua 更可控** — 虚拟化逻辑完全自有，可针对聊天场景深度优化
- **零跳动** — 高度预计算精确，不存在 estimated height → actual height 的跳变
- **Shrink-wrap 气泡** — CSS 无法实现的最优消息气泡宽度
- **性能上限更高** — 没有第三方库的抽象开销
- **轻量** — 减少一个依赖

### 风险与注意事项

- Pretext 目前 star 较少（31），需要关注维护情况
- `system-ui` 字体在 macOS 上 Canvas vs DOM 测量不一致，**必须使用命名字体**
- 非纯文本内容（markdown 渲染后的 DOM）的高度计算需要补充方案
- 流式输出场景需要验证 prepare() 的增量更新性能

## 参考

- [Pretext GitHub](https://github.com/chenglou/pretext)
- [Masonry Demo](https://github.com/chenglou/pretext/tree/main/pages/demos/masonry) — 自实现虚拟化参考
- [Editorial Engine Demo](https://github.com/chenglou/pretext/tree/main/pages/demos/editorial-engine) — 逐行流式布局参考
- Pretext `thoughts.md` / `RESEARCH.md` — 设计理念与浏览器兼容性细节
