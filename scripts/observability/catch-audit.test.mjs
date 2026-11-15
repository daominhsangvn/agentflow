import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { findSilentCatches, isObserved, SCOPE } from "./catch-audit.mjs";

test("flags an empty catch", () => {
  assert.deepEqual(findSilentCatches("try { a(); } catch {}"), [{ line: 1 }]);
});

test("marker comment counts as observed", () => {
  assert.equal(
    findSilentCatches("try { a(); } catch { // observability: probe\n}").length,
    0
  );
});

test("logger call counts as observed", () => {
  assert.equal(
    findSilentCatches("try {} catch (e) { gatewayLog.warn('x', { e }); }")
      .length,
    0
  );
});

test("silent return is flagged", () => {
  assert.equal(findSilentCatches("try {} catch { return null; }").length, 1);
});

test("returning a failure result is observed", () => {
  assert.equal(
    findSilentCatches("try {} catch { return { ok: false, error }; }").length,
    0
  );
});

test("brace inside a string does not break counting", () => {
  const src =
    'try {} catch {\n  const s = "{";\n  return s;\n}\nfoo();\ntry {} catch { throw new Error("x"); }';
  assert.deepEqual(findSilentCatches(src), [{ line: 1 }]);
});

test("reports correct line numbers", () => {
  const src = "a();\nb();\ntry {\n  c();\n} catch (e) {\n  return;\n}\n";
  assert.deepEqual(findSilentCatches(src), [{ line: 5 }]);
});

test("isObserved and SCOPE are exported", () => {
  assert.equal(isObserved("throw e"), true);
  assert.ok(SCOPE.includes("apps/api"));
});

test("catch inside string and template literals is ignored", () => {
  assert.equal(findSilentCatches("const a = 'x catch { y }';").length, 0);
  assert.equal(findSilentCatches('const a = "} catch {}";').length, 0);
  assert.equal(findSilentCatches("const a = `x ` + `catch { }`;").length, 0);
  assert.equal(findSilentCatches("a('catch {');\ntry {} catch {}").length, 1);
});

test("CLI exits 1 for a silent catch and 0 with a marker", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "catch-audit-"));
  const dir = path.join(root, "apps/api");
  fs.mkdirSync(dir, { recursive: true });
  const script = fileURLToPath(new URL("./catch-audit.mjs", import.meta.url));
  const run = () =>
    spawnSync("node", [script], {
      env: { ...process.env, CATCH_AUDIT_ROOT: root },
      encoding: "utf8",
    });
  fs.writeFileSync(path.join(dir, "a.ts"), "try { a(); } catch {}\n");
  const bad = run();
  assert.equal(bad.status, 1);
  assert.ok(bad.stdout.includes("apps/api/a.ts:1"));
  assert.ok(
    bad.stdout.includes("1 silent catch blocks in 1 files (scanned 1 files)")
  );
  fs.writeFileSync(
    path.join(dir, "a.ts"),
    "try { a(); } catch { // observability: ok\n}\n"
  );
  assert.equal(run().status, 0);
  fs.rmSync(root, { recursive: true, force: true });
});
