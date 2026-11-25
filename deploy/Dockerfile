# The images of the deployment (D16), one target per service. Build context: the repo root.
# Base images are pinned by the digest of their multi-platform index.

# node:24.11.1-alpine
FROM node:24.11.1-alpine@sha256:682368d8253e0c3364b803956085c456a612d738bd635926d73fa24db3ce53d7 AS node
WORKDIR /app
ENV NODE_ENV=production

FROM node AS build
COPY . .
RUN npm ci --include=dev --ignore-scripts \
  && npm run build --workspace @leetkob/api \
  && npm run build --workspace @leetkob/worker \
  && npm run build --workspace @leetkob/web

# Applies the committed migrations once, then exits.
FROM build AS migrate
USER node
CMD ["node", "--import", "tsx", "packages/db/src/migrate-cli.ts"]

FROM node AS dependencies
COPY . .
RUN npm ci --omit=dev --ignore-scripts

FROM node AS api
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api/package.json ./apps/api/
COPY --from=build /app/apps/api/dist ./apps/api/dist
USER node
CMD ["node", "apps/api/dist/apps/api/src/server.js"]

FROM node AS worker
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/worker/package.json ./apps/worker/
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
USER node

FROM worker AS check
CMD ["node", "apps/worker/dist/apps/worker/src/check.js"]

# Only this image has the Docker client (D12).
FROM worker AS judge
# docker:cli
COPY --from=docker:cli@sha256:6e26c5a09acc481245d6b50836f1f713c609e51ebc88735c08f5aa4b3c91e15a /usr/local/bin/docker /usr/local/bin/docker
CMD ["node", "apps/worker/dist/apps/worker/src/judge.js"]

# caddy:2-alpine (2.11.9)
FROM caddy:2-alpine@sha256:003a97808e781aa9f7e75cc2f43d34d461099031faf5e20faefb9f61126836f0 AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
