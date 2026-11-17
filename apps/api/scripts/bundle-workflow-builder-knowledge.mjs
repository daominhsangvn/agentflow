// Bundles the curated docs the workflow builder agent reads (list_guides / read_guide)
// into one generated JSON file. Node builtins only. The output is gitignored.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const SETUP_GUIDES = [
  "workflow-yaml",
  "triggers-and-actions",
  "process-yaml",
  "orchestrator",
  "connections",
  "connection-grants",
  "agents",
  "personal-agent",
];
const CONCEPT_GUIDES = ["orchestrated-vs-process", "how-agentflow-works"];

const WORKSHOP_PREFIX = /^docs\/workshop\//;
const YAML_SUFFIX = /\.yaml$/;
const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?/;
const IMPORT_LINE = /^import\s/;
const TITLE_FIELD = /^title:\s*(.+)$/m;
const H1 = /^# (.+)$/m;
const QUOTE_EDGES = /^["']|["']$/g;

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(
  args.root ?? path.resolve(import.meta.dirname, "../../..")
);
const out = path.resolve(
  args.out ??
    path.join(root, "apps/api/generated/workflow-builder-knowledge.json")
);

main();

function main() {
  if (!fs.existsSync(path.join(root, "docs/workflows.md"))) {
    if (fs.existsSync(out)) {
      console.log("[workflow-builder-knowledge] kept existing bundle");
      return;
    }
    console.error(
      "[workflow-builder-knowledge] docs/workflows.md not found and no existing bundle"
    );
    process.exit(1);
  }

  const guides = collectSources()
    .map(buildGuide)
    .filter((guide) => guide !== null);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ version: 1, guides }));
  console.log(`[workflow-builder-knowledge] wrote ${guides.length} guides`);
}

function parseArgs(argv) {
  const result = {};
  const iterator = argv[Symbol.iterator]();
  for (const arg of iterator) {
    if (arg === "--root") {
      result.root = iterator.next().value;
    } else if (arg === "--out") {
      result.out = iterator.next().value;
    }
  }
  return result;
}

function collectSources() {
  const sources = [
    { rel: "docs/workflows.md", id: "workflows", kind: "reference" },
    {
      rel: "docs/orchestrator-guide.md",
      id: "orchestrator-guide",
      kind: "reference",
    },
  ];
  const content = "apps/web/content/docs";
  for (const name of SETUP_GUIDES) {
    sources.push({
      rel: `${content}/guides/setup/${name}.mdx`,
      id: `setup/${name}`,
      kind: "guide",
    });
  }
  for (const name of CONCEPT_GUIDES) {
    sources.push({
      rel: `${content}/concepts/${name}.mdx`,
      id: `concepts/${name}`,
      kind: "guide",
    });
  }
  for (const file of listFiles(
    path.join(root, content, "guides/recipes"),
    ".mdx"
  )) {
    const name = path.basename(file, ".mdx");
    if (name !== "index") {
      sources.push({ rel: toRel(file), id: `recipes/${name}`, kind: "guide" });
    }
  }
  const tracked = trackedFiles();
  for (const file of listFiles(path.join(root, "docs/workshop"), ".yaml")) {
    if (tracked && !tracked.has(toRel(file))) {
      continue;
    }
    const rel = toRel(file);
    const id = rel.replace(WORKSHOP_PREFIX, "").replace(YAML_SUFFIX, "");
    sources.push({ rel, id: `example/${id}`, kind: "example" });
  }
  return sources;
}

// Tracked files when a git work tree is available, so git-ignored local material is never
// bundled. In the Docker pruner stage there is no .git: returns null and every file found
// on disk is used (the build context is already limited to tracked sources there).
function trackedFiles() {
  try {
    const output = execFileSync("git", ["ls-files", "-z", "docs/workshop"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return new Set(output.split("\0").filter(Boolean));
  } catch {
    // observability: no git work tree or no git binary, fall back to the filesystem listing
    return null;
  }
}

function toRel(file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function listFiles(dir, extension) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(full, extension));
    } else if (entry.name.endsWith(extension)) {
      files.push(full);
    }
  }
  return files.sort();
}

function buildGuide(source) {
  const file = path.join(root, source.rel);
  if (!fs.existsSync(file)) {
    console.warn(`[workflow-builder-knowledge] missing source ${source.rel}`);
    return null;
  }
  const raw = fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n");
  const { frontmatter, body } = splitFrontmatter(raw);
  const text = file.endsWith(".mdx") ? stripImports(body) : body;
  return {
    id: source.id,
    title: resolveTitle(frontmatter, text, file),
    kind: source.kind,
    source: source.rel,
    text: text.trim(),
  };
}

function splitFrontmatter(raw) {
  const match = FRONTMATTER.exec(raw);
  if (!match) {
    return { frontmatter: "", body: raw };
  }
  return { frontmatter: match[1], body: raw.slice(match[0].length) };
}

function stripImports(body) {
  return body
    .split("\n")
    .filter((line) => !IMPORT_LINE.test(line))
    .join("\n");
}

function resolveTitle(frontmatter, text, file) {
  const fromFrontmatter = TITLE_FIELD.exec(frontmatter);
  if (fromFrontmatter) {
    return fromFrontmatter[1].trim().replaceAll(QUOTE_EDGES, "");
  }
  const heading = H1.exec(text);
  if (heading) {
    return heading[1].trim();
  }
  return path.basename(file);
}
