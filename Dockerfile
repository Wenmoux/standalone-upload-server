ARG PO18_IMAGE_TAG=wenmoux/reader:v2.0
ARG PO18_IMMUTABLE_IMAGE_TAG=
ARG PO18_IMAGE_TAGS=
ARG PO18_APP_VERSION=2.0.0
ARG PO18_BUILD_DATE=
ARG PO18_BUILD_REVISION=
ARG PO18_SOURCE_HASH=
ARG PO18_BUILD_DIRTY=false
ARG NODE_ALPINE_IMAGE=node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293
ARG NODE_BOOKWORM_IMAGE=node:20-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0

FROM ${NODE_ALPINE_IMAGE} AS build-info
ARG PO18_IMAGE_TAG
ARG PO18_IMMUTABLE_IMAGE_TAG
ARG PO18_IMAGE_TAGS
ARG PO18_APP_VERSION
ARG PO18_BUILD_DATE
ARG PO18_BUILD_REVISION
ARG PO18_SOURCE_HASH
ARG PO18_BUILD_DIRTY
WORKDIR /build-info
ENV PO18_IMAGE_TAG=${PO18_IMAGE_TAG} \
    PO18_IMMUTABLE_IMAGE_TAG=${PO18_IMMUTABLE_IMAGE_TAG} \
    PO18_IMAGE_TAGS=${PO18_IMAGE_TAGS} \
    PO18_APP_VERSION=${PO18_APP_VERSION} \
    PO18_BUILD_DATE=${PO18_BUILD_DATE} \
    PO18_BUILD_REVISION=${PO18_BUILD_REVISION} \
    PO18_SOURCE_HASH=${PO18_SOURCE_HASH} \
    PO18_BUILD_DIRTY=${PO18_BUILD_DIRTY}
RUN node -e "const fs=require('fs'); const data={version:process.env.PO18_APP_VERSION||'',image:process.env.PO18_IMAGE_TAG||'',immutable_image:process.env.PO18_IMMUTABLE_IMAGE_TAG||'',image_tags:(process.env.PO18_IMAGE_TAGS||'').split(',').filter(Boolean),build_date:process.env.PO18_BUILD_DATE||'',build_revision:process.env.PO18_BUILD_REVISION||'',revision:process.env.PO18_BUILD_REVISION||'',source_hash:process.env.PO18_SOURCE_HASH||'',dirty:process.env.PO18_BUILD_DIRTY==='true'}; fs.writeFileSync('/build-info/.po18-build.json', JSON.stringify(data, null, 2));"

FROM ${NODE_ALPINE_IMAGE} AS root-deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM ${NODE_ALPINE_IMAGE} AS admin-build
WORKDIR /build/admin-ui
COPY admin-ui/package*.json ./
RUN npm ci && npm cache clean --force
COPY admin-ui ./
COPY ui /build/ui
COPY bot/epub-styles/assets/jianghu-top.png /build/bot/epub-styles/assets/jianghu-top.png
RUN npm run build

FROM ${NODE_ALPINE_IMAGE} AS server-pg
ARG PO18_IMAGE_TAG
ARG PO18_IMMUTABLE_IMAGE_TAG
ARG PO18_APP_VERSION
ARG PO18_BUILD_DATE
ARG PO18_BUILD_REVISION
ARG PO18_SOURCE_HASH
ARG PO18_BUILD_DIRTY
ENV NODE_ENV=production \
    PO18_IMAGE_TAG=${PO18_IMAGE_TAG} \
    PO18_IMMUTABLE_IMAGE_TAG=${PO18_IMMUTABLE_IMAGE_TAG} \
    PO18_APP_VERSION=${PO18_APP_VERSION} \
    PO18_BUILD_DATE=${PO18_BUILD_DATE} \
    PO18_BUILD_REVISION=${PO18_BUILD_REVISION} \
    PO18_SOURCE_HASH=${PO18_SOURCE_HASH} \
    PO18_BUILD_DIRTY=${PO18_BUILD_DIRTY}
LABEL org.opencontainers.image.version="${PO18_APP_VERSION}" \
      org.opencontainers.image.created="${PO18_BUILD_DATE}" \
      org.opencontainers.image.revision="${PO18_BUILD_REVISION}" \
      org.opencontainers.image.ref.name="${PO18_IMMUTABLE_IMAGE_TAG}" \
      org.opencontainers.image.source-hash="${PO18_SOURCE_HASH}"
WORKDIR /app
RUN apk add --no-cache postgresql16-client
COPY --from=root-deps /app/node_modules ./node_modules
COPY package*.json ./
COPY --from=build-info /build-info/.po18-build.json ./.po18-build.json
COPY pg-store.js server-pg.js ./
COPY services ./services
COPY assets ./assets
COPY ui ./ui
COPY routes ./routes
COPY db ./db
COPY scripts/migrate-rollback.js scripts/clean-chapter-titles.js ./scripts/
COPY public/legado-po18-reader-source.json public/rank.html ./public/
COPY --from=admin-build /build/admin-ui/dist ./public/
COPY docker/control-panel.js docker/entrypoint.js docker/setup-wizard.js docker/status-check.js docker/backup-pg.js docker/structured-log.js ./docker/
EXPOSE 3100
CMD ["node", "server-pg.js"]

