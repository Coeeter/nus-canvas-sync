import { createHash } from "node:crypto";
import type { TaskProjection } from "../domain/task";
import type { ExistingAction } from "../reconcile/plan";

export function bundleContiguousLectures(
  tasks: ReadonlyArray<TaskProjection>,
  existing: ReadonlyArray<ExistingAction> = [],
): Array<TaskProjection> {
  const passthrough = tasks.filter(
    (task) => task.kind !== "e-lecture" || task.week === undefined || task.state !== "ready",
  );
  let lectures = tasks.filter(
    (task): task is TaskProjection & { week: number } =>
      task.kind === "e-lecture" && task.week !== undefined && task.state === "ready",
  );

  // Keep an unfinished bundle's membership fixed when a later week opens.
  for (const row of existing) {
    if (
      !row.automatedIdentity?.startsWith("bundle:") ||
      ["Done", "Dropped"].includes(String(row.properties.Status))
    )
      continue;
    const members = String(row.properties["Parent Canvas ID"] ?? "")
      .split("\n")
      .filter(Boolean)
      .sort();
    const group = lectures.filter((task) => task.sourceIds.every((id) => members.includes(id)));
    const actual = group.flatMap((task) => task.sourceIds).sort();
    if (!group.length || JSON.stringify(actual) !== JSON.stringify(members)) continue;
    passthrough.push({
      ...group[0]!,
      id: row.automatedIdentity,
      title: String(row.properties.Action ?? group[0]!.title),
      sourceIds: members,
      memberSourceIds: members,
    });
    lectures = lectures.filter((task) => !group.includes(task));
  }

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
