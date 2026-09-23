# Agent-driven course planner implementation plan

## Status

Approved by Nas on 2026-09-21. The replacement implementation and container
agent boundary are complete. Live Canvas/Notion validation, property removal,
and deployment remain separate cutover actions.

## Direction

Replace the existing reconciliation engine rather than modifying it. Preserve
valuable planner/course knowledge, current uncommitted documentation
corrections, deployment facts, and Git history. Remove the old source, tests,
prompts, schemas, and obsolete operational documents as the replacement is
built; do not retain an `old/` implementation tree.

The replacement has five deliberately small responsibilities:

1. Export current Canvas evidence into one latest-successful corpus.
2. Import the current Notion projection into one SQLite database.
3. Run one full Codex reconciliation over a transactionally isolated database
   copy.
4. Validate and promote that copy.
5. Publish and verify the SQLite-to-Notion diff.

Use straightforward Bun/TypeScript and Bun's SQLite support. Effect and the old
candidate/reducer/projector architecture are not carried forward.

## Preserved knowledge and surfaces

Before deleting implementation files, consolidate relevant material from:

- `docs/context.md`;
- `docs/agent-memory/planner-contract.md`;
- `docs/agent-memory/notion.md`;
- `docs/agent-memory/decisions.md`;
- `docs/deployment.md`;
- the current Notion Agent Instructions page;
- Nas's current uncommitted documentation changes.

Produce two authoritative documents:

- a shared planner guide suitable for the repository and Notion;
- local Codex sync instructions covering the execution environment.

Create one active-semester document/configuration. Remove stale dated examples
from global rules unless they still clarify an invariant.

Keep the existing Notion database, dashboard URLs, Dokploy scheduling model,
Resend failure channel, and runtime secret injection where still relevant.

## Minimal persistence model

Use one persistent `/data/planner.db` with four conceptual tables:

- `actions`: canonical current planner state and internal Notion page mapping;
- `notion_snapshot`: last imported/published visible Notion state;
- `runs`: inputs, stage/outcome, pending publication, checksums, and errors;
- `audit_log`: append-only before/after mutation records.

Keep the schema direct. Do not add candidate, alias, evidence-state, bundle,
course-rule, lifecycle, or review-fingerprint tables. Use normal SQLite
constraints for basic integrity and migrations only when the schema genuinely
changes.

Mutation auditing should be automatic where practical. Codex command events
and output belong in a bounded per-run transcript rather than duplicated as
database read logs.

## Run flow

### 1. Acquire and prepare

- Acquire a single-run lock.
- Create a run identifier and isolated working directory.
- Copy the canonical SQLite database into the workspace, or initialize it on
  the first run.
- Read and validate active-semester configuration.

### 2. Collect Canvas

- Use the real Canvas CLI to enumerate configured courses and export all useful
  current course data and downloadable documents.
- Extract readable text from supported documents inside the container.
- Build a complete temporary corpus first.
- Replace `/data/canvas/<term>/latest` atomically only after the complete
  collection succeeds.
- Retain the previous successful corpus on failure.
- Do not collect GitHub or infer completion from external systems.

Codex receives the real Canvas CLI and discovers commands through `--help`.
Repository instructions make Canvas strictly read-only and identify external
content as untrusted evidence. Do not build a custom Canvas command parser or
allowlist in v1.

### 3. Import Notion

- Read the complete existing action data source at run start.
- Decode only the final visible planner fields plus Notion page identity.
- Compare it with the stored projection and annotate new or changed Notion
  input prominently for Codex.
- Import manual rows rather than ignoring them.
- Retain pending publication and failure context for agent inspection.

Codex receives no Notion credentials, API knowledge, or direct Notion access.

### 4. Reconcile with one Codex session

- Run Codex once for the complete active semester, using a configurable model
  and reasoning effort with a sensible medium-cost default.
- Give it the shared planner guide, local sync instructions, semester document,
  latest corpus, run-local SQLite database, current/pending Notion context, and
  full local shell/file access required for the job.
- Require it to inspect all courses, perform SQLite CRUD, resolve clear
  duplicates, retain user content, create Review rows for genuine uncertainty,
  and perform a final cross-course coverage check.
- Capture the structured Codex event stream/transcript without secrets.
- If the process fails, discard the run copy and retry once with identical
  source inputs.

Avoid a large output schema. Successful completion means the run-local SQLite
database itself is the result.

### 5. Validate and promote

Run simple structural invariants outside the model:

- valid enum/date/percentage values;
- no duplicate Notion page mapping;
- no active action lacking an Action or Course;
- Source is absent or a valid URL;
- audit records exist for mutations;
- the database passes SQLite integrity checks;
- Codex recorded a completed all-course verification.

These checks validate storage and completion, not academic semantics. Codex
owns semantic reconciliation.

