# Durable decisions

This log records current decisions and their rationale. It excludes daily sync outcomes and other facts that should be refreshed from source data.

## 2026-08-15 — Deterministic collection, agent interpretation

`sync.sh` captures all declared source categories and emits explicit error files. Agents interpret prose and reconcile Notion only after verifying the manifest, so unsupported endpoints cannot silently erase work.

## 2026-08-21 — One action per piece of work

Attendance is not a todo. Distinct assessed work performed during class has one canonical `During class` action; a duplicate upload or submission action exists only for an explicit out-of-class step.

## 2026-08-27 — Long-horizon assignment runway

Urgent remains a three-day queue. `Start By` and the `Assignments & projects` board expose substantial individual, group, and multi-stage work early without flooding the immediate queue.

## 2026-08-27 — GitHub is the CS2030S exercise boundary

A staff skeleton proves release, while the authenticated student's repository and exact latest `Submit` commit prove progress and completion. Canvas placeholders do not override that workflow.

## 2026-08-27 — Availability gates Readiness

A future `Available From` value prevents the source action from becoming `Ready`. Legitimate advance preparation is represented separately, preventing a teaching-week label or nearby deadline from advertising unavailable work as actionable.

## 2026-08-27 — Repository and Notion are maintained copies

Repository files make the workflow portable for local agents and version control. The Notion Agent Instructions page remains complete for agents with only Notion access. Durable rule changes update both copies in the same task; substantive conflicts pause planner writes until resolved.

## 2026-09-01 — Dependency metadata must be revalidated

Each sync verifies every `Waiting on prerequisite` record against the current state of its named immediate prerequisite and release evidence. A completed prerequisite clears the dependency and triggers a Readiness recomputation; dependency metadata never changes user-owned `Status`.

## 2026-09-03 — Lecture tracking follows course delivery mode

Released GEA1000 and GESS1001 e-lectures are actionable coursework and contiguous unwatched weeks may be bundled. IS1128, CS2030S, and MA1301 lectures are physical calendar events rather than todos; explicit source-assigned preparation for those physical classes remains actionable.

## 2026-09-04 — Deterministic service replaces broad agent reconciliation

The Bun service is the only automated Canvas/GitHub-to-Notion reconciler. It
diffs per-course successful baselines, invokes isolated Terra Medium only for
changed prose, validates candidate provenance, and keeps lifecycle decisions in
code. ChatGPT and Claude remain useful for manual todos and human Review but do
not run broad automated interpretation. Real failures retain the affected
baseline, update sync health, and send an idempotent Resend alert.

## 2026-09-19 — Durable reconciliation state and review acceptance

Canonical assignment/quiz identities and source-anchored derived stage keys are
persisted with evidence aliases. Review acceptance is stored against a stable
evidence revision of durable facts/issues and corrected fields are applied
before lifecycle projection; added evidence aliases do not reopen an accepted
review, while changed disputed facts do. The existing data volume also stores
source proposals and last verified writes so reconciliation uses three-way
ownership, distinguishes unknown from explicit removal, preserves and reviews
preexisting correction dates during bootstrap, and rebases immediately before
Notion patches. Terminal races fail closed while already-terminal rows may
migrate safe metadata. Bundle terminal membership is carried into later
membership changes. The migration command is dry-run only until the repaired
planner has been independently reviewed.

The follow-up review also requires terminal lifecycle precedence over new date
conflicts, structured AI issue/date evidence with an explicit unknown versus
authoritative-null distinction, and a raw source-proposal field separate from
user corrections and machine-write receipts. Accepted corrections therefore
remain stable through repeated unchanged runs without rewriting source
provenance.

Review issue fingerprints treat affected fields and disputed values as semantic
sets without source provenance. Corroborating evidence and source ordering do
not reopen an unchanged issue; a genuinely different field or value does.
Ambiguous active lecture bundle overlaps remain untouched but fail the affected
course before writes or baseline advancement so newly uncovered work is
explicit.

Machine-owned date fields accept only calendar-valid ISO date-only values or
timestamps with an explicit timezone. Incomplete source phrases remain null /
unknown with raw structured review evidence; they are never coerced into a
year, time, or Notion date. Malformed legacy cached dates migrate
conservatively without resetting reconciliation state or history.
