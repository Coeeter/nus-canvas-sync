FROM debian:bookworm-slim AS cli-artifacts

ARG CANVAS_VERSION=1.13.0
ARG CANVAS_SHA256=161c9e938c839cfcfdc967ed9d1a14e86e89f8bf4251808839a7c314f10b0b46
ARG CODEX_VERSION=0.156.0
ARG CODEX_SHA256=3d49d9af25a5168cfc51e50e520ab238b23083c259ae7c14f89b007cb2545c7b
ARG CODEX_HOST_SHA256=8383c79b0b6b4f77f01a1ca548fe1d550ad96a6e91b9fc1180bb69a449cae53b
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSLo /tmp/canvas.tar.gz "https://github.com/jjuanrivvera/canvas-cli/releases/download/v${CANVAS_VERSION}/canvas-cli_linux_x86_64.tar.gz" \
    && echo "${CANVAS_SHA256}  /tmp/canvas.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/canvas.tar.gz -C /tmp canvas \
    && mv /tmp/canvas /usr/local/bin/canvas \
    && curl -fsSLo /tmp/codex.tar.gz "https://github.com/openai/codex/releases/download/rust-v${CODEX_VERSION}/codex-x86_64-unknown-linux-musl.tar.gz" \
    && echo "${CODEX_SHA256}  /tmp/codex.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/codex.tar.gz -C /tmp \
    && mv /tmp/codex-x86_64-unknown-linux-musl /usr/local/bin/codex \
    && curl -fsSLo /tmp/codex-host.tar.gz "https://github.com/openai/codex/releases/download/rust-v${CODEX_VERSION}/codex-code-mode-host-x86_64-unknown-linux-musl.tar.gz" \
    && echo "${CODEX_HOST_SHA256}  /tmp/codex-host.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/codex-host.tar.gz -C /tmp \
    && mv /tmp/codex-code-mode-host-x86_64-unknown-linux-musl /usr/local/bin/codex-code-mode-host \
    && chmod 0755 /usr/local/bin/canvas /usr/local/bin/codex /usr/local/bin/codex-code-mode-host

FROM oven/bun:1.4.0-debian

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates poppler-utils sqlite3 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 nus-sync \
    && useradd --uid 10001 --gid 10001 --create-home --home-dir /home/nus-sync nus-sync

COPY --from=cli-artifacts /usr/local/bin/codex /usr/local/bin/codex
COPY --from=cli-artifacts /usr/local/bin/codex-code-mode-host /usr/local/bin/codex-code-mode-host
COPY --from=cli-artifacts /usr/local/bin/canvas /usr/local/bin/canvas

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY --chown=nus-sync:nus-sync . .

RUN mkdir -p /data /codex-home \
    && chown -R nus-sync:nus-sync /app /data /codex-home

ENV DATA_DIR=/data \
    CODEX_HOME=/codex-home \
    HOME=/home/nus-sync \
    TZ=Asia/Singapore

USER nus-sync
VOLUME ["/data", "/codex-home"]
CMD ["sleep", "infinity"]
HEALTHCHECK --interval=1m --timeout=10s --start-period=10s --retries=3 CMD ["bun", "run", "healthcheck"]
