# Orchestrator guide: setting it up and writing its rules

A practical guide for running a project's ticket flow through an
orchestrated workflow. The reference (how each part works in code) is
[orchestrator.md](orchestrator.md); bringing an agent people already run on
their own computer under the orchestrator is in
[agent-integration.md](agent-integration.md); runners and AGENTFLOW.md are in
[runner.md](runner.md); triggers in [workflows.md](workflows.md). The worked
example throughout is LeaveDesk:
[workshop/leavedesk/orchestrator-workflow.yaml](workshop/leavedesk/orchestrator-workflow.yaml).
A full ticket, To Do to Done, step by step with LikeC4 diagrams:
[case-studies/ld-6-team-calendar](case-studies/ld-6-team-calendar/README.md).

## 1. Concepts

| Term | What it is |
|---|---|
| **Orchestrated workflow** | A workflow with `agent.mode: orchestrated`. It starts no run: every event its triggers match goes to its own orchestrator, an agent on a runner of its own. |
| **Case** | One per (workflow, ticket). Holds the notes, the tasks, the decisions and the conversations of that ticket. Closes when the orchestrator closes it; a new message reopens it. |
| **Conversation** | One per thread of the ticket: `jira:KEY:item` for root comments and ticket changes, `jira:KEY:comment:<parent>` for a comment thread. Each has its own turns; different threads run in parallel. |
| **Turn** | One run of the orchestrator (Claude Code `-p`, MCP tools only, empty folder) that takes every new message of a conversation and acts with its tools. |
| **Task** | One command of one runner, started with `task_run`, run as a loop on that runner. Its answer, questions and files come back to the case. |
| **Wait** | `wait_for` (tasks) or `wait_human` (people) ends a turn. A wait on tasks is evaluated in code; the next turn starts only when it fires. |
| **Decision** | An approval asked with `request_decision`, given with the button in AgentFlow or recorded from the thread with `record_decision`. |
| **Ticket change** | A status move or label change, stored as a message of the item conversation (`Status changed: A → B (by X)`). |
| **supersede / queue** | What a new message does to a running turn of the same thread: `supersede` stops it (its write tools are refused at once), `queue` lets it finish. |
| **Side conversation** | A thread about another item (e.g. a Teams thread about LD-6). It stays its own case. With `caseLookup` the orchestrator can read the other item's case; with `caseHandoff` it can send people-approved text there as a `handoff` message. |
| **debounce** | `debounceSeconds`: a thread stays quiet this long before a turn starts, so a burst (three status flips, a comment and its edit) is one turn. |

## 2. The four layers

Every behaviour lives in exactly one layer. Put a rule in the wrong one and it
either drifts or cannot be enforced.

| Layer | Where | Holds | Changed by |
|---|---|---|---|
| **Rules** | The workflow (`agent.instructions`, editor or YAML) | The process: the flow by status or label, roles, what needs approval, how to talk on the ticket | The admin, in AgentFlow |
| **Capabilities** | Each of the project's Agents' `AGENTFLOW.md` (Project -> Agents) | The commands a runner offers: name, args, description, `mode`, `produces`, `needs`, `asks`, `push`, `attach` | The toolkit repository (auto runner) or the person's project folder (personal runner) |
| **Skills and commands** | `.claude/skills` of the toolkit repo, or the personal folder | How a command does its work, its input check and its output files | The team owning the toolkit |
| **Platform guarantees** | AgentFlow code | Cases, threads, debounce, supersede, waits, file transport, guards | Nobody per project |

### AGENTFLOW.md fields

```markdown
---
runner: QC (LeaveDesk)
toolkit:                                 # auto runners: the toolkit mounted into the workspace
  repository: workshop/leavedesk-qa
  mounts: [.claude/agents, .claude/skills]
commands:
  - name: /qa-test
    args: <KEY> design
    description: Design the test cases of a ticket from its PRD (no run)
    mode: write          # read | write. A read command never commits or pushes.
    produces: testcases  # a tag other commands can need
    needs: [prd]         # tags that must exist first (checked by AgentFlow and by the command)
    asks: true           # may stop with questions for people
    attach: ["TESTCASES-*.md"]   # files left for the ticket, globs in the work directory
  - name: /qa-run
    args: <KEY> [fresh | rerun | report]
    description: Run the designed tests of a merged ticket; opens a pull request
    mode: write
    produces: results
    needs: [testcases]
    push: true           # auto runner: AgentFlow commits, pushes and opens the pull request
    attach: ["RESULTS-*.md", "evidence-*/*.png"]
skills: [qa-test, qa-run]
---
(body: what each command does, in prose, for the orchestrator)
```

