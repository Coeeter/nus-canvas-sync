import { replayFixtures } from "../collector/replay";

const dir = Bun.argv[2];
if (!dir) {
  console.error("usage: bun run fixture:replay -- <fixture-dir>");
  process.exit(1);
}

const results = replayFixtures(dir);
for (const [course, diff] of Object.entries(results)) {
  console.log(`${course}: +${diff.added.length} ~${diff.changed.length} -${diff.removed.length}`);
}
