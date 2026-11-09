# Architecture (LikeC4)

A [LikeC4](https://likec4.dev) model of AgentFlow's components around the
workflow orchestrator, and how a request moves between them. External systems
are roles (channel, document store, code host, LLM provider), not products:
any integration connection plays them.

| File | Holds |
|---|---|
| `specification.c4` | Element kinds, tags, deployment node kinds |
| `model.c4` | Components and their relationships |
| `deployment.c4` | Control plane server, orchestrator runner, worker runners |
| `views.c4` | Component view, deployment view, flows 1-3 |

| View | Shows |
|---|---|
| `index` | The components: Orchestrator Core (API, code) and Orchestrator Agent (LLM, own runner), Integration layer, MCP server, worker runners |
| `deployment` | Where each component runs |
| `turnLifecycle` | Flow 1: a message arrives, the agent decides, the Core acts |
| `taskAndWait` | Flow 2: a task on a worker runner, the wait, the next turn |
| `decision` | Flow 3: a decision given in AgentFlow or in the thread |

```bash
npx likec4 start docs/architecture                 # preview in the browser
npx likec4 validate docs/architecture              # check syntax and references
npx likec4 export png -o <dir> docs/architecture   # images of every view
```

Elements nested in `agentflow` are referenced by their full name
(`agentflow.orchestrator.core`) outside their block. The behaviour behind each
step is in [orchestrator.md](../orchestrator.md).
