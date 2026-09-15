import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { documentURLs, readAppleDocs, renderDocument } from "./read-apple-docs.mjs";

const source = "https://developer.apple.com/documentation/example/widget";

test("executes the installed entry point through temporary paths and symlinks", () => {
  const directory = mkdtempSync(join(tmpdir(), "apple-hig cli "));
  const copied = join(directory, "reader.mjs");
  try {
    copyFileSync(fileURLToPath(new URL("./read-apple-docs.mjs", import.meta.url)), copied);
    const paths = [copied];
    if (process.platform !== "win32") {
      const linked = join(directory, "linked.mjs");
      symlinkSync(copied, linked);
      paths.push(linked);
    }
    for (const path of paths) {
      const help = spawnSync(process.execPath, [path, "--help"], { encoding: "utf8" });
      assert.equal(help.status, 0, help.stderr);
      assert.match(help.stdout, /Usage: node read-apple-docs/);
      const invalid = spawnSync(process.execPath, [path, "https://example.com/documentation/api"], {
        encoding: "utf8",
      });
      assert.equal(invalid.status, 1);
      assert.match(invalid.stderr, /HTTPS URL on developer.apple.com/);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

const text = (value) => ({ type: "text", text: value });
const paragraph = (value) => ({ type: "paragraph", inlineContent: [text(value)] });
const document = (content = []) => ({
  metadata: { title: "Example widget" },
  identifier: { url: "doc://example/documentation/example/widget", interfaceLanguage: "swift" },
  abstract: [text("A synthetic document for testing the converter.")],
  primaryContentSections: [{ kind: "content", content }],
  references: {},
});

test("normalizes public, Markdown, and JSON links without carrying query or fragment", () => {
  const expected = {
    page: source,
    data: "https://developer.apple.com/tutorials/data/documentation/example/widget.json",
  };
  for (const url of [source, source + ".md", source + "/?language=swift#Example", expected.data]) {
    assert.deepEqual(documentURLs(url), expected);
  }
  for (const url of [
    "http://developer.apple.com/documentation/example",
    "https://example.com/documentation/example",
    "https://developer.apple.com/design/",
    "https://user@developer.apple.com/documentation/example",
  ]) {
    assert.throws(() => documentURLs(url));
  }
});

test("retains conditions in tables, nested lists, asides, and every framework tab", () => {
  const doc = document([
    {
      type: "table",
      header: "row",
      rows: [
        [[paragraph("Condition")], [paragraph("Action")]],
        [[paragraph("Bright | dim")], [paragraph("Choose carefully")]],
      ],
    },
    { type: "aside", name: "Exception", content: [paragraph("Keep the existing behavior.")] },
    {
      type: "orderedList",
      start: 3,
      items: [
        {
          content: [
            paragraph("Parent"),
            { type: "unorderedList", items: [{ content: [paragraph("Child")] }] },
          ],
        },
      ],
    },
    {
      type: "tabNavigator",
      tabs: [
        { title: "Framework A", content: [paragraph("First variant")] },
        { title: "Framework B", content: [paragraph("Second variant")] },
      ],
    },
  ]);
  const md = renderDocument(doc, source);
  assert.ok(
    md.includes("| Condition | Action |\n| --- | --- |\n| Bright &#124; dim | Choose carefully |"),
  );
  assert.ok(md.includes("> **Exception**\n> \n> Keep the existing behavior."));
  assert.ok(md.includes("3. Parent\n   \n   - Child"));
  assert.ok(md.includes("**Framework A**\n\nFirst variant"));
  assert.ok(md.includes("**Framework B**\n\nSecond variant"));
});

test("resolves API names, overloaded URLs, image variants, captions, and copyright", () => {
  const doc = document([
    {
      type: "paragraph",
      inlineContent: [
        { type: "reference", identifier: "doc://example/function", overridingTitle: "Call it" },
      ],
    },
    {
      type: "paragraph",
      inlineContent: [
        {
          type: "image",
          identifier: "sample",
          metadata: { abstract: [text("The caption explains the example.")] },
        },
      ],
    },
  ]);
  doc.references = {
    "doc://example/function": { title: "example(_:)", url: "/documentation/example/function(_:)" },
    sample: {
      alt: "Example appearance",
      variants: [
        { traits: ["light"], url: "/images/example/light.png" },
        { traits: ["dark"], url: "/images/example/dark.png" },
      ],
    },
  };
  doc.legalNotices = { copyright: "Synthetic copyright notice" };
  const md = renderDocument(doc, source, "2026-09-16T00:00:00.000Z");
  assert.ok(
    md.includes("[Call it](<https://developer.apple.com/documentation/example/function(_:)>"),
  );
  assert.ok(md.includes("https://developer.apple.com/tutorials/images/example/light.png"));
  assert.ok(md.includes("https://developer.apple.com/tutorials/images/example/dark.png"));
  assert.ok(md.includes("The caption explains the example."));
  assert.ok(md.includes("Synthetic copyright notice"));
  assert.ok(md.includes("Retrieved: 2026-09-16T00:00:00.000Z"));
  assert.ok(!md.includes("doc://"));
});

test("preserves declaration, code, availability, and parameter meaning", () => {
  const doc = document([
    { type: "codeListing", syntax: "swift", code: ['let text = "a`b"', "use(text)"] },
  ]);
  doc.metadata.platforms = [
    { name: "Example OS", introducedAt: "1.0", deprecatedAt: "2.0", beta: true },
  ];
  doc.primaryContentSections.unshift(
    {
      kind: "declarations",
      declarations: [{ languages: ["swift"], tokens: [{ text: "func example()" }] }],
    },
    {
      kind: "parameters",
      parameters: [{ name: "input", content: [paragraph("Retain the input order.")] }],
    },
  );
  const md = renderDocument(doc, source);
  assert.ok(md.includes("Example OS: introduced 1.0; beta; deprecated 2.0"));
  assert.ok(md.includes("```swift\nfunc example()\n```"));
  assert.ok(md.includes('```swift\nlet text = "a`b"\nuse(text)\n```'));
  assert.ok(md.includes("### input\n\nRetain the input order."));
});

test("fails visibly on missing references and unfamiliar content instead of dropping it", () => {
  assert.throws(() => renderDocument({}, source), /not an Apple DocC article/);
  assert.throws(
    () => renderDocument(document([{ type: "futureDiagram" }]), source),
    /Unsupported DocC block/,
  );
  assert.throws(
    () =>
      renderDocument(
        document([
          { type: "paragraph", inlineContent: [{ type: "reference", identifier: "missing" }] },
        ]),
        source,
      ),
    /Unresolved DocC reference/,
  );
  const doc = document();
  doc.primaryContentSections.push({ kind: "futureSection" });
  assert.throws(() => renderDocument(doc, source), /Unsupported DocC section/);
});

test("rejects HTTP errors, HTML shells, and a different document from the server", async (context) => {
  const fetchMock = context.mock.method(globalThis, "fetch");
  fetchMock.mock.mockImplementation(async () => new Response("Not found", { status: 404 }));
  await assert.rejects(readAppleDocs(source), /HTTP 404/);
  fetchMock.mock.mockImplementation(
    async () =>
      new Response("This page requires JavaScript", {
        headers: { "content-type": "text/html" },
      }),
  );
  await assert.rejects(readAppleDocs(source), /non-JSON/);
  const wrong = document();
  wrong.identifier.url = "doc://example/documentation/different";
  fetchMock.mock.mockImplementation(async () => Response.json(wrong));
  await assert.rejects(readAppleDocs(source), /different document/);
  fetchMock.mock.mockImplementation(async () =>
    Response.json(document([paragraph("Actual content")])),
  );
  assert.ok((await readAppleDocs(source)).includes("Actual content"));
});
