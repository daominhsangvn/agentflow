# Checks run by doctor.bat (docs/runner.md "Option D: Windows"). Windows
# PowerShell 5.1 compatible. Prints one line per check and exits 1 when a
# required one fails. Native commands run with "Continue": PowerShell 5.1 turns
# their stderr into errors under "Stop".
param([string]$RunnerDir = $PSScriptRoot)

$ErrorActionPreference = "Continue"
$script:failed = 0
$script:warned = 0

function Pass($name, $detail) { Write-Host ("  PASS  {0,-22} {1}" -f $name, $detail) -ForegroundColor Green }
function Warn($name, $detail) { $script:warned++; Write-Host ("  WARN  {0,-22} {1}" -f $name, $detail) -ForegroundColor Yellow }
function Fail($name, $detail) { $script:failed++; Write-Host ("  FAIL  {0,-22} {1}" -f $name, $detail) -ForegroundColor Red }
function Info($name, $detail) { Write-Host ("  INFO  {0,-22} {1}" -f $name, $detail) }

# Every match of a command on PATH, in the order Windows resolves it.
function Find-OnPath($name) {
  $out = & where.exe $name 2>$null
  if ($LASTEXITCODE -ne 0) { return @() }
  return @($out | Where-Object { $_ })
}

function Read-EnvFile($file) {
  $values = @{}
  if (Test-Path $file) {
    foreach ($line in Get-Content $file) {
      if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') { $values[$matches[1]] = $matches[2].Trim() }
    }
  }
  return $values
}

# The short, file-name safe name of an AgentFlow server (host, lower case,
# -port when explicit, no ":"). Same rule as serverSlug in headless-instance-dir.ts.
function Get-ServerSlug($value) {
  if (-not $value) { return $null }
  $text = $value.Trim()
  if ($text -notmatch '://') { $text = "http://$text" }
  try { $uri = [Uri]$text } catch { return $null }
  if (-not $uri.Host) { return $null }
  $hostName = $uri.Host.ToLower().Replace("[", "").Replace("]", "").Replace(":", "-")
  $slug = $hostName
  if (-not $uri.IsDefaultPort) { $slug = "$hostName-$($uri.Port)" }
  if ($slug -notmatch '^[a-z0-9][a-z0-9.-]*$') { return $null }
  return $slug
}

$project = $null
$serverArg = $null
for ($i = 0; $i -lt $args.Count; $i++) {
  if ($args[$i] -eq "--project" -and $i + 1 -lt $args.Count) { $project = $args[$i + 1].ToUpper() }
  if ($args[$i] -eq "--server" -and $i + 1 -lt $args.Count) { $serverArg = $args[$i + 1] }
}
$server = Get-ServerSlug $serverArg

$title = "AgentFlow Agent doctor"
if ($project) { $title = "$title (personal Agent of $project" + $(if ($server) { " on $server" } else { "" }) + ")" }
Write-Host $title
Write-Host ""

# --- Windows and the account ---------------------------------------------------
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($admin) { Warn "account" "running as administrator: agents can do anything this account can; prefer a dedicated non-administrator account" }
else { Pass "account" "$env:USERDOMAIN\$env:USERNAME (not an administrator)" }

$longPaths = (Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name LongPathsEnabled -ErrorAction SilentlyContinue).LongPathsEnabled
if ($longPaths -eq 1) { Pass "long paths" "enabled" }
else { Warn "long paths" "disabled: deep node_modules paths can fail (admin: Set-ItemProperty HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem LongPathsEnabled 1)" }

$folder = (Resolve-Path $RunnerDir).Path
if ($folder -match '\\Downloads\\|\\Temp\\|\\AppData\\Local\\Temp') {
  Warn "runner folder" "$folder is a download or temp folder: the Windows service runs runner.mjs from here, keep it in a permanent place"
} else { Pass "runner folder" $folder }

# --- Node.js -------------------------------------------------------------------
$node = Find-OnPath "node.exe" | Select-Object -First 1
if (-not $node) { Fail "node" "not found: winget install OpenJS.NodeJS.LTS (22 or later)" }
else {
  $nodeVersion = (& $node --version 2>$null)
  $major = [int](($nodeVersion -replace '^v', '').Split('.')[0])
  if ($major -ge 22) { Pass "node" "$nodeVersion ($node)" } else { Fail "node" "$nodeVersion is too old: 22 or later ($node)" }
}

