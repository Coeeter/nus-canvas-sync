# Planner contract

This file defines durable planner behavior. Current Canvas, official course sites, captured course GitHub data, and the live Notion schema remain the source of current facts.

## Action model

- Track assignments, quizzes, exams, required preparation, announcements that require a response, and useful personal todos.
- Attendance alone is not an active todo. Keep a `During class` action only for distinct assessed work performed during the scheduled session.
- Represent one piece of work once. A scheduled in-class quiz or lab has one canonical `During class` record; create a separate upload or submission action only when an explicit out-of-class step exists.
- Lead course guidance with **Before class** and **During class**, then state the submission method and deadline. Distinguish required preparation from optional enrichment.

## Field ownership

- `Status` is the only user-facing workflow control. Preserve user choices unless an explicit rule below authorizes automation.
- Preserve user-authored notes, priority, effort, and planning choices. Replan `Planned` only when `Pinned` is false. Merge source evidence into notes without erasing user text.
- `Readiness`, `Start By`, source identity, source state, missing-sync counters, and sync timestamps are agent-maintained metadata and stay hidden from routine views.
- `Done` and `Dropped` leave active views immediately. `Readiness` mirrors terminal `Done` as `Completed`.
- The only automatic `Status` transition is verified CS2030S programming-exercise progress described in `sync-operations.md`.

## Readiness

Recompute Readiness before replanning or refreshing views:

- `Ready`: released now, relevant, and actionable.
- `Scheduled`: near-term assessed work that must be completed during class.
- `Locked`: the next unreleased actionable item.
- `Waiting on prerequisite`: a later action whose immediate unfinished prerequisite is named in `Blocked By`.
- `Later`: future backlog that is neither the next release nor ready to start.
- `Review`: `Needs Review` is checked.
- `Completed`: `Status` is `Done`.

Treat `Available From` as a hard gate on the source action. If it is later than the current Asia/Singapore date and time, the action cannot be `Ready` because of a nearby due date, a `Planned` date, `Start By`, or its teaching week. A date-only value opens at the start of that Singapore date. Audit every non-terminal `Ready` action with `Available From` populated and correct future-dated violations before updating views.

A separately identified preparation or setup action may be `Ready` before release only when official evidence supports that work. Give it a stable derived identity and do not use the unavailable source action as a proxy for preparation.

## Assignment runway

- Keep `Urgent` as the rolling three-day execution queue. Long work belongs on `Assignments & projects`.
- For every active assignment with an official due date, read the actual brief before setting agent-owned `Start By`.
- Use roughly three days for short, well-scoped work; seven days for substantial individual work; and at least fourteen days for group or multi-stage work. Start earlier when coordination, dependencies, source requirements, or existing commitments require it.
- When an unpinned assignment reaches `Start By`, make it actionable and give it a practical `Planned` date even when `Official Due` lies outside Urgent.
- Create milestones only for distinct source-supported stages such as topic choice, research, draft, group review, or submission check. Use stable derived identities through `Parent Canvas ID`; avoid generic checklists.

## Planning style

- Plan around the timetable and existing commitments with flexible daily priorities, not rigid hour blocks.
- Released self-paced lectures, readings, or videos are preparation actions. Plan weekly self-paced work on Sunday unless the source or Nas specifies otherwise.
- Never invent an `Official Due` date to force prerequisite or personal work into a view. Use `Planned`, `Start By`, `Blocked By`, `Readiness`, and `Status` for sequencing.

## Ad hoc todos

- Fetch the Actions schema and search for an existing matching action before creating anything. Update an existing action when the request refers to work already represented.
- For a user-created todo with no Canvas source, leave Canvas identity fields empty, use the named course, preserve the user's wording, and do not invent an `Official Due` date.
- Use `Planned` only for an intended work date and derive `Readiness` from whether the todo is actionable now. Default a genuinely new todo to `Status: Not started` unless Nas says it is already underway or complete.
- Verify the saved record and its active-view behavior. Ask only when a missing detail would materially change the action.
