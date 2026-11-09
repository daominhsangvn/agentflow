@echo off
rem Checks this Windows machine before setting up an AgentFlow Agent
rem (docs/runner.md "Option D: Windows"): Node.js, Git for Windows, the native
rem Claude Code (not the npm one), Git Bash argument handling, jq, Python,
rem credentials and, when the Agent is already set up, its runner.env and API.
rem
rem   doctor.bat                    the automatic Agent
rem   doctor.bat --project PRO-1    the personal Agent of a project
rem
rem Exit code 1 when a required check fails.
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0doctor.ps1" -RunnerDir "%~dp0." %*
exit /b %ERRORLEVEL%
