# Sync operations

## Collection and coverage

1. Run `./sync.sh` from the repository root.
2. Treat `latest/manifest.json` as the mandatory source manifest. Account for every expected course and top-level endpoint.
3. Inspect every `*.error.json`. A failed Canvas or GitHub endpoint is a coverage gap, never an empty result.
4. Read full announcement and page bodies, module content details, the course file index, and relevant briefs, specifications, rubrics, or official external course pages before interpreting work.
5. Use narrow, read-only live Canvas or GitHub calls only to retry a recorded failure, inspect an API gap, download a specifically relevant document, or resolve evidence ambiguity.

The collector intentionally gathers deterministic source data. The agent interprets prose, resolves conflicts, and reconciles Notion.

## Reconciliation

- Match imported actions idempotently by `Canvas Course ID` + `Canvas Item Type` + `Canvas Item ID`.
- Preserve personal fields according to `planner-contract.md`.
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

Update the dashboard's last-success callout and preserve the view invariants in `notion.md`. Report only changed facts, overdue work, ambiguity, failures, or something requiring Nas's response. If nothing changed and no failure remains, complete quietly.
