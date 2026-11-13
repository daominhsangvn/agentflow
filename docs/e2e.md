# End-to-end tests (Playwright)

The web e2e suite lives in `e2e/` and runs with Playwright from the repo root
(`playwright.config.ts`). It drives a running local stack; it never starts
servers itself.

## Run locally

```bash
docker compose up -d                                   # Postgres (RustFS/Mailpit optional)
cd packages/database && pnpm prisma migrate deploy && cd ../..
pnpm turbo dev --filter=app --filter=api               # keep running in another terminal
pnpm exec playwright install chromium                  # once
pnpm test:e2e:smoke                                    # or: pnpm test:e2e
```

- The API must run through `apps/api/server.ts` (the default `dev` script).
  It hosts the in-process scheduler that advances workflow runs and drains
  post actions, which `e2e/workflows.spec.ts` depends on.
- `pnpm test:e2e:ui` opens the Playwright UI. Reports go to
  `playwright-report/`, traces and screenshots to `test-results/` (both may
  contain authenticated page content; do not publish them).

## URLs and the test account

| Variable | Default | Purpose |
|---|---|---|
| `BASE_URL` | `NEXT_PUBLIC_APP_URL` from `apps/app/.env.local`, else `http://localhost:3000` | Web app origin. Must equal the origin of `BETTER_AUTH_URL` in `apps/api/.env.local`: Better Auth rejects sign-in from any other `Origin`, and the session JWT's issuer is that origin. |
| `E2E_API_URL` | `NEXT_PUBLIC_API_URL`, else port 3002 on the app host | API origin. (`API_BASE_URL` is not read: in the API env it is the loop callback URL.) |
| `E2E_USER_EMAIL` | `e2e@example.com` | Test account. |
| `E2E_USER_PASSWORD` | `DEVOPS_AGENTFLOW_APP_PWD`, else a fixed local default | Required when `BASE_URL` is not localhost. |
| `E2E_USER_NAME` | `E2E Bot` | Display name used when the account is created. |
| `E2E_INCLUDE_EXTERNAL` | unset | `1` also runs the `@external` specs (see below). |

`.env.local` values never override variables already set in the shell. The
app's `dev` script listens on 3000; if your `NEXT_PUBLIC_APP_URL` and
`BETTER_AUTH_URL` say another port (for example 3100), serve the app there
(`pnpm --filter app exec next dev -p 3100`) or point all three at the same
origin.

The `setup` project signs the account in through the Better Auth API (and
signs it up on first use), marks onboarding complete, and saves the session
cookie to `.auth/user.json`. Every other test starts from that storage state
and mints a fresh 15-minute JWT from it (`getSessionBearerToken(page)`, or the
`apiToken` fixture in `e2e/test.ts`) for API calls.

Every account created through sign-up owns its own new organization (the first
one on an empty database gets `agentflow`), so the e2e user is an owner.
Settings and the workflow spec need an org admin or owner; set
`E2E_USER_EMAIL`/`E2E_USER_PASSWORD` to an existing admin to reuse one. Sign-up
must be open (`AUTH_ALLOW_SIGN_UP` not `false`) unless the account already
exists. `e2e/invitations.spec.ts` also needs Mailpit at http://localhost:8025.

## Tags

| Tag | Specs | Needs |
|---|---|---|
| `@smoke` | `auth.setup`, `agent-onboarding-card`, `auth`, `bitbucket-connection`, `connection-yaml-editor`, `document-without-collaboration`, `local-git`, `model-provider`, `navigation`, `project-connections`, `project-process`, `project-repositories`, `projects`, `session-token`, `teams`, `workflow-run-process`, `workflow-yaml-editor`, `workflows` | Postgres plus the app and API dev servers. |
| `@external` | `feature-evaluation`, `plan-evaluation`, `pre-loop-system-check` | Liveblocks for document pages, and for loop completion a desktop compute target plus `AGENTFLOW_RUNNER_JWT_SECRET` shared with the API. Skipped unless `E2E_INCLUDE_EXTERNAL=1`. |

`settings.spec.ts` has no tag: `pnpm test:e2e` runs it, the smoke run does not.
Tags come from `E2ETag` in `e2e/helpers/tags.ts`. `e2e/global.setup.ts` probes
the app and API first and stops with start instructions when either is down.

`pnpm test:e2e:smoke` runs `playwright test --grep @smoke`. A single spec:
`pnpm exec playwright test e2e/workflows.spec.ts`.

## The workflows smoke spec

`e2e/workflows.spec.ts` creates a generic HTTPS ("webhook") integration
connection and a workflow with two `webhook.post` actions targeting a
throwaway HTTP server the test starts on `127.0.0.1`: a pre action
(`run.triggered`, before the agent team) and a post action (`run.started`,
`run.failed`). It then:

1. checks that an unsigned request to the inbound URL is rejected (401);
2. sends a Standard Webhooks-signed delivery (200) and waits for the run to
   fail, which it must, because the registered compute target has no desktop
   app behind it;
3. replays the same delivery and checks that there is still exactly one run;
4. waits for the `run.triggered` and `run.failed` deliveries at the local HTTP
   server, checks the pre action's arrived first and that it is recorded as a
   succeeded pre action run;
