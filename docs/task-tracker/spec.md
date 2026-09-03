# Automated university task tracker specification

Status: **Approved**

Product context: [`../context.md`](../context.md#automated-university-task-tracker--draft)

## Scope

This specification defines the replacement for the broad Canvas-to-Notion Codex
automation. A scheduled Bun application collects five NUS courses, detects
meaningful source changes, applies deterministic task rules, requests narrow
Codex interpretation only for changed prose, and projects safe results into the
existing Notion Actions database.

Nas is the sole user. Canvas and course GitHub sources are read-only. Notion is
the v1 task store and conversational interface, not the reasoning engine.

## Requirements

### Source collection and identity

- **SRC-001 — Declared coverage:** Each run MUST collect the declared Canvas
  assignments with submission state, quizzes, announcements with complete
  bodies, modules with item/content details, homepage, page index and bodies,
  file index, and combined planner feed for CS2030S, GEA1000, GESS1001, IS1128,
  and MA1301. It MUST also collect the authenticated user's relevant CS2030S
  personal repositories, staff skeleton repositories, and personal commit
  histories.
- **SRC-002 — Stable records:** Every collected object MUST normalize to a stable
  source identity such as `course:<course-id>:<kind>:<source-id>`, retain its
  source URL and relevant source metadata, and have a content hash computed from
  canonical task-relevant data rather than raw response ordering.
- **SRC-003 — Credentials:** Canvas MUST use `CANVAS_URL` and `CANVAS_TOKEN`.
  Private GitHub collection MUST use `GH_TOKEN`. Credentials MUST be injected at
  runtime and MUST NOT be committed, baked into images, written into snapshots,
  or printed in logs.
- **SRC-004 — Explicit endpoint outcomes:** Every declared source endpoint MUST
  produce either normalized data or a structured outcome identifying an
  expected capability gap, transient failure, or task-affecting failure. An
  error MUST NOT be represented as an empty successful result.
- **SRC-005 — Course-specific capabilities:** Known unsupported endpoints MUST be
  declared per course with their accepted alternate evidence. A known,
  source-specific 404 MUST NOT fail a run or produce an alert when the declared
  alternate sources succeeded. A newly failing required source, widespread
  Canvas failure, authentication failure, or loss of every accepted source for a
  task category MUST be task-affecting.
- **SRC-006 — Relevant documents:** The collector MUST preserve the complete file
  index. It MUST download and extract only documents referenced by changed
  assignments, announcements, module items, or pages, plus recognisable briefs,
  specifications, or rubrics selected by deterministic filename/link rules.
  Document hashes and source relationships MUST participate in change detection.
- **SRC-007 — Static timetable:** The timetable and course rhythm in
  `docs/context.md` MUST be used as versioned context. V1 MUST NOT connect to
  Google Calendar or an ICS feed.
- **SRC-008 — Read-only academic systems:** The application MUST NOT modify
  Canvas, submit coursework, attempt quizzes, change enrolment, or modify course
  GitHub repositories.

### Snapshots, diffs, and persistence

- **DIF-001 — Durable snapshots:** Each run MUST write a timestamped normalized
  snapshot to a persistent Docker volume and retain the previous successful
  baseline independently for each course.
- **DIF-002 — Semantic diff:** AI interpretation MUST receive only added or
  materially changed prose/document records for one course. Unchanged records,
  transport-only changes, response ordering, and sync timestamps MUST NOT invoke
  AI.
- **DIF-003 — Safe baseline advancement:** A course baseline MUST advance only
  after its collection, interpretation when required, deterministic reduction,
  Notion writes, and post-write verification succeed. A failed course MUST retry
  the same uncommitted diff on the next scheduled run.
- **DIF-004 — Independent courses:** Each course MUST commit independently.
  Successful courses MUST be allowed to advance when another course fails. The
  failed course MUST retain its last successful task state and baseline.
- **DIF-005 — Mutual exclusion and atomic state:** Concurrent scheduled or manual
  runs MUST not overlap. Baselines, incident state, and output manifests MUST use
  atomic replacement so interruption cannot leave partially written state.
- **DIF-006 — Auditability:** A run manifest MUST record per-course collection,
  diff, AI-attempt, reduction, Notion-write, verification, and final outcome
  without secret values. Snapshot/source membership MUST make every projected
  automated task traceable to its evidence.

### Deterministic task lifecycle

- **TSK-001 — State ownership:** Deterministic code MUST exclusively control
  automated source identity, availability, completion evidence, physical-event
  exclusion, preparation expiry, bundle membership, missing-source handling, and
  preservation of user state. Codex output MUST be treated only as candidate
  facts.
- **TSK-002 — Actionability:** A task is actionable only when it is relevant,
  unfinished, and available now. An authoritative future `unlock_at` MUST keep an
  observed task locked. A timetable, syllabus, homepage schedule, module label,
  or recurring cadence MUST NOT establish that an assessment is released, open,
  or due.
- **TSK-003 — Assessments:** A quiz or assignment MUST become actionable only
  from a dedicated current Canvas assessment/assignment record or an explicit
  current announcement that itself provides authoritative action details. A
  forecast may be retained as expected context but MUST remain outside active
  queues.
- **TSK-004 — Completion:** A current Canvas submission or grade MUST complete the
  matching Canvas task. For CS2030S programming exercises, an exact latest
  personal-repository commit message `Submit` MUST complete the task; a staff
  skeleton alone MUST only establish release. Verified completion MUST not be
  reopened by later source interpretation.
- **TSK-005 — User terminal choices:** A user-set `Done` or `Dropped` status and
  an explicit completion/dismissal confirmation MUST remain sticky until Nas
  reverses it.
- **TSK-006 — Physical events:** Attendance at lectures, tutorials, recitations,
  and labs MUST NOT be an active todo. A distinct assessment performed during a
  class MAY have one canonical `During class` record. A separate task MUST exist
  only for a real out-of-class preparation or submission step.
- **TSK-007 — Preparation expiry:** Source-supported preparation MUST be tied to
  its event. Once the event ends, unfinished preparation MUST leave active queues
  as expired and MUST NOT remain actionable.
- **TSK-008 — Optional material:** Optional practice, anonymous feedback,
  reference material, and general informational content MUST NOT become tasks by
  default.
- **TSK-009 — Bundling:** Adjacent source items that represent one realistic work
  session SHOULD display as one stable task, such as “Watch GEA1000 Weeks 1–3
  lecture videos.” Bundling MUST preserve all member source identities and
  per-source completion internally. It MUST NOT merge independently due,
  independently submitted, or meaningfully different work.
- **TSK-010 — Conflicts:** Conflicting authoritative evidence MUST NOT be resolved
  silently. The candidate MUST enter review with both sources and the precise
  conflict.
- **TSK-011 — Time projection:** Availability, due-state, preparation expiry,
  dependencies, and active-view membership MUST be recomputed on every run even
  when no source content changed and no AI call occurs. All planning times MUST
  use Asia/Singapore.
- **TSK-012 — Regression cases:** Automated tests MUST cover at least: unreleased
  IS1128 Quiz 2 remains expected and inactive; IS1128 Saturday–Wednesday cadence
  does not override a missing assessment; completed CS2030S Sit-In Lab 2 is not a
  todo; past recitation preparation expires; optional Practice Diagnostic 02 is
  inactive; submitted Diagnostic 02 stays complete; contiguous lecture videos
  bundle; future unlock prevents Ready; and the GESS1001 deadline conflict enters
  review.

### AI interpretation and review

- **AI-001 — Course isolation:** Each AI request MUST contain changed prose and
  relevant referenced documents for exactly one course, that course's approved
  context, and a structured output schema. It MUST NOT receive unrelated course
  content or Notion credentials.
- **AI-002 — Model policy:** Changed prose MUST use `gpt-5.6-terra` at medium
  reasoning effort. A further reviewer call MAY run only for changed candidates
  that remain ambiguous; it MUST NOT run unconditionally.
- **AI-003 — Restricted execution:** Codex MUST run non-interactively,
  ephemerally, with a read-only/isolated working directory, ignored ambient
  project rules/configuration where supported, and a strict JSON output schema.
  Its subprocess environment MUST be allowlisted and MUST exclude Canvas,
  GitHub, Notion, and Resend secrets.
- **AI-004 — Candidate evidence:** Each candidate MUST include course, source
  identities, source excerpts or field evidence, proposed kind, title, dates,
  required action, confidence, and ambiguity/conflict reasons. Unsupported
  candidate fields MUST be rejected by deterministic validation.
- **AI-005 — Immediate retry:** Invalid output, timeout, or failed Codex execution
  MUST receive one immediate retry, for two total attempts. After the second
  failure, the course MUST retain its previous baseline and be marked failed for
  the run.
- **AI-006 — Human review:** Unsafe, low-confidence, novel, or contradictory
  candidates MUST be written to Notion with `Needs Review = true` and
  `Readiness = Review`, with the reason, evidence, and proposed interpretation in
  Notes. They MUST remain outside active work views.
- **AI-007 — Review resolution:** Nas MUST be able to accept a review candidate by
  correcting disputed fields and clearing `Needs Review`, or reject it by setting
  `Status = Dropped`. The reducer MUST validate an accepted candidate before
  activation and MUST return it to review with an explanation if required facts
  remain unsafe or contradictory.

### Notion behavior

- **NOT-001 — Existing store:** V1 MUST use the existing Actions data source
  `collection://e04655de-e228-44cb-9042-597968f7057a`. It MUST NOT create a
  second task database or custom web frontend.
- **NOT-002 — Idempotent projection:** Automated records MUST match by stable
  source or derived bundle identity. Repeated successful runs with unchanged
  state MUST not create duplicates or rewrite unchanged properties.
- **NOT-003 — Field ownership:** Automated updates MUST patch only agent-owned
  fields plus `Status` when authoritative completion evidence explicitly permits
  it. They MUST preserve Nas's notes, priority, effort, pinned planning choices,
  and terminal status. Each write MUST refetch the current record and receive
  post-write verification before its course baseline advances.
- **NOT-004 — Manual tasks:** A row without an automated source identity MUST be
  treated as a manual ChatGPT/Claude/Nas task. The automated reducer MUST NOT
  rewrite or drop its title, Notes, dates, Priority, Effort, Status, or lifecycle.
- **NOT-005 — Dashboard order:** The dashboard MUST show, in order: sync health;
  **Review first**; Urgent; Next and active; Assignments and projects; Courses
  and timetable. The review view MUST be above all execution queues and display
  Action, Course, proposed/relevant dates, Notes/reason, Status, and Source URL.
- **NOT-006 — Review visibility:** `Needs Review = true` records MUST appear in
  Review first and MUST be excluded from Urgent, Next and active, and ordinary
  course execution views.
- **NOT-007 — Health summary:** The top dashboard callout MUST report every
  course's most recent outcome and time. A partial task-affecting failure MUST
  prominently begin with `LAST SYNC FAILED` and name successes and failures, for
  example “4 courses successfully synced at 12:03pm; IS1128 failed at 12:04pm.”
  A later fully successful run MUST replace the failure state with current
  per-course success information.
- **NOT-008 — Durable instructions:** Repository planner instructions and the
  Notion Agent Instructions page MUST be updated together to explain the new
  deterministic service, review interaction, manual-task ownership, and retired
  broad agent workflow.

### Failures and alerting

- **ERR-001 — Normal retry:** Transient collection, network, rate-limit, Notion,
  verification, and email calls SHOULD use bounded retries appropriate to the
  error. Validation/authentication errors MUST fail without pointless repeated
  requests. AI uses the exact two-attempt policy in AI-005.
- **ERR-002 — Alert threshold:** Expected course-specific capability gaps MUST
  remain visible in the run manifest but MUST NOT set `LAST SYNC FAILED` or send
  email. A run MUST alert when any course cannot safely collect, interpret,
  persist, or verify task-affecting state after its normal retries.
- **ERR-003 — Failure email:** Every scheduled run ending with an alertable
  failure MUST attempt one Resend email containing the run time, affected
  courses/stages, their last successful times, concise error classes without
  secrets, and relevant Canvas/dashboard links. Repeated failed scheduled runs
  MAY each send another email.
- **ERR-004 — Email idempotency:** Resend MUST use a stable idempotency key for
  the logical run alert so retries cannot duplicate that run's email. Resend MUST
  use runtime `RESEND_API_KEY`, `ALERT_EMAIL_FROM`, and `ALERT_EMAIL_TO` values.
- **ERR-005 — Alert failure:** If email delivery itself fails, the application
  MUST retain the `LAST SYNC FAILED` Notion state, record the sanitized Resend
  failure in the run manifest, and exit unsuccessfully for Dokploy logs. It MUST
  NOT recursively attempt another alert channel.

### Packaging and operations

- **OPS-001 — Bun project:** The implementation MUST be a maintainable
  TypeScript project executed with Bun and expose repository scripts for
  collection, one complete sync, tests, type checking, and fixture replay.
- **OPS-002 — Container:** A simple Dockerfile MUST bundle the application,
  production dependencies, a pinned Linux amd64 Canvas CLI, and a pinned Linux
  amd64 Codex CLI. Runtime secrets and persistent state MUST remain outside the
  image.
- **OPS-003 — Codex authentication:** Codex MUST use a dedicated persistent
  `CODEX_HOME` initialized once from the authenticated VPS installation. Its
  authentication file MUST be treated as password-equivalent and never exposed
  through logs or Notion.
- **OPS-004 — Dokploy scheduling:** Dokploy MUST invoke the container's supported
  sync command at 07:00, 12:00, 17:00, and 22:00 in Asia/Singapore. The image
  MUST NOT run its own cron daemon and no 03:00 run may be created.
- **OPS-005 — Manual execution:** The same supported sync command MUST be safely
  runnable manually. Overlap protection and idempotency MUST make a coincident
  manual/scheduled invocation harmless.
- **OPS-006 — Observability:** Logs MUST be concise and structured around run and
  course outcomes. They MUST not dump raw Canvas bodies, prompts, model output,
  Notion payloads, or credentials by default.
- **OPS-007 — Deployment handoff:** Documentation MUST give exact Dokploy volume,
  environment, authentication initialization, scheduled-job, manual-run,
  rollback, and health-verification steps. Plan approval does not itself
  authorize production deployment.

### Migration and retirement

- **MIG-001 — Targeted cleanup first:** Before replacement project execution,
  the current Notion database MUST receive the agreed targeted cleanup: remove
  the false IS1128 Quiz 2 from active work; complete CS2030S Sit-In Lab 2; expire
  stale CS2030S recitation preparation; remove optional Practice Diagnostic 02;
  correct GESS1001 Tutorial 2 preparation timing; consolidate duplicate GEA1000,
  GESS1001, and MA1301 preparation; and replace generic brief-review placeholders
  with source-supported assignment work. Legitimate future tasks and user-owned
  fields MUST be preserved.
- **MIG-002 — Review-first dashboard:** The Notion dashboard/view reordering and
  Review first presentation MUST be applied during targeted cleanup so ambiguity
  is visible before the replacement runs.
- **MIG-003 — Pause old automation:** After cleanup and before running replacement
  reconciliation, the Codex automation `sync-nus-semester-1` MUST be paused. It
  MUST NOT be deleted until the replacement has completed a verified production
  run and Nas separately authorizes deletion.
- **MIG-004 — Seed baseline:** The replacement MUST take a fresh full source
  snapshot after cleanup, validate coverage, and establish per-course baselines
  without reintroducing cleaned false/stale records.
- **MIG-005 — Rollback:** Until retirement is authorized, rollback MUST consist of
  disabling the Dokploy schedule and restoring the preserved old automation to
  active only after Nas chooses to do so. The new service MUST not automatically
  reactivate it.

## Acceptance scenarios

1. **Unreleased recurring quiz:** IS1128's timetable predicts Quiz 2, but no
   dedicated Canvas quiz exists. The run records expected context, creates no
   actionable Quiz 2, makes no AI claim that it is open/due, and sends no error
   email.
2. **Released recurring quiz:** A later snapshot adds IS1128 Quiz 2 with
   `unlock_at`, `due_at`, and no submission. Before unlock it is Locked; after
   unlock it is Ready; after submission/grade it is Done.
3. **Physical event:** A Canvas item describes a no-submission sit-in lab. It does
   not become an attendance todo. Nas's explicit completion is preserved.
4. **Expired preparation:** A recitation preparation task is unfinished when the
   recitation ends. The next time projection removes it from active views without
   marking the physical recitation incomplete.
5. **Ambiguous deadline:** Two authoritative GESS1001 sources disagree. One
   review candidate appears first on the dashboard with both dates and sources;
   neither date silently drives Urgent.
6. **Manual chat task:** Claude creates a Personal todo without source identity.
   Subsequent syncs leave every user-owned field unchanged.
7. **No source change:** A scheduled run has no semantic source diff. No Codex
   process starts; time-based lifecycle changes still apply; Notion receives only
   genuinely changed projections/status.
8. **One-course AI failure:** IS1128 Codex output fails schema validation twice
   while the other courses succeed. Four baselines advance, IS1128 does not, the
   dashboard begins `LAST SYNC FAILED`, and one idempotent Resend alert is sent.
9. **Known 404:** A declared course pages/quizzes endpoint returns its known 404
   while alternate declared sources succeed. The gap is recorded but the run does
   not alert or complain in the user-facing status.
10. **Notion verification failure:** A write cannot be verified. That course's
    baseline stays unchanged, the failure appears in health status, and the run
    attempts an alert.
11. **Overlapping runs:** A manual run starts while a scheduled run owns the lock.
    The second invocation exits cleanly without collection, duplicate Notion
    writes, or duplicate email.
12. **Fresh deployment:** With only documented environment values, state volume,
    and initialized Codex authentication, a manual Dokploy run creates a complete
    manifest, updates safe Notion state, and exposes enough evidence to configure
    the four daily schedules.

## Non-goals

- A custom web frontend or custom ChatGPT/Claude MCP server in v1.
- Live Google Calendar or ICS synchronization.
- Automatic coursework submission, quiz attempts, enrolment changes, or course
  communication.
- An LLM that directly reads/writes Notion or decides deterministic lifecycle
  state.
- Mirroring every Canvas item into the task list.
- Guaranteed interpretation of unsupported or contradictory sources without
  human review.
- Production deployment, DNS, or deletion of the old automation merely from
  approval of this specification.
