// One-shot SigNoz provisioning: admin, notification channels, dashboards and alert rules.
// Zero dependencies (Node 24 global fetch). Idempotent: safe to re-run.
// Never prints the password, JWT, webhook URL or request bodies.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ProvisionOutcome = {
  Created: "created",
  Updated: "updated",
  Failed: "failed",
  Skipped: "skipped",
};

export const ChannelName = {
  Webhook: "af-webhook",
  Email: "af-email",
};

const SELF_REGISTRATION_DISABLED = "self-registration is disabled";
const INCORRECT_PASSWORD = "incorrect_password";

export class InitExit extends Error {
  constructor(code, message) {
    super(message);
    this.exitCode = code;
  }
}

export function readConfig(env, scriptDir) {
  return {
    url: trimTrailingSlashes(env.SIGNOZ_URL || "http://signoz:8080"),
    email: env.SIGNOZ_ADMIN_EMAIL || "",
    password: env.SIGNOZ_ADMIN_PASSWORD || "",
    name: env.SIGNOZ_ADMIN_NAME || "Admin",
    orgName: env.SIGNOZ_ORG_NAME || "AgentFlow",
    provisionDir: env.SIGNOZ_PROVISION_DIR || path.resolve(scriptDir, ".."),
    alertEmailTo: env.SIGNOZ_ALERT_EMAIL_TO || "",
    // The pinned SigNoz ignores the global smtp_require_tls (SIGNOZ_ALERTMANAGER_
    // ..._SMTP__REQUIRE__TLS) for email channels: each channel defaults to TLS
    // required, so a plain-SMTP relay (Mailpit in dev) needs it on the channel.
    alertEmailRequireTls: env.SIGNOZ_SMTP_REQUIRE_TLS !== "false",
    alertWebhookUrl: env.SIGNOZ_ALERT_WEBHOOK_URL || "",
    timeoutSeconds: Number(env.SIGNOZ_INIT_TIMEOUT_SECONDS || 300),
  };
}

