import { createHash } from "node:crypto";
import type { TaskProjection } from "../domain/task";
import type { ExistingAction } from "../reconcile/plan";

export function bundleContiguousLectures(
  tasks: ReadonlyArray<TaskProjection>,
  terminalMemberSourceIds: ReadonlySet<string> = new Set(),
): Array<TaskProjection> {
  const passthrough = tasks.filter(
    (task) => task.kind !== "e-lecture" || task.week === undefined || task.state !== "ready",
  );
  const lectures = tasks.filter(
    (task): task is TaskProjection & { week: number } =>
      task.kind === "e-lecture" &&
      task.week !== undefined &&
      task.state === "ready" &&
      task.memberSourceIds.every((sourceId) => !terminalMemberSourceIds.has(sourceId)),
  );

  for (const courseCode of new Set(lectures.map((task) => task.courseCode))) {
    const course = lectures
      .filter((task) => task.courseCode === courseCode)
      .sort((left, right) => left.week - right.week);
    let group: typeof course = [];
    const flush = () => {
      if (group.length === 0) return;
      if (group.length === 1) {
        passthrough.push(group[0]!);
      } else {
        const members = group.flatMap((task) => task.memberSourceIds).sort();
        const first = group[0]!;
        const last = group.at(-1)!;
        passthrough.push({
          ...first,
          id: `bundle:${courseCode}:${createHash("sha256").update(members.join("\n")).digest("hex").slice(0, 16)}`,
          title: `Watch ${courseCode} Weeks ${first.week}–${last.week} lecture videos`,
          sourceIds: members,
          memberSourceIds: members,
          actionable: group.some((task) => task.actionable),
          state: group.some((task) => task.state === "ready") ? "ready" : first.state,
        });
      }
      group = [];
    };
    for (const task of course) {
      const previous = group.at(-1);
      if (previous && task.week !== previous.week + 1) flush();
      group.push(task);
    }
    flush();
  }
  return passthrough;
}

/** Terminal bundle membership is carried forward when a new week changes the bundle id. */
export function terminalLectureMembers(existing: ReadonlyArray<ExistingAction>) {
  const members = new Set<string>();
  for (const row of existing) {
    if (row.properties["Canvas Item Type"] !== "e-lecture") continue;
    if (row.properties.Status !== "Done" && row.properties.Status !== "Dropped") continue;
    const parent = row.properties["Parent Canvas ID"];
    if (typeof parent !== "string") continue;
    for (const sourceId of parent.split("\n").filter(Boolean)) members.add(sourceId);
  }
  return members;
}
