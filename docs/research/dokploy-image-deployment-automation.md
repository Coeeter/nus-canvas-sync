# Automating Docker-image deployments in Dokploy

Research date: 2026-09-08

## Recommendation

For this repository, extend the existing `container.yml` workflow so its final job triggers Dokploy **after** the image push succeeds. This is the deployment model Dokploy itself recommends for externally built images: build and publish in CI, configure the application with Docker as its source, and call `POST /api/application.deploy` from CI for registries other than Docker Hub ([Dokploy: Going Production](https://docs.dokploy.com/docs/core/applications/going-production), [Dokploy Application API](https://docs.dokploy.com/docs/api/application)).

The repository already publishes both `latest` and `sha-<commit>` to GHCR. The lowest-friction version is therefore:

1. Leave the Dokploy application configured as `ghcr.io/coeeter/nus-canvas-sync:latest` once.
2. After `docker/build-push-action` completes, call `POST /api/application.deploy` with the application ID and an `x-api-key` stored as a GitHub environment secret.
3. Give the deployment job a `production` environment and a single concurrency group, and verify the resulting Dokploy deployment rather than treating an HTTP 2xx alone as proof of rollout.

This eliminates manual tag edits. Dokploy will redeploy the stable `latest` pointer, while the separately published `sha-*` tag preserves a human-readable record of the exact build for rollback and diagnosis. Dokploy's guide explicitly demonstrates `:latest` for this workflow and says that an image-registry-triggered deployment only fires when the pushed tag matches the tag configured in Dokploy ([Dokploy: Going Production](https://docs.dokploy.com/docs/core/applications/going-production)).

If reproducibility is more important than simplicity, use the stronger variant: take the `digest` output from the build step, call `application.saveDockerProvider` with `ghcr.io/coeeter/nus-canvas-sync@sha256:...`, then call `application.deploy`. Dokploy documents both operations, and Docker documents that digests are immutable whereas tags can be retargeted ([Dokploy Application API](https://docs.dokploy.com/docs/api/application), [Docker: validating image inputs](https://docs.docker.com/build/policies/validate-images/), [docker/build-push-action outputs](https://github.com/docker/build-push-action#outputs)). This also removes manual image changes, but adds a state-changing API call and a second failure point; it should only be adopted after an end-to-end trial confirms that the installed Dokploy version accepts digest references in `dockerImage`.

## Why CI-to-Dokploy is preferable here

- It is Dokploy's documented solution for an external registry and avoids building on the production host ([Dokploy: Going Production](https://docs.dokploy.com/docs/core/applications/going-production)).
- Deployment happens only after tests and image publication succeed, so there is no race where Dokploy tries to pull an image that is still being pushed.
- The API is authenticated with `x-api-key`; the generic per-application deploy URL instead carries its refresh token in the URL. Dokploy's API documentation describes access-token authentication and supports expirations for tokens used by scripts or CI ([Dokploy API](https://docs.dokploy.com/docs/api), [Dokploy CLI authentication](https://docs.dokploy.com/docs/cli/authentication)).
- GitHub environments can restrict which branches deploy and withhold production secrets until protection rules pass; concurrency can ensure only one production deployment runs at once ([GitHub: deploying with Actions](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments)).
- The official Dokploy CLI is a valid wrapper (`dokploy application deploy --applicationId ...`), but the direct API is smaller for one operation and is the exact mechanism shown in Dokploy's production guide ([Dokploy CLI](https://github.com/Dokploy/cli), [Dokploy: Going Production](https://docs.dokploy.com/docs/core/applications/going-production)).

## Cloudflare rate limiting

Changing from a registry webhook to a GitHub Actions API call does **not** inherently bypass Cloudflare: both are HTTP requests reaching the public Dokploy hostname. It does reduce the event stream to one deliberate request after a successful build and makes retries and failure reporting part of the workflow.

The narrowest fix is a Cloudflare custom `Skip` rule for only the Dokploy deployment API path and only a strongly identified caller, skipping only the `http_ratelimit` phase. Cloudflare documents that custom rules can selectively skip rate-limiting rules and recommends custom rules over broad IP Access `Allow` rules; a broad Allow bypasses custom rules, rate limiting, and managed WAF rules ([Cloudflare skip options](https://developers.cloudflare.com/waf/custom-rules/skip/options/), [Cloudflare IP Access rules](https://developers.cloudflare.com/waf/tools/ip-access-rules/)). Keep Dokploy's API-key authentication active even when Cloudflare skips rate limiting.

Standard GitHub-hosted runner IP ranges are a poor allowlist: GitHub explicitly says they are numerous, change weekly, and recommends larger runners with static ranges or self-hosted runners instead ([GitHub-hosted runners reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)). Practical options, in descending order of simplicity, are:

1. Exempt only the authenticated Dokploy API path from the problematic Cloudflare rate-limit rule. Do not exempt the whole host or all WAF phases.
2. Use a self-hosted runner on the Dokploy network and call a private/unproxied Dokploy address. Self-hosted runners initiate outbound HTTPS to GitHub to receive jobs, so Dokploy need not expose an extra inbound deployment webhook ([GitHub self-hosted runners](https://docs.github.com/en/actions/reference/runners/self-hosted-runners)). Restrict this runner to a private repository; GitHub warns that public-repository forks can execute dangerous code on self-hosted runners ([GitHub: adding self-hosted runners](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners)).
3. Connect a GitHub-hosted runner to the private network through an OIDC-authenticated API gateway or a WireGuard overlay, both documented GitHub patterns ([GitHub: private networking](https://docs.github.com/en/actions/concepts/runners/private-networking)). This is robust but operationally heavier than this service warrants.
4. If no CI-to-Dokploy network path can be made reliable, run a scheduled reconciler on the Dokploy host: query GHCR for the expected tag/digest and invoke the local Dokploy API only when it changes. Dokploy supports cron schedules executing shell commands on the Dokploy server ([Dokploy Schedule API](https://docs.dokploy.com/docs/api/schedule)). This is pull-based and avoids inbound deployment traffic, but requires durable state, authentication to GHCR, idempotency, and monitoring; it is custom machinery rather than Dokploy's primary recommendation.

Retries should be bounded and apply only to transient failures (timeouts, 429, and 5xx), with exponential backoff. Do not blindly retry 401/403 or invalid requests. A failed trigger must fail the GitHub deployment job visibly.

## Registry polling and Watchtower

Watchtower polls a registry on a configurable interval (24 hours by default) and updates containers through the Docker daemon; it requires access to the Docker socket and registry credentials for private images ([Watchtower arguments](https://containrrr.dev/watchtower/arguments/), [Watchtower usage](https://containrrr.dev/watchtower/usage-overview/)). It is a poor fit for Dokploy-managed applications:

- it creates a second deployment controller alongside Dokploy, so Dokploy's deployment records, health checks, rollback behavior, and actual container state can diverge;
- mounting `/var/run/docker.sock` gives it high control over the host;
- polling adds rollout latency and registry traffic;
- it operates on running containers, while Dokploy applications use Docker/Swarm deployment orchestration; updating outside Dokploy can be undone by the next Dokploy reconciliation.

If pull-based operation is necessary, a small host-side reconciler that ultimately calls Dokploy's own API is safer architecturally than Watchtower because Dokploy remains the only deployment controller.

## `latest`, SHA tags, and digests

| Strategy | Automation | Reproducibility | Rollback/audit | Suggested use |
|---|---|---|---|---|
| Fixed `latest` in Dokploy + API deploy | One deploy call; no UI updates | Mutable pointer | Keep the parallel `sha-*` tag and record the build digest | Best simple default |
| Update Dokploy to `sha-<commit>` + deploy | Two API calls | Tag can still be mutable unless registry enforces immutability | Clear correlation to Git commit | Good compromise after API validation |
| Update Dokploy to `image@sha256:...` + deploy | Two API calls | Content-addressed and immutable | Exact artifact identity | Strongest production model |
| Registry webhook | Automatic when supported | Depends on configured tag | Event delivery is external | Fine for Docker Hub if Cloudflare is reliable |
| Polling/Watchtower | Automatic but delayed | Usually follows a mutable tag | Weak unless separately recorded | Last resort |

Docker Hub can enforce immutable tags, preventing a tag from being overwritten; Docker also states that digest references are intrinsically immutable ([Docker Hub immutable tags](https://docs.docker.com/docker-hub/repos/manage/hub-images/immutable-tags/), [Docker image digests](https://docs.docker.com/dhi/explore/security-concepts/digests/)). GHCR plus a digest captured from the build is therefore the clearest artifact identity without relying on tag-policy support.

## Security and reliability checklist

- Store `DOKPLOY_URL`, `DOKPLOY_APPLICATION_ID`, and especially `DOKPLOY_API_KEY` in a GitHub `production` environment; use an expiring, least-privilege Dokploy token where supported.
- Pin third-party Actions to commit SHAs. GitHub's official image-publishing example does this and grants only `contents: read` and `packages: write` for publication ([GitHub: publishing Docker images](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images)).
- Trigger only from trusted `main` workflow code, never from pull-request code with production secrets.
- Serialize production deploys. The current workflow cancels older builds in the same ref; add deployment-level concurrency so an older successful build cannot finish deploying after a newer one.
- Capture the image digest and Git commit in the Dokploy deployment title/description; `application.deploy` supports both fields ([Dokploy Application API](https://docs.dokploy.com/docs/api/application)).
- Configure a real application health check and Dokploy rollback behavior. Dokploy explicitly couples production deployment guidance with health checks and rollbacks ([Dokploy: Going Production](https://docs.dokploy.com/docs/core/applications/going-production)).
- After triggering, poll Dokploy deployment state or verify the service's health/version endpoint. CI success is not proof that the new image became healthy.

## Bottom line

Use the already-published `latest` tag as a stable channel and have GitHub Actions call Dokploy's authenticated deploy API after the push. Fix Cloudflare with a path-scoped rate-limit exception, or move only the deployment call onto a private runner/network path if Cloudflare remains unreliable. Keep SHA tags and record the digest for rollback. Avoid Watchtower because it bypasses Dokploy's deployment control plane. Move to digest-pinned `saveDockerProvider` + `deploy` later if an end-to-end test confirms digest references work cleanly with the installed Dokploy release.
