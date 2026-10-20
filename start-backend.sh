#!/bin/sh

set -eu

case "$0" in
  /*) SCRIPT_PATH="$0" ;;
  *) SCRIPT_PATH="$(pwd)/$0" ;;
esac

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$SCRIPT_PATH")" && pwd)"
BACKEND_DIR="${ROOT_DIR}/backend"
PID_FILE="${ROOT_DIR}/backend.pid"
LOG_FILE="${ROOT_DIR}/nohup.out"
LOCK_DIR="${ROOT_DIR}/backend.start.lock"
ENTRYPOINT="src/index.js"
DEFAULT_NODE_BIN="/root/.nvm/versions/node/v14.15.3/bin/node"
ROOT_ENV_FILE="${ROOT_DIR}/.env"
BACKEND_ENV_FILE="${BACKEND_DIR}/.env"
# backend/package.json declares "engines".node — keep this in sync with that floor.
MIN_NODE_MAJOR=14
# If this host manages the backend under systemd (production), that unit's
# Restart=always fights any process this script starts/stops by hand — every
# verb below must delegate to systemctl instead. See start-backend.sh history.
SYSTEMD_SERVICE="${SYSTEMD_SERVICE:-integration-gateway.service}"

has_systemd_unit() {
  command -v systemctl >/dev/null 2>&1 || return 1
  systemctl list-unit-files "${SYSTEMD_SERVICE}" 2>/dev/null | grep -q "${SYSTEMD_SERVICE}"
}

node_major_version() {
  "$1" -e 'process.stdout.write(String(process.versions.node.split(".")[0]))' 2>/dev/null
}

is_usable_node() {
  bin="$1"
  [ -n "${bin}" ] || return 1
  [ -x "${bin}" ] || return 1
  major="$(node_major_version "${bin}")"
  [ -n "${major}" ] || return 1
  [ "${major}" -ge "${MIN_NODE_MAJOR}" ] 2>/dev/null
}

resolve_node_bin() {
  # Explicit override (.env NODE_BIN=...) always wins — this is how each host
  # points at its own accessible, correct-version node binary.
  if [ "${NODE_BIN:-}" ] && is_usable_node "${NODE_BIN}"; then
    printf '%s\n' "${NODE_BIN}"
    return 0
  fi

  # Known install location for this host, tried before PATH so a stray old
  # system `node` (e.g. an ancient distro package) can't silently win.
  if is_usable_node "${DEFAULT_NODE_BIN}"; then
    printf '%s\n' "${DEFAULT_NODE_BIN}"
    return 0
  fi

  if command -v node >/dev/null 2>&1 && is_usable_node "$(command -v node)"; then
    command -v node
    return 0
  fi

  echo "ERROR: No usable node binary found (need major version >= ${MIN_NODE_MAJOR})." >&2
  echo "       Set NODE_BIN in ${ROOT_ENV_FILE} to an absolute, executable path." >&2
  if [ "${NODE_BIN:-}" ]; then
    echo "       NODE_BIN=${NODE_BIN} was set but is not usable (missing, not executable, or too old)." >&2
  fi
  return 1
}

load_env_file() {
  env_file="$1"
  [ -f "${env_file}" ] || return 0

  # shellcheck disable=SC1090
  set -a
  . "${env_file}"
  set +a
}

is_numeric_pid() {
  case "$1" in
    ''|*[!0-9]*) return 1 ;;
    *) return 0 ;;
  esac
}

is_pid_running_for_backend() {
  pid="$1"

  is_numeric_pid "${pid}" || return 1
  kill -0 "${pid}" 2>/dev/null || return 1

  proc_cwd="$(readlink -f "/proc/${pid}/cwd" 2>/dev/null || true)"
  [ "${proc_cwd}" = "${BACKEND_DIR}" ] || return 1

  cmdline="$(tr '\000' ' ' <"/proc/${pid}/cmdline" 2>/dev/null || true)"
  case "${cmdline}" in
    *"${ENTRYPOINT}"*) return 0 ;;
    *) return 1 ;;
  esac
}

find_running_pid() {
  if [ -f "${PID_FILE}" ]; then
    pid="$(tr -d '[:space:]' <"${PID_FILE}")"
    if is_pid_running_for_backend "${pid}"; then
      printf '%s\n' "${pid}"
      return 0
    fi
  fi

  for pid in $(pgrep -f "node .*${ENTRYPOINT}" 2>/dev/null || true); do
    if is_pid_running_for_backend "${pid}"; then
      printf '%s\n' "${pid}"
      return 0
    fi
  done

  return 1
}

write_pid_file() {
  printf '%s\n' "$1" >"${PID_FILE}"
}

clear_pid_file() {
  rm -f "${PID_FILE}"
}

status_backend() {
  if pid="$(find_running_pid)"; then
    write_pid_file "${pid}"
    echo "RUNNING pid=${pid}"
    return 0
  fi

  clear_pid_file
  echo "STOPPED"
  return 1
}

# On hosts where systemd owns this service, every verb below must go through
# systemctl (sudo prompts interactively if needed) instead of touching the
# process directly — manually starting/stopping it races with the unit's
# Restart=always and produces a duplicate, hard-to-diagnose respawn loop.
systemd_dispatch() {
  action="$1"
  echo "Backend is managed by systemd (${SYSTEMD_SERVICE}) on this host — delegating to systemctl." >&2
  case "${action}" in
    status) sudo systemctl status "${SYSTEMD_SERVICE}" --no-pager ;;
    *) sudo systemctl "${action}" "${SYSTEMD_SERVICE}" ;;
  esac
}

acquire_start_lock() {
  if mkdir "${LOCK_DIR}" 2>/dev/null; then
    trap 'rmdir "${LOCK_DIR}" 2>/dev/null || true' EXIT INT TERM HUP
    return 0
  fi

  echo "ERROR: start lock is already held. Another start may be in progress." >&2
  return 1
}

release_start_lock() {
  rmdir "${LOCK_DIR}" 2>/dev/null || true
  trap - EXIT INT TERM HUP
}

start_backend() {
  acquire_start_lock

  if existing_pid="$(find_running_pid)"; then
    write_pid_file "${existing_pid}"
    echo "Backend already running with pid=${existing_pid}"
    release_start_lock
    return 0
  fi

  clear_pid_file

  # Load .env into THIS shell before resolving node — NODE_BIN must be visible
  # here, not just in the child subshell below, or an override in .env is
  # silently ignored and resolve_node_bin falls back to DEFAULT_NODE_BIN/PATH.
  load_env_file "${ROOT_ENV_FILE}"
  load_env_file "${BACKEND_ENV_FILE}"
  node_bin="$(resolve_node_bin)"

  (
    load_env_file "${ROOT_ENV_FILE}"
    load_env_file "${BACKEND_ENV_FILE}"
    cd "${BACKEND_DIR}"
    nohup "${node_bin}" "${ENTRYPOINT}" >>"${LOG_FILE}" 2>&1 < /dev/null &
    printf '%s\n' "$!" >"${PID_FILE}"
  )

  sleep 2

  if new_pid="$(find_running_pid)"; then
    write_pid_file "${new_pid}"
    echo "Backend started with pid=${new_pid}"
    release_start_lock
    return 0
  fi

  echo "ERROR: Backend failed to start. Check ${LOG_FILE}" >&2
  clear_pid_file
  release_start_lock
  return 1
}

stop_backend() {
  waited=0

  if ! pid="$(find_running_pid)"; then
    clear_pid_file
    echo "Backend is not running"
    return 0
  fi

  echo "Stopping backend pid=${pid}"
  kill -TERM "${pid}" 2>/dev/null || true

  while is_pid_running_for_backend "${pid}"; do
    sleep 1
    waited=$((waited + 1))
    if [ "${waited}" -ge 30 ]; then
      echo "Backend did not stop in time; sending SIGKILL to pid=${pid}" >&2
      kill -KILL "${pid}" 2>/dev/null || true
      break
    fi
  done

  clear_pid_file
  echo "Backend stopped"
}

restart_backend() {
  stop_backend
  start_backend
}

usage() {
  cat <<'EOF'
Usage: sh start-backend.sh [start|stop|restart|status]

Defaults to "start".

On hosts where the systemd unit (SYSTEMD_SERVICE, default integration-gateway.service) is registered,
every action delegates to `systemctl` (may prompt for sudo password) instead
of managing the process directly.

Environment overrides (set in .env, next to this script):
  NODE_BIN=/absolute/path/to/node   Must be a real, executable node binary
                                    (checked by actually running it) of at
                                    least the version backend/package.json's
                                    "engines.node" requires. Takes priority
                                    over DEFAULT_NODE_BIN and PATH.
EOF
}

ACTION="${1:-start}"

if has_systemd_unit; then
  case "${ACTION}" in
    start|stop|restart|status)
      systemd_dispatch "${ACTION}"
      exit $?
      ;;
    help|-h|--help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: Unknown action: ${ACTION}" >&2
      usage >&2
      exit 1
      ;;
  esac
fi

case "${ACTION}" in
  start)
    start_backend
    ;;
  stop)
    stop_backend
    ;;
  restart)
    restart_backend
    ;;
  status)
    status_backend
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    echo "ERROR: Unknown action: ${ACTION}" >&2
    usage >&2
    exit 1
    ;;
esac
