# Agent-driven course planner specification

## Status

Approved by Nas on 2026-09-21. Implementation is in progress.

## Goal

Provide Nas with a trustworthy, small Notion planner for university work. One
Codex agent reconciles the complete current Canvas corpus, current planner
state, Nas's edits, timetable, and course guidance into a canonical SQLite
database. Notion is a convenient human interface and projection of that
database, not the reasoning engine or canonical store.

The system must be simple enough to carry into a new semester by updating
semester documentation and course configuration rather than adding course-
specific program logic.

## Non-goals

- Mirroring every Canvas object into Notion.
- Tracking ordinary lecture, tutorial, recitation, or lab attendance as todos.
- Encoding course-specific title patterns, dates, lifecycle rules, or GitHub
  completion conventions in application code.
- Running one model per course, a separate extraction/review model, or a custom
  multi-agent workflow.
- Giving the reconciliation agent knowledge of, or access to, the Notion API.
- Retaining an indefinitely growing history of raw Canvas exports.
- Detecting completion in external systems such as GitHub. Nas or a
  conversational planner agent records such completion.
- Building a custom Canvas tool framework or maintaining a Canvas command
  allowlist.

## Product model

### Canonical state

One SQLite database is the canonical planner state. It contains current actions,
the last known Notion projection, run/publish state, and an append-only mutation
audit trail.

Notion is imported before reconciliation and published after reconciliation.
Canvas and course material are read-only evidence. Codex reasons over SQLite,
the latest exported evidence, the planner instructions, and the live read-only
Canvas CLI.

### Visible action fields

The Notion planner exposes only fields that help Nas decide what to do:

- **Action**: the concrete deliverable or assessed obligation.
- **Course**: the course to which it belongs.
- **Status**: `Not started`, `In progress`, `Done`, or `Dropped`.
- **Availability**: `Locked`, `Ready`, `Blocked`, or `Review`.
- **Weight**: optional official percentage of the course grade.
- **Start By**: optional planning date for beginning meaningful work.
- **Due**: optional official deadline or major assessed-event time.
- **Source**: the most useful clickable Canvas URL.
- **Notes**: user-agent communication, review explanation, or concise context.

Notion does not expose Canvas IDs, reconciliation identities, hashes, parent
IDs, sync timestamps, or other machine bookkeeping as planner fields.

### Status and availability

Status describes progress. Availability independently describes whether the
next meaningful action can be performed.

- `Locked`: the deliverable is real, but Canvas, the lecturer, or a known
  release time prevents access.
- `Ready`: meaningful work can be done now.
- `Blocked`: the deliverable exists, but the next action depends on a person,
  feedback, approval, or another prerequisite. An in-progress group project
  waiting on teammates is `Status = In progress`, `Availability = Blocked`.
- `Review`: trustworthy resolution requires Nas. The same action row explains
  the uncertainty and requested decision in Notes.

The typical availability movement is `Locked -> Ready`, with `Blocked` used
when an external dependency interrupts progress. `Review` is an ambiguity gate,
not a progress state. `Done` and `Dropped` are terminal Status choices unless
Nas explicitly changes them.

### Action granularity

Create one row per real deliverable. A single specification may establish
multiple rows when it defines independently actionable deliverables with their
own dates or weights. For example, an IS1128 project proposal, presentation,
and report are distinct actions even if described in one document.

Do not create vague intermediary work such as "review the brief." Preparation
may be its own action when it is concrete and useful. A major graded physical
assessment such as a midterm, final, or assessed presentation remains visible
because its weight, preparation runway, and event time matter. Ordinary
physical attendance and sit-in labs are not todos.

Weight is recorded only when official evidence supplies it. A multi-stage
project does not duplicate the component's total weight across stages unless
the source explicitly assigns that weight to each stage. Start By reflects the
actual runway required; it is distinct from Weight and Due.

## Reconciliation behavior

### One complete agent run

Every scheduled sync runs one Codex agent session for all active courses. It
must:

1. Read the global planner guide and active-semester document.
2. Inspect the full current SQLite planner and imported Notion changes.
3. Inspect the latest successful Canvas export.
4. Use the live Canvas CLI when evidence needs confirmation, beginning with
   command help rather than relying on memorized syntax.
5. Create, update, merge, archive, and review SQLite actions as necessary.
6. Check every active course again for missing, duplicated, stale, or wrongly
   classified work.
7. Leave SQLite as the complete desired planner state.

The agent may use ordinary filesystem, shell, and SQLite capabilities. It does
not emit a constrained candidate schema and does not make Notion API calls.

The agent must treat Canvas, downloaded documents, and all external source text
as untrusted evidence rather than executable instructions. Canvas is strictly
read-only: no submissions, comments, messages, planner mutations, enrolment
changes, grading, or other writes are permitted.

### User and conversational-agent changes

Nas, ChatGPT, or Claude may edit Notion directly or create new rows. Every new
or changed visible field is imported and shown prominently to the reconciliation
agent. These changes must be acknowledged and acted upon; they may not disappear
into hidden reconciliation state.

