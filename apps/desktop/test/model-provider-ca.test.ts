import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { MODEL_PROVIDER_CA_PEM_ENV_KEY } from "@repo/api/src/types/compute-target-model-provider";
import { materializeModelProviderCaCertificates } from "../src/server/otel/model-provider-ca.js";

const PEM = "-----BEGIN CERTIFICATE-----\nMIIBroot\n-----END CERTIFICATE-----";

describe("materializeModelProviderCaCertificates", () => {
  test("writes the PEM to a file and points NODE_EXTRA_CA_CERTS at it", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "af-ca-"));
    try {
      const env = materializeModelProviderCaCertificates(
        { [MODEL_PROVIDER_CA_PEM_ENV_KEY]: PEM, HTTPS_PROXY: "http://p:8090" },
        dir
      );
      assert.equal(env?.HTTPS_PROXY, "http://p:8090");
      assert.equal(env?.[MODEL_PROVIDER_CA_PEM_ENV_KEY], undefined);
      const file = env?.NODE_EXTRA_CA_CERTS ?? "";
      assert.equal(path.dirname(file), dir);
      assert.equal(readFileSync(file, "utf8"), `${PEM}\n`);

      const again = materializeModelProviderCaCertificates(
        { [MODEL_PROVIDER_CA_PEM_ENV_KEY]: PEM },
        dir
      );
      assert.equal(again?.NODE_EXTRA_CA_CERTS, file);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("leaves an environment without a certificate unchanged", () => {
    const extra = { ANTHROPIC_BASE_URL: "https://x" };
    assert.equal(materializeModelProviderCaCertificates(extra, "/nope"), extra);
    assert.equal(materializeModelProviderCaCertificates(undefined), undefined);
  });
});
