import { expect, test } from "bun:test";
import { codexModels, isUnsupportedModel, transcriptFailure } from "../src/codex";

test("reports model rejection from Codex JSON events", () => {
  expect(
    transcriptFailure('{"type":"turn.failed","error":{"message":"model not supported"}}\n'),
  ).toBe("model not supported");
});

test("reads the model preference list in order", () => {
  expect(codexModels(" gpt-6-luna, gpt-5.6-luna ,")).toEqual(["gpt-6-luna", "gpt-5.6-luna"]);
  expect(codexModels(undefined)).toEqual([undefined]);
});

test("recognises the ChatGPT-account model rejection", () => {
  expect(
    isUnsupportedModel(
      transcriptFailure(
        `{"type":"turn.failed","error":{"message":"{\\"type\\":\\"error\\",\\"status\\":400,\\"error\\":{\\"type\\":\\"invalid_request_error\\",\\"message\\":\\"The 'gpt-6-luna' model is not supported when using Codex with a ChatGPT account.\\"}}"}}\n`,
      ),
    ),
  ).toBe(true);
  expect(isUnsupportedModel("Reconnecting... stream disconnected")).toBe(false);
});
