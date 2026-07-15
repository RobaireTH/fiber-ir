#!/bin/sh
set -eu

base_dir=${FIBER_HOME:-/fiber}
config_path=${FIBER_CONFIG:-$base_dir/config.yml}
rpc_port=${FIR_FNN_RPC_PORT:-8227}
internal_rpc_port=${FIR_FNN_INTERNAL_RPC_PORT:-18227}

if [ -z "${FIBER_SECRET_KEY_PASSWORD:-}" ]; then
  echo "FIBER_SECRET_KEY_PASSWORD must be set." >&2
  exit 1
fi

if [ -z "${CKB_SECRET_KEY:-}" ]; then
  echo "CKB_SECRET_KEY must be set to a throwaway testnet private key." >&2
  exit 1
fi

mkdir -p "$base_dir/ckb" "$(dirname "$config_path")"

if [ ! -f "$base_dir/ckb/key" ]; then
  umask 077
  printf '%s\n' "$CKB_SECRET_KEY" > "$base_dir/ckb/key"
fi

if [ ! -f "$config_path" ]; then
  cp /usr/local/share/fiber-ir/config.yml "$config_path"
fi

socat "TCP6-LISTEN:$internal_rpc_port,fork,reuseaddr,bind=::" "TCP4:127.0.0.1:$rpc_port" &

exec /usr/local/bin/docker-entrypoint.sh fnn -d "$base_dir" -c "$config_path"
