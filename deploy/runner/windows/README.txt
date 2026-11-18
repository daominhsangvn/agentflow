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

Check the machine (run it again after a change):

  doctor.bat                  before setting up the automatic Agent
  doctor.bat --name an-pro-1  before (or after) setting up a personal Agent
                              (or --project PRO-1)

It checks Node.js 22+, Git for Windows and its bash, that `claude` is the
native Claude Code (an npm install is a script wrapper that breaks the
loops' multi-line prompts), that Git Bash keeps a /command argument as typed,
jq, Python 3 with PyYAML, gh, the Claude login and, once runner.env exists,
the API URL (plain http needs AGENTFLOW_ALLOW_HTTP_HOSTS in runner.env) and
that the API answers. Fix every FAIL line before the setup.

Run a dedicated, non-administrator Windows account for the runner when you
can: the agents can do anything that account can.

Start:

  start-runner.cmd    The first start asks for the AgentFlow API URL, an API
                      key (Settings -> API Keys), the runner name (default:
                      your Windows user name) and the workspace (default:
                      %USERPROFILE%\.agentflow\_works), then connects.
                      When personal Agents are set up here and the
                      automatic one is not, it starts the personal Agent, or
                      lists those not running and asks which.
  setup-runner.cmd    Asks the questions again.

The answers are saved to %USERPROFILE%\.agentflow-runner\runner.env. Add more
variables there, one NAME=value per line, for the agents to use, e.g.

  CLAUDE_CODE_OAUTH_TOKEN=...            (from `claude setup-token`)
  ConnectionStrings__DefaultConnection=Server=localhost;Database=App_Agent;...

Runner telemetry is on by default (exports nothing when the API has no OTEL
endpoint). Add AGENTFLOW_RUNNER_TELEMETRY=false to runner.env to opt out.

Variables set in the environment win over the file. Stop the runner with
Ctrl+C.

Start with Windows: the last setup question offers to install the Agent as a
Windows service (WinSW, in the winsw folder) that starts before anyone signs
in. One service per Agent: agentflow-agent, or agentflow-agent-<agent name> for a
personal one (agentflow-agent-an-pro-1 for the Agent named an-pro-1). It runs under your Windows account: WinSW asks for that
account's password (not a Windows Hello PIN; Microsoft accounts use the online
password) and offers the "log on as a service" right; answer y. Mapped
network drives are not visible to services, use UNC paths. Logs:
%USERPROFILE%\.agentflow-runner\service\logs (personal:
...\personal\<agent name>\service\logs). Keep this folder in a permanent place, not
Downloads or temp: the service runs runner.mjs from here. Answering no to the
question removes an installed service.

Upgrade: unzip the new release, run setup-runner.cmd [--project KEY] [--name NAME] from it
and press Enter to every question. The service is re-pointed and restarted.

Uninstall: uninstall-runner.cmd [--project KEY] [--name NAME] removes the service and asks
whether to delete the Agent's local data (default no). The Agent stays in
AgentFlow as an offline computer. A service left behind by a deleted folder
is removed with: sc.exe delete agentflow-agent

Personal runner (one project, in your own project folder, with this
computer's git, gh and Claude Code setup):

  setup-runner.cmd    Answer "personal" to the first question, then give the
                      AgentFlow project key (e.g. PRO-1), the Agent's name
                      (default <user name>-<project key>), the project folder,
                      and whether your commands can run several tasks at once.
  start-runner.cmd --name an-pro-1
                      Starts the personal Agent named an-pro-1. --name alone is
                      enough. Agents run next to each other and next to the
                      auto runner. uninstall-runner.cmd --name an-pro-1 removes
                      it. Settings: %USERPROFILE%\.agentflow-runner\personal\an-pro-1\runner.env

Several Agents per project on one computer: each Agent has its own folder
personal\<agent name> (the name in lower case, accents dropped, other
characters turned into "-", at most 40 characters), and the project key is
stored in its runner.env. A name is unique on the computer, whatever the
project. Setup asks the name after the project key: an existing name of the
same project re-configures that Agent, a new name adds another one, and the
name of another project's Agent is refused. A new Agent's gateway port
defaults to "random".

--project PRO-1 alone: one Agent of the key is used. With several, start in a
terminal picks the one that is not running or asks which (a number); start
without a terminal (a service) fails and lists the --name choices; check and
uninstall fail and list them. With --project and --name together the Agent
must belong to that project. An Agent configured only through environment
variables has no runner.env: use --name for it.

See docs/runner.md, "Personal runner".