FROM ${NODE_ALPINE_IMAGE} AS bot
ARG PO18_IMAGE_TAG
ARG PO18_IMMUTABLE_IMAGE_TAG
ARG PO18_APP_VERSION
ARG PO18_BUILD_DATE
ARG PO18_BUILD_REVISION
ARG PO18_SOURCE_HASH
ARG PO18_BUILD_DIRTY
ENV NODE_ENV=production \
    PO18_IMAGE_TAG=${PO18_IMAGE_TAG} \
    PO18_IMMUTABLE_IMAGE_TAG=${PO18_IMMUTABLE_IMAGE_TAG} \
    PO18_APP_VERSION=${PO18_APP_VERSION} \
    PO18_BUILD_DATE=${PO18_BUILD_DATE} \
    PO18_BUILD_REVISION=${PO18_BUILD_REVISION} \
    PO18_SOURCE_HASH=${PO18_SOURCE_HASH} \
    PO18_BUILD_DIRTY=${PO18_BUILD_DIRTY}
LABEL org.opencontainers.image.version="${PO18_APP_VERSION}" \
      org.opencontainers.image.created="${PO18_BUILD_DATE}" \
      org.opencontainers.image.revision="${PO18_BUILD_REVISION}" \
      org.opencontainers.image.ref.name="${PO18_IMMUTABLE_IMAGE_TAG}" \
      org.opencontainers.image.source-hash="${PO18_SOURCE_HASH}"
WORKDIR /app
RUN apk add --no-cache font-wqy-zenhei
COPY --from=root-deps /app/node_modules ./node_modules
COPY package*.json ./
COPY --from=build-info /build-info/.po18-build.json ./.po18-build.json
COPY bot ./bot
COPY assets ./assets
COPY docker/status-check.js ./docker/status-check.js
EXPOSE 3300
CMD ["node", "bot/telegram-bot.js"]

FROM ${NODE_BOOKWORM_IMAGE} AS reader-build
WORKDIR /build/cirno-src
COPY cirno-src/package*.json ./
RUN npm ci
COPY cirno-src ./
RUN npm run build:standalone

FROM ${NODE_ALPINE_IMAGE} AS reader
ARG PO18_IMAGE_TAG
ARG PO18_IMMUTABLE_IMAGE_TAG
ARG PO18_APP_VERSION
ARG PO18_BUILD_DATE
ARG PO18_BUILD_REVISION
ARG PO18_SOURCE_HASH
ARG PO18_BUILD_DIRTY
ENV NODE_ENV=production \
    PO18_IMAGE_TAG=${PO18_IMAGE_TAG} \
    PO18_IMMUTABLE_IMAGE_TAG=${PO18_IMMUTABLE_IMAGE_TAG} \
    PO18_APP_VERSION=${PO18_APP_VERSION} \
    PO18_BUILD_DATE=${PO18_BUILD_DATE} \
    PO18_BUILD_REVISION=${PO18_BUILD_REVISION} \
    PO18_SOURCE_HASH=${PO18_SOURCE_HASH} \
    PO18_BUILD_DIRTY=${PO18_BUILD_DIRTY}
LABEL org.opencontainers.image.version="${PO18_APP_VERSION}" \
      org.opencontainers.image.created="${PO18_BUILD_DATE}" \
      org.opencontainers.image.revision="${PO18_BUILD_REVISION}" \
      org.opencontainers.image.ref.name="${PO18_IMMUTABLE_IMAGE_TAG}" \
      org.opencontainers.image.source-hash="${PO18_SOURCE_HASH}"
WORKDIR /app
COPY --from=root-deps /app/node_modules ./node_modules
COPY package*.json ./
COPY --from=build-info /build-info/.po18-build.json ./.po18-build.json
COPY cirno-src/reader-server.js ./cirno-src/reader-server.js
COPY --from=reader-build /build/cirno-src/dist-reader ./cirno-src/dist-reader
COPY docker/status-check.js docker/structured-log.js ./docker/
EXPOSE 3200
CMD ["node", "cirno-src/reader-server.js"]

FROM ${NODE_ALPINE_IMAGE} AS app
ARG PO18_IMAGE_TAG
ARG PO18_IMMUTABLE_IMAGE_TAG
ARG PO18_APP_VERSION
ARG PO18_BUILD_DATE
ARG PO18_BUILD_REVISION
ARG PO18_SOURCE_HASH
ARG PO18_BUILD_DIRTY
ENV NODE_ENV=production \
    PO18_IMAGE_TAG=${PO18_IMAGE_TAG} \
    PO18_IMMUTABLE_IMAGE_TAG=${PO18_IMMUTABLE_IMAGE_TAG} \
    PO18_APP_VERSION=${PO18_APP_VERSION} \
    PO18_BUILD_DATE=${PO18_BUILD_DATE} \
    PO18_BUILD_REVISION=${PO18_BUILD_REVISION} \
    PO18_SOURCE_HASH=${PO18_SOURCE_HASH} \
    PO18_BUILD_DIRTY=${PO18_BUILD_DIRTY}
LABEL org.opencontainers.image.version="${PO18_APP_VERSION}" \
      org.opencontainers.image.created="${PO18_BUILD_DATE}" \
      org.opencontainers.image.revision="${PO18_BUILD_REVISION}" \
      org.opencontainers.image.ref.name="${PO18_IMMUTABLE_IMAGE_TAG}" \
      org.opencontainers.image.source-hash="${PO18_SOURCE_HASH}"
WORKDIR /app
RUN apk add --no-cache postgresql16-client font-wqy-zenhei
RUN mkdir -p /config /tmp/po18 && chown -R node:node /config /tmp/po18
COPY --from=root-deps /app/node_modules ./node_modules
COPY package*.json ./
COPY --from=build-info /build-info/.po18-build.json ./.po18-build.json
COPY pg-store.js server-pg.js ./
COPY services ./services
COPY assets ./assets
COPY ui ./ui
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
