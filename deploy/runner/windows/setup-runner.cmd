@echo off
rem Asks the AgentFlow runner setup questions again (mode, API URL, API key,
rem runner name, workspace or project) and saves the answers; start-runner.cmd
rem then uses them. setup-runner.cmd --project PRO-1 re-asks a personal runner.
rem The last question offers to install or update the Agent as a Windows service.
setlocal
where node >nul 2>nul || (
  echo Node.js 22 or later is required: https://nodejs.org
  exit /b 1
)
node "%~dp0runner.mjs" setup %*
exit /b %ERRORLEVEL%
