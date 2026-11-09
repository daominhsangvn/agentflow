# Real test plan: Agents tab, project Agents, personal Agents, Windows service

Manual end-to-end test of the features shipped on `feat/orchestrator-followups`
on 2026-11-06, on real components: the local stack, the headless runner (auto
and personal), Claude through the computer's model provider, a real Jira site
and a Windows machine. The automated counterparts (fake Jira, fake Agents) are
`e2e/orchestrator-full-flow.spec.ts` and `e2e/agents-project-scope.spec.ts`;
this plan covers what they cannot: the runner code, Claude, Jira identities
and Windows.

| Area | Commits | Docs |
|---|---|---|
| Agents tab (diagram, case inbox, ask/answer) | 58ff673, 1136e12 | docs/orchestrator.md, guides/operate/agents |
| Workflows run only on their project's Agents | aa6bbf5 | docs/runner.md "Personal runner", docs/workflows.md |
| Questions an agent asks on the item (commentId) | 39acf3e, 678f39a | docs/orchestrator.md, docs/agent-integration.md |
| Windows service, uninstall script | 6060f33 | docs/runner.md "Option D: Windows" |

Approval before posting on LeaveDesk is a separate plan: [2026-11-08-leavedesk-approval.md](2026-11-08-leavedesk-approval.md).

Each case has an id, steps, the expected result and what to keep as evidence.
Record results in the table at the end.

## 0. Environment

| # | Precondition | How to check |
|---|---|---|
| E1 | Docker Desktop has free disk. The three runner containers crash with `ENOSPC: no space left on device` (2026-11-06). | `docker system df`; `docker logs --tail 5 agentflow-runner-1` shows no ENOSPC |
| E2 | Stack up: postgres, rustfs, local-git, mailpit; app :3000, api :3002, mcp :3010 (Node 24) | `curl -s localhost:3002/health`, `curl -s localhost:3010/ready` |
| E3 | Local DB matches the schema (init baseline edited in place) | `scripts/check-changes.sh --base 452cf72 --only db` |
| E4 | Runner image rebuilt from this branch (the bundle and `agent-plugins/` are baked in), runner-1 recreated with the README "Upgrade" `docker run` | `docker exec agentflow-runner-1 node /opt/agentflow-runner/runner.mjs --version` matches `apps/desktop` |
| E5 | Personal runner bundle built: `pnpm -C apps/desktop package:headless` (and `--windows` for section W) | `dist-headless/agentflow-runner-<v>*.zip` |
| E6 | Model provider set on each compute target (Settings → Agents → Model provider), Claude Code version pinned as the proxy requires | a trivial loop answers instead of `426 Outdated Claude Code version` |
| E7 | A real Jira site connected (bot account), a Jira project mapped on the test project's Jira connection (`projectKeys`), webhook delivery reaching the API (tunnel URL in `PUBLIC_WEBHOOK_BASE_URL`) | assign a ticket to the bot: Workflow → Events shows `created` |
| E8 | Two people's Jira accounts for the personal Agent cases: a developer (the personal Agent's own account) and a BA | both can comment on the test ticket |
| E9 | A Windows 10/11 machine (or VM) with the section W requirements, a non-administrator account with a password (not only a PIN) | `node -v` ≥ 22, `git --version`, `claude --version` |

Test data (create once, note the ids):

- Project `RT` (slug = project key) with one repository (Local Git `workshop/leavedesk-app` is enough for read-only commands).
- Agents: `rt-orch` (auto, runner-1), `rt-ba` (auto, second runner container or second data dir), `rt-dev` (personal for `RT`, on the Mac), `rt-outside` (auto, registered in the org, never added to `RT`).
- `AGENTFLOW.md` per Agent for `RT`: `rt-ba` declares `/ba-clarify` (`mode: read`, `asks: true`); `rt-dev` declares `/dev-clarify` (`asks: true`) whose command comments its question on the ticket and writes `commentId` (see docs/runner.md "Writing commands for a personal runner").
- Orchestrated workflow `RT orchestrator` on `rt-orch`: trigger Jira `issue_assigned` (bot), rules "Ask the BA to clarify new tickets; ask the developer for estimates", `mentionOnly: true`.

## A. Workflows run only on their project's Agents

