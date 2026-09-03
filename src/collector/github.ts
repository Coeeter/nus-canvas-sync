import { Effect, Redacted } from "effect";
import {
  githubCommitListSchema,
  githubRepoListSchema,
  viewerLoginSchema,
} from "../../schemas/github.schema";
import { AppConfig } from "../config/env";
import { decodeRequired } from "./outcome";
import { runProcess } from "./process";

const CS2030S_ORG = "nus-cs2030s-2627-s1";
const COMMIT_FETCH_CONCURRENCY = 4;

export class GithubClient extends Effect.Service<GithubClient>()("GithubClient", {
  accessors: true,
  dependencies: [AppConfig.Default],
  effect: Effect.gen(function* () {
    const config = yield* AppConfig;
    const env = { GH_TOKEN: Redacted.value(config.githubToken), PATH: process.env.PATH ?? "" };

    const viewerLogin = Effect.gen(function* () {
      const args = ["api", "user", "--jq", ".login"];
      const result = yield* runProcess("gh", args, env);
      // `gh api ... --jq .login` prints a bare string, not JSON; wrap it before schema decoding.
      return yield* decodeRequired({
        command: `gh ${args.join(" ")}`,
        result: { ...result, stdout: JSON.stringify(result.stdout.trim()) },
        schema: viewerLoginSchema,
      });
    });

    const repositories = Effect.gen(function* () {
      const args = [
        "repo",
        "list",
        CS2030S_ORG,
        "--limit",
        "1000",
        "--json",
        "name,nameWithOwner,description,isPrivate,updatedAt,url,defaultBranchRef",
      ];
      const result = yield* runProcess("gh", args, env);
      return yield* decodeRequired({
        command: `gh ${args.join(" ")}`,
        result,
        schema: githubRepoListSchema,
      });
    });

    const commits = (repoName: string) =>
      Effect.gen(function* () {
        const args = [
          "api",
          "-X",
          "GET",
          `repos/${CS2030S_ORG}/${repoName}/commits`,
          "-f",
          "per_page=100",
        ];
        const result = yield* runProcess("gh", args, env);
        return yield* decodeRequired({
          command: `gh ${args.join(" ")}`,
          result,
          schema: githubCommitListSchema,
        });
      });

    const relevantExerciseRepos = (login: string, repoNames: ReadonlyArray<string>) =>
      repoNames.filter((name) => new RegExp(`^exercises-ex\\d+-${login}$`).test(name));

    return {
      viewerLogin,
      repositories,
      commits,
      relevantExerciseRepos,
      commitConcurrency: COMMIT_FETCH_CONCURRENCY,
    };
  }),
}) {}

export function filterRelevantRepos<T extends { name: string }>(
  repos: ReadonlyArray<T>,
  login: string,
) {
  return repos.filter(
    (repo) => /^ex\d+-skeleton$/.test(repo.name) || repo.name.endsWith(`-${login}`),
  );
}
