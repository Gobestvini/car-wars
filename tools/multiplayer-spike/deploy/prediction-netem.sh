#!/bin/sh
# Test-only namespaces; no published ports and no production container changes.
set -eu
release=$1
delay=${2:-0}
loss=${3:-0}
jitter=${4:-0}
seconds=${PROBE_SECONDS:-40}
name="carwars-predict-${release}-${delay}-$$"
result="/srv/carwars/probes/${name}"
mkdir -p "$result"
chmod 777 "$result"
cleanup() {
  for role in server leader friend1 friend2; do docker rm -f "${name}-${role}" >/dev/null 2>&1 || true; done
  docker network rm "$name" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM
docker network create "$name" >/dev/null
for role in server leader friend1 friend2; do
  cpu=1
  if [ "$role" = server ]; then cpu=1.5; fi
  docker run -d --name "${name}-${role}" --network "$name" --network-alias "$role" \
    --cpus="$cpu" --memory=768m --cap-add=NET_ADMIN --user=0 --no-healthcheck \
    -v "$result:/results" -e "PROBE_ROLE=$role" -e "PROBE_SECONDS=$seconds" \
    -e "PROBE_DELAY=$delay" -e "PROBE_LOSS=$loss" -e "PROBE_JITTER=$jitter" \
    -e CARWARS_FIXED_SEED=20261005 "carwars-netem:$release" sh -c \
    'tc qdisc replace dev eth0 root netem delay "${PROBE_DELAY}ms" "${PROBE_JITTER}ms" loss "${PROBE_LOSS}%"; exec node tools/multiplayer-spike/deploy/prediction-probe.js' >/dev/null
done
for role in leader friend1 friend2; do
  code=$(docker wait "${name}-${role}")
  docker logs "${name}-${role}" > "$result/${role}.log" 2>&1
  if [ "$code" != 0 ]; then cat "$result/${role}.log"; exit 1; fi
done
docker logs "${name}-server" > "$result/server.log" 2>&1
printf 'RESULT %s\n' "$result"
for role in server leader friend1 friend2; do cat "$result/${role}.json"; printf '\n'; done
