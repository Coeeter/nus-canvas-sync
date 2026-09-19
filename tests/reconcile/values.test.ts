import { expect, test } from "bun:test";
import {
  isMachineDateValue,
  normalizeDateValue,
  parseReconciliationDate,
} from "../../src/reconcile/values";

test("machine date parsing accepts valid ISO forms and rejects ambiguous text", () => {
  expect(isMachineDateValue("2026-09-30")).toBe(true);
  expect(isMachineDateValue("2026-09-30T23:59:00+08:00")).toBe(true);
  expect(isMachineDateValue("2026-02-30")).toBe(false);
  expect(isMachineDateValue("2026-09-30T02:00:00")).toBe(false);
  expect(isMachineDateValue("September 30")).toBe(false);
  expect(normalizeDateValue("September 30")).toBe("September 30");
  expect(parseReconciliationDate("September 30")).toBe(null);
});
