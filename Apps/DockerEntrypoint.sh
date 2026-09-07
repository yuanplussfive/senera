#!/bin/sh
set -eu

runtime_user="node"

fail() {
  printf '%s\n' "Senera container startup failed: $*" >&2
  exit 1
}

prepare_workspace_skill_root() {
  workspace_root="${SENERA_WORKSPACE_ROOT:-/data}"
  state_root="${workspace_root%/}/.senera"
  skill_root="${state_root}/skills"

  # The application may run as root in single-service mode so the embedded
  # sandbox can reach Docker, but workspace-managed Skills must remain
  # writable by the non-root runtime user used by the default image path and
  # the container smoke probe.
  install -d -o node -g node "$state_root" "$skill_root" || \
    fail "cannot initialize workspace Skill directory: $skill_root"
  chown node:node "$state_root" "$skill_root" || \
    fail "cannot assign workspace Skill directory to runtime user: $skill_root"
}

[ "$#" -gt 0 ] || fail "no application command was provided."
[ "$(id -u)" = "0" ] || fail "the privilege bootstrap must start as root."

prepare_workspace_skill_root

# Single-service mode: the operator explicitly opts into running the whole
# container as root so the embedded sandbox Worker can reach the Docker Engine
# socket. Other container launches keep the default privilege-drop path.
if [ "${SENERA_CONTAINER_RUNTIME_USER:-}" = "root" ]; then
  printf '%s\n' "Senera container runtime: user=root (single-service mode, embedded sandbox Worker)"
  exec "$@"
fi

runtime_uid="$(id -u "$runtime_user")" || fail "runtime user $runtime_user does not exist."
runtime_gid="$(id -g "$runtime_user")" || fail "runtime group for $runtime_user does not exist."
[ "$runtime_uid" != "0" ] || fail "runtime user $runtime_user must not be root."
[ "$runtime_gid" != "0" ] || fail "runtime group for $runtime_user must not be root."
printf '%s\n' "Senera container runtime: user=${runtime_user} uid=${runtime_uid} gid=${runtime_gid}"
exec setpriv \
  --reuid="$runtime_uid" \
  --regid="$runtime_gid" \
  --clear-groups \
  -- "$@"
