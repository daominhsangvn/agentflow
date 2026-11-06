AgentFlow runner for Windows
============================

Runs AgentFlow agent loops on this computer, with the tools, databases and
network (VPN) it already has. Full guide: docs/runner.md, "Option D: Windows".

Install once (PowerShell):

  winget install OpenJS.NodeJS.LTS
  winget install Git.Git
  winget install jqlang.jq
  winget install Python.Python.3.12
  winget install GitHub.cli
  python -m pip install --user pyyaml
  irm https://claude.ai/install.ps1 | iex      (Claude Code, native installer)

Open a new terminal afterwards so PATH includes the new tools.

Run a dedicated, non-administrator Windows account for the runner when you
can: the agents can do anything that account can.

Start:

  start-runner.cmd    The first start asks for the AgentFlow API URL, an API
                      key (Settings -> API Keys), the runner name (default:
                      your Windows user name) and the workspace (default:
                      %USERPROFILE%\.agentflow\_works), then connects.
  setup-runner.cmd    Asks the questions again.

The answers are saved to %USERPROFILE%\.agentflow-runner\runner.env. Add more
variables there, one NAME=value per line, for the agents to use, e.g.

  CLAUDE_CODE_OAUTH_TOKEN=...            (from `claude setup-token`)
  ConnectionStrings__DefaultConnection=Server=localhost;Database=App_Agent;...

Variables set in the environment win over the file. Stop the runner with
Ctrl+C.

Start with Windows: the last setup question offers to install the Agent as a
Windows service (WinSW, in the winsw folder) that starts before anyone signs
in. One service per Agent: agentflow-agent, or agentflow-agent-pro-1 for a
personal one. It runs under your Windows account: WinSW asks for that
account's password (not a Windows Hello PIN; Microsoft accounts use the online
password) and offers the "log on as a service" right; answer y. Mapped
network drives are not visible to services, use UNC paths. Logs:
%USERPROFILE%\.agentflow-runner\service\logs (personal:
...\personal\PRO-1\service\logs). Keep this folder in a permanent place, not
Downloads or temp: the service runs runner.mjs from here. Answering no to the
question removes an installed service.

Upgrade: unzip the new release, run setup-runner.cmd [--project KEY] from it
and press Enter to every question. The service is re-pointed and restarted.

Uninstall: uninstall-runner.cmd [--project KEY] removes the service and asks
whether to delete the Agent's local data (default no). The Agent stays in
AgentFlow as an offline computer. A service left behind by a deleted folder
is removed with: sc.exe delete agentflow-agent

Personal runner (one project, in your own project folder, with this
computer's git, gh and Claude Code setup):

  setup-runner.cmd    Answer "personal" to the first question, then give the
                      AgentFlow project key (e.g. PRO-1), the project folder,
                      and whether your commands can run several tasks at once.
  start-runner.cmd --project PRO-1
                      Starts the personal runner of PRO-1. Run one per project;
                      they can run next to each other and next to the auto
                      runner. uninstall-runner.cmd --project PRO-1 removes it. Settings: %USERPROFILE%\.agentflow-runner\personal\PRO-1\runner.env

See docs/runner.md, "Personal runner".
