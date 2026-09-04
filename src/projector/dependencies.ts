import type { TaskFact } from "../domain/task";

export function applyTaskDependencies(facts: ReadonlyArray<TaskFact>): Array<TaskFact> {
  const diagnostics = new Map<number, TaskFact>();
  for (const fact of facts) {
    if (fact.courseCode !== "CS2030S") continue;
    const number = diagnosticNumber(fact.title);
    if (number !== null) diagnostics.set(number, fact);
  }

  return facts.map((fact) => {
    const number = fact.courseCode === "CS2030S" ? diagnosticNumber(fact.title) : null;
    if (number === null) return fact;
    const prerequisite = diagnostics.get(number - 1);
    const finished =
      prerequisite?.completed === true ||
      prerequisite?.userStatus === "Done" ||
      prerequisite?.userStatus === "Dropped";
    return { ...fact, blockedBy: prerequisite && !finished ? prerequisite.title : null };
  });
}

function diagnosticNumber(title: string) {
  const match = title.match(/^Diagnostic\s+(\d+)$/i);
  return match ? Number(match[1]) : null;
}
