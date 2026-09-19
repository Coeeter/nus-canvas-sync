# Sync operations

## Collection and coverage

1. Run `bun run sync` for the complete deterministic workflow. Use `./sync.sh`
   only for source-only diagnostics.
2. Treat `latest/manifest.json` as the mandatory source manifest. Account for every expected course and top-level endpoint.
3. Inspect every `*.error.json`. A failed Canvas or GitHub endpoint is a coverage gap, never an empty result.
4. Read full announcement and page bodies, module content details, the course file index, and relevant briefs, specifications, rubrics, or official external course pages before interpreting work.
5. Use narrow, read-only live Canvas or GitHub calls only to retry a recorded failure, inspect an API gap, download a specifically relevant document, or resolve evidence ambiguity.

The collector gathers deterministic source data. The service sends only one
course's changed prose and referenced changed documents to isolated Terra Medium
extraction. Codex returns candidates and never writes Notion. Deterministic code
validates provenance, resolves safe lifecycle state, and sends uncertainty to
Review first.

## Reconciliation

- Do not run the retired broad all-course agent workflow. Scheduled and manual
  automated reconciliation uses the same container command and outer run lock.
- Runtime and fixture replay use the same deterministic course-planning boundary.
  Per-course reconciliation state under the existing data volume persists
  logical-task aliases, review resolutions, accepted field overrides, and the
  last values actually written and verified. Missing fields are unknown; an
  explicit source `null` is a removal proposal.
- A candidate may link to a canonical task only through a validated current
  inventory match or a source-anchored derived stage key. Shared announcements
  and generic title/stage similarity are insufficient evidence for merging.
- When a released lecture bundle's membership changes, reuse an active bundle
  whose members contain the new projection and update that page in place.
  Members from terminal bundles are excluded from later actionable bundles;
  migration reports overlapping terminal/active bundles for review before any
  archival proposal is applied.
- Match imported actions idempotently by `Canvas Course ID` + `Canvas Item Type` + `Canvas Item ID`.
- Preserve personal fields according to `planner-contract.md`.
- Treat source overlap as evidence only: durable stage keys resolve identity.
  Review fingerprints ignore added source aliases and mutable wording, while
  changed disputed facts reopen Review. Stale terminal transitions fail closed;
  already-terminal planned rows may receive safe identity/completion metadata.
- Terminal `Done`/`Dropped` status dominates a newly discovered source conflict:
  retain the conflicting date/history, but do not re-route the terminal row to
  Review.
- AI candidates must carry structured issue evidence and explicit date states;
  legacy nullable caches migrate null to unknown. Persist raw source proposals
  separately from user corrections and verified machine-write receipts so an
  accepted correction remains stable across unchanged restarts.
- Validate machine-owned candidate dates as calendar-valid ISO date-only values
  or timezone-bearing ISO timestamps. Incomplete/raw date phrases remain null
  or unknown with structured review evidence; malformed fresh output is
  rejected/retried and malformed legacy cache values are migrated
  conservatively.
- Review issue fingerprints canonicalize the affected-field and disputed-value
  sets, excluding source provenance; corroborating evidence does not reopen an
  unchanged issue, while a different field or value does.
- Apply current Notion terminal choices before computing dependencies. Reuse an
  unambiguous active lecture bundle for both membership shrink and weekly
  expansion; suppress unsafe create/merge behavior for split or ambiguous
  overlaps, and fail the affected course before writes or baseline advancement
  so uncovered work is explicit.
- Separate release dates from due dates and preserve `During class` semantics.
- On the first source absence, set `Source State` to `Missing` and `Missing Syncs` to 1. Archive only after a second consecutive confirmed absence. Restore an item if it returns.
- Update course guidance when current official evidence changes how preparation, class activity, or submission works.
- Recompute availability, dependencies, Readiness, unpinned planning, assignment runway, and active views before reporting success.
- Before reporting success, explicitly verify that every `Waiting on prerequisite` record has a current unfinished immediate prerequisite, and that every non-terminal `Ready` record passes its `Available From` gate. Correct stale `Blocked By` and Readiness metadata in the same run; do not alter `Status` for either audit.

## CS2030S programming exercises

Read `latest/github/cs2030s-repos.json` and the matching file under `latest/github/cs2030s-exercise-commits`.

- A staff `exN-skeleton` repository means the exercise is released. The matching non-terminal action can become `Ready` for acceptance/setup even when Canvas has a blank Accept Link.
- A personal `exercises-exN-<github-login>` repository with only `Initial commit` means accepted but unfinished.
- Personal work after `Initial commit` with a latest commit message other than exact `Submit` means `Status: Doing` when the current status is non-terminal.
- An exact latest commit message `Submit` is authoritative completion evidence: set `Status: Done` and `Readiness: Completed` because Canvas does not receive these submissions.
- Record repository and commit evidence in notes without erasing user-authored text. Never infer personal progress from a staff skeleton and never reopen `Done` or `Dropped` automatically.

## Completion report

The service updates the dashboard health callout with every course outcome. A
real remaining failure begins `LAST SYNC FAILED`, retains only the failed
course's baseline, sends one idempotent Resend email, and exits nonzero. Declared
404/capability gaps with working alternates remain manifest metadata, not alerts.
Report only changed facts, overdue work, ambiguity, failures, or something
requiring Nas's response. If nothing changed and no failure remains, complete
quietly.