- `push` is per command. Split a command whose modes differ (design vs run,
  analyse vs archive) so only the mode that changes the repository pushes.
- `produces` / `needs` are free tags. AgentFlow checks a `needs` tag by the
  file names of its producers' `attach` globs (passed files or ticket
  attachments).
- Never put a secret in AGENTFLOW.md: the refresh warns on lines that look
  like one, and the file is shown to every admin and to the orchestrator.

## 3. Writing the rules (`instructions`)

The rules are sent with every turn. Keep them to the process. For each rule
below: what to write, why, and what the platform already does.

**Roles, not command names.**
Write: *"Pick the runner by its role (BA, Dev, QC) and the command whose
description and produces/needs fit the step. Do not guess commands a runner
does not declare."*
Why: AGENTFLOW.md is the source of truth. A command renamed or split in a
toolkit (`/ba-requirement archive` → `/ba-archive`) keeps working without
touching the workflow.
Platform: `task_run` refuses a command the runner does not declare.

**The flow, by status (or by label).**
Write one line per status: who starts what, what is posted, what the admin
must do next. *"Ready for Dev: BA archives the PRD; Dev writes the plan and QC
designs the test plan, both given the PRD."* *"PRD Review: start nothing
new."*
Why: the orchestrator acts on ticket changes; a status with no line is
ambiguous.
Platform: debounce merges a burst of moves into one turn that sees the final
status.

**Files on the ticket.**
Write: attach a task's files in the comment that announces them; always use
the latest succeeded task that produced the file; hand files to later tasks
with `task_run files` and name them in the prompt; never paste a file's
content into a comment; say so when a file is missing or "not collected".
Platform: the runner collects `attach` files at loop end (20 files, 4 MB
each, 5 MB total); `reply attachments` uploads them; `task_run files` writes
them to the next task's `inputs/`.

**Cancelling.**
Write: only a status change cancels tasks; moving forward keeps running tasks;
moving backward or out of the flow cancels the tasks started for the statuses
left; several changes in one turn: act on the final status.
Why: forward moves often happen while a task still runs (the admin approves
early).
Platform: `task_cancel` is accepted only in a turn that took a change listed in
`cancelOn`; comments never allow it.

**Questions and answers.**
Write: answer a question in its own thread; a reply that answers some
questions and asks new ones gets the new ones answered first, and the task is
resumed only when every question has an answer (list the open ones); a
question never stops or restarts a running task; answers people gave are
decisions to pass to later tasks that use the same file.
Platform: each comment thread is its own conversation; `reply replyTo` and
`task_run replyTo` keep an answer that waits for a task in the thread it
answers.
Write: *"A question the agent already asked on the ticket (marked already
asked): do not post it again; wait for the reply to that comment; when every
question of the task has an answer, resume it with the answers."*
Platform: the question's `commentId` becomes an anchor; a reply to that comment
reaches the orchestrator even without a mention and carries `task` and
`question`.

**BLOCKED.**
Write: *"A task answer that starts with BLOCKED: did nothing. Comment what is
missing and who produces it. If the missing file exists from an earlier task
of this case, pass it with task_run files and run the task again (once)."*
Platform: `needs` is checked before dispatch; the command checks again on the
runner.

**Blockers.**
Write: *"Before starting tasks for a status, read the item
(source_item_get). If any item in blockedBy is not yet in Review or Done, start
nothing and comment which items it waits for. When this item moves to Review or
Done, call case_notify for each item in blocks with what changed. On a
case_notify message, read the item again; if no blocker remains, act on its
current status as if it had just moved there. A comment on the ticket also
re-checks blockers."*
Why: a task started on an unfinished dependency produces work that is thrown
away; a blocked case must be woken when the blocker resolves.
Platform: `source_item_get` returns `blockedBy` / `blocks` (Jira "Blocks"
links, Azure DevOps predecessor / successor); `case_notify` queues a message on
the other case and wakes it (reopens a closed case).
Limits: the blocker must be in a workflow with a status-changed trigger (no
turn runs when it moves otherwise) and its case must exist in the same
workflow; notifying is model-driven (no platform guarantee), so the manual
comment is the fallback; which statuses count as resolved is the rules' choice,
not config.

**Language.** Write the default language of comments and that a comment in
another language is answered in that language. File names, commands and
ticket keys stay as they are.

