# Accessibility

Local guidance checked 2026-09-16. Apply the checks relevant to the changed interaction; a small edit does not imply a complete application audit.

## Perception and operation

- Preserve meaning through more than one signal: combine color with a label, shape, or other useful distinction. Important sound needs a visible or text equivalent.
- Keep content usable with larger text. Reflow layout instead of clipping the task's essential information. Use the platform's supported enlargement mechanisms.
- Check contrast against the actual background in supported appearances and with increased contrast. Prefer semantic colors with accessibility variants.
- Make targets distinguishable and sufficiently separated for the intended input. Keep native control metrics; a compact pointer interface and a spatial gaze target have different constraints. For custom controls, use component-specific target guidance rather than one universal size.
- Respect system settings and assistive input. A gesture that requires precision should have an accessible way to accomplish the same action.

Source: [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility).

## VoiceOver

Give interactive elements meaningful accessible names and expose their roles, values, and states through native controls or accessibility APIs. Describe meaningful images and provide access to interactive chart information; exclude purely decorative imagery.

Use headings, groups, and reading order to communicate relationships that otherwise exist only in visual proximity. Keep labels synchronized with what the feature actually does. Inspect the accessibility representation rather than assuming visible text or an icon is sufficient.

Source: [VoiceOver](https://developer.apple.com/design/human-interface-guidelines/voiceover).

## Keyboard access

Preserve familiar keyboard shortcuts and use new shortcuts for genuinely new commands. Distinguish text editing, normal platform focus behavior, and Full Keyboard Access. Let the system support navigation and activation rather than manually reproducing every key interaction.

In review, check the relevant path: entering the surface, reaching its controls, activating an action, and dismissing or returning. Respect the platform's behavior; iPadOS control navigation relies on Full Keyboard Access rather than assigning desktop-style focus behavior indiscriminately.

Source: [Keyboards](https://developer.apple.com/design/human-interface-guidelines/keyboards).

## Motion and transparency

When Reduce Motion is enabled, preserve state feedback while reducing distracting movement. With Reduce Transparency or Increase Contrast, check that custom content still works with the material's adjusted appearance. Native components can adapt automatically, but nearby custom colors and animations still matter.

Sources: [Motion](https://developer.apple.com/design/human-interface-guidelines/motion), [Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass).

## Evidence

Use the repository's permitted verification method. Code inspection can reveal missing labels or custom behavior; it cannot prove the complete VoiceOver experience, readability, or keyboard traversal. Report those as focused checks for an authorized tool session or the person operating the app, and distinguish unverified behavior from a confirmed defect.
