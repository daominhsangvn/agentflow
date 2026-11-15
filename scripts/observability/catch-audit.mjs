// Reports catch blocks that neither log, throw, return a failure, nor carry an
// "observability:" marker comment. Zero dependencies.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const ROOT = process.env.CATCH_AUDIT_ROOT
  ? path.resolve(process.env.CATCH_AUDIT_ROOT)
  : path.resolve(path.dirname(SELF), "../..");

export const SCOPE = [
  "apps/api",
  "apps/mcp/src",
  "apps/app/app/api",
  "apps/desktop/src/server",
  "apps/desktop/src/headless",
  "packages/storage",
  "packages/email",
  `packages/${"git"}${"hub"}`,
  "packages/database",
];

const SKIP_DIR =
  /(^|\/)(node_modules|\.next|dist|dist-headless|generated|__tests__|test|tests|e2e|scripts|fixtures)(\/|$)/;
const SKIP_FILE = /\.(test|spec|test-[a-z]+)\.[cm]?tsx?$|\.d\.ts$/;
const SOURCE_FILE = /\.(ts|tsx|mts)$/;
const OBSERVED = [
  /\b(?:console|[\w$]*[Ll]og(?:ger)?)\.(?:error|warn|info|debug)\(/,
  /\b(?:loop(?:Log|Error|Warn|Debug)|log[A-Z][\w$]*)\(/,
  /\bthrow\b/,
  /\breject\(/,
  /\b(?:recordError|setSpanOutcome|markSpanError|observeThrownError|recordException)\(/,
  /\b(?:errorResponse|serviceUnavailableResponse|handle[A-Z][\w$]*Error)\(/,
  /\bResult\.err\(|\bfailure\(|\bok:\s*false\b/,
];
const MARKER = /\/\/\s*observability:\s*\S/;
const CATCH_PATTERN = String.raw`\bcatch\s*(?:\([^)]*\))?\s*\{`;

export function isObserved(body) {
  return MARKER.test(body) || OBSERVED.some((re) => re.test(body));
}

export function findSilentCatches(source) {
  const silent = [];
  const re = new RegExp(CATCH_PATTERN, "g");
  const code = maskLiterals(source);
  let match = re.exec(code);
  while (match) {
    const bodyStart = re.lastIndex;
    const end = findBlockEnd(source, bodyStart);
    const body = source.slice(bodyStart, Math.max(bodyStart, end - 1));
    if (!isObserved(body)) {
      silent.push({ line: source.slice(0, match.index).split("\n").length });
    }
    match = re.exec(code);
  }
  return silent;
}

/** Copy of `src` with string and template literal contents blanked (newlines kept). */
function maskLiterals(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    let end = i + 1;
    if (ch === "/" && next === "/") {
      end = skipTo(src, i + 2, "\n", false);
    } else if (ch === "/" && next === "*") {
      end = skipTo(src, i + 2, "*/", false);
    } else if (ch === "'" || ch === '"' || ch === "`") {
      end = skipTo(src, i + 1, ch, true);
      out += ch + src.slice(i + 1, end).replaceAll(/[^\n]/g, " ");
      i = end;
      continue;
    }
    out += src.slice(i, end);
    i = end;
  }
  return out;
}

/** Index just past the closing brace of a block whose body starts at `start`. */
function findBlockEnd(src, start) {
  let depth = 1;
  let i = start;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === "/" && next === "/") {
      i = skipTo(src, i + 2, "\n", false);
    } else if (ch === "/" && next === "*") {
      i = skipTo(src, i + 2, "*/", false);
    } else if (ch === "'" || ch === '"' || ch === "`") {
      i = skipTo(src, i + 1, ch, true);
    } else {
      if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
      }
      i++;
    }
  }
  return i;
}

/** Index after `terminator`, honouring backslash escapes when `escapes` is set. */
function skipTo(src, from, terminator, escapes) {
  let i = from;
  while (i < src.length) {
    if (escapes && src[i] === "\\") {
      i += 2;
    } else if (src.startsWith(terminator, i)) {
      return i + terminator.length;
    } else {
      i++;
    }
  }
  return i;
}

function collect(target, out) {
  const stat = fs.statSync(target, { throwIfNoEntry: false });
  if (!stat || SKIP_DIR.test(path.relative(ROOT, target))) {
    return;
  }
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(target)) {
      collect(path.join(target, entry), out);
    }
  } else if (
    SOURCE_FILE.test(target) &&
    !SKIP_FILE.test(path.basename(target))
  ) {
    out.push(target);
  }
}

function main() {
  const args = process.argv.slice(2);
  const listMode = args[0] === "--list";
  const targets = listMode
    ? args.slice(1).map((p) => path.resolve(p))
    : SCOPE.map((d) => path.join(ROOT, d));
  const files = [];
  for (const target of targets) {
    collect(target, files);
  }
  let count = 0;
  const filesWithSilent = new Set();
  for (const file of files) {
    for (const { line } of findSilentCatches(fs.readFileSync(file, "utf8"))) {
      console.log(`${path.relative(ROOT, file)}:${line}`);
      count++;
      filesWithSilent.add(file);
    }
  }
  console.log(
    `catch-audit: ${count} silent catch blocks in ${filesWithSilent.size} files (scanned ${files.length} files)`
  );
  process.exit(!listMode && count > 0 ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  main();
}
