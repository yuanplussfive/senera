#!/bin/sh
set -eu

runtime_user="node"

fail() {
  printf '%s\n' "Senera container startup failed: $*" >&2
  exit 1
}

[ "$#" -gt 0 ] || fail "no application command was provided."
[ "$(id -u)" = "0" ] || fail "the privilege bootstrap must start as root."

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
