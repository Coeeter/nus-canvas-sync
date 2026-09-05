import { Schema } from "effect";
export const normalizedRecordSchema = Schema.Struct({
  id: Schema.String,
  courseCode: Schema.Literals(["CS2030S", "GEA1000", "GESS1001", "IS1128", "MA1301"]),
  kind: Schema.Literals([
    "assignment",
    "quiz",
    "announcement",
    "module",
    "page",
    "file",
    "document",
    "planner-item",
    "github-repo",
    "github-commit",
  ]),
  sourceUrl: Schema.NullOr(Schema.String),
  contentHash: Schema.String,
  fields: Schema.Record(Schema.String, Schema.Unknown),
});
