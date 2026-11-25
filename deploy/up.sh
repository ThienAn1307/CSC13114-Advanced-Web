#!/usr/bin/env bash
# Builds and starts the deployment, or updates it. Run on the VM, from any folder (README, Deployment).
set -euo pipefail
cd "$(dirname "$0")"

# The sandbox image is used by its immutable id (D19).
JUDGE_IMAGE=$(docker build --quiet --tag judge-cpp:deployed ../sandbox/image)
DOCKER_GID=$(stat -c %g /var/run/docker.sock)
export JUDGE_IMAGE DOCKER_GID
compose() { docker compose --file compose.prod.yml "$@"; }

compose build
# No Node on the VM: the check runs in the image that was just built, with no network.
compose config --format json |
  docker run --rm --interactive --network none --volume "$PWD/check-compose.mjs:/check.mjs:ro" \
    --entrypoint node leetkob-prod-api /check.mjs
compose up --detach --wait --remove-orphans
compose ps
