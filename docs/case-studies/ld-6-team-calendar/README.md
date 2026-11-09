# Case study: LD-6 · Team calendar, from To Do to Done with AgentFlow

One Jira ticket, three AI agents and the people who own the work. This case study follows
LeaveDesk ticket **LD-6 "As a manager I want a calendar of who in my team is off"** through
its whole life: PRD, planning, implementation, two test rounds, review and Done. It is meant
for a demo: running the full flow live takes hours, so the diagrams replay it step by step.

## How to open it

The diagrams are a [LikeC4](https://likec4.dev) model in [`likec4/`](likec4/). From the
repository root:

```bash
npx likec4@1.60.0 start docs/case-studies/ld-6-team-calendar/likec4   # interactive site
npx likec4@1.60.0 build docs/case-studies/ld-6-team-calendar/likec4 -o <dir>   # static site
npx likec4@1.60.0 export png docs/case-studies/ld-6-team-calendar/likec4 -o <dir> --sequence
```

Start at **L1** and click an element to drill down a level; the breadcrumb takes you back.
The cases (L5) are dynamic views: open one and step through it, from the first event to the
result. Some steps link down to the lifecycle views (L4). Press **Start** on a case to walk
through it: every step from the Orchestrator Agent's turn has a note, **Why this step**, that
quotes the line of the rules (or of the built-in prompt, or the platform guarantee) behind the
decision and names its mechanism in the `heart` view.

| Level | View | What it shows |
|---|---|---|
| L1 | `index` | The team works in Jira; AgentFlow reads Jira and writes back to Jira, Confluence and Git |
| L2 | `agentflowL2` | The workflow (rules), the Orchestrator Agent, the Agents and the AgentFlow API |
| L3 | `orchestratorL3` | Event → debounce → one turn → tools → guards → wait |
| L3 | `apiL3` | Inbound events, the case store, the engine tick, task files, integrations |
| L3 | `agentsL3` | BA, Dev and QC Agents and what each declares in `AGENTFLOW.md` |
| L4 | `baAgentL4`, `devAgentL4`, `qcAgentL4` | One agent: its `AGENTFLOW.md` (each declared command) and its skills |
| L4 | `taskLifecycle` | From `task_run` to the next turn |
| L4 | `documentLifecycle` | From a task's file to a Confluence page people edit, and back into the next task |
| L5 | `cases` | The eight cases of LD-6; open one to follow it |
| L5 | `fullFlow` | The whole ticket in one walkthrough: cases 1 to 5 in order, PRD → Done (case 8 inside Testing) |
| Setup | `setup` | The project: Jira, Confluence and Git connections, statuses, the agents and the workflow |
| Heart | `heart` | Why the Orchestrator Agent gets it right: the rules by section and each agent's `AGENTFLOW.md` (top) drive seven mechanisms (middle) that the platform guarantees (bottom) |
| Heart | `mechContext` … `mechDocuments` | One mechanism: the lines of the rules that drive it, quoted, what the platform guarantees, and the cases where it is seen |
| Heart | `turnAnatomy` | One turn step by step (turn B of case 6), linking down to the task and document lifecycles |

## The setup

**People** (the team): an admin who moves the ticket and answers questions, and a BA, a Dev
and a QC who review the documents and the pull requests and merge them.

**Agents** (each a team of Claude Code skills):

| Agent | Runs | Declares in `AGENTFLOW.md` |
|---|---|---|
| BA Agent | automatically, toolkit `leavedesk-knowledge` | `/ba-requirement` (produces the PRD, asks questions) · `/ba-archive` (needs the PRD, pushes) · `/leavedesk-research` (read) |
| Dev Agent | personal: on the developer's own machine and credentials | `/writing-plans` (needs the PRD, leaves the plan) · `/executing-plans` (needs the approved plan, pushes, opens its own PR) |
| QC Agent | automatically, toolkit `leavedesk-qa`, Playwright | `/qa-test` (needs the PRD, leaves the test plan) · `/qa-run` (needs the test plan, tests the Dev branch, leaves results and screenshots) · `/qa-review` (read) |

**The Orchestrator Agent** runs with no repository: it only has the
AgentFlow tools (`task_run`, `wait_for`, `reply`, `page_publish`, `page_get`,
`pull_request_open`, …). It reads two things every turn: the workflow's **rules** and the
**case** (what happened so far on the ticket).

**The workflow** "LeaveDesk · Questions" is orchestrated: it starts on a Jira status change or
a mention, and its rules are written in plain language. They describe the process and the
roles, never the commands (those come from `AGENTFLOW.md`). Each section drives one or more
of the mechanisms in the `heart` view:

| Section of the rules | Drives |
|---|---|
| Roles | Agent selection |
| The ticket | Context |
| Documents on Confluence | Documents |
| Flow (Jira status order) | Status logic · Never blocks · Resume the right work |
| Questions and answers (every status) | Conversations · Resume the right work · Agent selection · Context |
| Blocked tasks | Agent selection |
| Work belongs to its status | Status logic |
| Coming back to a status | Status logic · Resume the right work |
| Cancelling | Status logic · Never blocks |
| Language | Conversations |

The rules name roles only. Which agent has a role and what it can run comes from each agent's
`AGENTFLOW.md` (the table above): every turn's prompt lists each agent's role and its declared
commands with their description, needs and produces, so "BA writes the PRD" resolves to the
BA Agent's `/ba-requirement`. The `heart` view shows these declarations next to the rules,
and the "Why this step" note of every `task_run` step quotes the declaration it used.

What the rules cannot enforce, the platform does: the debounce and supersede, the guards
(declared commands, read/write mode, needs, cancel only on a ticket change, Confluence space
and edits), the waits the engine evaluates, `replyTo` and `resumeTaskId` / `fork` on the tools,
and the case (`CASE.md`) every turn reads.

<details>
<summary>The rules in full (about 7,700 characters; "runner" reads "agent")</summary>

```markdown
## Roles
- BA: writes the PRD of a ticket, archives the approved PRD in the knowledge base (a branch AgentFlow pushes) and answers questions about requirements.
- Dev: writes the implementation plan, implements it and opens its own pull request (never merges); answers questions about the plan and the code.
- QC: designs the test plan (test cases); separately, automates and runs the approved test plan and reports each test round with evidence screenshots (a branch AgentFlow pushes); answers questions about tests.
- People (BA, Dev, QC, admin) review the documents on Confluence and the pull requests, ask questions as Jira comments, merge the pull requests and move the ticket.
- The agents list says which agent does what; follow what each command declares (needs, produces, files).

## The ticket
- Agents do not see the Jira ticket: their files only hold the case. Before the first task of a ticket (and whenever the ticket's description changed), read the ticket with source_item_get and put it in the task prompt as people wrote it: key, title, description, acceptance criteria, and the names of its attachments. Later tasks of the same ticket get it again in their prompt.

## Documents on Confluence
- Every ticket has one page "<KEY> · <summary>" under the project's parent page (kind ticket): the ticket link, a one-line summary, and the links to its child pages. Create it the first time a document of the ticket is published, and update it when a child page is added.
- Child pages of the ticket page: "<KEY> · PRD" (kind prd), "<KEY> · Implementation plan" (kind plan), "<KEY> · Test plan" (kind test_plan). Each test round is a child page of the test plan: "<KEY> · Test run <N> · <YYYY-MM-DD>" (kind test_run; N counts the rounds in the case's Documents), with the results file as the body and the evidence screenshots as attachments.
- Publish with page_publish from the newest succeeded task that produced the file. Later versions update the SAME page: pass page (the page id from the case's Documents).
- Before a task works from a document, hand it the page's CURRENT content with task_run files [{page, name}] (people may have edited it on Confluence): PRD-<KEY>.md, PLAN-<KEY>.md, TESTCASES-<KEY>.md.
- If page_publish refuses because people edited the page: run the task again with that page in its files so their edits are kept, then publish. Use overwrite only when a person asked to replace the page.
- On Jira, write short comments with the page title, its link, its version and one or two lines on what changed. Do not attach files to Jira comments.
- To answer a question about a document, read the page first (page_get).

## Flow (Jira status order)
To Do → PRD → Planning → Implement → Testing → Review → Done
- To Do: nothing.
- PRD: BA writes the PRD from the ticket. Post its questions as one numbered comment. When the PRD is ready, publish the ticket page and the PRD page, comment the link and ask people to review the PRD on Confluence and to ask their questions here; they move the ticket to Planning when it is approved. When people ask for changes, resume the BA task with their feedback and the current PRD page in its files, publish the same page and comment what changed.
- Planning: at the same time BA archives the approved PRD, Dev writes the implementation plan and QC designs the test plan, all with the PRD page as PRD-<KEY>.md in their files. When the archive is done, open its pull request (pull_request_open with that task) and comment the link for Review. Post each one's questions in its own comment. When each is done, publish its page, update the ticket page and comment the links; ask people to review both. When people ask for changes, resume that task with the feedback and the current page in its files, publish the same page and comment what changed. People move the ticket to Implement when both are approved.
- Implement: Dev implements from the plan page (PLAN-<KEY>.md in its files) and opens its pull request itself. Post its questions. When done, comment the pull request link with its summary (from the pull request body file) and say the ticket can move to Testing. Nobody merges yet.
- Testing: QC automates and runs the approved tests from the test plan page (TESTCASES-<KEY>.md) with the PRD page (PRD-<KEY>.md) in its files and the prompt "Automate and run the approved test cases against the Dev branch <KEY> (its pull request is not merged yet); do not redesign them." When done, publish the test round as a child page of the test plan with the results file and the evidence screenshots as attachments, open the pull request of the QC test code (pull_request_open with that task), then comment: verdict, passed/failed counts, each failure with its reason, the test run page link and the pull request link. If tests failed, ask people what to do (back to Implement for a fix, then Testing again as a new test round, or accept).
- Review: start nothing new. People (Dev and QC) review the pull requests of the ticket (Dev code, QC tests, BA archive) and ask questions here: answer in the thread from the agent that knows (Dev: resume its implementation task with fork, or its read-only command; QC: its review command; BA: its research command). People merge the pull requests themselves and move the ticket to Done.
- Done: close the case.

## Questions and answers (every status)
- Answer each comment in its own thread (replyTo). A question about the PRD, the plan, the test plan or the results: read the page, ask the agent that wrote it when needed, answer in the thread with the page link.
- A reply that answers some questions and asks new ones: answer the new ones first, then resume the task only when every question has an answer; list the ones still open.
- A confirmed answer is a decision: pass it in the prompt of later tasks.
- A question never stops or restarts a running task.

## Blocked tasks
- A task answer that starts with "BLOCKED:" did nothing. Comment what is missing and who produces it (from that line). If the missing document exists on Confluence or from an earlier task, pass it in the task's files and run the task again (once); otherwise wait for it.

## Work belongs to its status
- Start a writing task only for the work of the ticket's CURRENT status (PRD: the PRD; Planning: archive, plan, test plan; Implement: code and fixes; Testing: test rounds). If someone asks in a comment for work of another status (e.g. "fix the code" while in Testing), do not start it: answer that the ticket must move to that status first, and do it when it is there. Reading tasks (questions, research, reviews) are allowed in every status.

## Coming back to a status
- When the ticket moves back to a status whose work was already done in this case (e.g. Testing → Implement after a failed test round, Planning → PRD), start NOTHING on your own. Comment what that status already produced (pages, pull request, last results) and ask what to change. Start the work only when a person says what to do in a comment (e.g. "fix D-1"), then resume the task that did that work with their instruction.
- The first time the ticket enters a status, follow the Flow as written.

## Cancelling
- Only a status change cancels tasks. Moving forward in the flow keeps running tasks (say they are still running).
- Moving backward or to a status outside the flow: cancel the tasks started for the statuses being left and say so on the ticket.
- Several changes in one turn: act on the final status only.

## Language
- Default language: Vietnamese. A comment written in another language is answered in that language. Page titles, file names, ticket keys and code stay as they are.
```

</details>

## What the ticket produced

| Where | What |
|---|---|
| Confluence | `LD-6 · Team calendar` (ticket page) with `LD-6 · PRD` (v1 → v4), `LD-6 · Implementation plan`, `LD-6 · Test plan` (v1 → v2), `LD-6 · Test run 1` (32/33) and `LD-6 · Test run 2` (33/33) |
| Git | `leavedesk-app` PR #6 (the feature, 512 tests), `leavedesk-qa` PR #10 (33 Playwright cases and results), `leavedesk-knowledge` PR #6 (the archived PRD and its decisions) |
| Jira | Short comments with links, each in the thread it answers; no files attached |

## The cases

### 1 · PRD: v1 → v4 on the same page (`case1Prd`)
The admin moves LD-6 to **PRD**. One turn reads the ticket (title, description, comments) and
starts the BA Agent with it. The BA Agent writes the PRD and asks 8 questions, each with the
assumption it uses meanwhile. The Orchestrator Agent publishes the ticket page and
`LD-6 · PRD` v1 and posts the questions as one numbered comment.
The admin answers 1–4 and asks about privacy in the same reply: the Orchestrator Agent answers
the new question first (a reading task, `/leavedesk-research`), notes that 5–8 are still open
and does not resume the BA Agent yet. When 5–8 are answered, it resumes the PRD task with all
eight answers and the current PRD page: **v2, same page**. Reading the ticket's description
against the answers, the BA Agent finds 4 new questions (pending leave, an HR filter,
employees, a month view) and the Orchestrator Agent posts them with the v2 link. The BA edits
the page on Confluence; the admin answers the new questions; the next revision starts from
the edited page: **v4 keeps the person's edit**.

### 2 · Planning: three agents in parallel (`case2Planning`)
The admin moves LD-6 to **Planning**. One turn starts three tasks at once, each with the PRD
page as it is on Confluence (`PRD-LD-6.md` v4): the BA Agent archives the PRD, the Dev Agent
writes the implementation plan (6 TDD tasks, 22 acceptance criteria mapped), the QC Agent
designs the test plan (33 cases). It waits for all three. Then it opens the archive pull
request, publishes `LD-6 · Implementation plan` and `LD-6 · Test plan`, and posts the QC
Agent's question. The answer goes back to the QC Agent: **Test plan v2**.

### 3 · Implement (`case3Implement`)
The admin moves LD-6 to **Implement**. The Dev Agent runs on the developer's own machine with
the plan page and the PRD page, implements with TDD on branch `LD-6` (512 tests pass) and
opens **PR #6** itself. Nobody merges yet: people merge in Review.

### 4 · Testing: round 1 fails, fix, round 2 passes (`case4Testing`)
The admin moves LD-6 to **Testing**. The QC Agent automates and runs the test plan against the
**unmerged Dev branch**. Round 1: **32/33**, defect D-1 (the period and the Previous/Next
buttons disappear after a failed first load). The Orchestrator Agent publishes
`LD-6 · Test run 1` under the Test plan with the 6 screenshots, opens the QC pull request
(#10) and asks: fix or accept?
The admin moves the ticket back to **Implement**: the Orchestrator Agent reports what exists
and starts nothing (case 8). The admin replies "fix D-1": the Dev Agent's implementation task
resumes with that instruction and pushes one more commit to PR #6. Back in **Testing**, the
admin asks for round 2: **33/33**, published as `LD-6 · Test run 2`; Test run 1 stays.

### 5 · Review → Done (`case5Review`)
The admin moves LD-6 to **Review**. The Orchestrator Agent lists the three pull requests. Dev,
QC and BA review them and ask questions in Jira; the answers come from reading tasks (allowed
in every status). People merge the three pull requests and move LD-6 to **Done**: the case
closes with a summary and the links.

### 6 · Several comments in one debounce window (`case6Comments`)
Two root questions ("Does the plan change the DB schema?", "Does the test plan cover an empty
calendar?") and two replies arrive within seconds. A turn that already started is superseded
when the fourth message arrives: its writes are refused. The next turn sees all four
messages, each with its comment reference, and **answers each one in its own thread**,
including the answer that waited for a QC task.

### 7 · Accidental status flip (`case7Flip`)
The admin moves LD-6 from Implement to Planning by mistake and to Testing ten seconds later.
The debounce merges both changes into **one turn**, which acts on the final status only: no
Planning task is started, nothing needs cancelling, the QC Agent starts testing.

### 8 · Coming back to a status (`case8Reentry`)
When the ticket comes back to a status whose work is done (Testing → Implement after a failed
round), the Orchestrator Agent comments what that status already produced (PR #6, Test run 1,
defect D-1), **starts nothing**, and waits for a person's instruction. Only "fix D-1" starts
the Dev Agent, on the task that did the work.

## What keeps it safe

| Guard | What it does |
|---|---|
| Declared commands | An agent only runs commands its `AGENTFLOW.md` declares; a read command never runs in write mode |
| Needs | A command whose input is missing is refused (or answers `BLOCKED: missing …`) instead of guessing |
| Cancel on a ticket change only | Only a status or label change may cancel tasks; a comment never does |
| One turn per conversation | A newer message supersedes a running turn; its writes are refused |
| Same-case files | Files and pages handed to a task come from this ticket only |
| Confluence | Writes stay in the project's space; publishing never drops a person's edit |
| The rules | Work belongs to its status; coming back to a status starts nothing |
| People decide | Agents ask, people answer; agents open pull requests, people merge |

## Presenting it

1. **Setup** (`setup`, 3 min): what the project holds: the Jira, Confluence and Git
   connections, the statuses, the BA, Dev and QC Agents plus the Orchestrator Agent, and the
   workflow with its rules. Click an agent to show its `AGENTFLOW.md` and skills (L4).
2. **Cases 1 → 7** (`cases`, 15 min): open each case and step through it. Cases 1–5 are the
   ticket's life; open the Confluence pages and the pull requests next to the steps. Cases 6
   and 7 are what people do: comment at once, click the wrong status.
3. **The heart** (`heart`, 7 min): why every case came out right. Top to bottom: the rules
   the admin wrote, the seven mechanisms they drive, what the platform guarantees whatever the
   model does. Click a mechanism (`mechSelection` for choosing the agent, `mechConversations`
   for many requests at once, `mechStatus` for the status flow, …) to show the exact lines of
   the rules and the cases where it is seen; a case opens from there.
4. **Anatomy of a turn** (`turnAnatomy`, 3 min): one turn of case 6 from the webhooks to the
   last reply, the mechanisms working together.
5. **For questions**: L3 (`orchestratorL3`, `apiL3`, `agentsL3`), the L4 lifecycles (a task, a
   document), case 8 (coming back to a status) and the guards table above.
