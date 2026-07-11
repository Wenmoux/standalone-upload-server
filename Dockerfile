ARG PO18_IMAGE_TAG=wenmoux/reader:v2.0
ARG PO18_APP_VERSION=2.0.0
ARG PO18_BUILD_DATE=
ARG PO18_BUILD_REVISION=

FROM node:20-alpine AS build-info
ARG PO18_IMAGE_TAG
ARG PO18_APP_VERSION
ARG PO18_BUILD_DATE
ARG PO18_BUILD_REVISION
WORKDIR /build-info
ENV PO18_IMAGE_TAG=${PO18_IMAGE_TAG} \
    PO18_APP_VERSION=${PO18_APP_VERSION} \
    PO18_BUILD_DATE=${PO18_BUILD_DATE} \
    PO18_BUILD_REVISION=${PO18_BUILD_REVISION}
RUN node -e "const fs=require('fs'); const data={version:process.env.PO18_APP_VERSION||'',image:process.env.PO18_IMAGE_TAG||'',build_date:process.env.PO18_BUILD_DATE||'',build_revision:process.env.PO18_BUILD_REVISION||'',revision:process.env.PO18_BUILD_REVISION||''}; fs.writeFileSync('/build-info/.po18-build.json', JSON.stringify(data, null, 2));"

FROM node:20-alpine AS root-deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:20-alpine AS admin-build
WORKDIR /build/admin-ui
COPY admin-ui/package*.json ./
RUN npm ci && npm cache clean --force
COPY admin-ui ./
RUN npm run build

FROM node:20-alpine AS server-pg
ARG PO18_IMAGE_TAG
ARG PO18_APP_VERSION
ARG PO18_BUILD_DATE
ARG PO18_BUILD_REVISION
ENV NODE_ENV=production \
    PO18_IMAGE_TAG=${PO18_IMAGE_TAG} \
    PO18_APP_VERSION=${PO18_APP_VERSION} \
    PO18_BUILD_DATE=${PO18_BUILD_DATE} \
    PO18_BUILD_REVISION=${PO18_BUILD_REVISION}
LABEL org.opencontainers.image.version="${PO18_APP_VERSION}" \
      org.opencontainers.image.created="${PO18_BUILD_DATE}" \
      org.opencontainers.image.revision="${PO18_BUILD_REVISION}"
WORKDIR /app
RUN apk add --no-cache postgresql16-client
COPY --from=root-deps /app/node_modules ./node_modules
COPY package*.json ./
COPY --from=build-info /build-info/.po18-build.json ./.po18-build.json
COPY pg-store.js server-pg.js ./
COPY services ./services
COPY routes ./routes
COPY db ./db
COPY scripts/migrate-rollback.js scripts/clean-chapter-titles.js ./scripts/
COPY public/legado-po18-reader-source.json public/rank.html ./public/
COPY --from=admin-build /build/admin-ui/dist ./public/
COPY docker/control-panel.js docker/entrypoint.js docker/setup-wizard.js docker/status-check.js docker/backup-pg.js docker/structured-log.js ./docker/
EXPOSE 3100
CMD ["node", "server-pg.js"]

FROM node:20-alpine AS bot
ARG PO18_IMAGE_TAG
ARG PO18_APP_VERSION
ARG PO18_BUILD_DATE
ARG PO18_BUILD_REVISION
ENV NODE_ENV=production \
    PO18_IMAGE_TAG=${PO18_IMAGE_TAG} \
    PO18_APP_VERSION=${PO18_APP_VERSION} \
    PO18_BUILD_DATE=${PO18_BUILD_DATE} \
    PO18_BUILD_REVISION=${PO18_BUILD_REVISION}
LABEL org.opencontainers.image.version="${PO18_APP_VERSION}" \
      org.opencontainers.image.created="${PO18_BUILD_DATE}" \
      org.opencontainers.image.revision="${PO18_BUILD_REVISION}"
WORKDIR /app
RUN apk add --no-cache font-wqy-zenhei
COPY --from=root-deps /app/node_modules ./node_modules
COPY package*.json ./
COPY --from=build-info /build-info/.po18-build.json ./.po18-build.json
COPY bot ./bot
COPY docker/status-check.js ./docker/status-check.js
EXPOSE 3300
CMD ["node", "bot/telegram-bot.js"]

FROM node:20-bookworm-slim AS reader-build
WORKDIR /build/cirno-src
COPY cirno-src/package*.json ./
RUN npm ci
COPY cirno-src ./
RUN npm run build:standalone

FROM node:20-alpine AS reader
ARG PO18_IMAGE_TAG
ARG PO18_APP_VERSION
ARG PO18_BUILD_DATE
ARG PO18_BUILD_REVISION
ENV NODE_ENV=production \
    PO18_IMAGE_TAG=${PO18_IMAGE_TAG} \
    PO18_APP_VERSION=${PO18_APP_VERSION} \
    PO18_BUILD_DATE=${PO18_BUILD_DATE} \
    PO18_BUILD_REVISION=${PO18_BUILD_REVISION}
LABEL org.opencontainers.image.version="${PO18_APP_VERSION}" \
      org.opencontainers.image.created="${PO18_BUILD_DATE}" \
      org.opencontainers.image.revision="${PO18_BUILD_REVISION}"
WORKDIR /app
COPY --from=root-deps /app/node_modules ./node_modules
COPY package*.json ./
COPY --from=build-info /build-info/.po18-build.json ./.po18-build.json
COPY cirno-src/reader-server.js ./cirno-src/reader-server.js
COPY --from=reader-build /build/cirno-src/dist-reader ./cirno-src/dist-reader
COPY docker/status-check.js docker/structured-log.js ./docker/
EXPOSE 3200
CMD ["node", "cirno-src/reader-server.js"]

FROM node:20-alpine AS app
ARG PO18_IMAGE_TAG
ARG PO18_APP_VERSION
ARG PO18_BUILD_DATE
ARG PO18_BUILD_REVISION
ENV NODE_ENV=production \
    PO18_IMAGE_TAG=${PO18_IMAGE_TAG} \
    PO18_APP_VERSION=${PO18_APP_VERSION} \
    PO18_BUILD_DATE=${PO18_BUILD_DATE} \
    PO18_BUILD_REVISION=${PO18_BUILD_REVISION}
LABEL org.opencontainers.image.version="${PO18_APP_VERSION}" \
      org.opencontainers.image.created="${PO18_BUILD_DATE}" \
      org.opencontainers.image.revision="${PO18_BUILD_REVISION}"
WORKDIR /app
RUN apk add --no-cache postgresql16-client font-wqy-zenhei
RUN mkdir -p /config /tmp/po18 && chown -R node:node /config /tmp/po18
COPY --from=root-deps /app/node_modules ./node_modules
COPY package*.json ./
COPY --from=build-info /build-info/.po18-build.json ./.po18-build.json
COPY pg-store.js server-pg.js ./
COPY services ./services
COPY routes ./routes
COPY db ./db
COPY scripts/migrate-rollback.js scripts/clean-chapter-titles.js ./scripts/
COPY public/legado-po18-reader-source.json public/rank.html ./public/
COPY --from=admin-build /build/admin-ui/dist ./public/
COPY bot ./bot
COPY cirno-src/reader-server.js ./cirno-src/reader-server.js
COPY --from=reader-build /build/cirno-src/dist-reader ./cirno-src/dist-reader
COPY docker ./docker
VOLUME ["/config"]
EXPOSE 3100 3200 3300
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node docker/healthcheck.js
ENTRYPOINT ["node", "docker/entrypoint.js"]
CMD ["node", "docker/run-all.js"]
