# ── Stage 1: build ──
FROM node:22-trixie-slim AS builder

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
FROM node:22-trixie-slim

# Debian trixie, for LibreOffice 25.2: bookworm is frozen at LibreOffice 7.4,
# which cannot parse a TOC field nested in a `w:sdt` and prints the field
# instruction into the document instead. Every hosted PDF with a table of
# contents showed it. Pin the base suite explicitly rather than tracking
# `node:22-slim`, so the LibreOffice version cannot move under us when Docker
# retags the default.
#
# LibreOffice + metric-compatible fonts. `--no-install-recommends` suppresses
# libreoffice-common's `Recommends: fonts-liberation2 | ttf-mscorefonts-installer`,
# which is why the image otherwise ships only DejaVu + OpenSymbol and every
# SAFE_FONT renders with the wrong advance widths.
#   fonts-liberation2        -> Arial / Times New Roman / Courier New (metric-compatible)
#   fonts-crosextra-carlito  -> Calibri (metric-compatible)
#   fonts-crosextra-caladea  -> Cambria (metric-compatible)
#   fonts-dejavu-core        -> the sans/serif/mono fallbacks local.conf points at
# fonts-dejavu-core must be listed EXPLICITLY: fontconfig-config declares
# `Depends: fonts-dejavu-core | ttf-bitstream-vera | fonts-liberation |
# fonts-liberation2 | ...`, so asking for fonts-liberation2 satisfies that
# alternative and apt silently drops DejaVu — which would leave every
# proportional fallback below resolving to Liberation Mono. Use the -core
# package, not the `fonts-dejavu` metapackage (that drags in +7 MB of extras).
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      libreoffice-core libreoffice-writer libreoffice-impress \
      fonts-liberation2 fonts-crosextra-carlito fonts-crosextra-caladea \
      fonts-dejavu-core && \
    rm -rf /var/lib/apt/lists/*

# Aliases for the SAFE_FONTS that Debian's own 30-metric-aliases.conf does not
# cover (no free metric clone exists). Additive: the per-conversion config
# written by FontconfigStager <include>s /etc/fonts/fonts.conf, which pulls
# 51-local.conf -> this file, so staged fonts still win.
COPY docker/fontconfig-local.conf /etc/fonts/local.conf

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
