export {};

const expected = [
  ["canvas", ["--version"], "canvas-cli version 1.13.0"],
  ["codex", ["--version"], "codex-cli 0.150.1"],
  ["gh", ["--version"], "gh version 2.98.0"],
  ["doppler", ["--version"], "v3.76.1"],
] as const;

for (const [binary, args, version] of expected) {
  const result = Bun.spawnSync([binary, ...args], { stdout: "pipe", stderr: "ignore" });
  const output = new TextDecoder().decode(result.stdout).trim();
  if (result.exitCode !== 0 || !output.includes(version)) {
    throw new Error(`${binary} is unavailable or not pinned to the expected version`);
  }
}

for (const file of ["prompts/extract-course.md", "schemas/course-candidates.schema.json"]) {
  if (!(await Bun.file(file).exists())) throw new Error(`Missing runtime file: ${file}`);
}

console.log(JSON.stringify({ event: "healthcheck", ok: true }));
