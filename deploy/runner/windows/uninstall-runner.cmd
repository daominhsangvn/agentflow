@echo off
rem Removes the AgentFlow Agent's Windows service and asks whether to delete
rem its local data. uninstall-runner.cmd --project PRO-1 for a personal Agent.
rem The Agent stays in AgentFlow; remove it there if not needed.
setlocal
where node >nul 2>nul || (
  echo Node.js 22 or later is required: https://nodejs.org
  exit /b 1
)
node "%~dp0runner.mjs" uninstall %*
exit /b %ERRORLEVEL%
