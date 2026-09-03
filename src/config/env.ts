import { Config, Effect, type Redacted } from "effect";

export interface AppConfigShape {
  readonly canvasUrl: string;
  readonly canvasToken: Redacted.Redacted<string>;
  readonly githubToken: Redacted.Redacted<string>;
  readonly dataDir: string;
}

/**
 * SRC-003: credentials are read at runtime via `Config.redacted`, which
 * masks the value in any log/error rendering, and are never written to
 * snapshots or manifests.
 */
export class AppConfig extends Effect.Service<AppConfig>()("AppConfig", {
  effect: Effect.gen(function* () {
    const canvasUrl = yield* Config.string("CANVAS_URL");
    const canvasToken = yield* Config.redacted("CANVAS_TOKEN");
    const githubToken = yield* Config.redacted("GH_TOKEN");
    const dataDir = yield* Config.string("DATA_DIR").pipe(Config.withDefault("./snapshots"));
    return { canvasUrl, canvasToken, githubToken, dataDir } satisfies AppConfigShape;
  }),
}) {}
