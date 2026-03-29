# Message List Architecture: Pretext + Custom Virtualization

> Decision Date: 2026-03-29
> Status: Technology Selection Confirmed
> Related: [Pretext repo](https://github.com/chenglou/pretext) | Phase 2 Core UI Rebuild

## Decision

Adopt **Pretext** (`@chenglou/pretext`) as the text measurement and layout engine for the message list, **without using virtua**, implementing a lightweight custom virtualization layer instead.

## Why Pretext

Pretext is a pure JS/TS multi-line text measurement and layout library developed by Cheng Lou, with these core capabilities:

1. **Zero DOM reflow measurement** — `prepare()` + `layout()` compute text height through pure arithmetic, without triggering browser layout
2. **Ultra-fast hot path** — `layout()` for 500 texts ~0.10ms, `prepare()` ~17ms (one-time)
3. **Full multilingual support** — CJK, emoji, mixed-bidi, Arabic, Thai, etc.
4. **Browser engine calibration** — Automatic correction for Safari vs Chromium emoji measurement differences
5. **Shrink-wrap** — `walkLineRanges()` supports binary search for optimal container width, enabling message bubble adaptive width (impossible with pure CSS)
6. **Line-by-line streaming layout** — `layoutNextLine()` allows different widths per line, supporting text layout that wraps around obstacles

## Why virtua Is Not Needed

Pretext's masonry demo (`pages/demos/masonry/`) demonstrates a complete custom virtualization pattern:

- No dependency on any external virtual scrolling library
- Once the measurement problem is solved, virtual scrolling is just a very thin layer of logic
- Mount/unmount rather than node pooling — since measurement is decoupled from the DOM, the overhead of creating/destroying divs is negligible

### Masonry Demo Virtualization Pattern

```
Data arrives → prepare(text, font) [one-time]
    ↓
Container width determined → layout(prepared, maxWidth, lineHeight) [pure arithmetic]
    ↓
scroll event + rAF → calculate visible items within viewport
    ↓
Mount only visible nodes (position: absolute) + 200px buffer
    ↓
resize → only re-run layout() (prepare cache is still valid)
```

## Message List Implementation Plan

### Rendering Pipeline

```
Message arrives
  → prepare(message.text, font) — one-time preprocessing + measurement
  → Cache PreparedText object

Container width changes / window resize
  → layout(prepared, containerWidth, lineHeight) — pure arithmetic height recalculation
  → Update y-coordinates for all messages

Scroll
  → rAF callback reads scrollTop
  → Binary search for messages within the visible area
  → Mount/unmount only DOM nodes for visible messages
  → position: absolute, container height = total content height
```

### Key API Usage

```typescript
import { prepare, layout, prepareWithSegments, walkLineRanges } from "@chenglou/pretext";

// 1. Preprocess when message arrives
const prepared = prepare(message.text, "16px Inter");

// 2. Calculate height (called on every width change, very fast)
const { height, lineCount } = layout(prepared, containerWidth, 24);

// 3. Message bubble shrink-wrap (optional, optimizes bubble width)
const preparedRich = prepareWithSegments(message.text, "16px Inter");
let optimalWidth = containerWidth;
walkLineRanges(preparedRich, containerWidth, (line) => {
  // Binary search for the most compact width
});
```

### Additional Logic to Implement

1. **Viewport management** — Scroll listening + visible area calculation + absolute positioning
2. **Scroll-to-bottom / Auto-follow** — Auto-scroll to bottom when new messages arrive
3. **Buffer zone** — Pre-render 200-300px above and below the viewport to prevent flickering during fast scrolling
4. **Non-text content height** — Code blocks, images, attachments, etc. require additional height calculation logic
5. **Streaming messages** — Streaming output requires incremental prepare + layout

### Advantages

- **More controllable than virtua** — Virtualization logic is entirely self-owned, deeply optimizable for chat scenarios
- **Zero jitter** — Height pre-calculation is precise, no estimated height → actual height jumps
- **Shrink-wrap bubbles** — Optimal message bubble width that CSS cannot achieve
- **Higher performance ceiling** — No third-party library abstraction overhead
- **Lightweight** — One fewer dependency

### Risks and Considerations

- Pretext currently has few stars (31), need to monitor maintenance status
- `system-ui` font has inconsistent Canvas vs DOM measurement on macOS, **must use named fonts**
- Non-pure-text content (DOM after markdown rendering) height calculation needs a supplementary solution
- Streaming output scenario requires verifying prepare() incremental update performance

## References

- [Pretext GitHub](https://github.com/chenglou/pretext)
- [Masonry Demo](https://github.com/chenglou/pretext/tree/main/pages/demos/masonry) — Custom virtualization reference
- [Editorial Engine Demo](https://github.com/chenglou/pretext/tree/main/pages/demos/editorial-engine) — Line-by-line streaming layout reference
- Pretext `thoughts.md` / `RESEARCH.md` — Design philosophy and browser compatibility details
