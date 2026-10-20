# Debian 13 (trixie) base for both stages, digest-pinned. Moved from bookworm to take newer Debian packages for the
# Trivy OS findings in the Phase 10 baseline; the effect is confirmed only by the image-build run (docs/implementation-status.md).
FROM node:22-trixie@sha256:def2655045ff1ee91b28a48cb3ec84feafef6d128bda0ff6903e7847ed0b27b4 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY pwa/package.json pwa/package-lock.json ./pwa/
RUN npm ci --prefix pwa --ignore-scripts
COPY tsconfig.json tsconfig.web.json vite.config.mjs index.html ./
COPY client ./client
COPY server ./server
COPY src ./src
COPY tests ./tests
COPY public ./public
COPY pwa ./pwa
COPY scripts ./scripts
RUN npm run typecheck && npm run build
RUN npm prune --omit=dev --ignore-scripts

FROM node:22-trixie-slim@sha256:154ba2f4d6fec323d28e4f4bb86bba4677f1223391a1979cf521304e03a98dfa AS runtime
# No apt layer or Git executable: optional read-only Git uses a confined JavaScript parser.
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787
# The runtime only executes `node` (CMD and HEALTHCHECK). npm and corepack, and the packages they bundle,
# are removed so they are not shipped in the image; this also removes the bundled npm dependency tree.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
 && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
COPY --from=build /app/build/server ./build/server
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
USER 10001:10001
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD ["node", "build/server/healthcheck.js"]
CMD ["node", "build/server/index.js"]
