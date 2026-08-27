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
