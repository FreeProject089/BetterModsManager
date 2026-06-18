# ── Build the React dashboard ───────────────────────────────────────────────
FROM node:24-alpine AS web
WORKDIR /web
COPY web/package.json ./
RUN npm install
COPY web/ .
RUN npm run build

# ── Build the Axum server ───────────────────────────────────────────────────
FROM rust:1.93-slim AS server
WORKDIR /app
COPY server/Cargo.toml server/Cargo.lock ./
COPY server/migrations ./migrations
COPY server/src ./src
RUN cargo build --release

# ── Runtime ─────────────────────────────────────────────────────────────────
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=server /app/target/release/bmm-telemetry-server /usr/local/bin/bmm-telemetry-server
COPY --from=web /web/dist ./public
ENV STATIC_DIR=/app/public
EXPOSE 8900
CMD ["bmm-telemetry-server"]
