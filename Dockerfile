# ── Stage 1: build ──
FROM node:20-slim AS builder

RUN npm i -g pnpm@9.15.9

WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig*.json ./
COPY scripts/ scripts/
COPY packages/ packages/

RUN pnpm install --frozen-lockfile

ARG VITE_AI_ENABLED=false
ENV VITE_AI_ENABLED=${VITE_AI_ENABLED}
RUN pnpm build

# ── Stage 2: runtime ──
FROM node:20-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends libreoffice-core libreoffice-writer libreoffice-impress && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy built output + production deps
COPY --from=builder /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=builder /app/node_modules/ node_modules/
COPY --from=builder /app/packages/ packages/

ENV NODE_ENV=production
ENV AI_ENABLED=false
ENV HOST=0.0.0.0

# FORMAT is set per-service: "docx" or "pptx"
ENV FORMAT=docx

EXPOSE 10000

CMD node packages/jto/dist/cli.js ${FORMAT} dev --host 0.0.0.0 --port 10000
