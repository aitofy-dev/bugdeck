# Build stage: python3/make/g++ are here for better-sqlite3, which has no
# prebuilt binary for musl and compiles on install.
FROM node:22-alpine AS build
RUN apk add --no-cache python3 make g++
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/widget/package.json packages/widget/
RUN pnpm install --frozen-lockfile --filter @bugdeck/server...

COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY packages/server packages/server
RUN pnpm --filter @bugdeck/server... run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production STORAGE_PATH=/data PORT=3131

COPY --from=build /app /app
RUN mkdir -p /data && chown -R node:node /data

USER node
VOLUME /data
EXPOSE 3131
CMD ["node", "packages/server/dist/bin.js"]
