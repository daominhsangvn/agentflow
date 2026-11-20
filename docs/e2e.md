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
| `@smoke` | `auth.setup`, `agent-onboarding-card`, `auth`, `bitbucket-connection`, `connection-yaml-editor`, `document-without-collaboration`, `local-git`, `model-provider`, `navigation`, `orchestrator-agents`, `orchestrator-cases`, `orchestrator-full-flow`, `project-connections`, `project-process`, `project-repositories`, `projects`, `session-token`, `teams`, `workflow-run-process`, `workflow-yaml-editor`, `workflows` | Postgres plus the app and API dev servers. |
| `@external` | `feature-evaluation`, `plan-evaluation`, `pre-loop-system-check` | Liveblocks for document pages, and for loop completion a desktop compute target plus `AGENTFLOW_RUNNER_JWT_SECRET` shared with the API. Skipped unless `E2E_INCLUDE_EXTERNAL=1`. |

`settings.spec.ts` has no tag: `pnpm test:e2e` runs it, the smoke run does not.
`workflow-item-queue.spec.ts` has no tag either (it takes minutes). It runs a
process-mode workflow with `agent.sameItem: queue_resume` against a fake Jira
site and two fake Agents and covers the item queue and session carry-over:
queued mentions, redelivery, another item in parallel, two mentions at once, a
failed run, the resume to fork to fresh fallback and an offline Agent. It
needs Postgres, migrations applied, the app and API dev servers (the API through
`server.ts`, for the engine tick), a Local Git repository and an org admin user,
like `orchestrator-full-flow.spec.ts`.
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

## Orchestrator and item queue specs

`orchestrator-full-flow.spec.ts` (a case from a fake Jira event through fake
Agents), `orchestrator-cases.spec.ts` and `orchestrator-agents.spec.ts` (the
case list and the Agents tab), and `workflow-item-queue.spec.ts` (the item queue
and session carry-over of `agent.sameItem`, docs/workflows.md "Item queue") run
with `pnpm exec playwright test <spec>`. They use the real API, its tick and
Postgres, with a fake Jira site and fake Agents (`e2e/helpers/fake-jira.ts`,
`fake-agent.ts`) instead of Jira, computers and Claude.

Needs, beyond "Run locally":

- All migrations applied (`pnpm prisma migrate deploy`): the queue and the case
  flow read tables and columns added by recent migrations, and fail with a
  Prisma error when one is missing.
- The two flow specs, `orchestrator-full-flow` and `workflow-item-queue`
  (`helpers/orchestrator-flow-env.ts`), need the org's Local Git connection
  with a repository: set `LOCAL_GIT_TOKEN` on the API (and restart it), so
  every organization gets the connection. Without it they stop with "The org
  has no Local Git connection (LOCAL_GIT_TOKEN on the API)".
- The e2e user is an org admin. `E2E_KEEP_DATA=1` keeps what a flow spec created.

`workflow-item-queue.spec.ts` has four tests (no tag). The first queues a second
mention on the same item and starts it after the first run's reply, in order
(result `queued`, shown as `queuedBehind` on the run detail, always pointing at the run that holds the item), delivers the same event twice (`duplicate`),
and resumes the earlier run's session (`parentLoopId`, the short prompt,
`inputs/new-messages.md`), a third run resuming the second's. The second runs a
mention on another item at once. The third sends two mentions at the same moment
and checks they never run together. The fourth fails the first run without
blocking the second, then runs the `RESUME_SESSION_NOT_FOUND` -> fork -> fresh
chain and starts fresh when the runner is offline. A fake Agent reports session ids and capabilities
(`loopStepResumeMiss`, `loopStepForkSession`) but runs no Claude.

What no automated spec reaches: a real Claude session, the working directory
lookup, Teams and `mentionRequester`. Those are the manual scenarios below.

### Manual scenarios for the item queue (Teams emulator)

Setup: the stack as above; the emulator and a Teams connection as in the next
section; a workflow from the project's request process with
`agent.sameItem: queue_resume`, `runner` = a real personal runner on this
machine (`/ask` available in its project folder, else add
`.claude/commands/ask.md`), and a second, shared auto runner in the project.
Send messages with `node scripts/dev/teams-send.mjs ... --inbound <url>`.

- **M1, queue and resume (personal runner, one at a time).** Mention the bot in
  a new thread (note `rootId`); while run 1 works, post a plain reply
  (`--reply-to <rootId> --text "context message"`, no mention) and then a
  mention as another user; then a mention in a new thread. Expect: run 2
  `received` with "Waiting for an earlier run of this item (Running)";
  `workflow_events.result` `created`, then `queued` for the second mention (the
  plain reply gets none that starts a run); `/control/messages` shows reply 1
  (`<at>An</at>`) strictly before reply 2 (`<at>Binh</at>`); the new thread runs
  at once; run 2's page says it continued the item's previous agent session;
  run 2's loop has `parentLoopId` = run 1's loop and the same Claude session id;
  `inputs/new-messages.md` of run 2 holds "context message" and the second
  mention only; each run page lists its own session row and run 2's tokens
  are not run 1's plus its own.
- **M2, auto runner.** As M1 with `runner` = the auto runner. Expect: run 2's loop
  runs in `loops/<run 1 slug>`; `.agentflow-ai/work/answer.md` of run 1 is gone
  before run 2's agent starts; with a step that asks (`questions: ask`), the
  answers-resume loop runs in the same folder and resumes.
- **M3, session missing.** Before the second mention, delete the session
  `.jsonl` under `~/.claude/projects/<working directory>` on the runner.
  Expect: run 2's first loop fails `RESUME_SESSION_NOT_FOUND`, a fork loop fails
  the same way, then a fresh loop runs; the run page says the runner no longer
  had the session; reply 2 is posted.
- **M4, runner offline.** Stop the runner after reply 1, mention again. Expect: the
  run goes to the other runner, fresh, with the full thread in `issue.md` and the
  reason "the runner of the earlier session is not available".
- **M5, personal runner in parallel.** `AGENTFLOW_RUNNER_PARALLEL=true`, two
  threads with two mentions each, sent quickly. Expect: the threads overlap, and
  within a thread the runs are strictly sequential with resume.

Two things only a real runner confirms, and the code assumes:

1. **The text the pinned Claude Code prints for a missing session.** The runner
   matches `no conversation found`, `session not found` / `session id not found`
   and `failed to load session` (`RESUME_SESSION_MISSING_RE` in
   `apps/desktop/src/server/operations/loop-step-resume-miss.ts`). M3 shows
   whether the pinned version's message matches; when it does not, the loop
   fails with its ordinary code and the run does not fall back.
2. **Whether a resumed invocation reports per-invocation or cumulative
   tokens.** Usage is recorded per loop on the assumption that a resumed
   invocation's result covers that invocation only. M1 checks it: if run 2's
   tokens equal run 1's plus its own, the numbers are cumulative and run 2 is
   overcounted.

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
