---
name: apple-hig
license: MIT
metadata:
  author: xinyao27
description: "Design, implement, or review native Apple interfaces using bundled Human Interface Guidelines knowledge. Use for platform conventions, component choices, hierarchy, accessibility, and Liquid Glass on macOS, iOS, iPadOS, watchOS, tvOS, or visionOS. Consult official updates when the task needs version-specific or uncovered information. For Apple-inspired websites, use a web design workflow."
---

# Apple Human Interface Guidelines

Apply the bundled Apple design knowledge to the user's interface. The local references contain working guidance, with official links for provenance and updates. Ordinary design work starts and can finish locally; opening those links is not a prerequisite.

## Establish the design context

Identify the user task, target platform, framework, minimum OS, and requested deliverable: advice, review, design, or implementation. Infer these from the conversation and project before asking for missing information.

For repository work, read its instructions, design system, and relevant feature invariants. Locate the current surface and its shared components. Preserve the product's established language, icon catalog, and interaction contract while evaluating the requested change.

Distinguish the build SDK from the deployment target. A newer SDK's appearance changes and a newly available API are different adoption decisions. Check an unfamiliar API against the installed SDK or current documentation; keep required compatibility behavior in the project's shared component layer.

## Read the relevant local knowledge

Load only the files and platform sections that bear on the task. Their source links document where the guidance came from; they do not instruct you to fetch every source.

| Decision                                                                | Local reference                                                                      |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Product priorities, hierarchy, typography, color, copy, or motion       | [Design foundations](references/foundations.md)                                      |
| Input methods, density, window behavior, or adapting across devices     | [Platform conventions](references/platforms.md) — read the target platform's section |
| Choosing navigation, menus, controls, sheets, or popovers               | [Component choices](references/components.md)                                        |
| Native appearance, translucency, custom surfaces, or Liquid Glass       | [Materials and Liquid Glass](references/materials.md)                                |
| Keyboard access, VoiceOver, readable content, or accessibility settings | [Accessibility](references/accessibility.md)                                         |

For example, reviewing a Mac settings pane usually needs the macOS section and component choices; add materials or accessibility when those are part of the findings. A button-label edit usually needs only the writing section in design foundations.

## Use the knowledge in the requested mode

- **Advice or design:** recommend the interaction and component that serves the user's task, explain the benefit, and identify material tradeoffs. Include the states needed to understand the flow.
- **Review:** inspect the supplied design or implementation. Trace behavior to owners and callers when source is available. Report concrete findings by user impact: location, condition, consequence, and smallest useful correction. Separate observed behavior from risks inferred from code, and Apple guidance from project rules or your aesthetic judgment.
- **Implementation:** make the authorized change through existing components and owners. Prefer native controls and shared wrappers. Explain the concrete need for a custom control and carry its interaction states and accessibility behavior with it. Keep shared appearance and compatibility decisions centralized.

The local notes are a synthesis of Apple recommendations, not a compliance specification. Apply the relevant criteria without forcing every task through a full audit or numerical score.

## When to consult an external source

Consult the specific official source when:

- The user asks for current official guidance, source verification, or an official example not covered locally.
- A decision depends on an OS release, new API, deprecation, beta behavior, or an exact metric that the local notes and installed SDK do not establish.
- The task needs an uncovered topic, a visual example, downloadable assets, or resolution of conflicting evidence.

Use [Source lookup and maintenance](references/apple-resources.md) only for these cases or an explicit skill refresh. Prefer current HIG for design and framework documentation or the installed SDK for API behavior. An older verification date alone does not turn every stable design decision into a lookup task.

If lookup fails, continue decisions supported by local knowledge and identify the particular unresolved claim. Source URLs can be cited from the local notes without claiming a fresh online verification. Ordinary use does not imply rewriting the skill.

## Finish with evidence

State what was decided or changed and what was verified. Cite the local guidance or its recorded official source when attribution helps explain a finding. A successful build proves compilation; rendered appearance and interaction require their own evidence. Follow repository rules for builds, user-operated checks, and authorized UI automation. Identify focused manual checks that remain.
