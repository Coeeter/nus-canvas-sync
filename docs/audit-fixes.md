# Audit remediation status

This records implementation status for [`AUDIT.md`](../AUDIT.md). The audit is
the evidence and failure analysis; this page records the resulting controls and
the boundary evidence used before deployment.

| Audit area | Status | Implemented control | Verification |
| --- | --- | --- | --- |
| H1 source coverage | Fixed | Full-semester announcements, hydrated module children, recursive page discovery, referenced files, locked-content records, DOCX support, and explicit failures for malformed/unreadable required sources | Pinned Canvas CLI loopback E2E plus read-only collection of all five live courses |
| H2 missing/deletion lifecycle | Fixed | Two distinct successful absences before archive; partial failures retain state; restoration reuses the same Notion page | Multi-run transition E2E |
| H3 unstable identities/terminal choices | Fixed | Stable `actionKey` identity, explicit legacy migrations, bundle member history, and sticky Done/Dropped/reopen behavior | Candidate, identity-migration, reconciliation, and transition tests |
| H4 Scheduled tasks omitted | Fixed | Scheduled work is tracked and view-bounded | Lifecycle and view tests |
| H5 candidate reduction | Fixed | Distinct stages survive; enrichment is limited to the same action; missing/conflicting dates enter Review | AI reduction and validation tests |
| H6 accepted review overwritten | Fixed | Source fingerprints persist accepted corrections and invalidate them when evidence changes | Transition E2E |
| H7 deterministic facts/date semantics | Fixed | Strict source dates, Singapore date-only handling, source locks, course delivery rules, and source-first course preparation | Rule and projector regressions plus live source rehearsal |
| H8 stale planner views/runway | Partially fixed | Rolling Urgent, Next & Active, and Review filters/sorts are verified; `Start By` is brief-aware | Local view API tests and read-only retrieval of all three live views |
| H9 locking/health | Fixed | Process-scoped `flock`, fsync-backed state writes, failed run status, and freshness-aware healthcheck | SIGKILL/overlap tests and container checks |
| H10 Notion retry duplication | Fixed | Pre-write ownership checks, no blind POST retry, durable create intent, recovery query, refetch, and property/archive verification | Stateful local Notion HTTP recovery E2E |
| M1 split state | Fixed | One atomic per-course state owns records, candidates, lifecycle, mappings, and fingerprints | Crash/transition tests |
| M2 academic calendar | Fixed | Recess week is excluded and explicit source event dates win | Schedule regressions |
| M3 GitHub latest commit | Fixed | Explicit repository HEAD is collected instead of author-date sorting | Collector tests |
| M4 early failure visibility | Fixed | Fatal failures persist failed status, attempt a bounded alert, and exit nonzero | CLI/run tests |

The assignments/projects board layout and course-guidance page content remain
human-maintained. The service verifies the three execution/review views it owns
and deliberately avoids changing dashboard/database layout without an explicit
product decision.

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
