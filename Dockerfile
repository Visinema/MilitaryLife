# syntax=docker/dockerfile:1.7

FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.12.2 --activate

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm run build:api

FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile --prod --filter @mls/shared --filter @mls/api

FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app /app
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/apps/api/src/db/migrations ./apps/api/src/db/migrations
EXPOSE 4000
CMD ["node", "apps/api/dist/server.js"]
