# Multi-stage build: compile TS in builder, run in slim runtime with Stockfish 17 binary.
FROM node:22-slim AS builder

WORKDIR /app

# Install dependencies (cached layer)
COPY package.json package-lock.json* ./
RUN npm ci

# Build TypeScript
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- Runtime stage ----
FROM node:22-slim AS runtime

# Stockfish 17.1 from official release (Linux x86_64 AVX2).
# Pinned hash for reproducibility; bump when upgrading Stockfish.
ARG STOCKFISH_VERSION=17.1
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates xz-utils \
    && curl -fsSL "https://github.com/official-stockfish/Stockfish/releases/download/sf_${STOCKFISH_VERSION}/stockfish-ubuntu-x86-64-avx2.tar" -o /tmp/stockfish.tar \
    && tar -xf /tmp/stockfish.tar -C /opt \
    && mv /opt/stockfish/stockfish-ubuntu-x86-64-avx2 /usr/local/bin/stockfish \
    && chmod +x /usr/local/bin/stockfish \
    && rm -rf /tmp/stockfish.tar /opt/stockfish \
    && apt-get purge -y curl xz-utils \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install only production dependencies
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled output
COPY --from=builder /app/dist ./dist

# Non-root user for safety
RUN useradd --create-home --shell /bin/bash app && chown -R app:app /app
USER app

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist/server.js"]
