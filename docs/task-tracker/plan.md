# Automated university task tracker implementation plan

Status: **Approved — Phases 1–4 complete, Phase 5 next**

Specification: [`spec.md`](spec.md)  
Product context: [`../context.md`](../context.md#automated-university-task-tracker--draft)

## Delivery strategy

Perform the already-authorized Notion cleanup and automation pause before code
execution. Then build the replacement from deterministic boundaries outward:
normalized evidence, task lifecycle, narrow reviewed AI interpretation, resilient
Notion orchestration, and finally the Docker/Dokploy handoff.

No phase deploys to production, pushes Git commits, deletes the old automation,
or modifies Canvas/GitHub. Each implementation phase ends in the listed local
commit after its validation passes. Approval of this plan authorizes those local
commits and the explicitly listed Notion cleanup/automation pause, but not push or
production deployment.

## Pre-execution operational gate — clean and freeze the old workflow

Requirements: MIG-001, MIG-002, MIG-003

Outcome: The current planner stops presenting known false/stale work and the old
broad automation can no longer corrupt it while the replacement is built.

Actions:

- Refetch the live Actions schema and targeted rows immediately before writes.
- Apply only the evidence-backed cleanup named by MIG-001, preserving every
  unrelated row and user-owned field.
- Move and rename the existing Needs review section to **Review first**, directly
  below sync health; configure it to show the fields required by NOT-005 and keep
  review records excluded from active views.
- Update the sync-health callout to state that the old automation is paused and
  the replacement is under construction.
- Verify each changed row and dashboard/view configuration.
- Pause `sync-nus-semester-1`; view it again to verify `PAUSED`. Do not delete it.

Validation tier: live targeted Notion and Codex-automation verification.

Evidence to capture:

- Before/after URLs and changed properties for every cleanup row.
- Fetched Review first, Urgent, and Next and active view configurations.
- Fetched dashboard ordering and health callout.
- Automation view showing `PAUSED` and its preserved prompt/schedule/model.

This gate has no code commit; its evidence is recorded in the plan execution
ledger when performed.

## Phase 1 — normalized collection and semantic diffs

Requirements: SRC-001, SRC-002, SRC-003, SRC-004, SRC-005, SRC-006, SRC-007,
SRC-008, DIF-001, DIF-002, DIF-005, DIF-006, OPS-001

Outcome: One supported Bun command captures secret-free normalized evidence for
all five courses, records explicit endpoint outcomes, downloads only relevant
documents, and emits stable per-course semantic diffs.

Touchpoints:

- `package.json`, `bun.lock`, `tsconfig.json`
- `src/config/`, `src/collector/`, `src/normalize/`, `src/diff/`, `src/state/`
- `config/courses.ts` and course capability/timetable configuration
- `schemas/` for persisted snapshot/run-manifest contracts
- `tests/fixtures/sources/`, `tests/collector/`, `tests/diff/`
- `sync.sh` as a compatibility wrapper around the supported Bun collector command
- `.gitignore`

Concrete changes:

- Add validated runtime configuration with secret-safe error messages.
- Wrap pinned Canvas CLI commands and GitHub's HTTPS API with bounded concurrency
  and normalized structured outcomes.
- Express required/optional/alternate endpoints per course instead of globally
  treating every 404 as failure.
- Canonicalize records, strip transport noise, hash task-relevant content, and
  retain source relationships/provenance.
- Select and extract only referenced/recognisable briefs, specs, and rubrics.
- Store timestamped snapshots, course baselines, and manifests atomically under
  a configurable data directory; add an exclusive run lock.
- Produce per-course added/changed/removed semantic diffs and fixture replay.

Validation tier: unit and fixture-boundary validation.

Commands:

- `bun run typecheck`
- `bun run test:collector`
- `bun run test:diff`
- `bun run fixture:replay -- tests/fixtures/sources/baseline`

Commit: `feat: add normalized course snapshot collection`

## Phase 2 — deterministic task lifecycle

Requirements: DIF-003, DIF-004, TSK-001, TSK-002, TSK-003, TSK-004, TSK-005,
TSK-006, TSK-007, TSK-008, TSK-009, TSK-010, TSK-011, TSK-012

Outcome: Pure code turns normalized facts and time into safe task projections,
including completion, release gates, physical-event exclusion, expiry, bundles,
sticky user choices, and review candidates.

Touchpoints:

- `src/domain/`, `src/rules/`, `src/projector/`
- `config/course-rules/`
- `tests/fixtures/incidents/`, `tests/rules/`, `tests/projector/`

Concrete changes:

- Define explicit fact, expected-item, event, preparation, task, bundle, review,
  user-override, and projection types.
- Implement the deterministic lifecycle and per-course successful-baseline
  transaction boundary.
- Encode source-authority rules and course-specific semantics from context.
- Keep forecasted cadence separate from observed assessments.
- Maintain many-to-one bundle membership locally while projecting one stable
  derived identity to Notion.
- Add regression fixtures for every incident in TSK-012 plus independent course
  failure and unchanged-source time projection.

Validation tier: exhaustive pure-domain unit and regression fixtures.

Commands:

- `bun run typecheck`
- `bun run test:rules`
- `bun run test:incidents`
- `bun run fixture:replay -- tests/fixtures/incidents`

Commit: `feat: add deterministic task lifecycle`

## Phase 3 — reviewed AI extraction and safe Notion projection

Requirements: AI-001, AI-002, AI-003, AI-004, AI-005, AI-006, AI-007, NOT-001,
NOT-002, NOT-003, NOT-004, NOT-005, NOT-006

Outcome: Changed prose can yield schema-valid, source-backed candidate facts;
deterministic validation either projects them safely or exposes them first in
Notion for Nas. Existing and chat-added user state is preserved.

Touchpoints:

- `src/ai/`, `prompts/`, `schemas/course-candidates.schema.json`
- `src/notion/`, `src/reconcile/`
- `tests/ai/`, `tests/notion/`, `tests/reconcile/`
- `tests/fixtures/codex/`, `tests/fixtures/notion/`

Concrete changes:

- Build one-course prompt inputs from changed records, referenced extracted
  documents, and that course's context section only.
- Invoke pinned Codex non-interactively with Terra Medium, an allowlisted secret-
  free environment, ephemeral isolated working directory, and output schema.
- Validate candidate provenance and fields before reduction; retry Codex once on
  failure.
- Implement an interface-backed Notion client that refetches before patching,
  updates only permitted fields, verifies writes, and remains idempotent.
- Preserve manual rows with no automated identity and every user-owned field.
- Implement review creation, acceptance revalidation, rejection, bundle
  projection, and active-view exclusion.
- Encode the desired Review first view configuration for live application during
  the pre-execution gate and verification thereafter.

Validation tier: contract tests with fake Codex/Notion boundaries plus fixture
integration; no paid/live model call required.

Commands:

- `bun run typecheck`
- `bun run test:ai`
- `bun run test:notion`
- `bun run test:reconcile`
- `bun run fixture:replay -- tests/fixtures/codex`

Commit: `feat: add reviewed course interpretation and Notion projection`

## Phase 4 — resilient orchestration and alerts

Requirements: DIF-003, DIF-004, DIF-005, NOT-007, ERR-001, ERR-002, ERR-003,
ERR-004, ERR-005, OPS-005, OPS-006

Outcome: A complete run safely advances successful courses, retains failed
courses, maintains the exact per-course dashboard health summary, and sends one
idempotent Resend email for every scheduled run with a real remaining failure.

Touchpoints:

- `src/run/`, `src/health/`, `src/alerts/`
- `tests/run/`, `tests/alerts/`, `tests/fixtures/failures/`
- `package.json`

Concrete changes:

- Compose collection, diff, time projection, optional interpretation,
  reconciliation, verification, baseline commit, health reporting, and exit code
  into one supported command.
- Implement bounded retry classification without retrying known unsupported 404s
  or validation/auth failures pointlessly.
- Commit successful courses independently and produce the exact success/failure
  dashboard wording requested by Nas.
- Send Resend text and HTML alerts with a stable per-run idempotency key and
  sanitized diagnostic links/details.
- Record alert failure without recursion and return a nonzero status for Dokploy.
- Prove the overlap lock prevents duplicate writes and email.

Validation tier: orchestration integration with fake external boundaries and
failure injection.

Commands:

- `bun run typecheck`
- `bun run test:run`
- `bun run test:alerts`
- `bun run fixture:replay -- tests/fixtures/failures`

Commit: `feat: add resilient sync orchestration and alerts`

## Phase 5 — Docker, Dokploy handoff, and durable policy reconciliation

Requirements: NOT-008, OPS-002, OPS-003, OPS-004, OPS-007, MIG-004, MIG-005

Outcome: A reproducible Linux amd64 image contains the application and pinned
collector/AI binaries; persistent state and authentication are external; all
operator and agent documentation agrees with the replacement workflow.

Touchpoints:

- `Dockerfile`, `.dockerignore`, `compose.yaml`
- `scripts/container-entrypoint.sh` or equivalent supported entrypoint
- `README.md`, `docs/deployment.md`
- `docs/agent-memory/planner-contract.md`
- `docs/agent-memory/sync-operations.md`
- `docs/agent-memory/notion.md`
- `docs/agent-memory/decisions.md`
- Notion Agent Instructions operational copy

Concrete changes:

- Build a simple pinned Bun image with verified Linux amd64 Canvas CLI and Codex
  CLI artifacts and only required document-extraction/runtime packages.
- Define persistent data and `CODEX_HOME` mounts, secret/config inputs, a
  non-privileged application user where compatible with mounted auth, and a
  no-cron container process suitable for Dokploy Compose/Application Jobs.
- Document one-time VPS Codex-auth initialization without copying auth into the
  image or repository.
- Document the exact Dokploy timezone and schedule: `0 7,12,17,22 * * *` in
  `Asia/Singapore`, invoking the repository-supported sync command.
- Document fresh-baseline dry run, live manual run, evidence checks, rollback,
  and the later separately authorized automation deletion.
- Reconcile the repository's old Notion-agent instructions with the new
  deterministic service and update the Notion Agent Instructions copy to
  equivalent behavior; verify both.

Validation tier: full local suite, image inspection, container boundary, and
documentation/config verification. No production deployment.

Commands:

- `bun run check`
- `docker build --platform linux/amd64 -t nus-canvas-sync:plan-verify .`
- `bun run test:container`
- `docker image inspect nus-canvas-sync:plan-verify`
- `docker run --rm nus-canvas-sync:plan-verify bun run healthcheck`
- `docker compose config`

Commit: `build: package task tracker for Dokploy`

## Final validation before handoff

- `bun run check`
- Run the complete incident fixture suite and confirm all TSK-012 cases.
- Build the Linux amd64 image from a clean checkout context.
- Scan image history/config and fixture manifests for secret-shaped values.
- Start the Compose service with fake/local boundaries and execute the same
  command Dokploy will schedule.
- Confirm a no-diff run invokes zero Codex calls.
- Confirm a failed IS1128 interpretation advances four course baselines, retains
  IS1128, writes `LAST SYNC FAILED`, and emits one idempotent fake Resend request.
- Confirm Notion manual-task fixtures are byte-for-byte unchanged in user-owned
  properties.
- Reconcile every specification ID against the evidence ledger below.

## Complete commit map

1. `feat: add normalized course snapshot collection`
2. `feat: add deterministic task lifecycle`
3. `feat: add reviewed course interpretation and Notion projection`
4. `feat: add resilient sync orchestration and alerts`
5. `build: package task tracker for Dokploy`

These are local commits only. Push and deployment require separate instructions.

## Execution ledger

No implementation has started. Evidence may be filled only during execution;
requirements, phases, validation boundaries, and commits are fixed after
approval unless the authority chain is amended and re-approved.

| Requirement | Evidence | Status |
| --- | --- | --- |
| SRC-001 | `src/collector/canvas.ts`, `src/collector/github.ts`, `src/collector/run.ts` collect all declared per-course endpoints, planner, and CS2030S personal/skeleton repos + commit histories | Done (code; not yet run against live Canvas) |
| SRC-002 | `src/normalize/types.ts` (`sourceId`), `src/normalize/hash.ts` (`contentHash` over canonicalized fields) | Done |
| SRC-003 | `src/config/env.ts` uses `Config.redacted` for `CANVAS_TOKEN`/`GH_TOKEN`; `src/collector/outcome.ts` `sanitize()` strips token-shaped strings before they reach the manifest | Done |
| SRC-004 | `src/collector/outcome.ts` `decodeEndpoint`/`decodeRequired` always return ok/CapabilityGapError/TransientFailureError/TaskAffectingFailureError; `tests/collector/outcome.test.ts` | Done |
| SRC-005 | `src/config/courses.ts` `COURSE_CAPABILITIES`/`isRequiredEndpoint`/`acceptedAlternates`; `tests/collector/outcome.test.ts` covers declared-gap vs undeclared-404 | Done (mechanism proven; no real gap declared yet — none confirmed against live Canvas) |
| SRC-006 | `src/collector/documents.ts` (`selectRelevantFiles`, `downloadAndExtract`), `normalizeDocument`; wired into `collectCourse` in `src/collector/run.ts`; `tests/collector/documents.test.ts` | Done |
| SRC-007 | No calendar/ICS integration added; `docs/context.md` timetable remains the only source | Done (by non-action) |
| SRC-008 | No write/mutating Canvas or GitHub CLI command anywhere in `src/collector/` | Done |
| DIF-001 | `src/state/snapshot-store.ts` (timestamped snapshot + `latest` symlink), `src/state/baseline-store.ts` (per-course baseline file) | Done |
| DIF-002 | `src/diff/compute.ts` `computeDiff` compares by id + content hash only; `tests/diff/compute.test.ts` proves reordering/unchanged records produce no diff | Done (diff production; AI consumption is Phase 3) |
| DIF-003 | `runSync` advances a baseline only after interpretation and verified Notion operations | Done |
| DIF-004 | Course pipeline failures are isolated; successful course baselines still advance | Done |
| DIF-005 | `src/state/lock.ts` `withRunLock` (exclusive `wx` create, scoped release), `src/state/atomic.ts` (`writeJsonAtomic`, tmp+rename) | Done |
| DIF-006 | `src/state/manifest.ts` (`RunManifest`, `summarizeResult`), written by `writeSnapshot`; no raw data or secret values included | Done |
| TSK-001 | `src/domain/task.ts`, `src/rules/lifecycle.ts` define the deterministic fact/projection boundary | Done |
| TSK-002 | `projectTask` requires observed, available, unfinished work; future release is Locked | Done |
| TSK-003 | Assessments without authoritative current action evidence remain Expected | Done |
| TSK-004 | Authoritative completion and exact CS2030S latest `Submit` signal are deterministic | Done |
| TSK-005 | User Done/Dropped choices are terminal and sticky | Done |
| TSK-006 | Physical events and physical-course lectures are inactive | Done |
| TSK-007 | Preparation expires after its event end | Done |
| TSK-008 | Optional material is inactive by default | Done |
| TSK-009 | `bundleContiguousLectures` emits one stable bundle retaining sorted member identities | Done |
| TSK-010 | Conflicting evidence projects to Review | Done |
| TSK-011 | Pure projection accepts the current instant and can rerun without source changes | Done |
| TSK-012 | `tests/rules/lifecycle.test.ts` and `tests/projector/bundle.test.ts` cover the reported incidents | Done |
| AI-001 | `src/ai/input.ts` builds one-course inputs from changed records, referenced documents, and supplied course context | Done |
| AI-002 | `CodexCliExecutor` pins `gpt-5.6-terra` and medium reasoning | Done |
| AI-003 | Codex runs ephemeral/read-only in a temporary directory with an allowlisted environment and ignored ambient rules/config | Done |
| AI-004 | JSON schema plus `validateCandidates` requires evidence and rejects unknown provenance | Done |
| AI-005 | `interpretCourse` performs exactly two attempts and cleans its temporary workspace | Done |
| AI-006 | `candidateToFact` sends ambiguous or low-confidence output through deterministic Review projection | Done |
| AI-007 | `resolveReviewedCandidate` preserves rejection and revalidates unsafe acceptance | Done |
| NOT-001 | `NotionClient` targets the configured existing data source; no database/frontend creation | Done |
| NOT-002 | Stable Canvas identity matching and logical-property comparison avoid duplicate/unchanged writes | Done |
| NOT-003 | Reconciliation updates only the live schema's agent-owned fields and verifies identity after every write | Done |
| NOT-004 | Rows without `Canvas Item ID` are manual and never receive an operation | Done |
| NOT-005 | Review-first dashboard order was applied in the completed cleanup gate | Done (live operation) |
| NOT-006 | Review projections set `Needs Review` and `Readiness = Review`; live views exclude them | Done |
| NOT-007 | `healthSummary` plus health-callout discovery/update reports every course and leads failures with `LAST SYNC FAILED` | Done |
| NOT-008 | Pending | Pending |
| ERR-001 | Transient collection retries once; Notion/Resend use bounded status-aware retries; Codex uses two attempts | Done |
| ERR-002 | Declared capability gaps remain non-alerting while failed collection/pipeline/health stages alert | Done |
| ERR-003 | Resend alert includes run time, courses/stages, prior baseline time, detail, and dashboard link | Done |
| ERR-004 | `ResendAlertClient` uses `nus-sync-<runId>` as the stable idempotency key | Done |
| ERR-005 | Alert failure is persisted in the manifest and returns an unsuccessful result without recursion | Done |
| OPS-001 | `package.json` scripts (`collect`, `typecheck`, `test`, `test:collector`, `test:diff`, `fixture:replay`, `check`); Bun + TypeScript 7 project under `src/` | Done |
| OPS-002 | Pending | Pending |
| OPS-003 | Pending | Pending |
| OPS-004 | Pending | Pending |
| OPS-005 | `bun run sync` is the one manual/scheduled command and owns an outer run lock | Done |
| OPS-006 | Sync emits one concise JSON outcome and suppresses raw source/model/Notion payloads | Done |
| OPS-007 | Pending | Pending |
| MIG-001 | Pending | Pending |
| MIG-002 | Pending | Pending |
| MIG-003 | Pending | Pending |
| MIG-004 | Pending | Pending |
| MIG-005 | Pending | Pending |

### Deviations

- Pre-execution Notion cleanup, Review-first dashboard update, and legacy
  automation pause were completed and verified before implementation.
- Implementation stack (not specified by the plan's touchpoints, decided with
  Nas during Phase 1): TypeScript 7 (`tsgo`), the `effect` library (services
  via `Effect.Service`, `Schema.TaggedError` failure taxonomy, `Effect.gen`)
  plus `@effect/platform`/`@effect/platform-bun` for subprocess execution and
  the filesystem, and Biome for lint/format instead of ESLint/Prettier. Later
  phases (Notion client, Codex invocation, orchestration, alerts) should
  follow the same conventions for consistency.

### Blockers

- None for Phase 1. The pre-execution Notion gate remains a prerequisite for
  any live production run, but is being handled outside this session.

### Next action

Continue with Phase 5 (container packaging, deployment documentation, and durable policy reconciliation).
