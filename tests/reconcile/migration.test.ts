import { expect, test } from "bun:test";
import { planMigration } from "../../src/reconcile/migration";
import type { ExistingAction } from "../../src/reconcile/plan";

test("migration dry run selects canonical IS1128/GEA survivors and proposes reversible duplicates", () => {
  const rows: Array<ExistingAction> = [
    {
      id: "is-canonical",
      automatedIdentity: "course:97325:assignment:274462",
      properties: {
        Course: "IS1128",
        "Canvas Item Type": "assessment",
        Action: "Project proposal submission",
        Status: "Done",
        Planned: "2026-09-09",
        "Parent Canvas ID": "course:97325:assignment:274462",
      },
    },
    {
      id: "is-duplicate",
      automatedIdentity: "candidate:old-proposal",
      properties: {
        Course: "IS1128",
        "Canvas Item Type": "assessment",
        Action: "Group Project Proposal",
        Status: "Not started",
        "Parent Canvas ID": "course:97325:page:course-design",
      },
    },
    {
      id: "gea-canonical",
      automatedIdentity: "course:94257:assignment:262075",
      properties: {
        Course: "GEA1000",
        "Canvas Item Type": "assessment",
        Action: "Quiz 3 (Chapter 3)",
        Status: "Not started",
        "Parent Canvas ID": "course:94257:assignment:262075\ncourse:94257:quiz:86811",
      },
    },
    {
      id: "gea-duplicate",
      automatedIdentity: "candidate:old-quiz",
      properties: {
        Course: "GEA1000",
        "Canvas Item Type": "assessment",
        Action: "Quiz 3",
        Status: "Not started",
        "Parent Canvas ID": "course:94257:announcement:493901",
      },
    },
  ];
  const report = planMigration(rows);
  expect(report.survivors.find((entry) => entry.pageId === "is-canonical")?.aliases).toContain(
    "candidate:old-proposal",
  );
  expect(report.survivors.find((entry) => entry.pageId === "gea-canonical")?.aliases).toContain(
    "candidate:old-quiz",
  );
  expect(report.duplicateArchivalProposals.map((entry) => entry.pageId).sort()).toEqual([
    "gea-duplicate",
    "is-duplicate",
  ]);
  expect(report.duplicateArchivalProposals.every((entry) => entry.reversible)).toBe(true);
});

test("migration leaves proposal/report stages distinct even when an announcement is shared", () => {
  const report = planMigration([
    {
      id: "proposal",
      automatedIdentity: "candidate:proposal",
      properties: {
        Course: "IS1128",
        "Canvas Item Type": "assessment",
        Action: "Project proposal",
        Status: "Not started",
      },
    },
    {
      id: "report",
      automatedIdentity: "candidate:report",
      properties: {
        Course: "IS1128",
        "Canvas Item Type": "assessment",
        Action: "Final report",
        Status: "Not started",
      },
    },
  ]);
  expect(report.survivors).toHaveLength(2);
  expect(report.duplicateArchivalProposals).toHaveLength(0);
});

test("migration never groups manual rows without an automated identity", () => {
  const report = planMigration([
    {
      id: "manual",
      automatedIdentity: null,
      properties: {
        Course: "IS1128",
        "Canvas Item Type": "assessment",
        Action: "Project proposal",
        Status: "Not started",
      },
    },
    {
      id: "auto",
      automatedIdentity: "candidate:proposal",
      properties: {
        Course: "IS1128",
        "Canvas Item Type": "assessment",
        Action: "Project proposal",
        Status: "Not started",
      },
    },
  ]);
  expect(report.survivors).toHaveLength(1);
  expect(report.survivors[0]?.pageId).toBe("auto");
});

test("quiz number alone does not merge courses or practice variants", () => {
  const report = planMigration([
    {
      id: "gea",
      automatedIdentity: "course:94257:quiz:3",
      properties: {
        Course: "GEA1000",
        "Canvas Item Type": "assessment",
        Action: "Quiz 3",
        Status: "Not started",
      },
    },
    {
      id: "is",
      automatedIdentity: "course:97325:quiz:3",
      properties: {
        Course: "IS1128",
        "Canvas Item Type": "assessment",
        Action: "Quiz 3",
        Status: "Not started",
      },
    },
    {
      id: "practice",
      automatedIdentity: "candidate:practice",
      properties: {
        Course: "GEA1000",
        "Canvas Item Type": "assessment",
        Action: "Quiz 3 Practice",
        Status: "Not started",
      },
    },
  ]);
  expect(report.survivors).toHaveLength(3);
  expect(report.duplicateArchivalProposals).toHaveLength(0);
});

test("migration blocks archival when a duplicate owns a unique note or correction", () => {
  const report = planMigration([
    {
      id: "canonical",
      automatedIdentity: "course:97325:assignment:123",
      properties: {
        Course: "IS1128",
        "Canvas Item Type": "assessment",
        Action: "Project",
        Status: "Not started",
        Notes: null,
        "Official Due": "2026-09-20T02:00:00Z",
        "Needs Review": false,
      },
    },
    {
      id: "duplicate",
      automatedIdentity: "candidate:123",
      properties: {
        Course: "IS1128",
        "Canvas Item Type": "assessment",
        Action: "Project",
        Status: "Not started",
        Notes: "my unique note",
        "Official Due": "2026-09-21T02:00:00Z",
        "Needs Review": true,
      },
    },
  ]);
  const proposal = report.duplicateArchivalProposals[0]!;
  expect(proposal.archiveEligible).toBe(false);
  expect(proposal.userValueDecisions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ field: "Notes", decision: "manual-merge-required" }),
      expect.objectContaining({ field: "Official Due", decision: "manual-merge-required" }),
      expect.objectContaining({ field: "Needs Review", decision: "manual-merge-required" }),
    ]),
  );
  expect(proposal.before.duplicate.properties.Notes).toBe("my unique note");
  expect(proposal.after.duplicateArchived).toBe(true);
  expect(proposal.rollback.duplicateArchived).toBe(false);
});
