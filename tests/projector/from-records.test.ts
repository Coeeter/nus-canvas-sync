import { expect, test } from "bun:test";
import type { NormalizedRecord } from "../../src/normalize/types";
import { factsFromRecords } from "../../src/projector/from-records";

const base = (overrides: Partial<NormalizedRecord>): NormalizedRecord => ({
  id: "course:1:assignment:1",
  courseCode: "CS2030S",
  kind: "assignment",
  sourceUrl: "https://canvas.example/1",
  contentHash: "hash",
  fields: {
    name: "Diagnostic 02",
    unlockAt: null,
    dueAt: null,
    submission: { workflowState: "graded", grade: "5" },
  },
  ...overrides,
});

test("Canvas completion and optional diagnostics become deterministic facts", () => {
  const [completed, optional] = factsFromRecords([
    base({}),
    base({
      id: "course:1:assignment:2",
      fields: { name: "Diagnostic 02 (Practice)", submission: null },
    }),
  ]);
  expect(completed?.completed).toBe(true);
  expect(optional?.kind).toBe("optional");
});

test("a Canvas quiz assignment and quiz endpoint become one assessment fact", () => {
  const facts = factsFromRecords([
    base({
      id: "course:94257:assignment:262076",
      courseCode: "GEA1000",
      fields: { name: "Quiz 2", quizId: 86813, submission: null },
    }),
    base({
      id: "course:94257:quiz:86813",
      courseCode: "GEA1000",
      kind: "quiz",
      fields: { title: "Quiz 2", unlockAt: null, dueAt: null },
    }),
  ]);

  expect(facts).toHaveLength(1);
  expect(facts[0]).toMatchObject({
    id: "course:94257:assignment:262076",
    sourceIds: ["course:94257:assignment:262076", "course:94257:quiz:86813"],
  });
});

test("CS2030S exercises use skeleton release and latest personal Submit completion", () => {
  const facts = factsFromRecords([
    base({
      id: "course:93698:assignment:265057",
      fields: { name: "ex2", submission: null },
    }),
    base({
      id: "course:93698:assignment:265058",
      fields: { name: "ex3", submission: null },
    }),
    base({
      id: "course:93698:github-repo:ex2-skeleton",
      kind: "github-repo",
      fields: { description: "Exercise 2" },
    }),
    base({
      id: "course:93698:github-repo:exercises-ex2-coeeter",
      kind: "github-repo",
      fields: { description: "Exercise 2" },
    }),
    base({
      id: "course:93698:github-commit:exercises-ex2-coeeter:new",
      kind: "github-commit",
      fields: {
        repoName: "exercises-ex2-coeeter",
        message: "Submit",
        authorDate: "2026-09-03T00:00:00Z",
      },
    }),
  ]);

  expect(facts.find((fact) => fact.title === "ex2")).toMatchObject({
    authoritativeAction: true,
    completed: true,
  });
  expect(facts.find((fact) => fact.title === "ex3")).toMatchObject({
    authoritativeAction: false,
    completed: false,
  });
});

test("published CS2030S problem sets become one concrete recitation preparation each", () => {
  const facts = factsFromRecords([
    base({
      id: "course:93698:document:9900386",
      kind: "document",
      fields: { displayName: "ps-03.pdf", text: "Problem Set 03" },
    }),
    base({
      id: "course:93698:document:9900406",
      kind: "document",
      fields: { displayName: "ps-02-comments.pdf", text: "Comments" },
    }),
  ]);

  expect(facts).toEqual([
    expect.objectContaining({
      id: "course:93698:document:9900386",
      kind: "preparation",
      title: "Prepare CS2030S Problem Set 3 for recitation",
      week: 5,
      workMode: "Before class",
    }),
  ]);
});

test("released GESS1001 content module becomes one e-lecture fact", () => {
  const facts = factsFromRecords([
    base({
      id: "course:2:module:1",
      courseCode: "GESS1001",
      kind: "module",
      fields: {
        name: "Week 3",
        state: "completed",
        unlockAt: "2026-08-25T06:00:00Z",
        items: [
          { id: 7, title: "Week 3 Overview", lockedForUser: false },
          { id: 8, title: "Week 3 Content", lockedForUser: false },
          { id: 9, title: "Week 3 Wrap Up", lockedForUser: false },
        ],
      },
    }),
  ]);
  expect(facts).toHaveLength(1);
  expect(facts[0]).toMatchObject({
    id: "course:2:module:1:item:8",
    kind: "e-lecture",
    week: 3,
    observed: true,
    availableFrom: "2026-08-25T06:00:00Z",
  });
});

