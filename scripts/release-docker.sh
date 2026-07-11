#!/usr/bin/env sh
set -eu

IMAGE="${1:-wenmoux/reader:v2.0}"
SETUP_PORT="${SETUP_PORT:-13100}"
READER_PORT="${READER_PORT:-13200}"
NAME="po18-release-test-$(date +%s)"

PO18_IMAGE_TAG="$IMAGE" node scripts/docker-build.js

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run -d --rm --name "$NAME" -p "${SETUP_PORT}:3100" -p "${READER_PORT}:3200" "$IMAGE" >/dev/null
sleep 4
wget -qO- "http://127.0.0.1:${SETUP_PORT}/health/ready" >/dev/null
i=0
while [ "$i" -lt 12 ]; do
  if docker logs "$NAME" 2>&1 | grep -q "setup token"; then
    break
  fi
  i=$((i + 1))
  sleep 1
done
if ! docker logs "$NAME" 2>&1 | grep -q "setup token"; then
  echo "warning: setup token was not found in captured logs; health check still passed" >&2
fi

if [ "${NO_PUSH:-0}" != "1" ]; then
  PO18_IMAGE_TAG="$IMAGE" node scripts/docker-push.js
  docker buildx imagetools inspect "$IMAGE"
fi