| Id | Steps | Expected | Evidence |
|---|---|---|---|
| A1 | `RT` → Agents: add `rt-orch`, `rt-ba` | Both listed with kind *automatic*, tools, capacity | screenshot |
| A2 | Save a plan-and-execute workflow on `RT` with Agent `rt-outside` | Refused: "The workflow's Agent (rt-outside) is not one of the Agents of project RT…" | screenshot of the error |
| A3 | Same with a runner rule on `rt-outside` | Refused: "Runner rule 1's Agent…" | screenshot |
| A4 | YAML editor: `runner:` suggestions for a workflow on `RT` | Only `rt-orch`, `rt-ba` (and `rt-dev` once added) | screenshot of the popup |
| A5 | Save on `rt-ba`; remove `rt-ba` from `RT`; Run now | Run fails `agent_not_in_project`; no loop on any other Agent | run page, `select … from loops where …` empty |
| A6 | Re-add `rt-ba`, stop its container (offline), Run now | Automatic Agent offline → the run goes to the least busy online project Agent (`rt-orch`) | run page shows the Agent used |
| A7 | Project without Agents (`RT-open`): workflow on `rt-outside` | Saves and runs on `rt-outside` (unchanged behaviour) | run page |
| A8 | Orchestrator: `runners_list` in a turn on `RT` (case CASE.md or the turn's tool calls) | Lists only `RT`'s Agents; `rt-outside` absent even with an AGENTFLOW.md for `RT` | turn tool calls |
| A9 | Fleet (`/agents`) and agent detail of `rt-ba` | Counts and project only from `RT`'s Agents | screenshot |

## P. Personal Agents

| Id | Steps | Expected | Evidence |
|---|---|---|---|
| P1 | `node runner.mjs setup` → personal, project key `NOPE` (not in the org), then start | Registration refused; the runner prints the `personal_agent_project_not_found` reason and does not loop on reconnect | terminal output |
| P2 | Setup with key `RT`, start `node runner.mjs --project RT` | Connected; in AgentFlow the Agent exists in the org and shows on `RT` → Agents as **waiting to be added**, not on any other project | screenshot |
| P3 | `PUT` / UI: add `rt-dev` to another project `RT-open` | Refused: "rt-dev is a personal Agent of project RT…" | screenshot |
| P4 | Add `rt-dev` to `RT` | Listed with kind *personal*; waiting list empty | screenshot |
| P5 | Workflow with a runner rule `source.assignee_email == "<dev email>"` → `rt-dev`; stop the personal runner; trigger | Run fails (named offline personal Agent); never falls back to `rt-orch`/`rt-ba` | run page |
| P6 | Same with the runner online | STEP runs in the project folder on the Mac; `.agentflow-ai/runs/<run>` created | run page, folder listing |
| P7 | Personal runner with a mismatched Claude Code version (proxy pins another) | Loop fails before running with the `claude install <version>` hint | loop error |
| P8 | Remove `rt-dev` from `RT`, restart the runner | Back on the waiting list; a running workflow on it fails `agent_not_in_project` | screenshot |

## Q. Questions an agent asks on the item under its own account (commentId)

Uses `rt-dev` (personal) whose `/dev-clarify` comments the question on the
Jira ticket with the developer's own account and writes
`{"id":"q1","question":"…","commentId":"<id>"}` to `questions.json`.

| Id | Steps | Expected | Evidence |
|---|---|---|---|
| Q1 | Assign test ticket `<KEY>` to the bot | Case opens on `RT orchestrator`; the orchestrator runs a task on `rt-dev` | case page |
| Q2 | The task ends with the question | The Jira comment is the developer's (not the bot's); the case shows a *task_asked* record; the bot posts **no** copy of the question; the case needs a person (Agents tab counter on `rt-dev` = 1) | Jira comment history, case timeline |
| Q3 | BA replies **to that comment** in Jira (Reply, no @bot mention) | A message reaches the case naming the task and question; a turn starts despite `mentionOnly: true` | case timeline, turn prompt |
| Q4 | Wait for the turn | The orchestrator resumes the task on `rt-dev` (no fork, same session); the agent continues with the answer; counter back to 0 | case tasks, loop on the Mac |
| Q5 | A plain comment on the ticket without mention | No turn (`mentionOnly`) | Workflow → Events: `filtered`/no case message |
| Q6 | Answer the same question on the case page instead of Jira (second ticket) | Same as Q4; open question count 0 | case page |
| Q7 | Two questions, one answered | Task not resumed until every question has an answer | case timeline |
| Q8 | Two Jira connections in the org with the same comment id (known bug, fix pending in `.harness/runs/anchor-scope-stale-e2e`) | After the fix: each reply reaches its own case only | — |

## T. Agents tab (Workflow → Agents)