test("MA1301 weekly source-assigned work becomes one preparation fact", () => {
  const facts = factsFromRecords([
    base({
      id: "course:97359:page:week-5",
      courseCode: "MA1301",
      kind: "page",
      fields: {
        title: "Week 5",
        body: "In preparation for this week's classes, view the videos. Work on Exercises 3.3 and 3.4.",
      },
    }),
  ]);

  expect(facts).toEqual([
    expect.objectContaining({
      id: "course:97359:page:week-5",
      kind: "preparation",
      title: "MA1301 Week 5 preparation",
      sourceIds: ["course:97359:page:week-5"],
      workMode: "Before class",
    }),
  ]);
});

test("known GEA1000 announcements become concrete work instead of review-the-brief todos", () => {
  const facts = factsFromRecords([
    base({
      id: "course:94257:announcement:485604",
      courseCode: "GEA1000",
      kind: "announcement",
      fields: {
        title: "Tutorial 2",
        message: "Do take time to work through the questions before your Tutorial 2 class.",
        postedAt: "2026-08-31T14:21:58Z",
      },
    }),
    base({
      id: "course:94257:announcement:481086",
      courseCode: "GEA1000",
      kind: "announcement",
      fields: {
        title: "Video Assignment",
        message: "This assignment will count towards your Tutorial participation marks.",
        postedAt: "2026-08-23T06:29:31Z",
      },
    }),
  ]);

  expect(facts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: "course:94257:announcement:485604",
        kind: "preparation",
        title: "Prepare GEA1000 Tutorial 2 questions",
        eventEndsAt: "2026-09-09T04:00:00.000Z",
      }),
      expect.objectContaining({
        id: "course:94257:announcement:481086",
        kind: "assessment",
        title: "Create GEA1000 group video assignment",
        dueAt: "2026-09-29",
      }),
    ]),
  );
});

test("known GESS1001 sources become tutorial preparation and distinct real assignments", () => {
  const facts = factsFromRecords([
    base({
      id: "course:94548:announcement:486744",
      courseCode: "GESS1001",
      kind: "announcement",
      fields: { title: "Tutorial 2 Instructions now available", postedAt: "2026-09-03T02:22:45Z" },
    }),
    base({
      id: "course:94548:announcement:482225",
      courseCode: "GESS1001",
      kind: "announcement",
      fields: { title: "Assignment instructions now available", postedAt: "2026-08-25T03:35:12Z" },
    }),
    base({
      id: "course:94548:module:157035",
      courseCode: "GESS1001",
      kind: "module",
      fields: {
        name: "Tutorials",
        items: [
          { id: 826236, title: "[Tut 2] Multiple Interpretations of Landscapes in Singapore.docx" },
        ],
      },
    }),
    base({
      id: "course:94548:module:158955",
      courseCode: "GESS1001",
      kind: "module",
      fields: {
        name: "Assignments",
        items: [
          {
            id: 836509,
            title: "Group Assignment_ Multimedia Submission on Heritage and Tourism Landscapes.pdf",
          },
          { id: 836512, title: "Individual Assignment - Landscapes of Migration.pdf" },
        ],
      },
    }),
  ]);

  expect(facts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: "course:94548:announcement:486744",
        title: "Prepare GESS1001 Tutorial 2 — Long Island stakeholder debate",
        sourceIds: expect.arrayContaining([
          "course:94548:announcement:486744",
          "course:94548:module:157035:item:826236",
        ]),
      }),
      expect.objectContaining({
        id: "course:94548:announcement:482225",
        title: "Create GESS1001 group heritage/tourism landscape project",
      }),
      expect.objectContaining({
        id: "course:94548:announcement:482225:individual-assignment",
        title: "Write GESS1001 individual migrant landscapes article",
        conflict: expect.objectContaining({ reason: expect.stringContaining("2026-09-18") }),
      }),
    ]),
  );
});
