#!/usr/bin/env sh

# [INPUT]: 依赖 Docker CLI、镜像标签和根级构建/测试/推送命令
# [OUTPUT]: 提供 POSIX 环境的显式本地镜像发布辅助流程
# [POS]: scripts 的兼容发布入口；默认生产发布仍由 GitHub Actions 执行
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

set -eu

IMAGE="${1:-wenmoux/reader:v2.0}"
SETUP_PORT="${SETUP_PORT:-13100}"
READER_PORT="${READER_PORT:-13200}"
NAME="po18-release-test-$(date +%s)"
SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-$(git show -s --format=%ct HEAD)}"
export SOURCE_DATE_EPOCH

PO18_RELEASE=1 PO18_IMAGE_TAG="$IMAGE" node scripts/docker-build.js
IMMUTABLE_IMAGE="$(node -p "require('./.docker-build.json').immutableTag")"

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run -d --rm --name "$NAME" -p "${SETUP_PORT}:3100" -p "${READER_PORT}:3200" "$IMMUTABLE_IMAGE" >/dev/null
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
  node scripts/docker-release-manifest.js
  DIGEST_REFERENCE="$(node -p "require('./release-manifest.json').digest_reference")"
  DIGEST="$(node -p "require('./release-manifest.json').digest")"
  docker pull "$DIGEST_REFERENCE"
  PO18_TEST_APP_IMAGE="$DIGEST_REFERENCE" PO18_EXPECTED_IMAGE_DIGEST="$DIGEST" node scripts/docker-smoke.js
  docker buildx imagetools inspect "$DIGEST_REFERENCE"
fi
