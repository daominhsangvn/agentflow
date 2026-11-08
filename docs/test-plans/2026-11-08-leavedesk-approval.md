# Test plan: approval before posting on LeaveDesk

Manual end-to-end test of the approval rule on the LeaveDesk orchestrated
workflow, on the local stack with a real Jira site. The rule says: nothing goes
on the Jira ticket (comments, edits, files, status changes) without an admin's
approval. The orchestrator asks with `request_decision` and `where:
case_page`, waits with `wait_human`, then posts exactly the approved text with
`reply` and `where: thread`. Not gated: Confluence pages, tasks, pull
requests, case-page replies and questions an Agent posted on the ticket
itself.

The approval is a rule, not a platform check: the platform keeps the request
off the ticket (`where: case_page`) and shows it under Decisions, but it does
not refuse an unapproved reply. A reply posted without approval is a fail of
the rules, not of the platform; record it as such.

Format as in [2026-11-07-real-test-agents.md](2026-11-07-real-test-agents.md):
each case has an id, steps, the expected result and what to keep as evidence.
Record results in the table at the end.

## 0. Environment

| # | Precondition | How to check |
|---|---|---|
| E1 | `request_decision where` shipped, the API runs with the 16000 limit (T023) and was restarted | `touch apps/api/server.ts` with the dev servers running; `curl -s localhost:3002/health` |
| E2 | The approval rule is in the LeaveDesk workflow `01a17639-6709-75fd-9974-5e6d92a88ad1` (Workflows -> YAML -> paste the repo YAML -> Save). Its content: a section "Approval before posting" that gates writes on the ticket behind a case-page decision, and lists what is not gated. The `source` grants include `transition`. | `select length(agent_config->>'instructions'), agent_config->'orchestrator'->'connections' from workflows where id='01a17639-6709-75fd-9974-5e6d92a88ad1'` shows about 8365 (16000 or fewer) and `transition` |
| E3 | Agents: `runner-orch` (orchestrator), `runner-1` (BA), `runner-qc` (QC), personal Dev `daomi-PRO-1` (Windows dev kit; asks on the ticket with `jira comment` and `commentId`) online | Agents tab of the workflow shows all four online |
| E4 | A new LD ticket, created for this test; an admin and a non-admin member of the org | the ticket exists; both accounts can open the case page |

## A. Approval before posting

| Id | Steps | Expected | Evidence |
|---|---|---|---|
| AP1 | Comment draft approved: move the ticket to PRD. When the BA task ends with questions, wait for the orchestrator. | A pending decision whose question is the numbered comment draft, posted on the case page only (the text ends "Approve or reject it under Decisions, or answer here."). Jira is unchanged. Admin **Approve**: the next turn posts exactly the draft on Jira (`reply where: thread`). | Jira comment history, decision row, turn tool calls |
| AP2 | Rejected with a comment ("shorter, Vietnamese") on the decision of AP1 (or a fresh one). | Decision rejected; a revised draft arrives in a NEW pending decision; still nothing on Jira. Approve it: the revised text is posted. | Jira comment history, both decision rows |
| AP3 | Status change needs approval: comment "@bot move the ticket to Planning". | A decision on the case page describes the move; no transition before approval. Approve: `source_item_transition` runs. The resulting status change does not cancel tasks. | Jira status history, turn tool calls, task list |
| AP4 | An Agent's own question needs no approval: in Planning the Dev task on the personal Agent comments its question itself (`commentId`). | `task_asked` on the case, no decision, no bot copy of the question. A reply on that comment resumes the task. | case messages, Jira comment, task state |
| AP5 | Agents tab shows the pending decision while one is open. | The orchestrator node's number counts the case; the case row has the warning dot and "Needs answer"; the Decisions card (Approve / Reject, admins only) is on top of the orchestrator node's case thread; Home lists "Pending decision"; a non-admin sees no buttons. | screenshots (admin and non-admin) |
| AP6 | Nothing on Jira before approval: across AP1-AP3, check the time between each request and its approval. | No bot comment, edit or transition between the request and the approval. Any unapproved thread reply is a fail of the rules, not of the platform. | the two SQL queries below |
| AP7 | Approval by a case-page message: with a decision pending, write "ok, post it" on the case page. | The orchestrator calls `record_decision` (via message) and the draft is posted. | decision row (`via` is message), Jira comment |
| AP8 | Not gated: let the flow publish the Confluence PRD page and start tasks. | The page is published and tasks start without a decision. | Confluence page, task list, no decision rows for them |
| AP9 | Size: paste the repo YAML in the YAML editor and Save. | The editor shows one warning on `instructions` (over 8000 characters) and the save succeeds; the E2 query shows about 8365. | screenshot of the warning, query output |

Evidence SQL (read-only, replace `<case>` with the case id):

```sql
select created_at, kind, payload->>'via', left(text,80)
from orchestrator_messages
where conversation_id in (select id from orchestrator_conversations where case_id='<case>')
order by created_at;

select status, via, decided_by, left(question,80)
from orchestrator_decisions where case_id='<case>';
```

## Results

| Id | Result (pass / fail / blocked) | Notes, evidence link |
|---|---|---|
| E1-E4 | | |
| AP1 | | |
| AP2 | | |
| AP3 | | |
| AP4 | | |
| AP5 | | |
| AP6 | | |
| AP7 | | |
| AP8 | | |
| AP9 | | |
