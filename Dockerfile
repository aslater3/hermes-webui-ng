FROM node:22-bookworm AS build
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

FROM node:22-bookworm-slim AS runtime
# No apt layer or Git executable: optional read-only Git uses a confined JavaScript parser.
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787
COPY --from=build /app/build/server ./build/server
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
USER 10001:10001
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD ["node", "build/server/healthcheck.js"]
CMD ["node", "build/server/index.js"]
