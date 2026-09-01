#!/usr/bin/env bash
# Copyright (c) 2026 Ngo Quoc Huy
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
web_url=${PLANE_REFERENCE_WEB_URL:-}
api_url=${PLANE_REFERENCE_API_URL:-http://localhost:8000}
api_container=${PLANE_REFERENCE_API_CONTAINER:-}
fixture="$repo_root/apps/web/tests/reference/work-item-create-form/fixture.py"
audit_dir=${PLANE_REFERENCE_AUDIT_DIR:-$repo_root/output/playwright}
correlation_id="work-item-create-form-$(date -u +%Y%m%dT%H%M%SZ)-$$"
audit_log="$audit_dir/$correlation_id.jsonl"
reference_run_id=${PLANE_REFERENCE_RUN_ID:-$correlation_id}
reference_email=${PLANE_REFERENCE_EMAIL:-$reference_run_id@example.test}
reference_password=${PLANE_REFERENCE_PASSWORD:-PickerReference-2026}
instance_setup_was_done=""
preview_pid=""
web_port=""
port_lock=""
current_stage="suite.bootstrap"
stage_open=0

mkdir -p "$audit_dir"

audit() {
  local action=$1
  local outcome=$2
  printf '{"timestamp":"%s","correlation_id":"%s","actor":{"type":"system","id":"reference-runner"},"action":"%s","target":{"type":"reference-suite","id":"work-item-create-form"},"outcome":"%s"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$correlation_id" "$action" "$outcome" >> "$audit_log"
}

begin_stage() {
  current_stage=$1
  stage_open=1
  audit "$current_stage" "started"
}

complete_stage() {
  audit "$current_stage" "success"
  stage_open=0
}

run_django() {
  local action=$1
  if [[ -n "$api_container" ]]; then
    docker exec -i -e "PLANE_REFERENCE_ACTION=$action" -e "PLANE_REFERENCE_RUN_ID=$reference_run_id" \
      -e "PLANE_REFERENCE_EMAIL=$reference_email" \
      -e "PLANE_REFERENCE_PASSWORD=$reference_password" \
      -e "PLANE_REFERENCE_INSTANCE_SETUP_WAS_DONE=$instance_setup_was_done" \
      "$api_container" python manage.py shell < "$fixture"
  else
    docker compose exec -T -e "PLANE_REFERENCE_ACTION=$action" -e "PLANE_REFERENCE_RUN_ID=$reference_run_id" \
      -e "PLANE_REFERENCE_EMAIL=$reference_email" \
      -e "PLANE_REFERENCE_PASSWORD=$reference_password" \
      -e "PLANE_REFERENCE_INSTANCE_SETUP_WAS_DONE=$instance_setup_was_done" \
      api python manage.py shell < "$fixture"
  fi
}

claim_web_port() {
  local candidate=$1
  local candidate_lock="${TMPDIR:-/tmp}/plane-reference-web-$candidate.lock"
  mkdir "$candidate_lock" 2>/dev/null || return 1
  if ! python3 -c 'import socket,sys; s=socket.socket(); s.bind(("127.0.0.1", int(sys.argv[1])))' "$candidate" 2>/dev/null; then
    rmdir "$candidate_lock"
    return 1
  fi
  printf '%s\n' "$$" > "$candidate_lock/owner"
  web_port=$candidate
  port_lock=$candidate_lock
}

cleanup() {
  local exit_code=$?
  if [[ ${PLANE_REFERENCE_KEEP_FIXTURE:-0} != 1 || $exit_code != 0 ]]; then
    audit "fixture.cleanup" "started"
    if run_django cleanup >/dev/null 2>&1; then
      audit "fixture.cleanup" "success"
    else
      audit "fixture.cleanup" "failure"
      exit_code=1
    fi
  fi
  if [[ -n "$preview_pid" ]]; then
    kill "$preview_pid" >/dev/null 2>&1 || true
  fi
  if [[ -n "$port_lock" ]]; then
    if [[ $(cat "$port_lock/owner" 2>/dev/null) == "$$" ]]; then
      rm -f "$port_lock/owner"
      rmdir "$port_lock" >/dev/null 2>&1 || true
    fi
  fi
  if [[ $exit_code == 0 && $stage_open == 0 ]]; then
    audit "suite.run" "success"
  else
    if [[ $exit_code == 0 ]]; then
      exit_code=1
    fi
    audit "$current_stage" "failure"
    audit "suite.run" "failure"
  fi
  echo "Reference audit: $audit_log"
  trap - EXIT
  exit "$exit_code"
}
trap cleanup EXIT

if [[ -n "$web_url" ]]; then
  claim_web_port "${web_url##*:}" || {
    echo "Reference web port is already claimed: ${web_url##*:}" >&2
    exit 1
  }
else
  for candidate in ${PLANE_REFERENCE_WEB_PORTS:-3000 3001 3002 3100}; do
    claim_web_port "$candidate" && break
  done
  if [[ -z "$web_port" ]]; then
    echo "No reference web port is available in PLANE_REFERENCE_WEB_PORTS." >&2
    exit 1
  fi
  web_url="http://localhost:$web_port"
fi

audit "suite.run" "started"
begin_stage "api.readiness"
curl -fsS "$api_url/api/instances/" >/dev/null
complete_stage

if [[ ! -d "$repo_root/node_modules" ]]; then
  begin_stage "dependencies.install"
  pnpm --dir "$repo_root" install --frozen-lockfile
  complete_stage
fi

begin_stage "web.build"
(
  cd "$repo_root/apps/web"
  VITE_API_BASE_URL="$api_url" VITE_WEB_BASE_URL="$web_url" ./node_modules/.bin/react-router build
)
complete_stage
begin_stage "web.preview"
(
  cd "$repo_root/apps/web"
  ./node_modules/.bin/vite preview --host 127.0.0.1 --port "$web_port" --strictPort
) >/tmp/plane-reference-preview.log 2>&1 &
preview_pid=$!
for _ in {1..60}; do
  curl -fsS "$web_url" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS "$web_url" >/dev/null
complete_stage

begin_stage "fixture.provision"
fixture_json=$(run_django setup | tail -1)
project_id=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["project_id"])' <<< "$fixture_json")
workspace_slug=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["workspace_slug"])' <<< "$fixture_json")
instance_setup_was_done=$(python3 -c 'import json,sys; print(str(json.load(sys.stdin)["instance_setup_was_done"]).lower())' <<< "$fixture_json")
project_url="$web_url/$workspace_slug/projects/$project_id/issues/"
complete_stage

