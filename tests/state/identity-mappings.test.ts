import { expect, test } from "bun:test";
import { planReconciliation } from "../../src/reconcile/plan";
import { projectTask } from "../../src/rules/lifecycle";
import { applyIdentityMappings } from "../../src/state/identity-mappings";

test("explicit scoped legacy mapping updates the same page with its original ownership precondition", () => {
  const rows = [
    {
      id: "old-page",
      automatedIdentity: "482225-individual",
      properties: {
        Course: "GESS1001",
        "Canvas Item ID": "482225-individual",
        Status: "Dropped",
        Notes: "Keep",
      },
    },
  ];
  const target = "candidate:GESS1001:article";
  const mapped = applyIdentityMappings(rows, [
    { pageId: "old-page", fromIdentity: "482225-individual", toIdentity: target },
  ]);
  const fact = projectTask(
    {
      id: target,
      courseCode: "GESS1001",
      kind: "assessment",
      title: "Individual article",
      sourceIds: ["course:94548:document:9782382"],
      observed: true,
      authoritativeAction: true,
    },
    new Date(),
  );
  const [operation] = planReconciliation(mapped, [fact], "2026-09-05T00:00:00Z");
  expect(operation).toMatchObject({
    type: "update",
    pageId: "old-page",
    expectedIdentity: "482225-individual",
    identity: target,
    properties: { Readiness: "Later" },
  });
  expect(operation?.properties).not.toHaveProperty("Status");
  expect(rows[0]?.automatedIdentity).toBe("482225-individual");
  expect(() =>
    applyIdentityMappings(rows, [
      {
        pageId: "old-page",
        fromIdentity: "482225-individual",
        toIdentity: "candidate:IS1128:wrong",
      },
    ]),
  ).toThrow("crosses course");
  expect(() =>
    applyIdentityMappings(
      [{ ...rows[0]!, automatedIdentity: null }],
      [{ pageId: "old-page", fromIdentity: "482225-individual", toIdentity: target }],
    ),
  ).toThrow("ownership changed");
});
