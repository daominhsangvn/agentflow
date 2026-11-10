import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { MODEL_PROVIDER_CA_PEM_ENV_KEY } from "@repo/api/src/types/compute-target-model-provider";

/**
 * The model provider's CA certificates arrive with a loop as PEM text under
 * MODEL_PROVIDER_CA_PEM_ENV_KEY (Settings → computers → Model provider). Node
 * only reads extra CAs from a file, so the text is written to
 * `~/.agentflow/model-provider-ca/<sha256>.pem` and the key is replaced by
 * NODE_EXTRA_CA_CERTS pointing at it. Same content, same file: rewritten only
 * when missing or changed.
 */
export function materializeModelProviderCaCertificates(
  extra: Record<string, string> | undefined,
  baseDir: string = defaultCaDir()
): Record<string, string> | undefined {
  const pem = extra?.[MODEL_PROVIDER_CA_PEM_ENV_KEY];
  if (!(extra && pem !== undefined)) {
    return extra;
  }
  const { [MODEL_PROVIDER_CA_PEM_ENV_KEY]: _pem, ...rest } = extra;
  if (!pem.trim()) {
    return rest;
  }
  const content = pem.endsWith("\n") ? pem : `${pem}\n`;
  const digest = createHash("sha256").update(content).digest("hex");
  const filePath = path.join(baseDir, `${digest.slice(0, 32)}.pem`);
  if (!(existsSync(filePath) && readFileSync(filePath, "utf8") === content)) {
    mkdirSync(baseDir, { recursive: true, mode: 0o700 });
    writeFileSync(filePath, content, { mode: 0o644 });
  }
  return { ...rest, NODE_EXTRA_CA_CERTS: filePath };
}

function defaultCaDir(): string {
  return path.join(os.homedir(), ".agentflow", "model-provider-ca");
}