begin_stage "browser.install"
(
  cd "$repo_root/apps/web"
  ./node_modules/.bin/playwright install chromium
)
complete_stage

playwright_args=(
  test tests/reference/work-item-create-form/work-item-create-form.spec.ts
  --workers=1
  --reporter=line
  --trace=retain-on-failure
)
if [[ ${PLANE_REFERENCE_HEADED:-0} == 1 ]]; then
  playwright_args+=(--headed)
fi

begin_stage "browser.ui-journey"
(
  cd "$repo_root/apps/web"
  PLANE_REFERENCE_AUDIT_LOG="$audit_log" \
  PLANE_REFERENCE_CORRELATION_ID="$correlation_id" \
  PLANE_REFERENCE_WEB_URL="$web_url" \
  PLANE_REFERENCE_PROJECT_URL="$project_url" \
  PLANE_REFERENCE_EMAIL="$reference_email" \
  PLANE_REFERENCE_PASSWORD="$reference_password" \
    ./node_modules/.bin/playwright "${playwright_args[@]}"
)
complete_stage

begin_stage "fixture.assert-persisted"
run_django assert | tail -1
complete_stage

if [[ ${PLANE_REFERENCE_KEEP_FIXTURE:-0} == 1 ]]; then
  printf 'Reference review URL: %s\nReference email: %s\nReference password: %s\nReference run: %s\n' \
    "$project_url" "$reference_email" "$reference_password" "$reference_run_id"
fi
