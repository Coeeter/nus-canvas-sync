import { expect, test } from "bun:test";
import { transcriptFailure } from "../src/codex";

test("reports model rejection from Codex JSON events", () => {
  expect(
    transcriptFailure('{"type":"turn.failed","error":{"message":"model not supported"}}\n'),
  ).toBe("model not supported");
});
