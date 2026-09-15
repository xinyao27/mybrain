# Materials and Liquid Glass

Local synthesis checked 2026-09-16. These design rules are usable without fetching the source pages. API signatures, availability, and new OS behavior remain separate implementation questions.

## Choose the layer and material

| Surface                                             | Starting treatment                                                        |
| --------------------------------------------------- | ------------------------------------------------------------------------- |
| Navigation and functional controls above content    | The standard component's system appearance; Liquid Glass where supported. |
| Content backgrounds and grouping inside content     | Semantic backgrounds or standard materials suited to that content.        |
| Custom floating control over varied text or imagery | Regular glass where a custom glass effect is justified.                   |
| Small controls over visually rich photos or video   | Consider clear glass after checking contrast and background treatment.    |

Liquid Glass separates navigation and controls from the content beneath them. Applying it throughout content cards or lists weakens that hierarchy. System controls can have transient glass elements while being manipulated, such as a slider's interactive part; this does not make the surrounding content a glass surface.

Regular glass adapts the background to maintain legibility and is the useful starting point for text-heavy or unpredictable surroundings. Clear glass prioritizes visible media. Bright media can need dimming; sufficiently dark content or system playback controls that already supply dimming may not. Decide from the actual background and foreground together.

Source: [Materials](https://developer.apple.com/design/human-interface-guidelines/materials).

## Adopt through the component

Start with the existing native control or shared wrapper. Rebuilding with a newer SDK may update its appearance without replacing the interaction. For supported buttons, prefer the system button style over manually wrapping the button in another glass effect.

Review custom fills, visual-effect backgrounds, and overlays that obscure system treatment. Avoid placing an extra glass surface around a control or presentation that already owns one. Retain system spacing and safe-area behavior so rounded controls, title bars, and content do not collide. For scrolling content, preserve the toolbar's scroll-edge treatment rather than covering it with a fixed painted background.

Source: [Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass).

## Geometry, emphasis, and adaptation

Nested shapes should look related: evaluate corner radius and padding together rather than repeating one radius on every level. Dense Mac controls can remain compact rounded rectangles while prominent, spacious actions use larger shapes. The platform's own controls carry these distinctions.

Use tint selectively to mark important actions. Check a custom surface over moving content and in active/inactive states. Respect Reduce Transparency, Increase Contrast, and Reduce Motion; standard material behavior already adapts to these preferences, while custom effects need their own verification.

Sources: [Get to know the new design system — WWDC25](https://developer.apple.com/videos/play/wwdc2025/356/), [Meet Liquid Glass — WWDC25](https://developer.apple.com/videos/play/wwdc2025/219/).

## Implementation and review decisions

When a project supports older systems, preserve its baseline native experience and put supported newer appearance behind its shared component boundary. This is an implementation strategy, not a reason to raise the deployment target.

For a suspected glass defect, locate who draws each surface and which layer owns the content. A review finding should name the interfering background, duplicated effect, illegible state, or broken geometry. A build can validate API use; appearance across backgrounds and accessibility settings needs rendered evidence or a focused manual check.
