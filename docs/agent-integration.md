# Integrating an existing agent with AgentFlow

For people who already run their own Claude Code agent (commands, skills,
plugins) on their own computer and want AgentFlow's orchestrator to drive it.
Once integrated, the agent **never asks the person at the terminal**: every
question, file and result goes through the orchestrator, which talks to people
on the ticket (Jira comment thread, Teams thread) or on the case page.

Related: the orchestrator reference [orchestrator.md](orchestrator.md), its
rules [orchestrator-guide.md](orchestrator-guide.md), installing a personal
agent [runner.md](runner.md) "Personal runner".

## 1. The picture

```
 people (Jira / Teams / case page)
        │  comments, status moves, answers, approvals
        ▼
 Orchestrator (AgentFlow)  ── task_run ──►  your agent (personal agent, your project folder)
        ▲                                     │ runs your command: /plan-ticket LD-6 ...
        │                                     │ writes files into $AGENTFLOW_WORKDIR
        └──── result: reply, questions, files ┘ and stops
```

A task is **one run of one command** of your agent. The agent cannot talk to
the orchestrator while it runs and cannot wait for an answer: it writes files
and stops. The orchestrator reads them, talks to people, and starts the next
task (or resumes this one with the answers).

## 2. What travels between the agent and the orchestrator

### The agent receives

| What | Where / how | Notes |
|---|---|---|
| The command and its args | First line of the prompt: `/plan-ticket LD-6` | Only commands declared in `AGENTFLOW.md` are ever started |
| The request | The rest of the prompt, written by the orchestrator: what is asked, context, decisions people made | Treat it as the spec of this task |
| A footer from AgentFlow | End of the prompt: where to write the reply, which files to leave, which inputs exist, read-only notice | Generated; do not rely on its exact wording |
| The ticket / case | `$AGENTFLOW_WORKDIR/issue.md` | The case as it stands (notes, tasks, decisions) |
| Input files | `$AGENTFLOW_WORKDIR/inputs/<name>` | Files of earlier tasks (PRD, plan, test cases) or a Confluence page as Markdown. Max 5 files, 400 KB together |
| Answers to its questions | A **new prompt in the same session** (task resumed, `resumeTaskId`) | The session still has everything the agent did and asked |
| A follow-up question about its earlier work | A **forked** session (`resumeTaskId` + `fork: true`) | Answer from what the session knows; the original session stays unchanged |
| Read-only mode | `mode: read` task: Edit/Write tools, `git commit`, `git push` denied | The reply file can still be written |
| System instructions | `--append-system-prompt` (personal agent): unattended, work dir, how to ask | Nothing is written into your `CLAUDE.md` or `.claude/` |

