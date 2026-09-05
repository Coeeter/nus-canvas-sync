import { contentHash } from "../normalize/hash";
import type { NormalizedRecord } from "../normalize/types";
import type { CandidateEnvelope } from "./types";

const KINDS = new Set(["assignment", "quiz", "announcement", "module", "page", "document"]);
const METADATA = new Set([
  "submission",
  "updatedAt",
  "lockedForUser",
  "unlockAt",
  "lockAt",
  "published",
  "state",
  "dueAt",
]);
function prose(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(prose);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !METADATA.has(key))
        .map(([key, item]) => [key, prose(item)]),
    );
  return value;
}

/** Include unchanged support for affected actions, without re-extracting unrelated work. */
export function affectedInterpretation(
  previous: ReadonlyArray<NormalizedRecord>,
  current: ReadonlyArray<NormalizedRecord>,
  candidates: CandidateEnvelope,
  force = false,
) {
  const relevant = (records: ReadonlyArray<NormalizedRecord>) =>
    records.filter((record) => KINDS.has(record.kind));
  const before = new Map(
    relevant(previous).map((record) => [record.id, contentHash({ prose: prose(record.fields) })]),
  );
  const after = new Map(
    relevant(current).map((record) => [record.id, contentHash({ prose: prose(record.fields) })]),
  );
  const affected = new Set(
    [...before.keys(), ...after.keys()].filter((id) => force || before.get(id) !== after.get(id)),
  );
  if (force)
    for (const candidate of candidates.candidates)
      for (const id of candidate.sourceIds) affected.add(id);
  const graph = new Map<string, Set<string>>();
  const connect = (left: string, right: string) => {
    const a = graph.get(left) ?? new Set<string>();
    a.add(right);
    graph.set(left, a);
    const b = graph.get(right) ?? new Set<string>();
    b.add(left);
    graph.set(right, b);
  };
  for (const candidate of candidates.candidates)
    for (const id of candidate.sourceIds) connect(candidate.sourceIds[0]!, id);
  for (const record of [...previous, ...current]) {
    if (Array.isArray(record.fields.referencedBy))
      for (const id of record.fields.referencedBy)
        if (typeof id === "string") connect(record.id, id);
    const courseId = record.id.match(/^course:(\d+):/)?.[1];
    if (!courseId) continue;
    if (typeof record.fields.quizId === "number")
      connect(record.id, `course:${courseId}:quiz:${record.fields.quizId}`);
    const text = JSON.stringify(record.fields);
    for (const match of text.matchAll(/\/files\/(\d+)/g))
      connect(record.id, `course:${courseId}:document:${match[1]}`);
    for (const match of text.matchAll(
      new RegExp(`/courses/${courseId}/pages/([a-zA-Z0-9_.%-]+)`, "g"),
    )) {
      let slug = match[1]!;
      try {
        slug = decodeURIComponent(slug);
      } catch {
        /* Keep malformed links as unavailable evidence. */
      }
      connect(record.id, `course:${courseId}:page:${slug}`);
    }
    if (record.kind === "module" && Array.isArray(record.fields.items))
      for (const item of record.fields.items) {
        if (item.pageUrl) connect(record.id, `course:${courseId}:page:${item.pageUrl}`);
        if (item.contentId && ["File", "Assignment", "Quiz"].includes(item.type))
          connect(
            record.id,
            `course:${courseId}:${item.type === "File" ? "document" : String(item.type).toLowerCase()}:${item.contentId}`,
          );
      }
  }
  const queue = [...affected];
  for (let index = 0; index < queue.length; index++)
    for (const id of graph.get(queue[index]!) ?? [])
      if (!affected.has(id)) {
        affected.add(id);
        queue.push(id);
      }
  return {
    records: relevant(current).filter((record) => affected.has(record.id)),
    affectedSourceIds: affected,
  };
}
