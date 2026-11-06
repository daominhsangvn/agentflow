#!/bin/sh
# One-shot init for the bundled Gitea (compose profile `local-git`).
# Ensures the admin user, an access token (written to TOKEN_FILE for the api) and an optional org.
# The Gitea CLI has no stdin/env option for the password, so `gitea admin user` still receives it
# as an argument inside this one-shot container. Idempotent: safe to rerun on every `docker compose up`.
set -eu

user="${LOCAL_GIT_ADMIN_USER:-agentflow}"
pass="${LOCAL_GIT_ADMIN_PASSWORD:-}"
email="${LOCAL_GIT_ADMIN_EMAIL:-${user}@local-git.invalid}"
owner="${LOCAL_GIT_OWNER:-}"
url="${GITEA_INTERNAL_URL:-http://local-git:3000}"
token_file="${TOKEN_FILE:-/run/local-git/token}"

TOKEN_NAME="agentflow-compose"
# Keep in sync with scripts/local-git-init.mjs
SCOPES="write:repository,write:organization,write:user,write:issue"

if [ -z "${pass}" ]; then
  echo "set LOCAL_GIT_ADMIN_PASSWORD in deploy/compose/.env" >&2
  exit 1
fi

gitea_cli() { su-exec git gitea -c /data/gitea/conf/app.ini "$@"; }

# curl takes credentials from stdin (--config -), so they stay out of argv.
# Usage: curl_token <token> <curl args...>; curl_basic <user> <pass> <curl args...>
curl_token() {
  _t="$1"
  shift
  printf 'header = "Authorization: token %s"\n' "${_t}" | curl --config - "$@"
}
curl_basic() {
  _cred="$(printf '%s:%s' "$1" "$2" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"
  shift 2
  printf 'user = "%s"\n' "${_cred}" | curl --config - "$@"
}

# 1. Wait for Gitea
i=0
until curl -fsS "${url}/api/healthz" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "${i}" -ge 60 ]; then
    echo "gitea did not become healthy within 120s" >&2
    exit 1
  fi
  sleep 2
done

# 2. Admin user
if out="$(gitea_cli admin user create --admin --username "${user}" --email "${email}" \
  --password "${pass}" --must-change-password=false 2>&1)"; then
  echo "admin user created"
elif echo "${out}" | grep -q "already exists"; then
  gitea_cli admin user change-password --username "${user}" --password "${pass}" \
    --must-change-password=false >/dev/null 2>&1 || {
    echo "failed to reapply admin password" >&2
    exit 1
  }
  echo "admin user exists, password re-applied"
else
  echo "admin user create failed" >&2
  echo "${out}" | grep -vF "${pass}" >&2 || true
  exit 1
fi

# 3. Access token
token=""
if [ -s "${token_file}" ]; then
  token="$(cat "${token_file}")"
  body="$(curl_token "${token}" -fsS "${url}/api/v1/user" 2>/dev/null || true)"
  case "${body}" in
    *"\"login\":\"${user}\""*)
      echo "token valid, kept"
      ;;
    *)
      token=""
      ;;
  esac
fi

if [ -z "${token}" ]; then
  curl_basic "${user}" "${pass}" -s -o /dev/null -w '%{http_code}\n' -X DELETE \
    "${url}/api/v1/users/${user}/tokens/${TOKEN_NAME}" >/dev/null || true
  token="$(gitea_cli admin user generate-access-token --username "${user}" \
    --token-name "${TOKEN_NAME}" --scopes "${SCOPES}" --raw)"
  if [ -z "${token}" ]; then
    echo "token generation failed" >&2
    exit 1
  fi
  token_dir="$(dirname "${token_file}")"
  mkdir -p "${token_dir}"
  tmp="${token_dir}/.token.$$"
  (umask 077 && printf '%s' "${token}" >"${tmp}")
  mv "${tmp}" "${token_file}"
  echo "token issued"
fi

# 4. Organization
if [ -n "${owner}" ] && [ "${owner}" != "${user}" ]; then
  if ! echo "${owner}" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$'; then
    echo "invalid LOCAL_GIT_OWNER" >&2
    exit 1
  fi
  code="$(curl_token "${token}" -s -o /dev/null -w '%{http_code}' \
    "${url}/api/v1/orgs/${owner}")"
  if [ "${code}" = "404" ]; then
    code="$(curl_token "${token}" -s -o /dev/null -w '%{http_code}' -X POST \
      -H "Content-Type: application/json" \
      -d "{\"username\":\"${owner}\",\"visibility\":\"private\"}" "${url}/api/v1/orgs")"
    case "${code}" in
      201 | 422) echo "org ensured" ;;
      *)
        echo "org create failed (HTTP ${code})" >&2
        exit 1
        ;;
    esac
  elif [ "${code}" = "200" ]; then
    echo "org exists"
  else
    echo "org lookup failed (HTTP ${code})" >&2
    exit 1
  fi
fi

exit 0
