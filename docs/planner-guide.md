# Planner guide

This is the shared guide for Nas and any agent that edits the university planner.

## What belongs in the planner

Create one row for each real deliverable: an assignment, quiz, project stage,
exam, assessed presentation, or concrete required preparation. One brief may
define several deliverables when proposal, presentation, report, or submission
stages have distinct deadlines or weights.

Do not create todos for ordinary lecture, tutorial, recitation, or lab
attendance. Sit-in labs are physical events, not outside work, even when graded.
Exams and major tests remain visible because their date, weight, and preparation
runway matter. Preparation for a physical event may be a separate actionable
row. Do not create vague work such as “review the brief” or optional practice
unless Nas opts in.
The future exam/test event row itself stays `Locked` until it can be undertaken;
put study or setup work that can happen now in a separate `Ready` preparation
row. Do not mark the event `Ready` merely because studying is possible.

## Fields

- **Action**: concrete work or assessed obligation.
- **Course**: course code.
- **Status**: `Not started`, `In progress`, `Done`, or `Dropped`.
- **Availability**: `Locked`, `Ready`, `Blocked`, or `Review`.
- **Weight**: official percentage of the course grade, when stated.
- **Start By**: when meaningful work should begin.
- **Due**: official deadline or major assessed-event time.
- **Source**: the most useful Canvas URL.
- **Notes**: Nas’s instructions, review question, or concise useful context.

Status is progress. Availability is whether the next meaningful action can be
performed. `Locked` means the lecturer, Canvas, or a known release time prevents
access. `Ready` means useful work can happen now. `Blocked` means an external
dependency such as teammates, feedback, approval, or a prerequisite prevents
the next action. `Review` means Nas must resolve genuine uncertainty.

Existing Status values are user-owned progress reports. Keep them unchanged
during Canvas reconciliation; only Nas or an agent acting on his explicit
request changes them. Canvas submission state, grades, due dates, and missing
submissions do not establish progress: some work is submitted outside Canvas.
New rows start as `Not started` unless Nas has explicitly reported progress.

## User changes and Review

Treat edits made by Nas, ChatGPT, or Claude as intentional input. Never silently
erase user-written Notes. Resolve uncertainty on the existing row rather than
creating a duplicate Review row. Nas accepts a review by correcting the row and
changing Availability; he rejects work with `Status = Dropped`.
An archived row stays archived through reconciliation unless Nas explicitly
restores it; Canvas evidence alone does not revive rejected or hidden work.

Use Canvas evidence rather than cadence to claim something is available. Keep
locked confirmed work visible, but do not invent unreleased recurring work.

## Current courses

See the active-semester guide for current course names, timetable, delivery
mode, and source-specific context. Refresh factual dates and requirements from
Canvas; dated examples are not permanent rules.
