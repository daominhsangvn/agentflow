# Workflow orchestrator

Each orchestrated workflow has its own **orchestrator**: an agent, on a runner
of its own, that every request of the workflow goes to. It reads the request
(a mention or a reply on a ticket, a message in a Teams thread, a task that
finished), the workflow's rules and what each runner declares it can do, then
chooses which command of which runner does the work, and answers.

```
Jira / Teams / ... ──trigger of an orchestrated workflow──► orchestrator (its runner)
                                                              │ reads: the thread, the ticket, the case,
                                                              │        the workflow's rules, AGENTFLOW.md of each runner
                                                              ├─► command on runner BA  ─┐
                                                              ├─► command on runner QC  ─┤ results come back,
                                                              │                          │ the orchestrator wakes up
                                                              └─◄────────────────────────┘ and answers in the thread
```

Status: phases 1-7 of the plan are built: runner capabilities (also from an
auto runner's toolkit), the orchestrator settings, `agent.mode: orchestrated`,
taking requests (conversations, turns, replies), tasks on other runners with
wait conditions, `supersede`, Teams thread replies, decisions and edited
messages, and the case pages. Of the guards (phase 8), the task guards and the
refusal audit and the write grants are built ("Guards" and "Write grants"
below); identity mapping and budgets come next. The orchestrator configuration moved from the project into
the workflow.

To set one up for a project and write its rules, see
[orchestrator-guide.md](orchestrator-guide.md).

## Settings (the orchestrated workflow)

Set in the workflow (editor or YAML) with `agent.mode: orchestrated`.

| Setting | Meaning |
|---|---|
| `enabled` (workflow) | The orchestrator takes the workflow's requests. Needs a runner; when the project has Agents, it must be one of them (saving refuses otherwise; a turn fails otherwise). |
| `agent.runner` | The computer its turns run on (Claude Code with the orchestrator's tools only). A computer the admin owns or one shared with the organization. |
| `agent.instructions` | The rules (up to 16000 characters; the YAML editor warns above 8000): which runner handles what, the order of the work, what needs an admin's approval. Sent with every turn. |
| `agent.orchestrator.concurrency` | `supersede` (default): a new message on a thread whose turn is running stops that turn, and the next turn answers both. `queue`: the running turn finishes, the next one takes every new message. Messages on different threads always run in parallel. |
| `agent.orchestrator.debounceSeconds` | Seconds a thread stays quiet before a turn starts, so a burst of messages is one turn (default 20). |
| `agent.orchestrator.turnTimeoutMinutes` | Minutes one turn may take (default 10). |
| `agent.orchestrator.connections` | What the orchestrator may write ("Write grants" below). Default `{}`: it only reads the ticket. `source`: `comment`, `attach`, `transition`, `label`, `link`; a Confluence connection key: `read` or `[publish]`; `pull_requests`: `[open]`. Only with `agent.mode: orchestrated`. |
| `agent.orchestrator.cancelOn` | Ticket-change kinds whose turn may cancel tasks with `task_cancel`: `status_changed`, `label_added`, `label_removed`. Default `[status_changed, label_removed]`; `[]` = the orchestrator never cancels. |
| `agent.orchestrator.mentionOnly` | `true` or `false`, default false. A reply in a thread the orchestrator talks in wakes it only when it mentions the bot (or replies to the bot's message). Other replies are not recorded; the orchestrator reads the thread when it needs it. |
| `agent.orchestrator.caseLookup` | `true` or `false`, default false. Adds `case_lookup`: the orchestrator may read the case of another item of this project (read only), e.g. a Teams thread asking about LD-6. |
| `agent.orchestrator.approvals` | `optional` (default) or `required`. `required` refuses `reply` / `edit_reply` on the thread and `source_item_*` writes: a comment or a move reaches the ticket only as the `draft` of an approved `request_decision`. `request_decision` with `where: thread` is refused too (the request and its draft stay on the case page), and `record_decision` cannot approve a draft: only an organization admin's Approve button does (rejecting still works). `reply` with `where: case_page` stays allowed. |
| `agent.orchestrator.caseHandoff` | `true` or `false`, default false. Adds `case_handoff`: after people approve a summary (`request_decision`), the orchestrator sends it to another item's case, whose orchestrator acts on it. |

```yaml
agent:
  runner: runner-orch
  mode: orchestrated
  instructions: |
    BA answers requirements questions; Dev implements; QC tests. Ask an admin
    before anything that changes a release.
  orchestrator:
    concurrency: supersede
    debounceSeconds: 20
    turnTimeoutMinutes: 10
    cancelOn: [status_changed, label_removed]
    connections:
      source: [comment, attach]
      confluence: [publish]
      pull_requests: [open]
```

When the project has Agents, `runners_list` and the tasks it starts only use them.

**Deployment model.** The orchestrator runs on one headless runner with no
repository clone: its turns run in an empty folder with the MCP tools only.
BA, Dev and QC run on personal runners, whose AGENTFLOW.md comes from their
project folder.

## Orchestrated workflows

A workflow with `agent.mode: orchestrated` keeps its triggers and starts no run:
each request goes to the workflow's own orchestrator. Saving one refuses
`agent.process` and `agent.runners` (`workflow-validation.ts`
`checkOrchestrated`); ingest never creates a run for it (`engine/ingest.ts`
`isOrchestratedTrigger`). Several workflows may take the same event, each with
its own cases. The workflow's `description` tells the orchestrator what the
workflow is for.

```yaml
name: Questions on LeaveDesk tickets
description: People mention the bot on a ticket to ask about requirements or the project.
project: LeaveDesk
triggers:
  - connection: jira
    type: jira.issue_mentioned
agent:
  runner: runner-orch
  mode: orchestrated
  instructions: Rules for the orchestrator.
  orchestrator:
    concurrency: supersede
```

## How a request is taken

**Cases and conversations** (`apps/api/lib/orchestrator/inbound.ts`,
`channel.ts`). Ingest offers every event to the orchestrator
(`engine/ingest.ts` `routeOrchestrated`). It takes one when a trigger of an
orchestrated workflow matched it, or when it replies to a message the
orchestrator posted (an **anchor**), whatever the triggers. No model is
asked where it belongs:

| The event | Its conversation (`channelKey`) |
|---|---|
| A reply to an anchor (a message the orchestrator posted, or a comment an agent asked a question in) | the anchor's conversation |
| A reply in a `teams_ask` thread (anchor `artifact = "teams_ask"`) | the asking conversation, only when it mentions the bot and comes from a mentioned person; otherwise dropped |
| A Teams message (post or reply) | the Teams thread: `microsoft_teams:<thread key>` |
| A Jira comment replying to another comment | that comment thread: `jira:<KEY>:comment:<parent id>` |
| A Jira mention on the issue | the issue's top level: `jira:<KEY>:item` |
| A Jira status or label change (`jira.issue_status_changed`, `jira.issue_labeled`) | the issue's top level: `jira:<KEY>:item` |
| A thread reply no trigger matched, workflow with `mentionOnly` | not recorded (dropped) |

A ticket change (`InboundEvent.itemChange`, turned into a message by
`ticket-change.ts`) is stored as an external message of kind `status_changed`
(text `Status changed: A → B (by X)`, payload `{from, to, actor}`), `label_added`
(`Label added: x (by X)`) or `label_removed` (`Label removed: x (by X)`);
the label payload is `{added, removed, actor}`. A `case_notify` from another case is
an internal message of kind `case_notify`. A `case_handoff` writes an internal
message of kind `handoff` on the target case, and the sending conversation gets a
`handoff_sent` message as an audit record (it never wakes a turn).
A `task_asked` message is an internal message recorded when a task settles with
questions that carry a `commentId` (the agent asked them on the item itself, see
"Questions asked on the item" under Tasks and waits). It never wakes a turn.

A conversation belongs to the **case** of its source item (`jira:LD-7`: one
case per item per workflow: unique on `workflowId, sourceKey`; conversations are unique per case and channel). The event's comment or message (`InboundEvent.
message`, filled by the Jira and Teams providers) is stored once as an
**external message** (`message:<comment id>`: the reply and mention events of
one comment are one message). The conversation's `nextWakeAt` moves to now +
the workflow's quiet time, so a burst of messages is one turn.

**Turns** (`apps/api/lib/orchestrator/advance.ts`). The workflow tick
(every `WORKFLOW_TICK_SECONDS`) advances the conversations whose `nextWakeAt`
passed and those with a running turn; each conversation is leased while it
moves, so it has one turn at a time, and different conversations run in
parallel. A turn takes every message no turn took, renders the prompt
(`turn-prompt.ts`: the role, "Your rules" from the workflow, the thread, CASE.md from
`case-render.ts`, the runners' commands, the new messages marked untrusted)
and sends it to the orchestrator's runner as the desktop command
`orchestrator_turn` (`dispatchOrchestratorTurn`). The runner
(`apps/desktop/src/server/operations/orchestrator-turn.ts`) runs Claude Code
in `<workspace>/.agentflow-ai/orchestrator/<workflow id>` with
`--resume <session>` when the conversation has one (a session this computer
does not have starts over: CASE.md carries what matters), only the
orchestrator's tools allowed (`mcp__agentflow_orchestrator`) and files,
shell and web denied. The result line carries the note, the session id and
the usage.

Settling a turn: the session is kept for the next turn of the conversation,
and the conversation waits (`waiting`), or is closed when the turn closed the
case. A turn whose tools declared nothing waits for people. A failed turn
gives its messages back to a turn two minutes later, at most three failed
turns in a row; a turn that cannot be sent fails the same way. While a turn
runs, newer messages wait for the next one (`queue`), or stop it
(`supersede`, below). A disabled workflow (or one without a runner)
keeps its messages and looks again every five minutes.

**Supersede.** With `concurrency: supersede`, a newer external message on a
conversation whose turn runs, once its thread is quiet, stops that turn:
the API sends the runner `orchestrator_turn_cancel` (once per turn; the
request is kept in the turn's `usage`), the runner kills the turn's process
and its command answers `ORCHESTRATOR_TURN_STOPPED_ERROR`. The turn settles
as `superseded`, its input messages (not its replies) go back to the next
turn with the new one, and that turn resumes the stopped turn's session. A
turn that finished before the stop arrived settles as usual.

In a `supersede` conversation, from the moment a newer external message
waits (or a stop was requested for the turn), the running turn's write
tools (`reply`, `edit_reply`, `task_run`, `task_cancel`, `request_decision`,
`record_decision`, `case_notify`, `case_handoff`, `source_item_transition`, `source_item_label`,
`source_item_link`, `close_case`) are refused with `superseded: a newer message
arrived; end the turn`. Reads, `case_update_notes`, `wait_for` and `wait_human`
stay allowed (`lib/orchestrator/supersede.ts`).

**Threads without a mention.** An event no trigger matched and that replies
to no anchor still reaches the orchestrator when its channel already has a
conversation (`orchestrator_conversations.channelKey` on the same workflow
connection): a Teams reply in a thread the orchestrator talks in arrives as
`microsoft_teams.thread_reply` (Teams sends the bot every channel message
with ChannelMessage.Read.Group; a new post without a mention is still
ignored), a Jira reply in a comment thread it talks in as
`jira.comment_reply`.

With `agent.orchestrator.mentionOnly: true` these events are dropped: a reply
wakes the orchestrator only when it replies to a message the orchestrator
posted (an anchor) or a trigger matched it (a mention). They are dropped, not
stored, because one Jira comment raises a reply event and a mention event that
are deduplicated to one message; storing the unmatched one would record the
comment without waking the case.

**Side conversations.** A thread about another item (a Teams thread about LD-6)
stays its own case; it is not merged into LD-6. The bot answers there when it
is mentioned, and with `caseLookup` it can read LD-6 with `case_lookup`. On
"record this in LD-6" the orchestrator reads the thread, posts the summary as a
decision (`request_decision`), and after people approve it calls `case_handoff`.
LD-6's orchestrator receives a `handoff` message and acts on it per its rules.

CASE.md (`case-render.ts`) lists Tasks and Decisions before Conversations.

**Tools** (`apps/api/app/orchestrator-tools/service.ts`). The runner
exchanges the turn for an `ost_…` token (`POST /desktop/orchestrator-sessions`,
the computer the turn was sent to, its owner's API key); apps/mcp serves the
tools for that token from `GET /orchestrator-tools/session` and
`POST /orchestrator-tools/call`. The token works while the turn runs.

| Tool | Does |
|---|---|
| `case_get` | CASE.md: notes, conversations with their latest messages, tasks, decisions |
| `case_update_notes` | Replaces the case's notes |
| `runners_list` | Each runner's AGENTFLOW.md (commands, skills, online) |
| `source_item_get` | The conversation's item through its project connection, incl. `blockedBy` / `blocks` relations |
| `reply` | `where`: `thread` (default for a message from the ticket) or `case_page` (default for a message sent from AgentFlow; shown on the case page only, no grant, no files). `thread` needs `source: comment`, and `attachments` needs `attach`. Posts in the conversation's thread through the provider's `replyOnItem` (Jira: a comment in the thread of the comment answered, on the issue when the site refuses threads; Teams: a reply in the thread mentioning who asked last). Kept as a `reply` message and an anchor |
| `task_run` | Starts a runner's command as a task (below); optional `replyTo`: the message ref the task answers |
| `task_get` | A task's status, answer, questions and error, and the message it answers (`replyTo`) |
| `task_cancel` | Cancels a task of the case with a reason ("Cancelling tasks" below); only in a turn that took a ticket change listed in `cancelOn` |
| `wait_for` | Ends the turn waiting for tasks: `all` (default) or `any`, `timeoutMinutes`, `wakeOnFailure` (default true) |
| `source_item_transition` | `{ transitionName }`: moves the case's ticket (grant `source: transition`) |
| `source_item_label` | `{ add, remove }`: adds and removes labels on the ticket (grant `source: label`) |
| `source_item_link` | `{ url, title }`: adds a link to the ticket (grant `source: link`) |
| `case_notify` | `{ itemKey, message }`: an internal message on the item conversation of another case of the same workflow (same connection), which wakes it after its debounce and reopens it if closed; refused when no case exists for that key, for the case's own item, when the calling conversation has no source item, or when the target case has no conversation on this project connection. No grant |
| `request_decision` | `{ question, where?, draft? }`: asks people to approve or reject: a decision row, and the question posted with `where: thread` (the item's thread, with the case's link; needs the `comment` grant) or `where: case_page` (the case page only, no grant). Default: where the message it answers came from. `draft` (`{ comment: { text, replyTo?, attachments? }, transitionName? }`) is what AgentFlow does on the item once the decision is approved; it is checked like `reply` / `source_item_transition` (grants, files, thread) and needs those grants |
| `record_decision` | Records a decision someone gave in the thread (`via: message`) |
| `page_publish` | (grant: the Confluence key `[publish]`) Publishes a task's Markdown file as a Confluence page, with attachments ("Confluence documents" below) |
| `page_get` | (grant: the Confluence key `read` or `[publish]`) Reads a Confluence page as Markdown, with its version and last editor |
| `pull_request_open` | (grant `pull_requests: [open]`) Opens the pull requests for the branches an auto-runner task pushed ("Pull requests of auto-runner tasks" below) |
| `case_lookup` | (setting `caseLookup`) `{ itemKey }`: CASE.md of the cases of another item in the same project (any workflow), read only |
| `case_handoff` | (setting `caseHandoff`) `{ decisionId, itemKey, caseId? }`: sends an approved summary to another item's case. Checked on the server: the decision is this case's own and approved, and is sent once (`handoff:<decisionId>`); the text is the decision's question, not the model's; the target is in the same project, any workflow, its item conversation else the latest; several cases without `caseId` are refused with a list. The target gets a `handoff` message, wakes after its debounce and is reopened if closed |
| `edit_reply` | Replaces the text of a message this conversation posted (provider `editOnItem`: Jira `PUT comment/{id}`, Teams activity update); `version` moves the anchor's version |
| `wait_human` | Ends the turn waiting for people. `asked` (one line) says what people were asked; with it the case counts as needing a person until the next turn starts ("The Agents tab" below) |
| `close_case` | Ends the turn and closes the case (a new message reopens it) |

Tools whose grant or setting is missing are not listed to the turn
(`visibleTools`, `service/tools.ts`); `case_lookup` and `case_handoff` are hidden
unless their setting is on.

## Write grants

`agent.orchestrator.connections` (`packages/api/src/types/orchestrator-grants.ts`,
`orchestratorConnectionGrantsSchema`, resolved by `resolveOrchestratorGrants`)
says what the orchestrator may write. Default `{}`.

| Key | Values | Allows |
|---|---|---|
| `source` | `comment`, `attach` (needs `comment`), `transition`, `label`, `link` | `reply` / `edit_reply` / `request_decision` (`where: thread`) on the ticket; `reply attachments`; `source_item_transition`; `source_item_label`; `source_item_link`; the `draft` of `request_decision` (its comment needs `comment`, its files `attach`, its move `transition`) |
| a Confluence key | `read` or `[publish]` | `page_get` and page files; `page_publish` (publish implies read). With several granted connections the call names `connection` |
| `pull_requests` | `[open]` | `pull_request_open` |
| a Teams key | `[ask]` | `teams_ask` (see "Asking people in Teams"). Not combined with `publish` on one key |

A Teams thread takes only `comment`. Saving checks the grants
(`workflow-validation.ts` `checkOrchestratorGrants`): every `source` operation
must be offered by some trigger's connection, every other key must be a
Confluence connection of the project (`publish` / `read`) or a Teams connection
(`ask`); a workflow granting `[ask]` is refused at save when that Teams project
connection has no Ask channel. The turn prompt's "Your writes" section
(`turn-prompt.ts`) states what is granted and what is not.

**Case-page messages.** `POST /orchestrator/cases/{id}/messages` (any org member;
`{ conversationId, text, answers }`) stores a message from the member (via
AgentFlow) and wakes the conversation; `answers` answer the questions of the
case's tasks. The orchestrator replies with `reply` on the case page, which needs
no grant and posts nothing on the ticket; posting there too is up to the rules
(`reply where: thread`). A case-page reply may list task files (`attachments`):
nothing is uploaded, the files are kept on the message
(`payload.attachments: [{taskId, name}]`) and the case timeline shows them under it.

## Asking people in Teams (`teams_ask`)

Granted with `agent.orchestrator.connections.<teams key>: [ask]`. The tool posts a
NEW message in a Teams channel (not a reply in the ticket's thread) that
@mentions people, and brings their answers back to the case that asked.

```yaml
connections:
  teams: [ask]
instructions: |
  Backend questions: teams_ask in channel qa-backend; requirement questions: in ba.
  Emails: Lan (QA) lan@example.com, Minh (BA) minh@example.com.
```

- **Channels.** The Teams project connection has an `askChannels` list, one entry
  per channel: `name = <channel link or id>`. The name may be left out for a
  channel link (it is taken from the channel's name); a bare id needs a name.
  Names are unique per connection and a channel is listed once. Each ask channel
  is claimed by the project connection like a mention channel, so a channel
  another project claims is refused. There is no channel key in the workflow:
  the rules choose by name (e.g. "backend questions → qa-backend, requirement
  questions → ba"). The turn prompt lists the allowed channels (name and
  connection key); any other channel is refused with the allowed names.
  Keep ask channels out of non-orchestrated `bot_mentioned` triggers: an empty
  channel filter on that project connection also fires in them.
- **Call.** `mentions` (emails), `text`, `channel` (a name or id; optional only
  when the granted connections have exactly one ask channel), `questions`
  (`[{taskId, questionId}]`, one task per post, ids must exist in the task's
  result), `attachments` (task files), `connection` (only when two connections
  share a channel name). A message may reference files, but Teams takes no
  uploads: the files are listed as links to the case page, with a link to the case.
- **People.** The email is the person's UPN or mail. The bot looks each one up in
  the channel's team (Bot Connector `GET /v3/conversations/{channel}/members/{upn}`,
  falling back to `GET .../pagedmembers`) and posts with
  `POST /v3/conversations` (private channels are not supported). A person not in
  the team refuses the call. The emails come from the rules (e.g. a table of
  Jira users or roles to emails); the turn prompt tells the model never to guess one.
- **serviceUrl.** The newest one a verified Teams delivery of that connection
  carried, else the global `https://smba.trafficmanager.net/teams/`.
- **Record.** The post is stored as an internal `reply` message (payload
  `teamsAsk`: channel, mentions, questions) and an anchor with
  `artifact = "teams_ask"` (`TEAMS_ASK_ANCHOR_ARTIFACT`, `lib/orchestrator/teams-ask.ts`)
  on the root message; with one question the anchor carries its task and question.
- **Replies.** Teams sends the bot every channel message (RSC), so the thread is
  filtered (`checkTeamsAskReply`): a reply counts only when it @mentions the bot
  AND comes from a person the post mentioned. Others are dropped for every
  workflow and logged with a reason (`ask_reply_without_bot_mention`,
  `ask_reply_from_someone_not_asked`). An accepted reply becomes
  a message `via="teams"` on the asking case, with the task and question; with
  several questions the first accepted reply answers them all.
- **Spam.** The bot mention alone opens nothing: a bot mention in a random Teams
  thread (a new post or a reply) with no `teams_ask` anchor and no matching
  trigger is ignored, with no reply and no case. Covered by the "teams_ask
  threads" tests in `lib/orchestrator/__tests__/inbound.test.ts`.

## Tasks and waits

**A task** (`apps/api/lib/orchestrator/tasks.ts`) is one command of one
runner, run as a STEP loop on that runner. `task_run` takes the runner (its
name, the role its AGENTFLOW.md gives it, or its id), the command, its args
and a prompt (the request and the context the runner needs: it sees only
that and the case); the mode is the command's declared one unless given.
The loop:

- works on **the case's Issue on that runner**: an Issue document made with
  the case's first task there (`orchestrator_tasks.documentId`, titled
  `<case> · <runner>`, CASE.md as its body). It carries the project, its
  repositories (cloned like any loop's) and the project key a personal
  runner checks, and names the runner's workspace for the case, so the
  case's tasks on a runner share one workspace (`fresh` only for the first)
  and a later task resumes an earlier one's session (`resumeTaskId`: its
  loop becomes the parent; `fork: true` resumes in a copy, e.g. to ask about
  a plan without changing its session). One loop runs on an Issue at a time:
  a second task of the case on the same runner waits (`queued`).
- keeps **case affinity**: a case's tasks of one role run on the same Agent.
  It is derived from `orchestrator_tasks` (the latest started task of the case
  on an Agent of that role; no stored column). When a runner name or role
  matches several Agents, the case's Agent is used, else one is auto-picked
  (online first, then free capacity via `maxInFlightCommands`, then load, then
  name). If none is online the task is refused. Naming a different Agent of the
  role is refused, for read and write tasks alike (a read task elsewhere sees
  none of the uncommitted code and would move the affinity).
- has step settings (`LoopStepConfig`): `runId` = the case (a personal
  runner keeps one work directory per case), `stepId` = the task,
  `askQuestions` from the command's `asks`, the answer file collected
  (`ORCHESTRATOR_TASK_REPLY_FILE`, `.agentflow-ai/work/orchestrator-reply.md`;
  `$AGENTFLOW_WORKDIR/orchestrator-reply.md` on a personal runner), `push`
  from the command's `push` on an auto runner (a personal runner's command
  pushes itself), and `readOnly` for a read: Edit, MultiEdit, NotebookEdit,
  `git commit` and `git push` are denied (`READ_ONLY_STEP_DISALLOWED_TOOLS`,
  the answer file is still written), `attach` and `attachChanged` from the
  command's (a `<name>:` glob is collected from a folder in the personal
  Agent's `attachRoots` or the built-in `project`; an auto Agent skips it; the
  prompt says where the files go; see "Capabilities" in `docs/runner.md`),
  and `inputs` from `task_run files` (written to `inputs/` before the agent
  starts). The case page lists each stored task file with View and
  Download.
