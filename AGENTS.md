# AGENTS.md

## Overview

This is **xinyao**'s personal knowledge base (Second Brain). It stores ideas, tech stack notes, personal background, fleeting inspirations, and anything worth capturing. The primary content format is **Markdown**.

Content may be organized by date, by type, by topic — or not organized at all. Structure will evolve over time.

## Content Categories

Possible content types include:

- **ideas/** — Sparks, product ideas, half-formed thoughts, shower thoughts
- **tech/** — Tech stack notes, research, learning logs, code snippets
- **journal/** — Date-based entries, reflections, retrospectives
- **me/** — Personal background, bio material, values, career notes
- **resources/** — Bookmarked articles, tools, links

> This is a suggested structure. The actual organization is fluid and may change at any time.

## Writing Conventions

- Primary language is **Chinese**; English is used for technical terms
- Markdown files use `.md` extension
- Filenames use lowercase kebab-case, e.g. `my-new-idea.md`
- Each file should start with a heading (`# Title`) and a date when possible
- Content does not need to be polished — drafts and fragments are welcome. Capturing is more important than perfecting.

## Agent Guidelines

### Creating Content
- Place files in the appropriate directory by type. When unsure, use the root or `ideas/`
- Add a title and creation date at the top of new files
- Preserve the author's personal voice and tone — avoid over-formatting or sounding too "AI-generated"
- Prefer capturing more rather than less — ideas are fleeting

### Organizing Content
- **Never delete any content**, even if it looks like a rough draft or incomplete
- When reorganizing, keep the original text intact; add structured summaries alongside if needed
- If moving files, explain why

### Searching
- Use `rg` (ripgrep) to search across Markdown files
- Content is mixed Chinese and English — search with both when relevant

### Technical Context
- The author is a frontend / full-stack developer
- Tech stack preferences: TypeScript, React, Bun, Vite, pnpm
- The repo uses vite-plus for build tooling, but the core value is the Markdown content, not the code

## Project Structure

```
mybrain/
├── src/            # Code exports (secondary)
├── dist/           # Build output
├── *.md            # Core content — Markdown files
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## Commands

```bash
pnpm install        # Install dependencies
pnpm dev            # Dev mode
pnpm build          # Build
pnpm check          # Type check
pnpm lint           # Lint
```
