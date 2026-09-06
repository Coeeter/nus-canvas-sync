FROM debian:bookworm-slim AS cli-artifacts

ARG CANVAS_VERSION=1.13.0
ARG CANVAS_SHA256=161c9e938c839cfcfdc967ed9d1a14e86e89f8bf4251808839a7c314f10b0b46
ARG CODEX_VERSION=0.150.1
ARG CODEX_SHA256=ab308870bc7fc048c23dc49d03f6b8af9ce7fc99b9da882d6688be7a90155c7a
ARG GH_VERSION=2.98.0
ARG GH_SHA256=3b8ac6b30336802fc1a858d7c084e11cdf24ac1a761ca90b68022d7d729208de

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
    && curl -fsSLo /tmp/gh.tar.gz "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz" \
    && echo "${GH_SHA256}  /tmp/gh.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/gh.tar.gz -C /tmp \
    && mv "/tmp/gh_${GH_VERSION}_linux_amd64/bin/gh" /usr/local/bin/gh \
    && chmod 0755 /usr/local/bin/canvas /usr/local/bin/codex /usr/local/bin/gh

FROM oven/bun:1.4.0-debian

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates poppler-utils \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 nus-sync \
    && useradd --uid 10001 --gid 10001 --create-home --home-dir /home/nus-sync nus-sync

COPY --from=cli-artifacts /usr/local/bin/codex /usr/local/bin/codex
COPY --from=cli-artifacts /usr/local/bin/canvas /usr/local/bin/canvas
COPY --from=cli-artifacts /usr/local/bin/gh /usr/local/bin/gh

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY --chown=nus-sync:nus-sync . .

RUN mkdir -p /data /codex-home \
    && chown -R nus-sync:nus-sync /app /data /codex-home

ENV DATA_DIR=/data \
    CODEX_HOME=/codex-home \
    HOME=/home/nus-sync \
    TZ=Asia/Singapore

USER nus-sync
VOLUME ["/data", "/codex-home"]
CMD ["bun", "run", "sync"]
HEALTHCHECK --interval=1m --timeout=10s --start-period=10s --retries=3 CMD ["bun", "run", "healthcheck"]