- runs as the runner's owner. When the runner is offline the task fails with
  "Runner X is offline: the task was not started..." if the case has no work
  there yet; otherwise it stays `queued` with a waiting reason until the Agent
  is back (the case's workspace is there). When it is busy the task
  stays `queued` and `task_run`, `task_get`, wait results, CASE.md and the case
  page show it as `waiting` with the reason. A queued task that fails on a later
  tick wakes the wait. A personal runner that runs one task at a time
  takes them in turn: the task stays `queued` and the tick tries again.

**Guards.** `task_run` (through `startTask`) refuses a task before it is
created when:

- **declared**: the command is not in the runner's AGENTFLOW.md (a file that
  does not parse refuses every command). A queued task is checked again when
  it launches and fails if its command is no longer declared.
- **mode**: it asks for `mode: write` on a command declared `mode: read`.
  `mode: read` on a write command is allowed (a read-only step, no push).
- **push**: not a refusal. AgentFlow pushes only for an auto runner's command
  with `push: true` run in write mode; a read command that declares `push`
  gets a capabilities warning.
- **needs**: a `needs` tag has producers (commands of the project whose
  `produces` is that tag) with `attach` globs, and neither the passed `files`
  nor the ticket's attachments match one of them by file name. A need with no
  producer or no `attach` is not checked, and the check passes when the ticket
  cannot be read (fail-open). The runner-side BLOCKED check stays. Tasks with
  `resumeTaskId` are exempt.

