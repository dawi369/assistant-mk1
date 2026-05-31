/**
 * Renderer and validator for the internal architecture graph.
 *
 * The TypeScript graph is canonical. This script turns it into generated
 * Markdown/Mermaid views and can fail CI/local checks when the generated doc is
 * stale or graph references are invalid.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { architectureGraph, architectureNodeKinds } from "../docs/architecture.graph";
import type {
  ArchitectureEdge,
  ArchitectureGraph,
  ArchitectureNode,
  ArchitectureView,
} from "../docs/architecture.graph";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const markdownOutputPath = resolve(repoRoot, "docs/generated/architecture-graph.md");
const htmlOutputPath = resolve(repoRoot, "docs/generated/architecture-graph/index.html");

type Command = "render" | "check" | "list";

function main() {
  const command = (process.argv[2] ?? "render") as Command;

  if (!["render", "check", "list"].includes(command)) {
    fail(`Unknown command "${command}". Use render, check, or list.`);
  }

  const errors = validateArchitectureGraph(architectureGraph, repoRoot);
  if (errors.length > 0) {
    fail(
      ["Architecture graph validation failed:", ...errors.map((error) => `- ${error}`)].join("\n"),
    );
  }

  if (command === "list") {
    listGraph(architectureGraph);
    return;
  }

  const markdown = formatGeneratedContent(
    renderGraphMarkdown(architectureGraph),
    markdownOutputPath,
  );
  const html = formatGeneratedContent(renderGraphHtml(architectureGraph), htmlOutputPath);

  if (command === "check") {
    assertGeneratedFileCurrent(markdownOutputPath, markdown);
    assertGeneratedFileCurrent(htmlOutputPath, html);

    console.log("Architecture graph is valid and generated output is current.");
    return;
  }

  mkdirSync(dirname(markdownOutputPath), { recursive: true });
  mkdirSync(dirname(htmlOutputPath), { recursive: true });
  writeFileSync(markdownOutputPath, markdown);
  writeFileSync(htmlOutputPath, html);
  console.log(`Rendered ${relative(repoRoot, markdownOutputPath)}`);
  console.log(`Rendered ${relative(repoRoot, htmlOutputPath)}`);
}

function renderGraphMarkdown(graph: ArchitectureGraph): string {
  const lines: string[] = [];

  lines.push("<!-- GENERATED FILE: do not edit directly. Run `pnpm graph:render`. -->");
  lines.push("");
  lines.push(`# ${graph.title}`);
  lines.push("");
  lines.push(graph.summary);
  lines.push("");
  lines.push(
    "> Canonical source: `docs/architecture.graph.ts`. The HTML explorer is the primary visual output.",
  );
  lines.push("");
  lines.push(
    "> Preferred visual explorer: [`docs/generated/architecture-graph/index.html`](architecture-graph/index.html).",
  );
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Nodes: ${graph.nodes.length}`);
  lines.push(`- Edges: ${graph.edges.length}`);
  lines.push(`- Views: ${graph.views.length}`);
  lines.push("");

  lines.push("## Graph Maintenance");
  lines.push("");
  lines.push(
    "Update `docs/architecture.graph.ts` and then run `pnpm graph:render` whenever a change affects architecture shape, runtime boundaries, durable contracts, generated graph tooling, or any tracked source path listed below.",
  );
  lines.push("");
  lines.push("Review the graph when a change does any of the following:");
  lines.push("");
  lines.push("- Adds, removes, renames, or materially changes a tracked source file.");
  lines.push(
    "- Changes a runtime boundary, API route, provider seam, deployment shape, or generated graph tooling.",
  );
  lines.push(
    "- Changes framework/data-client contracts, durable entity definitions, tool execution, tenancy, policy, storage, or secret-custody assumptions.",
  );
  lines.push("- Promotes a `target` or `planned` concept into current implementation.");
  lines.push("");

  lines.push("## Mega View");
  lines.push("");
  lines.push(
    "The HTML explorer includes a collapsed Mega View generated from every canonical node and edge. Use scoped views for understanding; use the Mega View for completeness checks.",
  );
  lines.push("");
  lines.push(`- Nodes: ${graph.nodes.length}`);
  lines.push(`- Edges: ${graph.edges.length}`);
  lines.push("- Node kind groups:");
  for (const [kind, nodes] of groupNodesByKind(graph.nodes)) {
    lines.push(`  - ${kind}: ${nodes.length}`);
  }
  lines.push("");

  lines.push("## Generated Views");
  lines.push("");
  lines.push(
    "Open the HTML explorer for rendered diagrams, searchable catalogs, filters, and clickable references.",
  );
  lines.push("");
  lines.push(
    ...graph.views.map(
      (view) => `- ${view.title}: ${view.nodeIds.length} nodes, ${view.edgeIds.length} edges.`,
    ),
  );
  lines.push("");

  lines.push("## View Details");
  lines.push("");
  lines.push(
    "Each view stays compact here and expands in the HTML explorer. The TypeScript graph remains the source of truth.",
  );
  lines.push("");
  for (const view of graph.views) {
    lines.push(`<details>`);
    lines.push(
      `<summary>${view.title}: ${view.nodeIds.length} nodes, ${view.edgeIds.length} edges</summary>`,
    );
    lines.push("");
    lines.push(view.summary);
    lines.push("");
    lines.push(`Nodes: ${view.nodeIds.map((nodeId) => `\`${nodeId}\``).join(", ")}.`);
    lines.push("");
    lines.push(`Edges: ${view.edgeIds.map((edgeId) => `\`${edgeId}\``).join(", ")}.`);
    lines.push("");
    lines.push(`</details>`);
    lines.push("");
  }

  lines.push("## Node Groups");
  lines.push("");
  for (const [kind, nodes] of groupNodesByKind(graph.nodes)) {
    lines.push(`- ${kind}: ${nodes.length} (${nodes.map((node) => `\`${node.id}\``).join(", ")})`);
  }
  lines.push("");

  lines.push("## Edge Groups");
  lines.push("");
  for (const [kind, edges] of groupEdgesByKind(graph.edges)) {
    lines.push(`- ${kind}: ${edges.length}`);
  }
  lines.push("");

  lines.push("## Tracked Source Files");
  lines.push("");
  lines.push(
    "Changes to these source/config files should trigger a graph review if they alter responsibilities, boundaries, or contracts.",
  );
  lines.push("");
  lines.push(...renderReferenceRows(collectRefs(graph.nodes, "fileRefs")));
  lines.push("");

  lines.push("## Full Catalogs");
  lines.push("");
  lines.push(
    "The full node catalog, edge catalog, and file reference table are intentionally kept out of this Markdown file because they are too wide to render well here.",
  );
  lines.push(
    "Use the HTML explorer for those details: [`docs/generated/architecture-graph/index.html`](architecture-graph/index.html).",
  );
  lines.push("");

  return `${lines.join("\n").trimEnd()}\n`;
}

function renderGraphHtml(graph: ArchitectureGraph): string {
  const viewModels = graph.views.map((view) => ({
    ...view,
    mermaid: renderMermaidView(graph, view),
  }));
  const megaViewId = "mega-view";
  const megaMermaid = renderMegaMermaidView(graph);
  const explorerNodes = graph.nodes.map((node) => ({
    id: node.id,
    label: node.label,
    summary: node.summary,
    kind: node.kind,
    tags: node.tags,
    fileRefs: node.fileRefs,
    notes: node.notes,
  }));
  const graphData = {
    id: graph.id,
    title: graph.title,
    summary: graph.summary,
    nodes: explorerNodes,
    edges: graph.edges,
    views: viewModels,
    fileRefs: collectRefs(graph.nodes, "fileRefs"),
  };
  const currentCount = graph.nodes.filter((node) => node.tags.includes("current")).length;
  const targetCount = graph.nodes.filter((node) => node.tags.includes("target")).length;
  const nodeKinds = [...new Set(graph.nodes.map((node) => node.kind))].sort();
  const tags = [...new Set(graph.nodes.flatMap((node) => node.tags))].sort();
  const viewNav = viewModels
    .map(
      (view) =>
        `<button class="view-link" type="button" data-open-view="${escapeAttribute(view.id)}">${escapeHtml(view.title)}</button>`,
    )
    .join("\n");
  const megaViewSection = `
      <details class="panel view-panel" id="${megaViewId}">
        <summary class="section-heading collapsible-heading">
          <div>
            <h2>Mega View</h2>
            <p>All canonical nodes and edges in one atlas. Use scoped views for understanding; use this for completeness checks.</p>
          </div>
          <span class="pill">${graph.nodes.length} nodes / ${graph.edges.length} edges</span>
        </summary>
        <div class="panel-body">
          <div class="notice">
            This view is intentionally dense and generated from every canonical node and edge. It should not become the primary reading path.
          </div>
          <div class="diagram-scroll">
            <pre class="mermaid">${escapeHtml(megaMermaid)}</pre>
          </div>
        </div>
      </details>`;
  const viewSections = viewModels
    .map(
      (view) => `
      <details class="panel view-panel" id="${escapeAttribute(view.id)}">
        <summary class="section-heading collapsible-heading">
          <div>
            <h2>${escapeHtml(view.title)}</h2>
            <p>${escapeHtml(view.summary)}</p>
          </div>
          <span class="pill">${view.nodeIds.length} nodes / ${view.edgeIds.length} edges</span>
        </summary>
        <div class="diagram-scroll">
          <pre class="mermaid">${escapeHtml(view.mermaid)}</pre>
        </div>
      </details>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(graph.title)}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: oklch(98% 0.006 255);
        --panel: oklch(99.2% 0.004 255);
        --panel-muted: oklch(96.4% 0.008 255);
        --text: oklch(21% 0.018 255);
        --muted: oklch(48% 0.028 255);
        --border: oklch(88% 0.016 255);
        --accent: oklch(50% 0.16 252);
        --accent-soft: oklch(94.5% 0.03 252);
        --current: oklch(93% 0.05 150);
        --target: oklch(93% 0.055 82);
        --planned: oklch(94% 0.05 340);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        background: var(--bg);
        color: var(--text);
        font-family:
          Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      a {
        color: var(--accent);
      }

      .shell {
        max-width: 1280px;
        margin: 0 auto;
        padding: 28px;
      }

      .hero {
        display: flex;
        justify-content: space-between;
        gap: 24px;
        align-items: flex-start;
        margin-bottom: 18px;
      }

      .eyebrow {
        color: var(--muted);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      h1,
      h2,
      h3 {
        margin: 0;
        letter-spacing: 0;
      }

      h1 {
        max-width: 760px;
        margin-top: 6px;
        font-size: 28px;
        line-height: 1.16;
      }

      h2 {
        font-size: 18px;
      }

      p {
        margin: 0;
        color: var(--muted);
        line-height: 1.55;
      }

      .hero-actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 8px;
        max-width: 440px;
      }

      .path-chip,
      .panel {
        border: 1px solid var(--border);
        border-radius: 8px;
        background: var(--panel);
      }

      .path-chip {
        display: inline-flex;
        align-items: center;
        min-height: 34px;
        padding: 7px 10px;
        color: var(--text);
        font-size: 13px;
      }

      .path-chip code {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .topline {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin: 10px 0 18px;
      }

      .meta-pill {
        display: inline-flex;
        align-items: center;
        min-height: 28px;
        padding: 4px 9px;
        border: 1px solid var(--border);
        border-radius: 999px;
        background: var(--panel);
        color: var(--muted);
        font-size: 13px;
      }

      .notice {
        padding: 12px 14px;
        border: 1px solid oklch(82% 0.06 252);
        border-radius: 8px;
        background: var(--accent-soft);
        color: oklch(34% 0.11 252);
        font-size: 14px;
      }

      .nav {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin: 20px 0 28px;
      }

      .view-link,
      button,
      select,
      input {
        border: 1px solid var(--border);
        border-radius: 6px;
        background: var(--panel);
        color: var(--text);
        font: inherit;
        font-size: 14px;
      }

      .view-link {
        padding: 8px 10px;
        cursor: pointer;
      }

      .panel {
        margin: 12px 0;
        padding: 16px;
      }

      .section-heading {
        display: grid;
        grid-template-columns: 26px minmax(0, 1fr) auto;
        gap: 14px;
        align-items: center;
      }

      .section-heading p {
        max-width: 76ch;
        margin-top: 4px;
      }

      details.panel {
        padding: 0;
      }

      .collapsible-heading {
        cursor: pointer;
        padding: 16px;
        list-style: none;
      }

      .collapsible-heading::-webkit-details-marker {
        display: none;
      }

      .collapsible-heading::before {
        content: "+";
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
        width: 22px;
        height: 22px;
        border: 1px solid var(--border);
        border-radius: 6px;
        color: var(--muted);
        font-weight: 700;
      }

      details[open] > .collapsible-heading::before {
        content: "-";
      }

      details[open] > .collapsible-heading {
        border-bottom: 1px solid var(--border);
      }

      .panel-body {
        padding: 16px;
      }

      .section-heading .pill {
        justify-self: end;
      }

      .panel-body > * + * {
        margin-top: 12px;
      }

      .pill,
      .badge {
        display: inline-flex;
        align-items: center;
        min-height: 24px;
        padding: 3px 8px;
        border-radius: 999px;
        background: var(--panel-muted);
        color: oklch(34% 0.025 255);
        font-size: 12px;
        white-space: nowrap;
      }

      .badge.current {
        background: var(--current);
        color: oklch(38% 0.11 150);
      }

      .badge.target {
        background: var(--target);
        color: oklch(42% 0.1 78);
      }

      .badge.planned {
        background: var(--planned);
        color: oklch(42% 0.12 340);
      }

      .diagram-scroll {
        overflow: auto;
        padding: 16px;
        background: var(--panel);
      }

      .filters {
        display: grid;
        grid-template-columns: minmax(220px, 1fr) repeat(3, minmax(150px, 220px));
        gap: 10px;
        margin-bottom: 14px;
      }

      input,
      select {
        width: 100%;
        padding: 9px 10px;
      }

      .table-wrap {
        overflow: auto;
        border: 1px solid var(--border);
        border-radius: 8px;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        min-width: 900px;
        background: var(--panel);
      }

      th,
      td {
        padding: 10px;
        border-bottom: 1px solid var(--border);
        text-align: left;
        vertical-align: top;
        font-size: 13px;
      }

      th {
        position: sticky;
        top: 0;
        background: var(--panel-muted);
        color: var(--text);
      }

      code {
        font-family: "SFMono-Regular", Consolas, monospace;
        font-size: 12px;
      }

      .tag-list {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }

      .ref-list {
        display: grid;
        gap: 4px;
      }

      @media (max-width: 820px) {
        .shell {
          padding: 20px;
        }

        .hero {
          display: grid;
        }

        .hero-actions {
          justify-content: flex-start;
          max-width: none;
        }

        h1 {
          font-size: 24px;
        }

        .filters {
          grid-template-columns: 1fr;
        }

        .section-heading {
          grid-template-columns: 26px minmax(0, 1fr);
          align-items: start;
        }

        .section-heading .pill {
          grid-column: 2;
          justify-self: start;
        }
      }
    </style>
    <script type="module">
      import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";

      mermaid.initialize({
        startOnLoad: true,
        securityLevel: "loose",
        flowchart: {
          htmlLabels: true,
          curve: "basis"
        }
      });
    </script>
  </head>
  <body>
    <main class="shell">
      <header class="hero">
        <div>
          <div class="eyebrow">Internal architecture explorer</div>
          <h1>${escapeHtml(graph.title)}</h1>
        </div>
        <div class="hero-actions">
          <span class="path-chip"><code>docs/architecture.graph.ts</code></span>
          <span class="path-chip"><code>docs/generated/architecture-graph.md</code></span>
        </div>
      </header>

      <div class="topline" aria-label="Graph summary">
        <span class="meta-pill">${graph.nodes.length} nodes</span>
        <span class="meta-pill">${graph.edges.length} edges</span>
        <span class="meta-pill">${graph.views.length} views</span>
        <span class="meta-pill">${currentCount} current</span>
        <span class="meta-pill">${targetCount} target</span>
      </div>

      <nav class="nav" aria-label="Graph views">
        <button class="view-link" type="button" data-open-view="${megaViewId}">Mega View</button>
        ${viewNav}
      </nav>

      <details class="panel">
        <summary class="section-heading collapsible-heading">
          <div>
            <h2>Maintenance Notes</h2>
            <p>When to update the canonical graph and how to regenerate this explorer.</p>
          </div>
          <span class="pill">source of truth: docs/architecture.graph.ts</span>
        </summary>
        <div class="panel-body">
          <div class="notice">
            Do not edit this generated file directly. Run <code>pnpm graph:render</code> after changing the graph.
            Diagrams load Mermaid from a CDN in this v1 explorer, so rendering needs network access.
          </div>
        <ul>
          <li>Add, remove, rename, or materially change a tracked source file.</li>
          <li>Change a runtime boundary, API route, provider seam, deployment shape, or generated graph tooling.</li>
          <li>Change framework/data-client contracts, durable entities, tool execution, tenancy, policy, storage, or secret-custody assumptions.</li>
          <li>Promote a <span class="badge target">target</span> or <span class="badge planned">planned</span> concept into <span class="badge current">current</span> implementation.</li>
        </ul>
        <p>After graph updates, run <code>pnpm graph:render</code> and <code>pnpm graph:check</code>.</p>
        </div>
      </details>

      ${megaViewSection}

      ${viewSections}

      <details class="panel">
        <summary class="section-heading collapsible-heading">
          <div>
            <h2>Node Catalog</h2>
            <p>Search by id, label, summary, tags, or files. Filter by implementation status and node kind.</p>
          </div>
          <span class="pill" id="node-count"></span>
        </summary>
        <div class="panel-body">
        <div class="filters">
          <input id="node-search" type="search" placeholder="Search nodes">
          <select id="node-status">
            <option value="">All statuses</option>
            <option value="current">current</option>
            <option value="target">target</option>
            <option value="planned">planned</option>
          </select>
          <select id="node-kind">
            <option value="">All kinds</option>
            ${nodeKinds.map((kind) => `<option value="${escapeAttribute(kind)}">${escapeHtml(kind)}</option>`).join("")}
          </select>
          <select id="node-tag">
            <option value="">All tags</option>
            ${tags.map((tag) => `<option value="${escapeAttribute(tag)}">${escapeHtml(tag)}</option>`).join("")}
          </select>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Kind</th>
                <th>Label</th>
                <th>Summary</th>
                <th>Tags</th>
                <th>Files</th>
              </tr>
            </thead>
            <tbody id="node-table"></tbody>
          </table>
        </div>
        </div>
      </details>

      <details class="panel">
        <summary class="section-heading collapsible-heading">
          <div>
            <h2>Edge Catalog</h2>
            <p>Search relationships by id, kind, endpoint, label, and notes.</p>
          </div>
          <span class="pill" id="edge-count"></span>
        </summary>
        <div class="panel-body">
        <div class="filters">
          <input id="edge-search" type="search" placeholder="Search edges">
          <select id="edge-kind">
            <option value="">All edge kinds</option>
          </select>
          <span></span>
          <span></span>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Kind</th>
                <th>From</th>
                <th>To</th>
                <th>Label</th>
              </tr>
            </thead>
            <tbody id="edge-table"></tbody>
          </table>
        </div>
        </div>
      </details>

      <details class="panel">
        <summary class="section-heading collapsible-heading">
          <div>
            <h2>Tracked Source Files</h2>
            <p>Files whose responsibility changes should trigger a graph review.</p>
          </div>
        </summary>
        <div class="panel-body">
        ${renderReferenceTableHtml(graph.nodes, "fileRefs", "File")}
        </div>
      </details>
    </main>

    <script type="application/json" id="graph-data">${escapeScriptJson(JSON.stringify(graphData))}</script>
    <script>
      const graph = JSON.parse(document.getElementById("graph-data").textContent);
      const nodeTable = document.getElementById("node-table");
      const edgeTable = document.getElementById("edge-table");
      const nodeCount = document.getElementById("node-count");
      const edgeCount = document.getElementById("edge-count");
      const nodeSearch = document.getElementById("node-search");
      const nodeStatus = document.getElementById("node-status");
      const nodeKind = document.getElementById("node-kind");
      const nodeTag = document.getElementById("node-tag");
      const edgeSearch = document.getElementById("edge-search");
      const edgeKind = document.getElementById("edge-kind");
      const viewButtons = document.querySelectorAll("[data-open-view]");

      const edgeKinds = [...new Set(graph.edges.map((edge) => edge.kind))].sort();
      for (const kind of edgeKinds) {
        const option = document.createElement("option");
        option.value = kind;
        option.textContent = kind;
        edgeKind.appendChild(option);
      }

      function searchable(value) {
        return JSON.stringify(value).toLowerCase();
      }

      function matchesSearch(value, query) {
        return !query || searchable(value).includes(query.toLowerCase());
      }

      function renderTags(tags) {
        return '<div class="tag-list">' + tags.map((tag) => {
          const className = ["current", "target", "planned"].includes(tag) ? "badge " + tag : "badge";
          return '<span class="' + className + '">' + escapeHtml(tag) + '</span>';
        }).join("") + '</div>';
      }

      function renderRefs(refs) {
        if (!refs || refs.length === 0) {
          return "";
        }

        return '<div class="ref-list">' + refs.map((ref) => {
          const href = "../../" + ref;
          return '<a href="' + escapeAttribute(href) + '"><code>' + escapeHtml(ref) + '</code></a>';
        }).join("") + '</div>';
      }

      function renderNodes() {
        const query = nodeSearch.value;
        const status = nodeStatus.value;
        const kind = nodeKind.value;
        const tag = nodeTag.value;
        const nodes = graph.nodes.filter((node) =>
          matchesSearch(node, query) &&
          (!status || node.tags.includes(status)) &&
          (!kind || node.kind === kind) &&
          (!tag || node.tags.includes(tag))
        );

        nodeCount.textContent = nodes.length + " shown";
        nodeTable.innerHTML = nodes.map((node) => '<tr>' +
          '<td><code>' + escapeHtml(node.id) + '</code></td>' +
          '<td>' + escapeHtml(node.kind) + '</td>' +
          '<td>' + escapeHtml(node.label) + '</td>' +
          '<td>' + escapeHtml(node.summary) + '</td>' +
          '<td>' + renderTags(node.tags) + '</td>' +
          '<td>' + renderRefs(node.fileRefs) + '</td>' +
        '</tr>').join("");
      }

      function renderEdges() {
        const query = edgeSearch.value;
        const kind = edgeKind.value;
        const edges = graph.edges.filter((edge) =>
          matchesSearch(edge, query) &&
          (!kind || edge.kind === kind)
        );

        edgeCount.textContent = edges.length + " shown";
        edgeTable.innerHTML = edges.map((edge) => '<tr>' +
          '<td><code>' + escapeHtml(edge.id) + '</code></td>' +
          '<td>' + escapeHtml(edge.kind) + '</td>' +
          '<td><code>' + escapeHtml(edge.from) + '</code></td>' +
          '<td><code>' + escapeHtml(edge.to) + '</code></td>' +
          '<td>' + escapeHtml(edge.label) + '</td>' +
        '</tr>').join("");
      }

      function escapeHtml(value) {
        return String(value)
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#39;");
      }

      function escapeAttribute(value) {
        return escapeHtml(value);
      }

      for (const input of [nodeSearch, nodeStatus, nodeKind, nodeTag]) {
        input.addEventListener("input", renderNodes);
      }

      for (const input of [edgeSearch, edgeKind]) {
        input.addEventListener("input", renderEdges);
      }

      for (const button of viewButtons) {
        button.addEventListener("click", () => {
          const section = document.getElementById(button.dataset.openView);
          if (!section) {
            return;
          }
          section.open = true;
          section.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }

      renderNodes();
      renderEdges();
    </script>
  </body>
</html>
`;
}

function renderMermaidView(graph: ArchitectureGraph, view: ArchitectureView): string {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const edgeById = new Map(graph.edges.map((edge) => [edge.id, edge]));
  const lines: string[] = [`flowchart ${view.direction ?? "LR"}`];

  for (const nodeId of view.nodeIds) {
    const node = requireNode(nodeById, nodeId);
    lines.push(`  ${mermaidId(node.id)}["${mermaidText(node.label)}"]`);
  }

  for (const edgeId of view.edgeIds) {
    const edge = requireEdge(edgeById, edgeId);
    const arrow = mermaidArrow(edge);
    lines.push(
      `  ${mermaidId(edge.from)} ${arrow}|${mermaidText(edge.label)}| ${mermaidId(edge.to)}`,
    );
  }

  for (const kind of new Set(view.nodeIds.map((nodeId) => requireNode(nodeById, nodeId).kind))) {
    lines.push(`  classDef ${kind} ${classDefForKind(kind)};`);
  }

  for (const nodeId of view.nodeIds) {
    const node = requireNode(nodeById, nodeId);
    lines.push(`  class ${mermaidId(node.id)} ${node.kind};`);
  }

  return lines.join("\n");
}

function renderMegaMermaidView(graph: ArchitectureGraph): string {
  const lines: string[] = ["flowchart LR"];

  for (const [kind, nodes] of groupNodesByKind(graph.nodes)) {
    lines.push(`  subgraph ${mermaidSubgraphId(kind)}["${mermaidText(formatKindLabel(kind))}"]`);
    for (const node of nodes) {
      lines.push(`    ${mermaidId(node.id)}["${mermaidText(node.label)}"]`);
    }
    lines.push("  end");
  }

  for (const edge of graph.edges) {
    const arrow = mermaidArrow(edge);
    lines.push(
      `  ${mermaidId(edge.from)} ${arrow}|${mermaidText(edge.label)}| ${mermaidId(edge.to)}`,
    );
  }

  for (const kind of architectureNodeKinds) {
    lines.push(`  classDef ${kind} ${classDefForKind(kind)};`);
  }

  for (const node of graph.nodes) {
    lines.push(`  class ${mermaidId(node.id)} ${node.kind};`);
  }

  return lines.join("\n");
}

function renderReferenceTableHtml(
  nodes: ArchitectureNode[],
  key: "fileRefs",
  label: string,
): string {
  const rows = collectRefs(nodes, key)
    .map(
      ([ref, nodeIds]) => `
        <tr>
          <td><a href="../../${escapeAttribute(ref)}"><code>${escapeHtml(ref)}</code></a></td>
          <td>${escapeHtml(nodeIds.join(", "))}</td>
        </tr>`,
    )
    .join("");

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>${escapeHtml(label)}</th>
            <th>Referenced By</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function mermaidArrow(edge: ArchitectureEdge): string {
  if (edge.kind === "must_not_access") {
    return "-.->";
  }

  if (edge.kind === "documents" || edge.kind === "configures") {
    return "-.->";
  }

  return "-->";
}

function classDefForKind(kind: ArchitectureNode["kind"]): string {
  const definitions: Partial<Record<ArchitectureNode["kind"], string>> = {
    app: "fill:#eef2ff,stroke:#4f46e5,color:#111827",
    runtime: "fill:#ecfeff,stroke:#0891b2,color:#111827",
    api_route: "fill:#f0fdf4,stroke:#16a34a,color:#111827",
    component: "fill:#f8fafc,stroke:#64748b,color:#111827",
    interface: "fill:#fff7ed,stroke:#ea580c,color:#111827",
    entity: "fill:#fefce8,stroke:#ca8a04,color:#111827",
    workflow: "fill:#fdf2f8,stroke:#db2777,color:#111827",
    policy: "fill:#fee2e2,stroke:#dc2626,color:#111827",
    storage: "fill:#f0f9ff,stroke:#0284c7,color:#111827",
    tooling: "fill:#f5f3ff,stroke:#7c3aed,color:#111827",
    doc: "fill:#f7fee7,stroke:#65a30d,color:#111827",
    config: "fill:#fafafa,stroke:#525252,color:#111827",
    external: "fill:#f1f5f9,stroke:#475569,color:#111827",
  };

  return definitions[kind] ?? "fill:#f8fafc,stroke:#64748b,color:#111827";
}

function collectRefs(nodes: ArchitectureNode[], key: "fileRefs"): Array<[string, string[]]> {
  const refs = new Map<string, string[]>();

  for (const node of nodes) {
    for (const ref of node[key] ?? []) {
      refs.set(ref, [...(refs.get(ref) ?? []), node.id]);
    }
  }

  return [...refs.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function groupNodesByKind(
  nodes: ArchitectureNode[],
): Array<[ArchitectureNode["kind"], ArchitectureNode[]]> {
  const groups = new Map<ArchitectureNode["kind"], ArchitectureNode[]>();

  for (const node of nodes) {
    groups.set(node.kind, [...(groups.get(node.kind) ?? []), node]);
  }

  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function groupEdgesByKind(
  edges: ArchitectureEdge[],
): Array<[ArchitectureEdge["kind"], ArchitectureEdge[]]> {
  const groups = new Map<ArchitectureEdge["kind"], ArchitectureEdge[]>();

  for (const edge of edges) {
    groups.set(edge.kind, [...(groups.get(edge.kind) ?? []), edge]);
  }

  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function renderReferenceRows(refs: Array<[string, string[]]>): string[] {
  return refs.map(([ref, nodes]) => `- \`${ref}\` -> ${nodes.join(", ")}`);
}

function formatKindLabel(kind: ArchitectureNode["kind"]): string {
  return kind
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function mermaidSubgraphId(kind: ArchitectureNode["kind"]): string {
  return `sg_${kind.replaceAll(/[^a-zA-Z0-9_]/g, "_")}`;
}

function mermaidId(id: string): string {
  return `n_${id.replaceAll(/[^a-zA-Z0-9_]/g, "_")}`;
}

function mermaidText(text: string): string {
  return text.replaceAll('"', "'").replaceAll("|", "/").replaceAll("\n", " ");
}

function requireNode(nodeById: Map<string, ArchitectureNode>, id: string): ArchitectureNode {
  const node = nodeById.get(id);
  if (!node) {
    throw new Error(`Missing node: ${id}`);
  }
  return node;
}

function requireEdge(edgeById: Map<string, ArchitectureEdge>, id: string): ArchitectureEdge {
  const edge = edgeById.get(id);
  if (!edge) {
    throw new Error(`Missing edge: ${id}`);
  }
  return edge;
}

function validateArchitectureGraph(graph: ArchitectureGraph, repoRoot: string): string[] {
  const errors: string[] = [];
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  const viewIds = new Set<string>();

  for (const node of graph.nodes) {
    if (nodeIds.has(node.id)) {
      errors.push(`Duplicate node id: ${node.id}`);
    }
    nodeIds.add(node.id);

    for (const fileRef of node.fileRefs ?? []) {
      if (!existsSync(resolve(repoRoot, fileRef))) {
        errors.push(`Node ${node.id} references missing file: ${fileRef}`);
      }
    }
  }

  for (const edge of graph.edges) {
    if (edgeIds.has(edge.id)) {
      errors.push(`Duplicate edge id: ${edge.id}`);
    }
    edgeIds.add(edge.id);

    if (!nodeIds.has(edge.from)) {
      errors.push(`Edge ${edge.id} has missing from node: ${edge.from}`);
    }

    if (!nodeIds.has(edge.to)) {
      errors.push(`Edge ${edge.id} has missing to node: ${edge.to}`);
    }
  }

  for (const view of graph.views) {
    if (viewIds.has(view.id)) {
      errors.push(`Duplicate view id: ${view.id}`);
    }
    viewIds.add(view.id);

    for (const nodeId of view.nodeIds) {
      if (!nodeIds.has(nodeId)) {
        errors.push(`View ${view.id} references missing node: ${nodeId}`);
      }
    }

    for (const edgeId of view.edgeIds) {
      const edge = graph.edges.find((candidate) => candidate.id === edgeId);

      if (!edge) {
        errors.push(`View ${view.id} references missing edge: ${edgeId}`);
        continue;
      }

      if (!view.nodeIds.includes(edge.from) || !view.nodeIds.includes(edge.to)) {
        errors.push(`View ${view.id} includes edge ${edgeId} without both endpoint nodes`);
      }
    }
  }

  return errors;
}

function assertGeneratedFileCurrent(path: string, expected: string) {
  if (!existsSync(path)) {
    fail(`Generated architecture graph is missing: ${relative(repoRoot, path)}`);
  }

  const current = readFileSync(path, "utf8");
  if (current !== expected) {
    fail(
      `Generated architecture graph is stale: ${relative(repoRoot, path)}. Run: pnpm graph:render`,
    );
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}

function escapeScriptJson(value: string): string {
  return value.replaceAll("<", "\\u003c").replaceAll(">", "\\u003e").replaceAll("&", "\\u0026");
}

function listGraph(graph: ArchitectureGraph) {
  console.log(`${graph.title}`);
  console.log(
    `nodes=${graph.nodes.length} edges=${graph.edges.length} views=${graph.views.length}`,
  );
  for (const view of graph.views) {
    console.log(`- ${view.id}: ${view.nodeIds.length} nodes, ${view.edgeIds.length} edges`);
  }
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function formatGeneratedContent(content: string, filepath: string): string {
  return execFileSync("pnpm", ["exec", "oxfmt", "--stdin-filepath", filepath], {
    cwd: repoRoot,
    encoding: "utf8",
    input: content,
  });
}

main();