# --- Git for Windows and its bash ----------------------------------------------
$git = Find-OnPath "git.exe" | Select-Object -First 1
$bash = $null
if ($env:AGENTFLOW_GIT_BASH_PATH -and (Test-Path $env:AGENTFLOW_GIT_BASH_PATH)) { $bash = $env:AGENTFLOW_GIT_BASH_PATH }
if (-not $git) { Fail "git" "not found: winget install Git.Git" }
else {
  Pass "git" "$((& $git --version 2>$null)) ($git)"
  if (-not $bash) {
    $dir = Split-Path $git
    for ($depth = 0; $depth -lt 3 -and -not $bash; $depth++) {
      $dir = Split-Path $dir
      $candidate = Join-Path $dir "bin\bash.exe"
      if (Test-Path $candidate) { $bash = $candidate }
    }
  }
}
if (-not $bash) {
  foreach ($root in @($env:ProgramW6432, $env:ProgramFiles, (Join-Path $env:LOCALAPPDATA "Programs"))) {
    if ($root -and -not $bash -and (Test-Path (Join-Path $root "Git\bin\bash.exe"))) { $bash = Join-Path $root "Git\bin\bash.exe" }
  }
}
if ($bash) { Pass "git bash" "$bash (loop scripts run here; WSL's bash is never used)" }
else { Fail "git bash" "Git for Windows bin\bash.exe not found (set AGENTFLOW_GIT_BASH_PATH)" }

# --- Claude Code: the native build first on PATH --------------------------------
$claudes = @(Find-OnPath "claude")
$claudeExe = $null
if ($claudes.Count -eq 0) { Fail "claude" "not found: irm https://claude.ai/install.ps1 | iex" }
else {
  $first = $claudes[0]
  $npmLike = { param($p) $p -match '\.(cmd|ps1|bat)$' -or $p -notmatch '\.exe$' -or $p -match '\\npm\\|\\nodejs\\|\\nvm|\\node_modules\\' }
  if (& $npmLike $first) {
    Fail "claude" "$first is the npm install (a script wrapper): it breaks multi-line prompts. Install the native build: irm https://claude.ai/install.ps1 | iex, then npm uninstall -g @anthropic-ai/claude-code"
  } else {
    $claudeExe = $first
    Pass "claude" "$((& $first --version 2>$null)) ($first)"
    if ($first -notmatch '\\\.local\\bin\\claude\.exe$') { Warn "claude location" "not the native installer's %USERPROFILE%\.local\bin\claude.exe" }
  }
  $others = @($claudes | Select-Object -Skip 1 | Where-Object { & $npmLike $_ })
  if ($others.Count -gt 0) { Warn "claude (other copies)" "also on PATH: $($others -join ', ') (npm uninstall -g @anthropic-ai/claude-code)" }
}
$credentials = Join-Path $env:USERPROFILE ".claude\.credentials.json"
if (Test-Path $credentials) { Pass "claude login" "credentials file ($credentials)" }
elseif ($env:ANTHROPIC_API_KEY -or $env:CLAUDE_CODE_OAUTH_TOKEN -or $env:ANTHROPIC_AUTH_TOKEN) { Pass "claude login" "environment credential" }
else { Warn "claude login" "none on this machine: run claude and /login, or set the Agent's model provider in AgentFlow" }

# --- Git Bash argument handling -------------------------------------------------
# Git Bash rewrites arguments that look like POSIX paths for native programs
# (/writing-plans -> C:/Program Files/Git/writing-plans). The runner excludes a
# prompt's slash command with MSYS2_ARG_CONV_EXCL; check that this works here and
# that a multi-line argument reaches a native program intact.
if ($bash -and $node) {
  $nodeShell = $node -replace '\\', '/'
  $tmp = Join-Path $env:TEMP "agentflow-doctor.sh"
  $script = @"
argv() { '$nodeShell' -e 'process.stdout.write(JSON.stringify(process.argv.slice(1)))' -- "`$@"; }
echo "converted=`$(argv '/doctor-check x')"
echo "excluded=`$(MSYS2_ARG_CONV_EXCL=/doctor-check argv '/doctor-check x')"
echo "multiline=`$(MSYS2_ARG_CONV_EXCL=/doctor-check argv '/doctor-check line one
line two')"
"@
  [IO.File]::WriteAllText($tmp, $script.Replace("`r`n", "`n"))
  $lines = & $bash $tmp 2>&1 | ForEach-Object { "$_" }
  Remove-Item $tmp -ErrorAction SilentlyContinue
  $result = @{}
  foreach ($line in $lines) { if ($line -match '^(\w+)=(.*)$') { $result[$matches[1]] = $matches[2] } }
  if ($result.excluded -eq '["/doctor-check x"]') { Pass "slash commands" "kept as typed (MSYS2_ARG_CONV_EXCL works)" }
  else { Fail "slash commands" "Git Bash still rewrites /commands: $($result.excluded) (update Git for Windows)" }
  if ($result.multiline -eq '["/doctor-check line one\nline two"]') { Pass "multi-line prompts" "reach native programs intact" }
  else { Fail "multi-line prompts" "arrive as $($result.multiline)" }
  if ($result.converted -ne '["/doctor-check x"]') { Info "path conversion" "active for other arguments ($($result.converted)), as loop scripts expect" }
}

