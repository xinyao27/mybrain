# Source lookup and maintenance

Read this file when an external lookup is needed under `SKILL.md`, or when the user requests a skill refresh. It is not part of routine use. The bundled knowledge and retrieval examples were checked on 2026-09-16.

## Resolve the specific gap

Start with the source recorded beside the relevant local guidance. For an uncovered design topic, search within [Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/). For exact API behavior or availability, inspect the installed SDK or Apple's framework documentation. Use [Apple Design](https://developer.apple.com/design/) to find newly published resources when the user asks about current releases.

Read the section that answers the question. Prefer current HIG over an older WWDC example when their recommendations differ, and distinguish a design recommendation from an API constraint. Identify beta or platform-specific material before applying it to the deployment target.

## Read official pages into Markdown

Use the bundled [reader](../scripts/read-apple-docs.mjs) for HIG pages and `/documentation/` articles or API symbols. It fetches the page's public DocC data and writes ordinary Markdown. Run it with Node.js 22.20+ from any directory, resolving the script path from the installed skill:

```bash
node "<skill-directory>/scripts/read-apple-docs.mjs" \
  "https://developer.apple.com/design/human-interface-guidelines/materials" \
  --output "<temporary-directory>/apple-hig/materials.md"
```

Replace the two directory placeholders with actual paths. Read the saved file with the agent's normal file-reading tool and check the title against the intended topic. The command prints the saved path to stderr; omitting `--output` prints Markdown to stdout. It creates parent directories and refuses to overwrite existing files. To refresh, use a new filename; an existing copy is a dated snapshot, not proof of current guidance.

The same command accepts an API URL such as `https://developer.apple.com/documentation/swiftui/view/glasseffect(_:in:)`. Public page, `.md`, and DocC `.json` URLs are accepted. Section anchors and query strings are removed: the reader retrieves the whole page in its default language variant. It does not select translated or Objective-C variants from query parameters.

The output includes the title, source URL, retrieval time, article body, tables, lists, framework tabs, code, API availability, related topics, image descriptions and links, and Apple's copyright notice. Inline `doc://` identifiers are resolved into named HTTPS links. Media paths are resolved under Apple's `/tutorials/` asset root. The reader does not download images or videos; inspect those separately when the decision depends on appearance. A text extraction is not visual verification.

### Failure behavior and alternatives

An HTML response saying “This page requires JavaScript” is not the article. Apple's own Markdown can also contain unresolved `doc://` references. The reader uses DocC for both HIG and API pages to handle these consistently; no browser rendering, API key, MCP server, or npm package is needed.

HTTP errors, HTML shells, mismatched document identifiers, unresolved references, and unsupported body structures produce a nonzero exit and an explicit error. Conversion finishes before opening an output file, so retrieval or format failures do not leave a misleading partial article. The DocC endpoint is an implementation detail of Apple's site and may change.

If Node or command execution is unavailable, continue with the bundled references or ask an available read-only HTTP tool to fetch the corresponding DocC JSON. These are verified examples:

| Public page                                                                           | DocC data                                                                                                 |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `https://developer.apple.com/design/human-interface-guidelines/materials`             | `https://developer.apple.com/tutorials/data/design/human-interface-guidelines/materials.json`             |
| `https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass` | `https://developer.apple.com/tutorials/data/documentation/technologyoverviews/adopting-liquid-glass.json` |

When reading JSON directly, check `metadata.title`, read `abstract`, `primaryContentSections`, and relevant `topicSections`, and resolve inline identifiers through `references`. Preserve framework tabs, tables, code, captions, and availability conditions. If retrieval or conversion fails, use an accessible official page or permitted browser and identify the specific unresolved claim. Apple Design landing pages, resource downloads, and WWDC videos use their own pages; they are outside this reader's scope.

Keep generated Apple documents in a temporary or ignored directory for the task, separate from the independently authored MIT skill. Preserve source and copyright notices. Cite the human-readable Apple URL in answers and distinguish local snapshots, live retrieval, and search excerpts.

## Design assets and tools

- [Apple Design Resources](https://developer.apple.com/design/resources/): select the platform and version for official UI kits, icon templates, and product artwork. Follow the page's current download links instead of freezing asset versions here.
- [SF Symbols](https://developer.apple.com/sf-symbols/): inspect semantic symbol choices and supported variants when the project uses SF Symbols. Retain a project's explicitly chosen icon system.
- [Fonts](https://developer.apple.com/fonts/): consult platform typography resources when selecting or preparing type.
- [Icon Composer](https://developer.apple.com/icon-composer/): consult for layered app icons. An ordinary interface review does not imply redesigning the product's app icon.

## Refreshing the local knowledge

When asked to update this skill, revise the local file that owns the topic. Preserve the distinction between stable design criteria and release-specific facts. Keep concise, independently phrased guidance that helps the next agent make a decision, with its source and checked date. Replace superseded guidance instead of accumulating a second version in a change log.

Ordinary design tasks use the skill; they do not authorize changing it or downloading an entire documentation site. A focused correction may need one source, while a requested broader refresh may need several. Update invocation metadata if the capability or scope changes, then validate the skill and its local references.