Promote the valid run result atomically to the canonical database. Keep a
pending publish record before contacting Notion.

### 6. Publish and verify Notion

- Compute a minimal visible-field diff from canonical SQLite to the imported
  Notion snapshot.
- Create, update, or archive pages idempotently.
- Retry transient Notion failures up to the specified bounds.
- Refetch the complete data source and verify the final visible projection.
- Clear pending publication and record the verified snapshot only after
  agreement.
- On partial failure, retain pending state for the next full agent run.
- Publish the shared planner guide to the Notion Agent Instructions page when
  its content changes, and verify it separately from planner actions.

The initial implementation run reuses the earlier manual cleanup, imports the
current live database, and lets the new agent reconcile it again against fresh
Canvas evidence. It performs the schema simplification and remaining cleanup as
part of the replacement cutover rather than a separate migration project.
Before any difficult-to-reverse property removal, export the complete existing
Notion data and inspect the generated migration diff. Production Notion schema
changes remain an explicit cutover action, not an implication of plan approval.

### 7. Report and schedule

- Update the separate sync-health block.
- Send one Resend email only after retry exhaustion for a technical failure.
- Remain silent for no-change success and product Review outcomes.
- Exit nonzero on technical failure so Dokploy records the failed execution.
- Preserve the existing four daily Asia/Singapore schedule.

## Repository replacement

Once the preserved knowledge has been consolidated, remove the current:

- AI candidate/schema/reducer code;
- deterministic course-specific projectors and lifecycle code;
- JSON baseline, interpretation, and reconciliation stores;
- old reconciliation/migration machinery;
- tests coupled to that architecture;
- stale prompts and generated schemas;
- obsolete diagnostic and rollout documentation that no longer describes the
  product.

Rebuild the README, Dockerfile, package scripts, runtime code, and validation
around the five-responsibility flow. Preserve unrelated user files and do not
delete untracked material merely because it is not part of the new application.

## Docker-first validation

All evidence of correctness comes from the built production-style image and
containers, not host-only commands.

### Image validation

- Build the actual image from a clean context.
- Run it as the intended non-root user.
- Verify pinned/runtime versions for Codex, Canvas CLI, SQLite support, document
  extraction tools, and the application.
- Confirm secrets are absent from image history, filesystem, logs, transcripts,
  and generated fixtures.

### Persistence and agent validation

In a container with disposable volumes:

- import a representative Notion export;
- collect or mount a representative Canvas corpus;
- run the real Codex reconciliation against a real SQLite file;
- stop/restart the container and verify persistence;
- inspect action rows, audit mutations, run state, and transcript;
- prove a user Notes correction changes the next result;
- prove a corrected Review reuses the same action instead of creating another;
- prove a duplicate is archived and a manual row is retained;
- prove Locked, Ready, Blocked, and Review coexist independently of Status;
- prove multiple deliverables from one specification retain separate weights
  and deadlines;
- prove a failed Codex run cannot corrupt the canonical database.

### Publication validation

- Exercise real Notion read and diff generation from the container.
- Run a no-write/dry-run publication and inspect the exact proposed changes.
- Exercise retry/resume using the real publisher boundary with a controlled
  interrupted run.
- Apply the approved initial migration to the existing Notion database.
- Refetch and compare every visible field against SQLite.
- Run a second complete sync and prove it is idempotent: no duplicate rows and
  no unnecessary Notion writes.

### Canvas safety validation

- Verify Codex discovers commands through Canvas CLI help.
- Inspect the transcript and confirm only read commands were issued.
- Do not test Canvas mutation commands against the live account.

Supporting unit tests should cover only stable deterministic boundaries such as
SQLite constraints/migrations, Notion encoding/diffing, retry classification,
and audit triggers. They do not replace container end-to-end evidence.

## Sequencing

1. Consolidate shared and local documentation plus active-semester config.
2. Replace the repository implementation and container image.
3. Implement SQLite, Canvas export, and Notion import without publishing.
4. Implement and validate one-session Codex reconciliation.
5. Implement Notion diff, pending publication, retries, and verification.
6. Build and exercise the complete image with disposable persistent volumes.
7. Generate and inspect the live initial migration diff.
8. Obtain explicit authorization for difficult-to-reverse live Notion schema
   changes, then publish and verify the cutover.
9. Run a second production sync to prove idempotence before considering the
   replacement complete.

## Current state and blockers

- Product design and portable plan: approved.
- Replacement implementation: complete and validated in the production image.
- Real Codex/SQLite reconciliation: validated with a disposable fixture using
  `gpt-5.6-luna`.
- Live Canvas collection and live Notion schema dry-run: require runtime
  credentials in the deployment environment.
- Live Notion schema mutation/publication: intentionally not performed; it is a
  difficult-to-reverse cutover action requiring explicit authorization.
- Dokploy deployment and schedule enablement: not performed.
