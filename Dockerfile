# syntax=docker/dockerfile:1
# AntiGravity — multiplayer Xiangqi (server + static client).
# Target platform is chosen at build time (e.g. `docker buildx build
# --platform linux/amd64 ...`), NOT hardcoded here, so the same file
# builds cleanly for any architecture.
#
# Base: node:22-alpine (Active LTS). Fewer known CVEs than the older
# node:20 line; rebuilds float to the latest patched 22.x automatically.

# ---------- Stage 1: production dependencies ----------
FROM node:22-alpine AS deps
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

# ---------- Stage 2: runtime ----------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8080

# Static frontend (served by the HTTP server on the same port)
COPY --chown=node:node index.html style.css ./
COPY --chown=node:node js ./js
COPY --chown=node:node assets ./assets

# Server application and production dependencies
COPY --chown=node:node server/src ./server/src
COPY --chown=node:node --from=deps /app/server/node_modules ./server/node_modules

USER node

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:8080/healthz || exit 1

CMD ["node", "server/src/index.js"]