# --- jq, Python, gh --------------------------------------------------------------
$jq = Find-OnPath "jq" | Select-Object -First 1
if ($jq) { Pass "jq" "$((& $jq --version 2>$null)) ($jq)" } else { Fail "jq" "not found: winget install jqlang.jq" }

$python = $null
foreach ($candidate in @(@("python3"), @("python"), @("py", "-3"))) {
  $exe = Find-OnPath $candidate[0] | Where-Object { $_ -notmatch '\\WindowsApps\\' } | Select-Object -First 1
  if (-not $exe) { continue }
  $extra = @($candidate | Select-Object -Skip 1)
  $version = (& $exe @extra --version 2>&1 | Out-String).Trim()
  if ($version -match 'Python 3') { $python = @{ exe = $exe; extra = $extra; version = $version }; break }
}
if (-not $python) { Fail "python 3" "not found (the Microsoft Store alias does not count): winget install Python.Python.3.12" }
else {
  Pass "python 3" "$($python.version) ($($python.exe))"
  $null = & $python.exe @($python.extra) -c "import yaml" 2>&1
  if ($LASTEXITCODE -eq 0) { Pass "pyyaml" "installed" } else { Fail "pyyaml" "missing: python -m pip install --user pyyaml" }
}

$gh = Find-OnPath "gh" | Select-Object -First 1
if ($gh) { Pass "gh" "$((& $gh --version 2>$null | Select-Object -First 1)) ($gh)" }
else { Warn "gh" "not found: loops cannot open GitHub pull requests (winget install GitHub.cli)" }

