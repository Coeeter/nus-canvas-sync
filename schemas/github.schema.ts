import { Schema } from "effect";

export const githubRepoSchema = Schema.Struct({
  name: Schema.String,
  nameWithOwner: Schema.String,
  description: Schema.NullOr(Schema.String),
  isPrivate: Schema.Boolean,
  updatedAt: Schema.String,
  url: Schema.String,
  defaultBranchRef: Schema.NullOr(Schema.Struct({ name: Schema.String })),
});
export const githubRepoListSchema = Schema.Array(githubRepoSchema);
export type GithubRepo = typeof githubRepoSchema.Type;

export const githubCommitSchema = Schema.Struct({
  sha: Schema.String,
  html_url: Schema.String,
  commit: Schema.Struct({
    message: Schema.String,
    author: Schema.Struct({ name: Schema.String, email: Schema.String, date: Schema.String }),
  }),
});
export const githubCommitListSchema = Schema.Array(githubCommitSchema);
export type GithubCommit = typeof githubCommitSchema.Type;

export const viewerLoginSchema = Schema.String;
