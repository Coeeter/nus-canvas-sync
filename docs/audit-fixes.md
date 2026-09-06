# Audit remediation status

This records implementation status for [`AUDIT.md`](../AUDIT.md). The audit is
the evidence and failure analysis; this page records the resulting controls and
their boundary evidence. The follow-up fixes below are locally verified and
require a new deployment before they affect production.

| Audit area | Status | Implemented control | Verification |
| --- | --- | --- | --- |
| H1 source coverage | Fixed | Full-semester announcements, hydrated module children, recursive page discovery, referenced files, locked-content records, DOCX support, and explicit failures for malformed/unreadable required sources | Pinned Canvas CLI loopback E2E plus read-only collection of all five live courses |
| H2 missing/deletion lifecycle | Fixed | Two distinct successful absences before archive; partial failures retain state; restoration reuses the same Notion page | Multi-run transition E2E |
| H3 unstable identities/terminal choices | Fixed | Stable `actionKey` identity, collision checks on fresh and merged candidates, explicit legacy migrations, bundle member history, and sticky Done/Dropped/reopen behavior | Candidate, identity-migration, reconciliation, and transition tests |
| H4 Scheduled tasks omitted | Fixed | Scheduled work is tracked and view-bounded | Lifecycle and view tests |
| H5 candidate reduction | Fixed | Distinct stages survive; enrichment is limited to the same action; missing/conflicting dates enter Review | AI reduction and validation tests |
| H6 accepted review overwritten | Fixed | Source fingerprints persist accepted corrections and invalidate them when evidence changes | Transition E2E |
| H7 deterministic facts/date semantics | Fixed | Strict source dates, Singapore date-only handling, source locks, course delivery rules, and source-first course preparation | Rule and projector regressions plus live source rehearsal |
| H8 stale planner views/runway | Partially fixed | Rolling Urgent, Next & Active, and Review filters/sorts are verified; `Start By` uses cited inline briefs and linked documents | Local view API tests, read-only retrieval of all three live views, and inline-brief transition tests |
| H9 locking/health | Fixed | Process-scoped `flock`, fsync-backed state writes, failed run status, and freshness-aware healthcheck | SIGKILL/overlap tests and container checks |
| H10 Notion retry duplication | Fixed | Pre-write ownership checks, no blind POST retry, durable create intent, recovery query, refetch, and property/archive verification | Stateful local Notion HTTP recovery E2E |
| M1 split state | Fixed | One atomic per-course state owns records, candidates, lifecycle, mappings, and fingerprints | Crash/transition tests |
| M2 academic calendar | Fixed | Recess week is excluded and explicit source event dates win | Schedule regressions |
| M3 GitHub latest commit | Fixed | Explicit repository HEAD is collected instead of author-date sorting | Collector tests |
| M4 early failure visibility | Fixed | Fatal failures persist failed status, attempt a bounded alert, and exit nonzero | CLI/run tests |

The service verifies its three execution/review views. The assignments/projects
board layout remains human-maintained; changing dashboard/database layout needs
an explicit product decision.

Course-guidance updates remain an **unimplemented service requirement**, not an
approved manual-only responsibility. The planner contract still requires updates
when official preparation, class activity, or submission instructions change,
leading with Before class and During class, then submission method and deadline.
H8 remains partial until that requirement is implemented and verified. The
Notion Agent Instructions copy carries the same requirement.

## Follow-up verification — 6 September 2026

- Candidate validation now uses the same identity as reconciliation. Fresh
  candidates with colliding keys are rejected for extraction retry. A collision
  with retained or migrated candidates fails the course before Notion writes and
  preserves the previous state generation. Existing identities are unchanged.
- Runway reads assignment/quiz descriptions, cited page/announcement bodies,
  and extracted documents with source relationships. Unrelated bodies, titles,
  and HTML attributes do not supply brief content. Planning starts on the
  Singapore Start By date, and pinned planning is preserved.
- Regression evidence exercises extraction, candidate merging, the real sync
  orchestration, a stateful Notion HTTP boundary, and persisted course state.
  These checks do not establish the deployed image's behavior.

## First migration

The checked-in migration file contains exact page IDs observed read-only on
2026-09-06. `map` decisions preserve each row and user-authored fields while
changing its generated identity. `retire` is limited to obsolete duplicate,
attendance, cadence-only, or superseded bundle rows. `preserve` exempts important
future assessment rows whose current sources do not yet yield a stable canonical
identity. Retired pages are archived and remain recoverable in Notion history.

Before enabling unattended schedules, the first manual production run must show
five successful course outcomes, no pending-create journal, a successful default
healthcheck, and correct Review/Urgent/Next views.