# --- The Agent's configuration, once set up -------------------------------------
$dataDir = if ($env:AGENTFLOW_RUNNER_DATA_DIR) { $env:AGENTFLOW_RUNNER_DATA_DIR } else { Join-Path $env:USERPROFILE ".agentflow-runner" }
$envFile = Join-Path $dataDir "runner.env"
$instanceDir = $dataDir
$instanceServer = $null
if ($project) {
  $personal = Join-Path $dataDir "personal"
  $legacyDir = Join-Path $personal $project
  $instanceDir = $legacyDir
  $envFile = Join-Path $legacyDir "runner.env"
  if ($serverArg -and -not $server) {
    Fail "instance" "cannot read '$serverArg' as a server (use a host, host:port or the API URL)"
  } elseif ($server) {
    $keyedDir = Join-Path $personal "$project@$server"
    if (Test-Path $keyedDir) {
      $instanceDir = $keyedDir
      $instanceServer = $server
      $envFile = Join-Path $keyedDir "runner.env"
    } else {
      $legacyConfig = Read-EnvFile (Join-Path $legacyDir "runner.env")
      $legacySlug = Get-ServerSlug $legacyConfig["AGENTFLOW_API_URL"]
      if (-not (Test-Path $legacyDir) -or $legacySlug -ne $server) {
        $instanceDir = $keyedDir
        $envFile = Join-Path $keyedDir "runner.env"
        $instanceServer = $server
        Info "runner.env" "no personal Agent of $project for $server set up yet (setup-runner.cmd --project $project --server $server)"
      }
    }
  } elseif (-not (Test-Path $legacyDir)) {
    $keyedDirs = @()
    if (Test-Path $personal) { $keyedDirs = @(Get-ChildItem -Path $personal -Directory -Filter "$project@*") }
    if ($keyedDirs.Count -eq 1) {
      $instanceDir = $keyedDirs[0].FullName
      $instanceServer = $keyedDirs[0].Name.Substring($project.Length + 1)
      $envFile = Join-Path $instanceDir "runner.env"
    } elseif ($keyedDirs.Count -gt 1) {
      $choices = (@($keyedDirs | ForEach-Object { "--server " + $_.Name.Substring($project.Length + 1) })) -join " or "
      Fail "instance" "several personal Agents of $project are set up here, one per AgentFlow server: add $choices"
    }
  }
}
if (-not (Test-Path $envFile)) { Info "runner.env" "$envFile not created yet (setup-runner.cmd writes it)" }
else {
  $config = Read-EnvFile $envFile
  Pass "runner.env" $envFile
  # A line appended to a file without a final newline joins the previous one
  # (NO_PROXY=...127.0.0.1AGENTFLOW_ALLOW_HTTP_HOSTS=...).
  $joined = @(Get-Content $envFile | Where-Object { $_ -notmatch '^\s*#' -and $_ -cmatch '^\s*[A-Za-z_][A-Za-z0-9_]*=[^=]*?[a-z0-9.:/\-]([A-Z][A-Z0-9]*_[A-Z0-9_]+)=' })
  foreach ($line in $joined) { Fail "runner.env line" "two settings on one line: '$(($line -split '=')[0])=...' (put each NAME=value on its own line)" }
  $raw = [IO.File]::ReadAllText($envFile)
  if ($raw.Length -gt 0 -and -not $raw.EndsWith("`n")) { Warn "runner.env end" "no final newline: a line added with Add-Content or echo >> joins the last one" }
  $apiUrl = $config["AGENTFLOW_API_URL"]
  if (-not $apiUrl) { Fail "API URL" "AGENTFLOW_API_URL missing in runner.env (run setup-runner.cmd)" }
  else {
    $uri = [Uri]$apiUrl
    $local = @("localhost", "127.0.0.1", "::1") -contains $uri.Host
    $allowed = @(($config["AGENTFLOW_ALLOW_HTTP_HOSTS"] -split ',') | ForEach-Object { $_.Trim() }) -contains $uri.Host
    if ($uri.Scheme -eq "http" -and -not $local -and -not $allowed) {
      Fail "API URL" "$apiUrl is plain http: add AGENTFLOW_ALLOW_HTTP_HOSTS=$($uri.Host) to runner.env (the Windows service reads only that file)"
    }
    $health = (& curl.exe -s -m 10 -o NUL -w "%{http_code}" "$($apiUrl.TrimEnd('/'))/health" 2>$null)
    if ($health -eq "200") { Pass "API" "$apiUrl answers" } else { Fail "API" "$apiUrl/health answered '$health' (network, VPN, hosts file?)" }
  }
  if ($config["HTTPS_PROXY"]) { Info "proxy" "HTTPS_PROXY=$($config["HTTPS_PROXY"]) NO_PROXY=$($config["NO_PROXY"])" }
  if ($project) {
    $projectDir = $config["AGENTFLOW_RUNNER_PROJECT_DIR"]
    if ($projectDir -and (Test-Path $projectDir)) { Pass "project folder" $projectDir }
    else { Fail "project folder" "AGENTFLOW_RUNNER_PROJECT_DIR '$projectDir' does not exist" }
  }
}

$serviceId = "agentflow-agent"
if ($project) {
  $serviceId = "agentflow-agent-$($project.ToLower())"
  if ($instanceServer) { $serviceId = "$serviceId-$instanceServer" }
  # Prefer the id of an installed service definition in the instance dir.
  $serviceXml = Get-ChildItem -Path (Join-Path $instanceDir "service") -Filter "*.xml" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($serviceXml) { $serviceId = [IO.Path]::GetFileNameWithoutExtension($serviceXml.Name) }
}
$service = Get-Service $serviceId -ErrorAction SilentlyContinue
if ($service) { Info "windows service" "$serviceId is $($service.Status)" }
else { Info "windows service" "$serviceId not installed (setup-runner.cmd offers it)" }

Write-Host ""
if ($script:failed -gt 0) {
  Write-Host "$($script:failed) check(s) failed, $($script:warned) warning(s): fix the FAIL lines before setting up the Agent." -ForegroundColor Red
  exit 1
}
Write-Host "All required checks passed ($($script:warned) warning(s))." -ForegroundColor Green
exit 0
