# Reconciliation repair rollout note

Date: 2026-09-19

## Behavior protected by this repair

- Review acceptance is fingerprinted by durable task identity, kind, normalized
  disputed issue, and normalized disputed dates. Added evidence, title wording,
  or equivalent ISO date spelling does not reopen an accepted review. A changed
  disputed fact or issue still reopens it.
- Source IDs and source aliases are migration evidence only. They cannot merge a
  distinct same-kind stage when the durable logical keys differ.
- A terminal row is safe to update only when its terminal status was already
  present at planning time. A concurrent terminal transition fails closed, so
  the run does not advance reconciliation state or baseline. Already-terminal
  rows may receive completed metadata and canonical identity migration while
  preserving `Status`.
- Initial rollout treats differing existing `Official Due` or `Available From`
  values conservatively: it preserves the value, flags the row for review, and
  records it as a protected bootstrap correction rather than machine-written
  provenance. The protection survives restart and unchanged syncs; explicit
  acceptance records the correction, while a later source change reopens review
  without overwriting it. Date-only release values use Asia/Singapore
  calendar-day semantics.
- Terminal `Done`/`Dropped` status dominates newly discovered date conflicts:
  conflicting dates remain preserved for review history, but completed work is
  never routed back to `Needs Review`.
- New AI candidates carry structured review issues and per-date evidence
  states. `unknown` is distinct from `explicit-null`; legacy nullable caches
  migrate nulls to `unknown` and retain prose only as a compatibility fallback.
- Machine-owned dates accept only calendar-valid ISO date-only values or ISO
  timestamps with an explicit timezone. Incomplete source phrases such as
  `September 30` remain null/unknown date evidence and raw review text; they
  never reach a Notion date payload. Malformed fresh output fails validation
  and retries, while malformed legacy cache values migrate conservatively to
  unknown review evidence.
- Persisted `sourceProposal` is the raw source projection. User corrections,
  acceptance, protected bootstrap values, and verified machine writes remain
  separate, so accepted corrections survive repeated unchanged runs without
  becoming the next source proposal.
- Dependency projection consumes the current user terminal status, and an
  unambiguous active lecture bundle is expanded in place as new weeks release;
  split or multiply-overlapping bundles remain untouched rather than creating
  another duplicate row, but now fail the affected course with an actionable
  conflict before Notion writes or baseline advancement.
- Review issue fingerprints treat affected fields and disputed values as
  semantic sets: source provenance and ordering do not reopen an unchanged
  issue, while a genuinely different field or disputed value does.

## Rollout

1. Run the captured incident replay and require `writesPerformed:false`.
2. Run `bun run check` and the focused runtime boundary tests:
   `bun test tests/run/course-plan.incidents.test.ts tests/run/orchestrate.test.ts`.
3. Run the migration dry-run. Review every before/after/rollback artifact;
   archive nothing automatically while `archiveEligible` is false.
4. Deploy only after the Notion Agent Instructions page contains the same rules
   in the delta below.
5. Run one sync with the scheduler disabled, inspect the resulting changes and
   review flags, then re-enable the schedule only after the report is accepted.

## Reproducible validation

The final local validation used these commands from the repository root:

```text
bun run check
bun test tests/reconcile/state.test.ts tests/reconcile/plan.test.ts tests/run/course-plan.incidents.test.ts tests/run/orchestrate.test.ts
bun run incident:replay -- /tmp/nus-sync-audit-20260919-djt3sa2j > /tmp/nus-sync-incident-replay-final8.json
docker build --platform linux/amd64 -t nus-canvas-sync:reconciliation-verify-final2 .
docker run --rm --platform linux/amd64 nus-canvas-sync:reconciliation-verify-final2 bun run healthcheck
```

The container healthcheck returned `{"event":"healthcheck","ok":true}`.
The exact read-only `CodexCliExecutor` extraction command and its sanitized
result are recorded in `docs/agent-memory/ai-extraction-probe.md` and
`/tmp/nus-sync-codex-extraction-final.json`; the command performs no Notion
write.

## Rollback

Pause the scheduler, preserve the run report and reconciliation-state files, and
restore the previously verified image/configuration. Do not delete state or
archive duplicate pages as part of rollback. If a duplicate merge is approved,
use the proposal's concrete rollback artifact to restore the survivor and
duplicate archive flags before investigating further.

## Maintained Notion-copy delta

The repository copies now additionally require: machine-owned dates must be
calendar-valid ISO date-only values or timezone-bearing ISO timestamps; raw
ambiguous date phrases remain structured review text and never become Notion
dates. Review fingerprints must ignore
mutable source membership and wording; source overlap is not task identity;
terminal status dominates newly discovered conflicts while terminal writes need
a status precondition and stale terminal races fail closed; first-run differing
correction dates are preserved and reviewed; raw source proposals remain
separate from accepted user corrections; AI issue/date evidence is structured;
and date-only release comparisons are evaluated at Asia/Singapore midnight. The live Notion
Agent Instructions copy was not written in this repair because no Notion write
connector or production-write authorization was available; it must be updated
with this exact delta before rollout.

## Remaining manual duplicate choices

The latest sanitized migration dry-run reports 103 survivor groups, 4 duplicate
archival proposals, 0 archive-eligible proposals, and 6 conflicts. The remaining
choices cover GEA1000 Examplify installation metadata, GEA1000 Quiz 3 action
wording, the three-row IS1128 project-proposal group, and GEA1000/GESS1001
active-versus-terminal lecture bundle membership. Each proposal contains
concrete survivor/duplicate before state, after state, and rollback state.