5. opens `/{org}/workflows` and expects the workflow to be listed.

Everything it creates is deleted in `finally`.

## Microsoft Teams emulator (manual e2e)

A dev-only stand-in for Teams, to run the `teams_ask` flow end to end over
HTTP without Azure. Not part of the Playwright suite.

`TEAMS_EMULATOR_URL` (in `apps/api/.env.local`, e.g. `http://localhost:3990`)
replaces, for every Teams connection of that API process: the Bot Framework
OpenID metadata and keys, the Entra token URL, the Bot Connector host and
global serviceUrl, and the Graph base URL. The JWT issuer
(`https://api.botframework.com`) and audience (the bot App ID) are unchanged;
the emulator signs with its own RSA key. It is ignored (with one warning) when
`NODE_ENV=production`. Never set it in production or in
`deploy/compose/docker-compose.prod.yml`.

Start (restart the API after setting the variable):

```bash
node scripts/dev/teams-emulator.mjs --port 3990 --app-id <guid> --tenant-id <guid>
# or: pnpm teams:emulator -- --port 3990 --app-id <guid> --tenant-id <guid>
```

Flags: `--port`, `--app-id`, `--tenant-id`, `--team-id`, `--users <json>`
(default `scripts/dev/teams-emulator.users.json`: An `an@contoso.test`, Binh
`binh@contoso.test`, Chi UPN `chi@contoso.test` / email `chi.nguyen@contoso.test`).
State is in memory. Unit test: `node --test scripts/dev/teams-emulator.test.mjs`.

Scenario:

1. Teams connection: bot App ID and tenant ID = the emulator's, any client
   secret, delivery Webhook; note its inbound URL. Project connection key
   `teams`, Channels one request channel (`19:requests@thread.tacv2`), Ask channels two chips:
   `qa-backend = 19:qabackend@thread.tacv2` and `ba = 19:ba@thread.tacv2`.
   A bare `19:x@thread.tacv2` chip is refused (it needs a name).
2. Orchestrated workflow with `agent.orchestrator.connections: { source: [comment], teams: [ask] }`
   and rules with an email table (`| Jira user | email |`: An -> an@contoso.test,
   Binh -> binh@contoso.test) and the channel rule "Backend/API questions: ask
   An in qa-backend. Requirement questions: ask Binh in ba." Its trigger is
   `microsoft_teams.bot_mentioned` with config `channels: [19:requests@thread.tacv2]`,
   so a mention in an ask channel does not start a case. Do not use the HTTP
   request trigger: its endpoints are webhook/run-mode only, an orchestrated
   workflow has no project-connection route for it and the delivery is "No
   enabled trigger matched".
3. Start the case:
   `node scripts/dev/teams-send.mjs --root new --channel 19:requests@thread.tacv2 --mention-bot --text "..." --as an@contoso.test --inbound <inboundUrl>`.
   The agent command must return questions (e.g. a test command writing
   questions.json without commentId), e.g. "Which timeout should the API use?".
4. The orchestrator calls `teams_ask` with `channel: "qa-backend"`, mentioning
   `an@contoso.test`, with `questions [{taskId, questionId}]`. Expect:
   `curl localhost:3990/control/messages` shows a root post in
   `19:qabackend@thread.tacv2` (not `19:ba...`) with `<at>An</at>` and the mention
   entity; the case page shows "Asked in Teams: An" and the file chips. A
   requirement question ("Should half days count?") goes to `ba` mentioning Binh.
5. Fake answer (`<rootId>` is the `id` of that root post):

   ```bash
   node scripts/dev/teams-send.mjs --inbound <inboundUrl> --as an@contoso.test \
     --reply-to <rootId> --mention-bot --text "Use 4 hours"
   ```

   Expect: delivery accepted, the message on the asking case with `via teams`,
   the task's open questions at 0, the next turn resumes the task.
6. Spam cases. Each: the delivery is recorded as ignored, no message on any
   case, no bot post in `/control/messages`:
   a. `--root new --mention-bot` (a random new thread with no anchor and no
      matching trigger) as any user: ignored, no reply, no case;
   b. `--reply-to <rootId>` without `--mention-bot` as an@contoso.test;
   c. `--reply-to <rootId> --mention-bot` as binh@contoso.test (not tagged).

   Case (a) is also an automated test: "ignores a bot mention that starts a new
   Teams thread when no trigger matches" and "ignores a bot mention in a thread
   without an ask anchor" in `apps/api/lib/orchestrator/__tests__/inbound.test.ts`.

`teams-send.mjs` also takes `--channel <id>` (the channel of a new thread) and
`--emulator <url>` (default `http://localhost:3990`); it prints
`{ status, activityId, rootId }`.

## Unit tests for the helpers

The helpers in `e2e/helpers/` have vitest tests in `e2e/helpers/__tests__/`
(Playwright only collects `*.spec.ts` and `*.setup.ts`). They need no running
stack:

```bash
npx vitest run --config e2e/vitest.config.ts
npx tsc --noEmit -p tsconfig.playwright.json
```