`$AGENTFLOW_WORKDIR` is set on every AgentFlow run (personal agent:
`<project>/.agentflow-ai/runs/<case id>`, one per case and kept across the
case's tasks; automatic agent: `<worktree>/.agentflow-ai/work`). When it is
not set, the command was typed by hand.

### The agent sends back

| What | File | Read by AgentFlow |
|---|---|---|
| **The answer** | `$AGENTFLOW_WORKDIR/orchestrator-reply.md` | When the run ends; the orchestrator sees it in the task result |
| **Questions for people** | `$AGENTFLOW_WORKDIR/questions.json` | Only when the command declares `asks: true`. Max 30 questions, 2,000 chars each, 10 options of 500 chars |
| **Files for the ticket** | Files in `$AGENTFLOW_WORKDIR` matching the command's `attach` globs, or files of a folder named in `attachRoots` (`features:**/*.md`; `attachChanged: true` keeps only what the run changed) | Collected at the end (20 files, 4 MB each, 5 MB total); the orchestrator attaches them to Jira, publishes them to Confluence, or hands them to later tasks; people view and download them on the case page |
| **"Cannot start"** | First line of the reply: `BLOCKED: <what is missing>` | The orchestrator tells people what is missing and who produces it |
| **Code** | Your own branch, push and pull request (personal agent, your credentials) | AgentFlow never merges; neither does the agent |
| **Capabilities** | `AGENTFLOW.md` in the project folder | Uploaded when the agent starts and whenever the file changes |
| Session, time, tokens | Synced automatically | Shown on the case |

### What the agent cannot do

- Talk to people directly: no `AskUserQuestion`, no "Proceed? (y/n)", no
  terminal prompt, no Slack/Jira comment asking a question. Nobody is there,
  and the orchestrator would not know about the question.
- Use AgentFlow's integration tools (a personal agent has none). Your own MCP
  servers still work, but **questions and results must still go through the
  files above**, so the orchestrator can track them.
- Wait inside a run, poll, or "come back later". Write the questions and stop.
- Cancel itself or start other agents' work. Ask for it in the reply.

## 3. Writing the prompts, case by case

Every rule below fits into your command (`.claude/commands/*.md`) or skill as
a short "AgentFlow mode" section. Keep the hand-typed behaviour for when
`$AGENTFLOW_WORKDIR` is not set, so the same command works both ways.

### 3.1 The agent needs a decision (questions)

```markdown
## Questions
When you need a decision you cannot make from the request, the inputs, the
ticket or the code:
- If `$AGENTFLOW_WORKDIR` is set: do the work that does not depend on the
  answer first, then write ALL open questions at once to
  `$AGENTFLOW_WORKDIR/questions.json` and stop. Do not ask in the terminal,
  do not call AskUserQuestion, do not guess.
  Format: `[{"id": "q1", "question": "...", "options": ["A", "B"]}]`
  (options optional). Also write `orchestrator-reply.md`: what you did so far
  and that you wait for answers to q1..qN.
- Otherwise ask the user as usual.
```

Good questions (people read them in a Jira comment, out of context):

- One decision per question, self-contained: name the ticket, file and
  section. *"LD-6 PRD §3.2: should a half-day leave count as 0.5 day in the
  team calendar total?"*, not *"How should we count this?"*
- Give options when the choice is closed, and say which one you would pick
  and why: *"Options: 0.5 (recommended: matches payroll), 1"*.
- Stable ids (`q1`, `q2`, …) and the same id for the same question if asked
  again.
- Batch them: one task stop costs a round trip with people.

Where the questions go is up to the orchestrator's rules: on the ticket, on the
case page, or, when the workflow grants `teams: [ask]`, in a Teams channel
that @mentions the people who should answer (`teams_ask`). The agent does
not choose: it writes the same `questions.json`. Only a reply that mentions the
bot and comes from a mentioned person is taken as the answer.

### 3.2 The answers come back (resume)

Answers from Teams arrive the same way as answers on the ticket (with the
question ids); one reply to a multi-question ask answers all of its questions.

```markdown
## Resuming with answers
If this session already asked questions and the new prompt carries answers:
record them where this command keeps decisions (e.g. a "Decisions" section of
`PLAN-<KEY>.md`), then continue from where you stopped. Do not start over and
do not ask again what is answered. If some answers are missing or raise new
questions, ask only those (3.1).
```

The resumed prompt may start with the command again (`/plan-ticket LD-6`)
followed by the answers: the command must detect it is a continuation (the
session history, or its own files already in the work directory) instead of
redoing step 1.

### 3.3 Confirmations ("Proceed?", "Overwrite?")

```markdown
## No confirmations
In an AgentFlow run never wait for a yes/no. Use the default stated here
(overwrite the previous draft; skip optional steps) and say what you chose in
the reply. If the choice is risky and has no safe default, make it a question
(3.1).
```

If the command already has an `--auto` flag, declare it in `AGENTFLOW.md`
`args` so the orchestrator passes it.

### 3.4 Input files

```markdown
## Inputs
Before anything else (no branch, no clone, no skill), check the inputs:
`$AGENTFLOW_WORKDIR/inputs/PRD-<KEY>.md` (in an AgentFlow run) or
`./PRD-<KEY>.md` (by hand). If it is missing, write exactly one line as the
first line of `$AGENTFLOW_WORKDIR/orchestrator-reply.md` and stop:
BLOCKED: missing PRD-<KEY>.md (needs prd: produced by /ba-requirement analyze <KEY> on BA)
```

Read inputs as the version people approved: do not "fix" them silently;
report doubts in the reply or as questions.

### 3.5 Output files for the ticket

```markdown
## Output
Write the result to `$AGENTFLOW_WORKDIR/PLAN-<KEY>.md` (fixed name). Do not
attach it to Jira, comment it, or paste it anywhere: AgentFlow collects it and
the orchestrator decides where it goes.
```

- Fixed names `<KIND>-<KEY>.md` that match the `attach` globs in
  `AGENTFLOW.md` (`PLAN-*.md`). The orchestrator uses them to hand files to
  later tasks and to check `needs`.
- Screenshots and evidence also go under `$AGENTFLOW_WORKDIR`
  (`evidence-<KEY>/*.png`) and are declared in `attach`.
- Keep text files under 200 KB if a later task needs them as input.
- A toolkit that already writes its files elsewhere (another folder of the
  computer, many runs side by side) does not have to move them: name the
  folder in `attachRoots`, glob it as `<name>:**/*.md` and set
  `attachChanged: true` (docs/runner.md, "Capabilities").

### 3.6 The reply

```markdown
## Reply
Last step, always (even when you failed or stopped with questions):
overwrite `$AGENTFLOW_WORKDIR/orchestrator-reply.md` with, in at most ~15 lines:
- Status: done | waiting for answers | BLOCKED | failed: <why>
- What you did, with file names and links (branch, PR URL)
- Decisions you made on your own (defaults chosen)
- What should happen next (who reviews, which command runs next)
```

Always overwrite it: a personal agent keeps one work directory per case, so an
old reply from an earlier task of the case would otherwise be read again.

### 3.7 Code changes

```markdown
## Git
Work on branch `feature/<KEY>-<slug>`. Commit, push and open the pull request
with this machine's credentials (gh / tea / glab). Never merge. Put the PR URL
in the reply. In a read-only task change nothing and commit nothing.
```

If several tasks may run at once on your agent (`AGENTFLOW_RUNNER_PARALLEL=true`),
use a git worktree per ticket: never two tickets in one checkout.

### 3.8 Questions about earlier work

The orchestrator answers "why did the plan choose X?" by forking the session
that wrote the plan. Nothing to write for it, but keep reasoning in the files
(a "Decisions" section) so a fresh session can answer too when the old one is
gone.

### 3.9 Ready-to-paste block

Put this once in the project's `CLAUDE.md` (or in each command) and keep the
command-specific parts (inputs, output names) in the commands:

```markdown
## When run by AgentFlow ($AGENTFLOW_WORKDIR is set)
You run unattended; nobody reads this terminal.
- Never ask in the terminal, never call AskUserQuestion, never wait for a
  confirmation. Decide with the command's defaults, or write the open
  questions to $AGENTFLOW_WORKDIR/questions.json
  ([{"id":"q1","question":"...","options":["..."]}]) and stop.
- Never contact people yourself (no Jira/Slack/Teams comments to ask or to
  report). AgentFlow's orchestrator does that.
- Inputs are in $AGENTFLOW_WORKDIR/inputs/. Missing input: first line of the
  reply is "BLOCKED: missing <file> (<who produces it>)", then stop.
- Leave output files in $AGENTFLOW_WORKDIR with their fixed names; do not
  attach or post them.
- Always finish by overwriting $AGENTFLOW_WORKDIR/orchestrator-reply.md:
  status, what you did, defaults you chose, what comes next.
- When resumed with answers, record them and continue; do not start over.
- Never merge a pull request.
```

## 4. Declaring the agent (AGENTFLOW.md)

In the project folder of the personal agent. The orchestrator only sees what
is declared here, and refuses commands that are not.

```markdown
---
runner: Dev (LeaveDesk)
commands:
  - name: /plan-ticket
    args: <KEY> [--auto]
    description: Plan a ticket from its approved PRD
    mode: write
    produces: plan
    needs: [prd]
    asks: true                 # without it, questions.json is ignored
    attach: ["PLAN-*.md"]
  - name: /explain-code
    args: <question>
    description: Answer a question about the code, changes nothing
    mode: read
    produces: answer
skills: [tdd]
---

# Dev (LeaveDesk)

## /plan-ticket
Reads inputs/PRD-<KEY>.md, writes PLAN-<KEY>.md. Asks when the PRD leaves a
behaviour open. Resume it with the answers; fork it to ask about the plan.
```

- `asks: true` on every command that may write `questions.json`; a command
  without it is told not to ask and to choose a default.
- `mode: read` for commands that only answer; the orchestrator then uses them
  freely for questions.
- Split a command whose modes differ (design vs run) so each declares its own
  `mode`, `needs` and `attach`.
- No secrets: the file is shown to admins and to the orchestrator.

## 5. Checklist

- [ ] Personal agent installed for the project (`node runner.mjs setup`,
  mode personal) and online in AgentFlow → Agents.
- [ ] `claude --version` matches the version AgentFlow pins.
- [ ] `AGENTFLOW.md` in the project folder; Project → Agents → Commands shows
  the commands with no warnings.
- [ ] Every declared command: input check with `BLOCKED`, fixed output names,
  questions through `questions.json`, no confirmations, reply file overwritten.
- [ ] `allowed-tools` in each command's front matter (or
  `AGENTFLOW_RUNNER_SKIP_PERMISSIONS=true`): a permission prompt also hangs a
  run.
- [ ] Try each command by hand with `AGENTFLOW_WORKDIR=/tmp/af-test` set: it
  must finish without any prompt and leave the reply (and questions) there.
- [ ] One ticket end to end with the orchestrator, including one question
  answered in the Jira thread.
