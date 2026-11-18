# Platform agent settings

Optional. This folder is mounted read-only into the `api` container at
`/run/platform-agent`. The workflow builder assistant (the first feature using the platform agent) stays off unless
`PLATFORM_AGENT_SETTINGS_FILE` is set in `deploy/compose/.env`. With the variable unset, or with no
`settings.json` here, the api starts normally and the assistant reports itself as not configured.

Everything here except this README and `.gitignore` is git-ignored. Never commit tokens or certificates.

## What goes here

- `settings.json`: a Claude Code style settings file. Only its `env` block is used.
- `ca-xxx.crt`: optional CA certificate (PEM or DER) for a TLS-intercepting proxy.

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://llm-gateway.example.internal",
    "ANTHROPIC_AUTH_TOKEN": "<token>",
    "ANTHROPIC_CUSTOM_HEADERS": "X-Example-Header: <value>",
    "HTTPS_PROXY": "http://proxy.example.internal:3128",
    "HTTP_PROXY": "http://proxy.example.internal:3128",
    "NO_PROXY": "localhost,127.0.0.1",
    "NODE_EXTRA_CA_CERTS": "ca-xxx.crt"
  }
}
```

Every key of the `env` block is passed to Claude Code (for example `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`).
One of `ANTHROPIC_AUTH_TOKEN` or `ANTHROPIC_API_KEY` is required. Other top-level keys (hooks, permissions)
are ignored.

## Claude Code version

The `api` image installs Claude Code. In `deploy/compose/.env`:

```
# Exact release, also installed into the image at build time (rebuild the api image after changing it)
# PLATFORM_AGENT_CLAUDE_CODE_VERSION=2.1.322
# Image build only: latest (default), stable, or none to leave Claude Code out
# PLATFORM_AGENT_CLAUDE_CODE_CHANNEL=latest
```

The api never installs Claude Code at runtime; with a version pin it needs that exact release.

## Enable

In `deploy/compose/.env`:

```
PLATFORM_AGENT_SETTINGS_FILE=/run/platform-agent/settings.json
# Optional: use another host folder instead of ./platform-agent
# PLATFORM_AGENT_DIR=/srv/agentflow/platform-agent
```

Then `docker compose up -d api`.

## Certificate paths

A relative `NODE_EXTRA_CA_CERTS` (`ca-xxx.crt`) resolves against the folder holding `settings.json`. An
absolute path that does not exist in the container (for example a Windows path such as
`C:\certs\ca-xxx.crt` copied from a desktop `settings.json`) falls back to the same file name inside this
folder, so put the certificate here.

## Rotating the token

`settings.json` is re-read when its modification time changes. Edit the token and save; no restart needed.

## Smoke check

```
docker compose -f deploy/compose/docker-compose.prod.yml exec api pnpm --filter api workflow-builder:smoke
```

It prints the settings summary (booleans and counts only), the knowledge guide count, the resolved Claude Code
version and one short Claude Code run that reads a guide. It exits 1 on failure.
