import { describe, expect, test } from "bun:test";
import { Effect, Either, Schema } from "effect";
import { classifyFailure, decodeEndpoint, decodeRequired } from "../../src/collector/outcome";
import type { ProcessResult } from "../../src/collector/process";
import type { CourseCapabilities, CourseCode } from "../../src/config/courses";

const okResult = (stdout: string): ProcessResult => ({ stdout, stderr: "", exitCode: 0 });
const failResult = (stderr: string): ProcessResult => ({ stdout: "", stderr, exitCode: 1 });

describe("classifyFailure", () => {
  test("recognizes auth, not-found, and transient shapes", () => {
    expect(classifyFailure("Error: 401 Unauthorized")).toBe("auth");
    expect(classifyFailure("Error: 404 Not Found")).toBe("not-found");
    expect(classifyFailure("Error: 503 Service Unavailable")).toBe("transient");
    expect(classifyFailure("Error: something else entirely")).toBe("unknown");
  });

  test("recognizes British 'unauthorised' spelling, not just American 'unauthorized'", () => {
    expect(classifyFailure("Error: user not authorised")).toBe("auth");
    expect(classifyFailure("Error: user not authorized")).toBe("auth");
    expect(classifyFailure("Error: unauthorized")).toBe("auth");
  });
});

describe("decodeEndpoint", () => {
  const schema = Schema.Array(Schema.Struct({ id: Schema.Number }));

  test("a declared gap that 404s becomes a non-fatal CapabilityGapError (SRC-005)", async () => {
    const capabilities: Record<CourseCode, CourseCapabilities> = {
      CS2030S: { gaps: {} },
      GEA1000: { gaps: {} },
      GESS1001: { gaps: {} },
      IS1128: { gaps: { quizzes: ["modules", "announcements"] } },
      MA1301: { gaps: {} },
    };

    const result = await Effect.runPromise(
      Effect.either(
        decodeEndpoint({
          course: "IS1128",
          endpoint: "quizzes",
          command: "canvas quizzes list",
          result: failResult("404 Not Found"),
          schema,
          capabilities,
        }),
      ),
    );
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) expect(result.left._tag).toBe("CapabilityGapError");
  });

  test("a declared course capability gap accepts its observed authorization failure", async () => {
    const result = await Effect.runPromise(
      Effect.either(
        decodeEndpoint({
          course: "GESS1001",
          endpoint: "files",
          command: "canvas files list",
          result: failResult("403 user not authorised to perform that action"),
          schema,
        }),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) expect(result.left._tag).toBe("CapabilityGapError");
  });

  test("GESS1001 files matches its declared auth gap on British 'unauthorised' wording alone", async () => {
    const result = await Effect.runPromise(
      Effect.either(
        decodeEndpoint({
          course: "GESS1001",
          endpoint: "files",
          command: "canvas files list",
          result: failResult("user not authorised to perform that action"),
          schema,
        }),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) expect(result.left._tag).toBe("CapabilityGapError");
  });

  test("an undeclared 404 is task-affecting, never silently treated as a gap", async () => {
    const result = await Effect.runPromise(
      Effect.either(
        decodeEndpoint({
          course: "IS1128",
          endpoint: "quizzes",
          command: "canvas quizzes list",
          result: failResult("404 Not Found"),
          schema,
        }),
      ),
    );
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) expect(result.left._tag).toBe("TaskAffectingFailureError");
  });

  test("an undeclared failure is task-affecting, never silently empty (SRC-004)", async () => {
    const result = await Effect.runPromise(
      Effect.either(
        decodeEndpoint({
          course: "CS2030S",
          endpoint: "assignments",
          command: "canvas assignments list",
          result: failResult("500 Internal Server Error"),
          schema,
        }),
      ),
    );
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) expect(result.left._tag).toBe("TaskAffectingFailureError");
  });

  test("a response that fails schema validation is task-affecting, not a silent empty success", async () => {
    const result = await Effect.runPromise(
      Effect.either(
        decodeEndpoint({
          course: "CS2030S",
          endpoint: "assignments",
          command: "canvas assignments list",
          result: okResult(JSON.stringify([{ id: "not-a-number" }])),
          schema,
        }),
      ),
    );
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) expect(result.left._tag).toBe("TaskAffectingFailureError");
  });

  test("a transient failure is retryable, distinct from a hard failure", async () => {
    const result = await Effect.runPromise(
      Effect.either(
        decodeRequired({
          command: "canvas planner items",
          result: failResult("504 Gateway Timeout"),
          schema,
        }),
      ),
    );
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) expect(result.left._tag).toBe("TransientFailureError");
  });

  test("a valid response decodes successfully", async () => {
    const result = await Effect.runPromise(
      decodeRequired({
        command: "canvas planner items",
        result: okResult(JSON.stringify([{ id: 1 }])),
        schema,
      }),
    );
    expect(result).toEqual([{ id: 1 }]);
  });
});
