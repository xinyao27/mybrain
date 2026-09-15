# apple-hig

[简体中文](README_zh-CN.md)

Apple design guidance for coding agents, stored locally and loaded by topic. Use it to design, implement, or review native interfaces for macOS, iOS, iPadOS, watchOS, tvOS, and visionOS.

## Install with skills

Run this in your project and select your agent when prompted:

```bash
npx skills add xinyao27/mybrain --skill apple-hig
```

For a global Codex installation without selection prompts:

```bash
npx --yes skills add xinyao27/mybrain --skill apple-hig --global --agent codex --yes
```

For Claude Code, replace `codex` with `claude-code`. Omit `--global` to install only in the current project. The `--skill apple-hig` option selects this skill from the repository.

Installation needs Git, network access, and Node.js 22.20 or newer with npm/npx for the currently verified skills CLI. The bundled knowledge is Markdown and only needs file-reading tools. An optional documentation reader uses Node.js 22.20+ and network access to save official articles as Markdown; it needs no API keys, MCP servers, or npm packages. Implementing and building a native app still requires that app's development environment.

The command uses the open-source [skills CLI](https://github.com/vercel-labs/skills), which powers [skills.sh](https://skills.sh/). A directory listing is not required to install from this repository.

## Use

In Codex, ask:

```text
$apple-hig Review this macOS settings pane. Identify concrete usability issues and suggest the smallest useful fixes.
```

Other examples:

```text
Use apple-hig to choose between a sheet, popover, and window for this export flow.
```

```text
Use apple-hig to review the Liquid Glass layering in these SwiftUI views and implement the necessary changes.
```

The agent reads the task, project instructions, and relevant local references. It uses external sources when a question depends on new APIs, release-specific behavior, missing information, or an explicit request to verify current guidance. Ordinary design work does not require downloading the HIG again.

## Included knowledge

| Topic                                        | Guidance                                                                            |
| -------------------------------------------- | ----------------------------------------------------------------------------------- |
| [Foundations](references/foundations.md)     | Design principles, hierarchy, typography, color, writing, and motion                |
| [Platforms](references/platforms.md)         | Input methods, density, windows, and conventions for six Apple platforms            |
| [Components](references/components.md)       | Navigation, toolbars, menus, controls, sheets, and popovers                         |
| [Materials](references/materials.md)         | Content and control layers, regular/clear glass, native surfaces, and compatibility |
| [Accessibility](references/accessibility.md) | Readability, VoiceOver, keyboard access, and system preferences                     |

[SKILL.md](SKILL.md) is the agent entry point. [Source lookup and maintenance](references/apple-resources.md) is loaded when a lookup or refresh is needed. Each local reference records its official sources and checked date. Chinese translations use the `_zh-CN.md` suffix; the standard discovery entry point remains the English `SKILL.md`.

This is a practical selection of HIG guidance, not a complete mirror or a certification checklist. It supports native app work; Apple-inspired websites need a web design workflow. A successful build does not establish visual or interaction quality.

## Read an official article as a local file

The skill includes a [documentation reader](scripts/read-apple-docs.mjs). From the installed `apple-hig` directory, run:

```bash
node scripts/read-apple-docs.mjs \
  "https://developer.apple.com/design/human-interface-guidelines/materials" \
  --output .cache/materials.md
```

Then read `.cache/materials.md` with any agent's file-reading tool. Substitute an Apple API URL to retrieve its documentation the same way. The script fetches public DocC JSON, converts the article to Markdown, resolves API links and image URLs, and preserves tables, framework tabs, code, availability, source, and retrieval time. Images and videos remain links. It works without a browser or a particular agent integration.

Omit `--output` to print the document. Existing files are preserved; choose a new filename for a refresh. Save downloaded Apple content in a temporary or ignored directory. The reader reports errors instead of silently skipping unsupported body content. It supports HIG and `/documentation/` pages in their default language variant, not all pages on developer.apple.com. See [source lookup](references/apple-resources.md) for details and fallbacks when Node or network access is unavailable.

### Verification

Checked on 2026-09-16: converted 23 live HIG documents, the Liquid Glass adoption article, and three SwiftUI API documents. Inspected the output for conditional guidance, table structure, API names, code, and media links. The included regression tests cover content preservation, URL normalization, and failures:

```bash
node --test scripts/read-apple-docs.test.mjs
```

Also installed through the skills CLI for Codex and Claude Code in clean temporary projects and ran the installed reader, including a symlinked installation path.

This verifies retrieval and conversion. It does not claim that every agent or model has been behaviorally evaluated.

## Updates and contributions

Update a global installation with:

```bash
npx skills update apple-hig --global
```

For a project installation, use `--project` instead. To contribute, change the reference that owns the topic, cite the official source, record the checked date, and keep its Chinese translation in sync. Keep stable guidance local and label release-specific claims. Preserve relative file links so the skill works after installation in another project.

## Provenance and license

Independently authored guidance based on [Apple Design](https://developer.apple.com/design/) and the Human Interface Guidelines. This project is not affiliated with or endorsed by Apple.

The original skill instructions, summaries, translations, and reader code are available under the [MIT License](LICENSE). Linked Apple documentation, fonts, icons, UI kits, and other third-party resources remain under their respective terms; they are not redistributed in this skill.
