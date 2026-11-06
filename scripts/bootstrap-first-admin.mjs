// Creates the first AgentFlow owner from environment variables. Runs as the
// one-shot `bootstrap-admin` compose job inside the api image: it calls the
// api's internal route, which runs the normal Better Auth sign-up even when
// AUTH_ALLOW_SIGN_UP=false. Idempotent: when any user exists nothing changes.
//
//   AGENTFLOW_ADMIN_EMAIL, AGENTFLOW_ADMIN_PASSWORD   required
//   AGENTFLOW_ADMIN_NAME                              default "Administrator"
//   INTERNAL_API_SECRET                               required
//   AGENTFLOW_API_INTERNAL_URL                        default http://api:3002
//
//   node scripts/bootstrap-first-admin.mjs
const RETRY_INTERVAL_MS = 2000;
const RETRY_TIMEOUT_MS = 120_000;
const MIN_PASSWORD_LENGTH = 8;
const TRAILING_SLASHES = /\/+$/;

const email = (process.env.AGENTFLOW_ADMIN_EMAIL ?? "").trim();
const password = process.env.AGENTFLOW_ADMIN_PASSWORD ?? "";
const name = (process.env.AGENTFLOW_ADMIN_NAME ?? "").trim() || "Administrator";
const secret = process.env.INTERNAL_API_SECRET ?? "";
const baseUrl = (
  process.env.AGENTFLOW_API_INTERNAL_URL || "http://api:3002"
).replace(TRAILING_SLASHES, "");

await main();

async function main() {
  requireEnv("AGENTFLOW_ADMIN_EMAIL", email);
  requireEnv("AGENTFLOW_ADMIN_PASSWORD", password);
  requireEnv("INTERNAL_API_SECRET", secret);
  if (password.length < MIN_PASSWORD_LENGTH) {
    fail(
      `AGENTFLOW_ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters`
    );
  }

  const data = await requestWithRetry();
  if (data?.status === "created") {
    console.log(`Created the first admin ${email}`);
  } else {
    console.log("Users exist: first-admin bootstrap skipped");
  }
}

async function requestWithRetry() {
  const deadline = Date.now() + RETRY_TIMEOUT_MS;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(
        `${baseUrl}/internal/bootstrap/first-admin`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-internal-secret": secret,
          },
          body: JSON.stringify({ email, password, name }),
        }
      );
      if (response.ok) {
        const json = await response.json();
        return json.data;
      }
      if (response.status === 401) {
        fail("INTERNAL_API_SECRET of the job and the api differ");
      }
      if (response.status === 400) {
        fail(`The api rejected the request: ${await readApiError(response)}`);
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    console.log(`Waiting for the api (${lastError})...`);
    await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL_MS));
  }
  return fail(`The api did not accept the request within 120s (${lastError})`);
}

async function readApiError(response) {
  try {
    const json = await response.json();
    return typeof json?.error === "string"
      ? json.error
      : JSON.stringify(json?.error ?? json);
  } catch {
    return `HTTP ${response.status}`;
  }
}

function requireEnv(key, value) {
  if (!value) {
    fail(`set ${key} in deploy/compose/.env`);
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