- **granted**: a write the grants do not allow (`notGranted`) is refused and
  recorded like any refusal.
- **superseded**: the new write tools (`source_item_*`) are refused for a
  superseded turn, like the other writes.
- **own changes**: the bot's own transition or label change is stored as an
  internal ticket-change message on the conversation (actor `AgentFlow`), so
  people and the next turn see it. `task_cancel` counts only external messages,
  so it never allows a cancel.

Every refused tool call (`ok: false`, not retryable) is recorded as a
`tool_refused` message on the conversation (`<tool> refused: <error>`, no tool
input). It never wakes a turn, shows as "Refused" in the case detail and
appears in CASE.md's recent messages.

**Files.** A command declares `attach` globs in AGENTFLOW.md (relative to the
task's work directory). `buildStep` adds them to the step's `attach`, and the
runner collects the matches as bytes when the loop ends (at most 20 files,
4 MB each, 5 MB together; files over a limit are reported as skipped or
omitted). The upload route stores them in the loop-state bucket under the
loop's prefix (deleted with it 90 days after completion). The task result
lists them (name, size) in `task_get`, wait results and CASE.md.

- `reply attachments: [{taskId, name}]` uploads files of tasks of the same case
  to the source item through the source's `attachFile` (Jira; Teams refuses),
  one after another, then posts the comment with the files shown. A failure
  posts nothing and names what was already attached. `edit_reply` takes no
  attachments.
- `task_run files: [{taskId, name}]` passes text files of earlier tasks (at
  most 5, 200 KB each, 400 KB together) to the new task. They are written to
  `inputs/` in its work directory and kept in the task result until launch.
- `task_run files: [{page, name}]` passes a Confluence page (id or link, inside
  the project connection's spaces). Its current Markdown is read when
  `task_run` runs, stored in the task result as `pageInputs`, and written to
  `inputs/<name>` at launch, with the same limits as task files (shared count
  and size). A page input counts for the guards' `needs` check.
- `task_run replyTo` is checked against the conversation's messages, stored in
  the task result, and shown in `task_get`, wait results and CASE.md ("answers
  ref ...").

The case pages are on Workflow → Cases, with a breadcrumb back to the workflow.

An organization admin can delete a case from its page (`DELETE /orchestrator/cases/{id}`):
its conversations, messages, turns, tasks, waits and decisions go with it; its loops, sessions,
pull requests and Issues stay. A case with a running turn or a queued or running task is refused
(409). A new message about the same item opens a new case.

### The Agents tab

An orchestrated workflow has an **Agents** tab. The left side is a diagram: the
orchestrator and, below it, each Agent (automatic or personal) with a task in
the workflow's cases. Each node shows a counter of the cases that need a person.
The right side is a case inbox scoped to the selected node, then the case
thread and a composer. The selection is in the URL:
`?tab=agents&agent=<agentId>&case=<caseId>`; without `agent` the orchestrator
is selected.

**Needs a person** is one definition (`caseNeedsPersonWhere`,
`apps/api/lib/orchestrator/case-needs-person.ts`), used by the org case list
and the workflow case counts. A case needs a person when it is open, its
orchestrator is not working (no running turn, no wake scheduled) and one of
these holds:

- a decision is pending;
- an Agent question has no answer yet (a task with `openQuestionCount > 0`);
- the last `wait_human` set `asked` (`askedHuman` on the conversation).

`openQuestionCount` on a task is set to the number of the questions in its
result when the task settles (including questions the Agent already asked on
the item, `task_asked`). It goes down by one for the first anchored reply to
each question, goes to 0 when answers are sent on the case page, when the task
is resumed without fork, and when it is cancelled. `askedHuman` is set by
`wait_human asked` and cleared when the next turn starts.

**Writing to an Agent.** A case-page message may carry `toAgentId` (the Agent
picked in the composer; it must have a task in the case). The orchestrator gets
it as a message with `to="<agent>"` and relays it: a `task_run` that resumes
that Agent's latest task in the case with `fork: true`, `replyTo` the
message, then `wait_for`, then a `reply` on the case page with what the Agent
said. The relay does not change the original task or its open questions.

If that Agent has a task in the case with open questions, the stored `toAgent`
also carries `openQuestionTaskId`, and the turn prompt writes the message with
`open-questions-task="<task>"`. The message then counts as the answers: the
orchestrator resumes that task without fork (`task_run` with `resumeTaskId`,
same runner), `replyTo` the message, then `wait_for`.

The inbox lists the cases that need a person first, then the others by last
update. The orchestrator
node's number is the cases that need a person. An Agent node's number is its
queued plus running tasks across the cases; its question icon means it has open
questions and its red alert icon means its latest task in an open case failed.
The Agent's inbox rows show Running or Queued (with the wait reason) and the
same icons.

The tick (`advanceDueConversations`) launches queued tasks, settles running
ones whose loop ended (`isLoopSettled`: a revivable timed-out loop is still
running): `succeeded` with the answer file and the questions, `failed` with
the loop's error. The task's result keeps its `inputs`, `replyTo` and
cancel/waiting notes when it settles or fails.

**Questions asked on the item.** A personal Agent may comment a question on the
ticket itself and write that comment's id as `commentId` in its
`questions.json`; it flows into `TaskResult.questions`. When the task settles,
`task-asked.ts` records the `task_asked` message and one anchor per `commentId`
(`orchestrator_anchors.task_id`, `question_id`; provider = the conversation's
item provider; idempotent on (organization, connection, comment id)). Anchors are
scoped to the integration connection because provider ids such as Jira comment
ids are per site, so a reply is looked up with the connection that received it.
A reply to that comment routes by
the anchor, whatever the triggers and `mentionOnly`, and its message payload
carries `taskId` and `questionId` (`task="..." question="..."` in the prompt).
The orchestrator collects the answers in a turn and resumes the task (no fork,
same runner). Wait results, CASE.md and `task_get` mark these questions as
asked on the item; AgentFlow never posts them.

Anchors are written when the task settles, not when the agent comments. A reply
posted in that window (loop still running, settle delay) is not anchored yet and
routes by the triggers, so on a `mentionOnly` workflow it is dropped. The
provider of an anchor is the conversation's item provider, which is also the
case's source provider (a case holds only conversations of its own source), so
it always matches the commented item.

**Waits** (`waits.ts`). `wait_for` stores what the conversation waits for and
ends the turn. The engine evaluates it in code whenever one of its tasks
settles, and its deadline from the tick: while the condition does not hold
nothing happens (no turn, no model call); once it does (or a task failed,
with `wakeOnFailure`, or the deadline passed) the wait fires once, an
internal message (`task_results`, `deadline`) carries each task's status,
answer, questions and error, and the conversation's next turn is due at once.
Tasks that already finished fire the wait as soon as it is stored. Waits of
one conversation that fire in the same evaluation (or the same deadline tick)
post one combined message, with each task listed once.

**Cancelling tasks** (`task-cancel.ts`). `task_cancel { taskId, reason }` is
accepted only in a turn that took a message whose kind is in `cancelOn`
(default `status_changed` and `label_removed`; `[]` = never); otherwise the
refusal names the setting. Comments, questions and replies never allow it. Any
task of the same case can be cancelled, never another ticket's case.

- running: the loop is stopped through `engine/cancel.ts` `cancelLoop`.
- queued: never dispatched.
- finished: closed, so it cannot be resumed.

Waits count `cancelled` as finished and wake at once with
"cancelled: <reason>", including a comment-thread turn waiting in parallel.
CASE.md "started for" names the status, label or message that started each
task, so only the removed label's tasks get cancelled. The turn prompt has a
"Ticket changes" section; debounce merges a burst of flips into one turn that
sees the sequence and the final status.

## Confluence documents

`page_publish { file: {taskId, name}, title, kind?, page?, parent?, space?,
attachments?, overwrite?, connection? }` turns a Markdown file of a task of
the case into a Confluence page (`kind`: `ticket`, `prd`, `plan`, `test_plan`,
`test_run`, `other`).

- **Target.** `page` (id or link) updates that page. Without it the page is
  found by `title` in the space, or created: under `parent` (a page reference,
  or `root` for the top of the space) or the project connection's
  `parentPageId`; `space` names the space key when it is not implied. A title
  already used by a page elsewhere in the space is refused (pass it as `page`
  or choose another title).
- **Overwrite guard.** Updating a page that someone else edited since
  AgentFlow last published it (the version recorded on the case) is refused;
  hand the page to a task with `task_run files [{page, name}]` so the edits
  are kept, then publish again. `overwrite: true` replaces it when people
  asked for that.
- **Attachments and images.** `attachments` (at most 10 files of tasks of the
  case, e.g. screenshots) are uploaded to the page; images are shown below the
  body (file names in the Markdown stay plain text). A new page with files
  is created first and then updated with the attachment blocks, so it has two
  versions.
- **`page_get { page, connection? }`** returns the page's Markdown (cut at
  60 000 characters), version, parent and last editor (and whether
  AgentFlow wrote that version).
- **Recorded on the case.** Each publish is kept as a `document` message
  (page, title, kind, version, URL). CASE.md lists them under "Documents", the
  case page shows them in a card, and they are not fed again to the next turn
  when a turn is superseded.
- **Scope.** Only the project's Confluence connections are used; with more
  than one, `connection` names the one. The provider refuses any page or
  parent outside the connection's `spaceKeys`.

## Pull requests of auto-runner tasks

`push` on a command only pushes branches (an auto runner's command with
`push: true` run in write mode); it opens no pull request.
`pull_request_open { taskId, title, description?, draft? }` opens the pull
requests for the branches that task pushed, one per project repository, through
each repository's connection. It is refused for a task that has not succeeded or
pushed nothing; a branch that already has a pull request is reported as
existing, and a repository that fails does not stop the others.

## Decisions

`request_decision` stores a pending decision on the case and posts its
question. It is decided once (`lib/orchestrator/decisions.ts`), either way:

- **in AgentFlow**: `POST /orchestrator/decisions/{id}` (`{ approved,
  comment }`, org admins only) records it in the admin's name (`via:
  button`), and an internal `decision` message wakes the conversation;
- **in the thread**: the orchestrator records what someone said with
  `record_decision` (`via: message`, who as written); it already knows, so
  no message wakes it again. Who may decide this way is one of the guards
  (phase 8).

`request_decision` takes an optional `where` (`thread` or `case_page`), like
`reply`. With `where: thread` the question is posted on the item's thread
with the case's link and needs the `comment` grant. With `where: case_page`
it stays in AgentFlow: it is posted on the case page only, ends with "Approve
or reject it under Decisions, or answer here.", and needs no grant. Without
`where` it goes where the message it answers came from. A decision asked on
the case page is approved or rejected with the Decisions card (on the case
page, or on the orchestrator node's case in the Agents tab), or answered by a
case-page message that the orchestrator records with `record_decision`.
Rules use this for "nothing goes on the ticket without an admin's approval"
(see [orchestrator-guide.md](orchestrator-guide.md) section 3).

**Draft.** `request_decision` may carry a `draft`: the whole comment
(`comment.text`, `replyTo`, `attachments`) and/or a status move
(`transitionName`). The draft is validated when the decision is requested and
stored on the decision; the Decisions card shows it in full. When the decision
is approved, by the button or (without `approvals: required`) by `record_decision`, the server carries the
draft out exactly once (the claim is the same `updateMany` that decides it),
through the same code as `reply` and `source_item_transition`. The result
(`draftResult`: `running`, `done` or `failed`, the comment reference, the move,
the error) is written on the decision. The `decision` message that wakes the
orchestrator says the draft was already posted (or why it failed), so it must
not post it again. A rejected decision posts nothing. If the process stops
while posting, the result stays `running` and the draft is not retried.

With `agent.orchestrator.approvals: required`, a thread write that does not
come from an approved draft is refused, `request_decision` with `where: thread`
is refused (nothing reaches the ticket before approval), and `record_decision`
with `approved: true` on a decision that has a draft is refused ("only an
admin's Approve button approves a draft"; audit `tool_refused`). A rejection
through `record_decision` still works. If the comment was posted but writing it
to the history failed, the comment is still reported as posted and is never
posted again.

## What runners can do (AGENTFLOW.md)

The orchestrator chooses among the commands the project's Agents declare in their
`AGENTFLOW.md`: docs/runner.md "Capabilities (AGENTFLOW.md)". Project →
Agents → Commands shows them.