// Returns { status, body } where body is parsed JSON or null.
async function call(ctx, method, route, { token, payload } = {}) {
  const headers = { Accept: "application/json" };
  if (payload !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await ctx.fetch(`${ctx.config.url}${route}`, {
    method,
    headers,
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

// Safe summary of a failed response: HTTP status and error code only.
export function describeFailure(result) {
  const error = result.body?.error;
  const code =
    (typeof error === "object" && error ? error.code : undefined) ||
    result.body?.errorType ||
    "unknown";
  return `HTTP ${result.status} ${code}`;
}

function errorText(result) {
  const error = result.body?.error;
  if (typeof error === "string") {
    return error;
  }
  return error?.message || "";
}

function errorCode(result) {
  const error = result.body?.error;
  return typeof error === "object" && error ? error.code : undefined;
}

export async function waitForHealth(ctx) {
  const deadline = ctx.now() + ctx.config.timeoutSeconds * 1000;
  while (ctx.now() < deadline) {
    try {
      const result = await call(ctx, "GET", "/api/v1/health");
      if (result.status === 200) {
        return;
      }
    } catch {
      // not reachable yet
    }
    await ctx.sleep(2000);
  }
  throw new InitExit(1, "signoz-init: SigNoz did not become healthy in time");
}

export async function ensureAdmin(ctx) {
  const { config } = ctx;
  const result = await call(ctx, "POST", "/api/v1/register", {
    payload: {
      name: config.name,
      orgName: config.orgName,
      email: config.email,
      password: config.password,
    },
  });
  if (result.status === 200) {
    ctx.log("signoz-init: admin created");
    return;
  }
  if (
    result.status === 400 &&
    errorText(result).includes(SELF_REGISTRATION_DISABLED)
  ) {
    ctx.log("signoz-init: already initialised");
    return;
  }
  throw new InitExit(
    1,
    `signoz-init: register failed (${describeFailure(result)})`
  );
}

export async function login(ctx) {
  const result = await call(ctx, "POST", "/api/v1/login", {
    payload: { email: ctx.config.email, password: ctx.config.password },
  });
  const token = result.body?.data?.accessJwt;
  if (result.status === 200 && token) {
    return token;
  }
  if (errorCode(result) === INCORRECT_PASSWORD) {
    throw new InitExit(
      1,
      "signoz-init: admin login failed: SIGNOZ_ADMIN_PASSWORD differs from the existing SigNoz admin"
    );
  }
  throw new InitExit(
    1,
    `signoz-init: login failed (${describeFailure(result)})`
  );
}

export function desiredChannels(config) {
  const channels = [];
  if (config.alertWebhookUrl) {
    channels.push({
      name: ChannelName.Webhook,
      webhook_configs: [{ send_resolved: true, url: config.alertWebhookUrl }],
    });
  }
  if (config.alertEmailTo) {
    channels.push({
      name: ChannelName.Email,
      email_configs: [
        {
          send_resolved: true,
          to: config.alertEmailTo,
          require_tls: config.alertEmailRequireTls,
        },
      ],
    });
  }
  return channels;
}

// Upsert one item. `existingId` selects PUT vs POST.
async function upsert(
  ctx,
  token,
  { kind, title, collection, existingId, payload }
) {
  const route = existingId ? `${collection}/${existingId}` : collection;
  const method = existingId ? "PUT" : "POST";
  let outcome = existingId
    ? ProvisionOutcome.Updated
    : ProvisionOutcome.Created;
  try {
    const result = await call(ctx, method, route, { token, payload });
    if (result.status < 200 || result.status >= 300) {
      outcome = ProvisionOutcome.Failed;
      ctx.log(`signoz-init: ${describeFailure(result)} for ${kind} ${title}`);
    }
  } catch (error) {
    outcome = ProvisionOutcome.Failed;
    ctx.log(
      `signoz-init: request error for ${kind} ${title} (${error?.name || "Error"})`
    );
  }
  ctx.results.push({ outcome, kind, title });
  ctx.log(`${outcome} ${kind} ${title}`);
  return outcome;
}

async function listItems(ctx, token, route, pick) {
  try {
    const result = await call(ctx, "GET", route, { token });
    if (result.status === 200) {
      return pick(result.body) || [];
    }
    ctx.log(`signoz-init: list ${route} failed (${describeFailure(result)})`);
  } catch {
    ctx.log(`signoz-init: list ${route} failed (request error)`);
  }
  return [];
}

export async function syncChannels(ctx, token) {
  const desired = desiredChannels(ctx.config);
  if (desired.length === 0) {
    return [];
  }
  const existing = await listItems(
    ctx,
    token,
    "/api/v1/channels",
    (body) => body?.data
  );
  const configured = [];
  for (const channel of desired) {
    const match = existing.find(
      (item) => item.name === channel.name || item.id === channel.name
    );
    const outcome = await upsert(ctx, token, {
      kind: "channel",
      title: channel.name,
      collection: "/api/v1/channels",
      existingId: match?.id,
      payload: channel,
    });
    if (outcome !== ProvisionOutcome.Failed) {
      configured.push(channel.name);
    }
  }
  return configured;
}

async function readJsonFiles(dir) {
  let names;
  try {
    names = (await readdir(dir))
      .filter((name) => name.endsWith(".json"))
      .sort();
  } catch {
    return [];
  }
  const files = [];
  for (const name of names) {
    files.push({
      name,
      json: JSON.parse(await readFile(path.join(dir, name), "utf8")),
    });
  }
  return files;
}

export async function syncDashboards(ctx, token) {
  const files = await readJsonFiles(
    path.join(ctx.config.provisionDir, "dashboards")
  );
  if (files.length === 0) {
    return;
  }
  const existing = await listItems(
    ctx,
    token,
    "/api/v1/dashboards",
    (body) => body?.data
  );
  for (const { name, json } of files) {
    const title = json.title || name;
    const match = existing.find((item) => item.data?.title === json.title);
    await upsert(ctx, token, {
      kind: "dashboard",
      title,
      collection: "/api/v1/dashboards",
      existingId: match?.id,
      payload: json,
    });
  }
}

export async function syncRules(ctx, token, channelNames) {
  const files = await readJsonFiles(
    path.join(ctx.config.provisionDir, "alerts")
  );
  if (files.length === 0) {
    return;
  }
  const existing = await listItems(
    ctx,
    token,
    "/api/v1/rules",
    (body) => body?.data?.rules
  );
  for (const { name, json } of files) {
    const title = json.alert || name;
    const match = existing.find((item) => item.alert === json.alert);
    await upsert(ctx, token, {
      kind: "rule",
      title,
      collection: "/api/v1/rules",
      existingId: match?.id,
      payload: { ...json, preferredChannels: channelNames },
    });
  }
}

// Returns the process exit code.
export async function run(ctx) {
  try {
    await waitForHealth(ctx);
    if (!(ctx.config.email && ctx.config.password)) {
      ctx.log(
        "signoz-init: SIGNOZ_ADMIN_EMAIL/SIGNOZ_ADMIN_PASSWORD not set; skipped"
      );
      return 0;
    }
    await ensureAdmin(ctx);
    const token = await login(ctx);
    const channelNames = await syncChannels(ctx, token);
    await syncDashboards(ctx, token);
    await syncRules(ctx, token, channelNames);
  } catch (error) {
    if (error instanceof InitExit) {
      ctx.log(error.message);
      return error.exitCode;
    }
    ctx.log(`signoz-init: unexpected error (${error?.name || "Error"})`);
    return 1;
  }
  return ctx.results.some((item) => item.outcome === ProvisionOutcome.Failed)
    ? 1
    : 0;
}

export function createContext(overrides = {}) {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  return {
    config: readConfig(process.env, scriptDir),
    fetch: globalThis.fetch,
    log: (line) => console.log(line),
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    results: [],
    ...overrides,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exit(await run(createContext()));
}

function trimTrailingSlashes(value) {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") {
    end -= 1;
  }
  return value.slice(0, end);
}