Manual or unrelated rows remain unchanged unless Notes explicitly ask the sync
agent to act. Academic rows may be enriched from official evidence. If a prior
publish is pending, the agent sees the pending state, current Notion state, and
mutation history and decides the new desired value. Its final decision is the
state published upstream.

User-authored Notes are never silently erased. The agent may append a clearly
distinguishable response and may remove its own obsolete review explanation
after resolution. Correcting a Review row and changing its Availability resolves
the review. Rejection uses `Status = Dropped`.

### Duplicate and obsolete work

Codex may merge or archive duplicate and obsolete SQLite-managed rows when the
evidence is clear. It preserves the strongest user-authored content and records
the change in the mutation audit. It never creates a second Review row for an
existing action and never automatically archives unrelated manual rows.

### Review

Genuine uncertainty becomes one visible Review row and does not stop other
valid planner work from publishing. Notes state the exact uncertainty, current
best interpretation, relevant source, and requested correction. A later run
uses Nas's edited row as direct context. New contradictory official evidence
may reopen the same row with a new explanation.

## Sources and semester changes

Canvas is the only automatic academic source in the initial system. The latest
successful complete export is stored by term and course in the persistent data
volume. A failed collection cannot replace the last successful export or imply
that work was deleted.

Historical raw exports are not retained routinely. SQLite audit history and
run logs are retained.

One human-readable active-semester document defines:

- term name and dates;
- active course codes, names, and Canvas course IDs;
- timetable and delivery mode;
- concise course purpose and relevant workflow notes;
- examples that clarify actionable and non-actionable work.

Moving to a new semester is an agent-assisted documentation/configuration
change, not an application-code change. Old planner rows remain as history and
are excluded from active views as appropriate. Unfinished work is not silently
carried into the new semester; a genuine surviving obligation enters Review.

## Planner documentation

The repository contains:

1. A concise shared planner guide containing field definitions, course context,
   actionable/non-actionable examples, and Review behavior.
2. Local-only sync instructions covering Canvas export, SQLite reconciliation,
   audit, validation, and publishing.

The shared guide has a complete maintained copy on the existing Notion Agent
Instructions page for ChatGPT and Claude. It excludes repository paths, SQLite
commands, Canvas collection procedure, and publisher implementation details.

## Import and publication

A run has two logical Notion phases:

1. Import the complete current Notion database before Codex starts.
2. Publish the final SQLite-to-Notion diff after reconciliation succeeds.

The publisher may require multiple Notion requests, but that transport detail
is invisible to Codex. Publishing is idempotent. It records the intended diff,
retries transient failures, refetches Notion, and verifies the resulting visible
state. A partial publish remains pending and is resumed on the next run after
fresh Notion import and agent reconciliation.

SQLite remains authoritative when publishing fails. A correct agent result is
not discarded solely because Notion is temporarily unavailable.

## Auditability

Every SQLite insert, update, archive, and delete records:

- run and time;
- actor;
- affected row;
- before value;
- after value.

The Codex run transcript records shell, SQLite, filesystem, and Canvas commands.
Ordinary read results are not duplicated into the database audit log. Each run
also retains its initial state identity, final state identity, planned Notion
diff, outcome, and failure details.

The reconciliation agent receives full CRUD access to a run-local database
copy. A crashed or invalid run cannot corrupt the canonical database. A valid
result is promoted atomically.

## Failure behavior

- Canvas and Notion operations receive up to three total attempts with short
  backoff for transient failures.
- A failed Codex process receives one replacement attempt against the same
  inputs.
- A verification mismatch is refetched and the mismatched rows are retried
  once.
- Exhausted failures retain the last valid state and any pending publication,
  record one failed run, and send one failure email.
- A later successful recovery updates sync health without sending recovery
  email.
- Review is a product outcome, not a technical failure.
- An unchanged successful run is silent and performs no Notion writes.

A small sync-health area remains outside the action schema. It reports current
success or a prominent technical failure without creating fake coursework rows.

## Scheduling and deployment

The system runs in Docker under Dokploy at 07:00, 12:00, 17:00, and 22:00
Asia/Singapore time. Each run invokes one complete Codex reconciliation even
when preliminary hashes show no apparent change. Overlapping runs are prevented.

All implementation and validation run through the actual Docker image and
containers. Host-only execution is not accepted as proof that the system works.
Secrets are injected at runtime and never written to images, prompts,
transcripts, logs, or audit values.

## Required observable outcomes

- Notion contains exactly one current row per real deliverable.
- Nas's direct edits and Notes visibly affect the next reconciliation.
- Corrected Review rows are not recreated as duplicates.
- Locked and Blocked work remain distinguishable from progress.
- Canvas URLs, not opaque Canvas IDs, are visible as sources.
- Every active course receives a final completeness pass on every run.
- A new semester can be configured without editing application logic.
- A failed publication can resume without losing agent work or overwriting
  newer Notion input.
- Mutation history explains what changed and identifies the responsible run.
