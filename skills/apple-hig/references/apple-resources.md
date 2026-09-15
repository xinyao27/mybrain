# Source lookup and maintenance

Read this file when an external lookup is needed under `SKILL.md`, or when the user requests a skill refresh. It is not part of routine use. The bundled knowledge and retrieval examples were checked on 2026-09-16.

## Resolve the specific gap

Start with the source recorded beside the relevant local guidance. For an uncovered design topic, search within [Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/). For exact API behavior or availability, inspect the installed SDK or Apple's framework documentation. Use [Apple Design](https://developer.apple.com/design/) to find newly published resources when the user asks about current releases.

Read the section that answers the question. Prefer current HIG over an older WWDC example when their recommendations differ, and distinguish a design recommendation from an API constraint. Identify beta or platform-specific material before applying it to the deployment target.

## Reading pages that require JavaScript

An HTML response saying “This page requires JavaScript” is not the article. Follow an Apple-provided Markdown link when present. If that is unavailable, Apple's documentation site also serves DocC JSON for many pages. These examples were verified:

| Public page                                                                           | DocC data                                                                                                 |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `https://developer.apple.com/design/human-interface-guidelines/materials`             | `https://developer.apple.com/tutorials/data/design/human-interface-guidelines/materials.json`             |
| `https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass` | `https://developer.apple.com/tutorials/data/documentation/technologyoverviews/adopting-liquid-glass.json` |

Fetch with an available read-only HTTP tool. Confirm the response is JSON and `metadata.title` matches the intended article. Read `abstract`, `primaryContentSections`, and any relevant `topicSections`. Resolve inline reference identifiers through `references` to retain API names, link titles, and image descriptions. Inspect images when the decision depends on an example's appearance; prose alone does not verify its layout.

The data URL pattern is a fallback to try, not a stable public API contract. If unavailable, use an accessible official page or a permitted browser. Cite the human-readable Apple URL in the answer, and distinguish search excerpts from a complete article. A failed lookup limits the unresolved claim, not decisions already supported by local guidance.

## Design assets and tools

- [Apple Design Resources](https://developer.apple.com/design/resources/): select the platform and version for official UI kits, icon templates, and product artwork. Follow the page's current download links instead of freezing asset versions here.
- [SF Symbols](https://developer.apple.com/sf-symbols/): inspect semantic symbol choices and supported variants when the project uses SF Symbols. Retain a project's explicitly chosen icon system.
- [Fonts](https://developer.apple.com/fonts/): consult platform typography resources when selecting or preparing type.
- [Icon Composer](https://developer.apple.com/icon-composer/): consult for layered app icons. An ordinary interface review does not imply redesigning the product's app icon.

## Refreshing the local knowledge

When asked to update this skill, revise the local file that owns the topic. Preserve the distinction between stable design criteria and release-specific facts. Keep concise, independently phrased guidance that helps the next agent make a decision, with its source and checked date. Replace superseded guidance instead of accumulating a second version in a change log.

Ordinary design tasks use the skill; they do not authorize changing it or downloading an entire documentation site. A focused correction may need one source, while a requested broader refresh may need several. Update invocation metadata if the capability or scope changes, then validate the skill and its local references.
