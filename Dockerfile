# Multi-stage build: compile TypeScript, then ship a small runtime image.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci || npm install

FROM deps AS build
WORKDIR /app
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app

# Run as non-root.
RUN addgroup -S app && adduser -S app -G app

COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
COPY --from=build /app/dist ./dist

USER app

# These can all be overridden via env.
ENV NODE_ENV=production \
    BIND_HOST=0.0.0.0 \
    PORT=3000 \
    LOG_LEVEL=info

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" || exit 1

CMD ["node", "dist/cli.js", "http"]
