# syntax=docker/dockerfile:1
# Builds the React classroom app and serves it from the Express backend (one container, one port).

FROM node:22-bookworm-slim AS build
# Build tools for native dependencies
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
COPY shared/package.json shared/
RUN npm ci
COPY shared ./shared
COPY backend ./backend
COPY frontend ./frontend
COPY database ./database
RUN node backend/scripts/fetch-model.js || true
RUN npm run build:classroom
RUN npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 DATABASE_PATH=/app/database/echoclass.db
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/shared ./shared
COPY --from=build /app/backend ./backend
COPY --from=build /app/database ./database
COPY --from=build /app/frontend/dist ./frontend/dist
RUN chown -R node:node /app
USER node
VOLUME /app/database
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "backend/src/server.js"]
