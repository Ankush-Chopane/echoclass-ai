# syntax=docker/dockerfile:1
# Builds the React classroom app and serves it from the Express backend (one container, one port).
# NOTE: not built in the authoring sandbox (no Docker daemon) - see README "Verification status".

FROM node:22-bookworm-slim AS build
# Build tools are only needed if better-sqlite3 has no prebuilt binary for the platform.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/
COPY apps/classroom-web/package.json apps/classroom-web/
COPY apps/public-web/package.json apps/public-web/
COPY packages/shared/package.json packages/shared/
RUN npm ci
COPY packages ./packages
COPY apps/backend ./apps/backend
COPY apps/classroom-web ./apps/classroom-web
# Download the MediaPipe hand model (skipped quietly if the network is unavailable; the app falls back to the CDN at runtime).
RUN node apps/backend/scripts/fetch-model.js || true
RUN npm run build:classroom
# Keep only runtime dependencies of the backend (+ shared package)
RUN npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 DATABASE_PATH=/data/echoclass.db
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/backend ./apps/backend
COPY --from=build /app/apps/classroom-web/dist ./apps/classroom-web/dist
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/backend/src/server.js"]
