FROM golang:1.25.2-bookworm AS canvas-builder

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go install github.com/jjuanrivvera/canvas-cli/cmd/canvas@v1.13.0

FROM debian:bookworm-slim AS cli-artifacts

ARG CODEX_VERSION=0.150.1
ARG CODEX_SHA256=ab308870bc7fc048c23dc49d03f6b8af9ce7fc99b9da882d6688be7a90155c7a
ARG GH_VERSION=2.98.0
ARG GH_SHA256=3b8ac6b30336802fc1a858d7c084e11cdf24ac1a761ca90b68022d7d729208de
ARG DOPPLER_VERSION=3.76.1
ARG DOPPLER_SHA256=e35230bd21fdbd7e41ddcb24672ec61cecefdb22de244d0216ea6b59853f63f2

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSLo /tmp/codex.tar.gz "https://github.com/openai/codex/releases/download/rust-v${CODEX_VERSION}/codex-x86_64-unknown-linux-musl.tar.gz" \
    && echo "${CODEX_SHA256}  /tmp/codex.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/codex.tar.gz -C /tmp \
    && mv /tmp/codex-x86_64-unknown-linux-musl /usr/local/bin/codex \
    && curl -fsSLo /tmp/gh.tar.gz "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz" \
    && echo "${GH_SHA256}  /tmp/gh.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/gh.tar.gz -C /tmp \
    && mv "/tmp/gh_${GH_VERSION}_linux_amd64/bin/gh" /usr/local/bin/gh \
    && curl -fsSLo /tmp/doppler.tar.gz "https://github.com/DopplerHQ/cli/releases/download/${DOPPLER_VERSION}/doppler_${DOPPLER_VERSION}_linux_amd64.tar.gz" \
    && echo "${DOPPLER_SHA256}  /tmp/doppler.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/doppler.tar.gz -C /usr/local/bin doppler \
    && chmod 0755 /usr/local/bin/codex /usr/local/bin/gh /usr/local/bin/doppler

FROM oven/bun:1.4.0-debian

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates poppler-utils \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 nus-sync \
    && useradd --uid 10001 --gid 10001 --create-home --home-dir /home/nus-sync nus-sync

COPY --from=canvas-builder /go/bin/canvas /usr/local/bin/canvas
COPY --from=cli-artifacts /usr/local/bin/codex /usr/local/bin/codex
COPY --from=cli-artifacts /usr/local/bin/gh /usr/local/bin/gh
COPY --from=cli-artifacts /usr/local/bin/doppler /usr/local/bin/doppler

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY --chown=nus-sync:nus-sync . .

RUN mkdir -p /data /codex-home \
    && chown -R nus-sync:nus-sync /app /data /codex-home \
    && chmod 0755 /app/scripts/container-entrypoint.sh

ENV DATA_DIR=/data \
    CODEX_HOME=/codex-home \
    HOME=/home/nus-sync \
    TZ=Asia/Singapore

USER nus-sync
VOLUME ["/data", "/codex-home"]
ENTRYPOINT ["/app/scripts/container-entrypoint.sh"]
HEALTHCHECK --interval=1m --timeout=10s --start-period=10s --retries=3 CMD ["bun", "run", "healthcheck"]
