# The checker command in an image (PA#3 criterion 6, decisions.md D20).
# Build from the repo root; the build context is the checker package only:
#   docker build -f checker/Dockerfile -t leetkob-checker packages/checker
# Run with the model off and no network:
#   docker run --rm --network none -e MODEL_OFF=1 --user "$(id -u):$(id -g)" \
#     -v "$PWD/eval/dev:/data:ro" -v "$PWD/out:/out" leetkob-checker --data /data --out /out/predictions.jsonl

# node:24.11.1-alpine, pinned by the digest of its multi-platform index
FROM node:24.11.1-alpine@sha256:682368d8253e0c3364b803956085c456a612d738bd635926d73fa24db3ce53d7

WORKDIR /app
# No dependencies to install: Node 24 runs the TypeScript sources directly.
COPY package.json ./
COPY src ./src
USER node
ENTRYPOINT ["node", "src/cli.ts"]