| Id | Steps | Expected | Evidence |
|---|---|---|---|
| T1 | Open `RT orchestrator` → Agents | Tab only on orchestrated workflows; diagram: orchestrator node, one node per `RT` Agent (declared via AGENTFLOW.md, or that ran a task), online/offline state, role from AGENTFLOW.md | screenshot |
| T2 | With Q2's case open | Tab badge "1 case needs a person"; counter on `rt-dev`; edge orchestrator→`rt-dev` animated while it has open questions and active tasks | screenshot / short recording |
| T3 | Click `rt-dev` | URL `?agent=<id>`; inbox lists only cases where `rt-dev` has a task; Back restores the previous selection | screenshot |
| T4 | Open the case | Thread shows the conversation; "Orchestrator asks" banner only while the case needs a person | screenshot |
| T5 | Answer the question in the thread form | Same result as Q6; counter and badge clear after the turn | screenshot |
| T6 | "Ask rt-ba about <key>": a question about earlier work | The orchestrator's turn prompt has `to="rt-ba"`; it runs a **fork** task on `rt-ba` (original session untouched); the answer comes back in the thread | case tasks (`fork: true`), turn prompt |
| T7 | Ask an Agent with no task in the case (API `toAgentId`) | 409 "The agent has no task in this case" | response |
| T8 | Orchestrator ends a turn with `wait_human` + `asked` (e.g. rules ask for a confirmation) | Case needs a person with the asked line on the list, the case page and the banner; the next message clears it | screenshot |
| T9 | Non-admin member | Can read the tab and post messages; admin-only actions hidden | screenshot |
| T10 | Mobile width (≤ 768 px) | Diagram and inbox stack; no horizontal scroll | screenshot |

## W. Windows: service and uninstall

Bundle: `pnpm -C apps/desktop package:headless --windows`, copy the zip to the
Windows machine, unzip to a permanent folder (e.g. `C:\agentflow\runner-<v>`).

| Id | Steps | Expected | Evidence |
|---|---|---|---|
| W1 | Inspect the zip | `runner.mjs`, `agent-plugins\`, `start-runner.cmd`, `setup-runner.cmd`, `uninstall-runner.cmd`, `README.txt`, `winsw\WinSW.exe`, `winsw\LICENSE.txt`; WinSW sha256 matches the pinned value | `Get-FileHash winsw\WinSW.exe` |
| W2 | `setup-runner.cmd`: auto mode, answer **yes** to "start with Windows" | One UAC prompt; WinSW asks for the account password and offers "log on as a service"; service `agentflow-agent` installed, Automatic, running as that account | `sc.exe qc agentflow-agent`, `Get-Service agentflow-agent` |
| W3 | Reboot, do not sign in | Agent online in AgentFlow before sign-in; a loop runs | AgentFlow Agents page, `<data dir>\service\logs` |
| W4 | `setup-runner.cmd --project RT` (personal), yes to the service | Second service `agentflow-agent-rt`, independent of the first; both online | `Get-Service agentflow-agent*` |
| W5 | Cancel the UAC prompt | "Windows did not get administrator approval (UAC cancelled); nothing changed."; no service change | terminal |
| W6 | Wrong password in WinSW | Install fails with the log path; no half-installed service | terminal, `sc.exe query` |
| W7 | Setup again answering **no** to the service | Service removed; runner still works with `start-runner.cmd` | `sc.exe query` |
| W8 | Upgrade: unzip a newer build to a new folder, run its `setup-runner.cmd`, Enter to everything | Service re-pointed to the new folder and restarted; the Agent keeps its id in AgentFlow | service binary path, Agents page |
| W9 | Uninstall while a loop runs | Asks "Stopping the Agent fails N loop(s)…"; no → nothing changes | terminal |
| W10 | `uninstall-runner.cmd`, delete local data **no** | Service removed; `%USERPROFILE%\.agentflow-runner` kept; Agent offline in AgentFlow | `sc.exe query`, folder |
| W11 | `uninstall-runner.cmd --project RT`, delete local data **yes** | Only `agentflow-agent-rt` removed; `...\personal\RT` deleted; the auto service untouched | `Get-Service`, folder |
| W12 | Account with a Windows Hello PIN only / Microsoft account | Docs guidance holds: the online password works; a PIN is refused | terminal |
| W13 | Project folder on a mapped drive (`Z:`) | Fails as documented; the UNC path works | loop error |
| W14 | Loop on Windows: python/jq output, stop a loop | No `\r` in values (shims); stopping ends the whole process tree | loop log, Task Manager |

## R. Regression on the same stack

| Id | Steps | Expected |
|---|---|---|
| R1 | `scripts/check-changes.sh --base 452cf72` | Lint, typecheck, db, unit and e2e as recorded on 2026-11-06 (pre-existing failures listed in `.harness/runs/anchor-scope-stale-e2e/00_request.md`) |
| R2 | LeaveDesk workflow (docs/workshop/leavedesk) on PRO-1: one ticket BA → Dev → QC | Same outcome as the last workshop run; Agents tab shows the three agents |
| R3 | Plan-and-execute workflow on a project without an orchestrator | Run completes on its project Agent |
| R4 | Project page tabs, Workflows list (case counts), Cases, Runs, Agents fleet, Home | Render with data; no console errors |

## Results

| Id | Result (pass / fail / blocked) | Notes, evidence link |
|---|---|---|
| E1–E9 | | |
| A1–A9 | | |
| P1–P8 | | |
| Q1–Q8 | | |
| T1–T10 | | |
| W1–W14 | | |
| R1–R4 | | |
