#!/usr/bin/env node
// Fetch a single public Apple DocC page as portable Markdown. No npm packages.
import { realpathSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const origin = "https://developer.apple.com";

export function documentURLs(input) {
  const url = new URL(input);
  if (url.origin !== origin || url.username || url.password) {
    throw new Error("Use an HTTPS URL on developer.apple.com.");
  }
  // Accept public page, Markdown, and DocC JSON URLs, including section anchors.
  const path = url.pathname
    .replace(/^\/tutorials\/data\//, "/")
    .replace(/\.(json|md)$/, "")
    .replace(/\/+$/, "");
  if (!/^\/(design\/human-interface-guidelines|documentation)(\/|$)/.test(path)) {
    throw new Error("Supported pages: Apple HIG and /documentation/ articles or APIs.");
  }
  return { page: origin + path, data: origin + "/tutorials/data" + path + ".json" };
}

function escapeText(text = "") {
  return String(text).replace(/[\\`*_[\]<>]/g, "\\$&");
}

function code(text, language) {
  const runs = String(text).match(/`+/g) || [];
  const fence = "`".repeat(
    Math.max(language === undefined ? 1 : 3, ...runs.map((s) => s.length + 1)),
  );
  return language === undefined
    ? fence + " " + text + " " + fence
    : fence + language + "\n" + text + "\n" + fence;
}

export function renderDocument(doc, source, retrieved = new Date().toISOString()) {
  if (!doc.metadata?.title || !doc.identifier?.url || !Array.isArray(doc.primaryContentSections)) {
    throw new Error(
      "Response is not an Apple DocC article (missing title, identifier, or sections).",
    );
  }
  const refs = doc.references || {};
  const blocks = (nodes = []) => nodes.map(block).join("\n\n");
  const inline = (nodes = []) => nodes.map(span).join("");
  const link = (title, url) => "[" + title + "](<" + new URL(url, source).href + ">)";

  function reference(identifier, label) {
    const ref = refs[identifier];
    if (!ref?.url || !ref.title) throw new Error("Unresolved DocC reference: " + identifier);
    if (ref.url.startsWith("doc:")) throw new Error("Unresolved DocC URL: " + ref.url);
    return link(label || escapeText(ref.title), ref.url);
  }

  function media(node) {
    const ref = refs[node.identifier];
    if (!ref?.variants?.length) throw new Error("Missing media variants: " + node.identifier);
    const description = escapeText(ref.alt || ref.title || node.identifier);
    const caption = inline(node.metadata?.abstract);
    const variants = ref.variants.map((variant) => {
      if (!variant.url) throw new Error("Missing media URL: " + node.identifier);
      // DocC media paths use /tutorials/, not the article or JSON directory.
      const url = /^\/(images|videos)\//.test(variant.url)
        ? origin + "/tutorials" + variant.url
        : new URL(variant.url, origin + "/tutorials/").href;
      const label =
        description +
        (ref.variants.length > 1 ? " (" + escapeText((variant.traits || []).join(", ")) + ")" : "");
      return (node.type === "image" ? "!" : "") + link(label, url);
    });
    return variants.join("\n\n") + (caption ? "\n\n" + caption : "");
  }

  function span(node) {
    switch (node.type) {
      case "text":
        return escapeText(node.text);
      case "codeVoice":
        return code(node.code);
      case "strong":
        return "**" + inline(node.inlineContent) + "**";
      case "emphasis":
        return "*" + inline(node.inlineContent) + "*";
      case "strikethrough":
        return "~~" + inline(node.inlineContent) + "~~";
      case "small":
        return inline(node.inlineContent);
      case "newTerm":
        return "*" + inline(node.inlineContent) + "*";
      case "subscript":
        return "<sub>" + inline(node.inlineContent) + "</sub>";
      case "superscript":
        return "<sup>" + inline(node.inlineContent) + "</sup>";
      case "inlineHead":
        return "**" + inline(node.inlineContent) + "**";
      case "reference":
        return reference(
          node.identifier,
          node.overridingTitleInlineContent
            ? inline(node.overridingTitleInlineContent)
            : escapeText(node.overridingTitle),
        );
      case "image":
        return media(node);
      case "break":
        return "  \n";
      default:
        throw new Error("Unsupported DocC inline type: " + node.type);
    }
  }

  function table(node) {
    if (node.extendedData?.length) throw new Error("Merged table cells require a reader update.");
    const rows = node.rows.map((row) =>
      row.map((cell) => blocks(cell).replace(/\|/g, "&#124;").replace(/\n/g, "<br>")),
    );
    if (!rows.length) return "";
    const width = Math.max(...rows.map((row) => row.length));
    if (node.header !== "row" && node.header !== "both") rows.unshift(Array(width).fill(""));
    rows.splice(1, 0, Array(width).fill("---"));
    return rows.map((row) => "| " + row.join(" | ") + " |").join("\n");
  }

  function block(node) {
    switch (node.type) {
      case "paragraph":
        return inline(node.inlineContent);
      case "heading":
        return "#".repeat(Math.min(6, Math.max(1, node.level))) + " " + escapeText(node.text);
      case "codeListing":
        return code(node.code.join("\n"), node.syntax || "text");
      case "unorderedList":
      case "orderedList":
        return node.items
          .map((item, index) => {
            const prefix =
              node.type === "orderedList" ? String((node.start || 1) + index) + ". " : "- ";
            const body = blocks(item.content);
            return prefix + body.replace(/\n/g, "\n" + " ".repeat(prefix.length));
          })
          .join("\n\n");
      case "aside":
        return (
          "**" +
          escapeText(node.name || node.style || "Note") +
          "**\n\n" +
          blocks(node.content)
        )
          .split("\n")
          .map((line) => "> " + line)
          .join("\n");
      case "table":
        return table(node);
      case "row":
        return node.columns
          .map((column, index) => "**Column " + (index + 1) + "**\n\n" + blocks(column.content))
          .join("\n\n");
      case "tabNavigator":
        return node.tabs
          .map((tab) => "**" + escapeText(tab.title) + "**\n\n" + blocks(tab.content))
          .join("\n\n");
      case "links":
        return node.items.map((id) => "- " + reference(id)).join("\n");
      case "video":
      case "image":
        return media(node);
      case "thematicBreak":
        return "---";
      case "small":
        return inline(node.inlineContent);
      default:
        throw new Error("Unsupported DocC block type: " + node.type);
    }
  }

  function section(value) {
    switch (value.kind) {
      case "content":
        return blocks(value.content);
      case "declarations":
        return (
          "## Declaration\n\n" +
          value.declarations
            .map((decl) => {
              const label = decl.platforms?.filter(Boolean).join(", ");
              return (
                (label ? label + "\n\n" : "") +
                code(decl.tokens.map((token) => token.text).join(""), decl.languages?.[0] || "text")
              );
            })
            .join("\n\n")
        );
      case "parameters":
        return (
          "## Parameters\n\n" +
          value.parameters
            .map((param) => "### " + escapeText(param.name) + "\n\n" + blocks(param.content))
            .join("\n\n")
        );
      case "restParameters":
        return (
          "## Parameters\n\n" +
          value.items
            .map((param) => "### " + escapeText(param.name) + "\n\n" + blocks(param.content))
            .join("\n\n")
        );
      case "mentions":
        return "## Mentioned in\n\n" + value.mentions.map((id) => "- " + reference(id)).join("\n");
      case "returns":
        return "## Return value\n\n" + blocks(value.content);
      default:
        throw new Error("Unsupported DocC section kind: " + value.kind);
    }
  }

  function groups(values = []) {
    return values
      .map(
        (group) =>
          "### " +
          escapeText(group.title) +
          "\n\n" +
          (group.abstract ? inline(group.abstract) + "\n\n" : "") +
          (group.content ? blocks(group.content) + "\n\n" : "") +
          group.identifiers.map((id) => "- " + reference(id)).join("\n"),
      )
      .join("\n\n");
  }

  const availability = (doc.metadata.platforms || [])
    .map((platform) => {
      const notes = [
        platform.introducedAt && "introduced " + platform.introducedAt,
        platform.beta && "beta",
        platform.unavailable && "unavailable",
        (platform.deprecated || platform.deprecatedAt) &&
          "deprecated" + (platform.deprecatedAt ? " " + platform.deprecatedAt : ""),
        platform.obsoletedAt && "obsoleted " + platform.obsoletedAt,
      ].filter(Boolean);
      return "- " + escapeText(platform.name + (notes.length ? ": " + notes.join("; ") : ""));
    })
    .join("\n");
  const legal = doc.legalNotices || {};
  const output = [
    "# " + escapeText(doc.metadata.title),
    "Source: " +
      link("Apple documentation", source) +
      "  \nRetrieved: " +
      retrieved +
      "  \nFormat: Apple DocC converted to Markdown; default language variant (" +
      (doc.identifier.interfaceLanguage || "unspecified") +
      ").",
    inline(doc.abstract),
    availability && "## Availability\n\n" + availability,
    doc.deprecationSummary?.length && "## Deprecation\n\n" + blocks(doc.deprecationSummary),
    ...doc.primaryContentSections.map(section),
    doc.topicSections?.length && "## Topics\n\n" + groups(doc.topicSections),
    doc.seeAlsoSections?.length && "## See also\n\n" + groups(doc.seeAlsoSections),
    "---",
    legal.copyright || "Apple documentation. Copyright Apple Inc.",
    link(
      "Terms of Use",
      legal.termsOfUse || "https://www.apple.com/legal/internet-services/terms/site.html",
    ) + (legal.privacyPolicy ? " | " + link("Privacy Policy", legal.privacyPolicy) : ""),
  ];
  return output.filter(Boolean).join("\n\n") + "\n";
}

export async function readAppleDocs(input) {
  const urls = documentURLs(input);
  const response = await fetch(urls.data, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw new Error("Apple DocC returned HTTP " + response.status + " for " + urls.page);
  if (!response.headers.get("content-type")?.includes("json")) {
    throw new Error("Apple returned a non-JSON response; an HTML shell is not article content.");
  }
  const doc = await response.json();
  const identifierPath = new URL(doc.identifier?.url || "invalid:").pathname.toLowerCase();
  if (identifierPath !== new URL(urls.page).pathname.toLowerCase()) {
    throw new Error(
      "Apple returned a different document: " + (doc.identifier?.url || "missing identifier"),
    );
  }
  return renderDocument(doc, urls.page);
}

async function main(args) {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    process.stdout.write(
      "Usage: node read-apple-docs.mjs <apple-url> [--output <file.md>]\n" +
        "Fetch one HIG or API document. Without --output, print Markdown to stdout.\n" +
        "Existing output files are preserved; choose a new name to refresh. Requires Node.js 22.20+.\n",
    );
    return;
  }
  if (
    !(args.length === 1 || (args.length === 3 && args[1] === "--output" && args[2].endsWith(".md")))
  ) {
    throw new Error("Usage: node read-apple-docs.mjs <apple-url> [--output <file.md>]");
  }
  // Render fully before opening the destination. Network/schema errors leave no partial document.
  const markdown = await readAppleDocs(args[0]);
  if (args[2]) {
    const destination = resolve(args[2]);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, markdown, { flag: "wx" });
    process.stderr.write("Saved " + markdown.length + " characters to " + destination + "\n");
  } else {
    process.stdout.write(markdown);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write("read-apple-docs: " + error.message + "\n");
    process.exitCode = 1;
  });
}
