# Design foundations

Local guidance distilled from Apple sources, checked 2026-09-16. Use these decision criteria directly; source links are for attribution and updates.

## Design principles

| Principle      | Apply it to the interface                                                                                              |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Purpose        | Name the user's desired outcome. Prioritize the features that materially help reach it.                                |
| Agency         | Make entry, navigation, cancellation, and recovery understandable. Preserve work when people change direction.         |
| Responsibility | Explain actual data use, request only necessary access in context, and protect user work.                              |
| Familiarity    | Reuse learned controls and metaphors; keep equivalent actions and locations consistent.                                |
| Flexibility    | Account for different devices, inputs, abilities, and useful personalization.                                          |
| Simplicity     | Make the important choices discoverable. Fewer visible controls do not necessarily mean fewer steps or less confusion. |
| Craft          | Resolve details across states: layout, feedback, performance, language, and transitions.                               |
| Delight        | Choose a feeling appropriate to the product and reinforce it without obstructing the task.                             |

Use these to explain tradeoffs, not to require eight separate sections in a review. A proposed improvement should connect a concrete interface choice to a user outcome.

Source: [Design principles](https://developer.apple.com/design/human-interface-guidelines/design-principles).

## Hierarchy and typography

Build hierarchy through placement, grouping, weight, size, and color together. Prefer system text styles and existing project tokens; system fonts provide platform-appropriate tuning. Limit competing typefaces and avoid fragile, very light text at small sizes.

Keep headings and body text distinguishable when users enlarge text. Let content reflow, and preserve the information needed to complete the task instead of solving overflow through smaller text. Scale meaningful icons with their labels where the platform supports it. Long translations should retain usable controls and clear reading order.

Source: [Typography](https://developer.apple.com/design/human-interface-guidelines/typography).

## Color

Choose semantic colors for labels, backgrounds, separators, selection, and status. System colors adapt to appearance and accessibility preferences. Custom colors need suitable variants for supported appearances and increased contrast.

Keep each color's meaning consistent. If a color denotes interactivity in one place, decorative text in that color can create a false affordance. Reinforce state with labels or shapes. Evaluate colors against the actual background, including artwork and translucent surfaces; a swatch alone does not prove legibility.

Source: [Color](https://developer.apple.com/design/human-interface-guidelines/color).

## Writing

Name destinations for their contents and actions for their result. Use familiar words and stable terminology. Describe an error and the useful next step in the product's voice; vary tone to fit the seriousness of the situation.

Use consistent labels for the same stage of a flow. Make starting, continuing, finishing, and cancelling distinguishable. Match capitalization to the component and the project's language conventions. Preserve localization infrastructure and write each language naturally.

Practical application: a failed export needs a clear explanation and a usable recovery action; an empty library needs a way to add the first item. Avoid technical subsystem names when they do not help the user decide what to do.

Source: [Writing](https://developer.apple.com/design/human-interface-guidelines/writing).

## Motion and feedback

Use motion to explain a state change, indicate a relationship, or respond to input. Keep feedback brief and causally connected to the action. Entrance and dismissal should preserve a coherent sense of place.

Native components already supply subtle feedback for frequent interactions. Additional custom motion should earn the attention and time it costs. Let people interrupt or cancel where possible; repeated transitions should not prevent the next action. Preserve understandable feedback when Reduce Motion is enabled, and avoid making animation the only signal.

Choose timing and spring behavior for the specific interaction. These notes intentionally prescribe no universal Apple duration, bounce, or spring preset.

Source: [Motion](https://developer.apple.com/design/human-interface-guidelines/motion).