## 4. Writing commands for orchestration

1. **Check inputs first**, before any branch, clone or skill. On a miss write
   one line as the first line of the reply file and stop:
   `BLOCKED: missing PRD-<KEY>.md (needs prd: produced by /ba-requirement analyze <KEY> on BA (LeaveDesk))`
2. **Fixed output names**: `<KIND>-<KEY>.md` (`PRD-LD-5.md`, `PLAN-LD-5.md`,
   `TESTCASES-LD-5.md`, `RESULTS-LD-5.md`), matching the `attach` globs.
3. **Read inputs** from `.agentflow-ai/work/inputs/` (auto runner) or
   `$AGENTFLOW_WORKDIR/inputs/` (personal runner).
4. **Write the reply** to `.agentflow-ai/work/orchestrator-reply.md`
   (`$AGENTFLOW_WORKDIR/orchestrator-reply.md`): what was done, in a few
   lines. Questions go to `questions.json` when the command declares `asks`.
5. **Leave ticket files** in the work directory; do not attach them to the
   ticket yourself.
6. **Never merge.** An auto runner's `push: true` command lets AgentFlow open
   the pull request; a personal runner's command pushes and opens it with the
   person's credentials. The admin merges.
7. **A run never redesigns.** A command that executes an approved artifact
   (test cases, a plan) uses it as is and reports doubts in its report.

## 5. Setup checklist for a real project

- [ ] **Toolkit repositories**, one per team (BA, QC, ...), each with
  `AGENTFLOW.md` at the root, `.claude/skills` (and agents), and the input
  check in every command. Add them to the project's repositories.
- [ ] **Runners**: one per team, plus one for the orchestrator (no repository
  clone; a small model is enough for testing). Personal runners for people who
  work on their own machine (AGENTFLOW.md in their project folder). When the
  project has Agents, the orchestrator's Agent must be one of them (save
  refuses).
- [ ] **Capabilities**: Project → Agents → Commands → refresh each auto
  runner after a toolkit change; check problems and warnings. A personal runner
  uploads its file when it starts.
- [ ] **The workflow**: `agent.mode: orchestrated`, the orchestrator's runner,
  the rules, `concurrency`, `debounceSeconds`, `cancelOn`; optionally
  `mentionOnly`, `caseLookup` and `caseHandoff`. Triggers
  `jira.issue_mentioned` and `jira.issue_status_changed` (and
  `jira.issue_labeled` if the flow uses labels) with `projectKeys`.
- [ ] **Jira**: the statuses of the flow; a webhook per bot connection with
  the events *issue updated* and *comment created/updated*; the bot user can
  comment, attach and read the project.
- [ ] **Model provider**: the model and the pinned Claude Code version on
  every runner. Auto runners install the pinned version per loop; a personal
  runner fails a loop with the `claude install <version>` to run when the
  machine's version differs.
- [ ] **Git**: auto runners push with the loop's git credentials; personal
  runners with the person's (for Gitea, a `tea` login whose token has
  `write:repository` and `write:issue`).
- [ ] **Try it** on one ticket through every status, with a question in a
  comment at each review step, before using it on real work.

## Navigation

- **Cases**: sidebar Cases lists every case of the org (filter by project,
  workflow, status). Home shows what needs attention (pending decisions,
  waiting for a person, blocked or failed tasks, offline agents); each item
  links to its case.
- **Agents**: sidebar Agents lists every agent (automatic and personal) with
  health and Claude Code version. Click an agent for its detail:
  capabilities, the workflows that use it, recent tasks and usage.

## Case time and cost

Active agent time is the summed duration of the sessions of the case's tasks
(the loop's start to end when a loop has no synced session) plus the
orchestrator's turns. Elapsed time is opened to closed. Tokens and cost are
summed the same way and include personal-agent sessions.

## 6. What is not guarded yet

Guarded today: undeclared commands, write tasks of read commands, missing
`needs`, write tools of a superseded turn, `task_cancel` outside a ticket
change turn; refused calls are recorded on the case as "Refused" messages.
Not yet:

- Who may approve in the thread: `record_decision` trusts the orchestrator's
  reading of who wrote it (no Jira/Teams account ↔ AgentFlow member mapping).
- Budgets per case or project (turns per hour, tasks, cost).
- Write grants for the orchestrator's replies and posts per integration.
- Cancelling only on backward moves: the rules decide, not the platform.
- Hardening against untrusted ticket text beyond marking it untrusted in the
  prompt.
