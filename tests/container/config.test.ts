import { expect, test } from "bun:test";

test("container pins required tools and delegates scheduling to Dokploy", async () => {
  const dockerfile = await Bun.file("Dockerfile").text();
  const dockerignore = await Bun.file(".dockerignore").text();
  expect(dockerfile).toContain("CANVAS_VERSION=1.13.0");
  expect(dockerfile).toContain(
    "CANVAS_SHA256=161c9e938c839cfcfdc967ed9d1a14e86e89f8bf4251808839a7c314f10b0b46",
  );
  expect(dockerfile).toContain("canvas-cli_linux_x86_64.tar.gz");
  expect(dockerfile).not.toContain("golang:");
  expect(dockerfile).not.toContain("go install");
  expect(dockerfile).toContain("CODEX_VERSION=0.150.1");
  expect(dockerfile).toContain("USER nus-sync");
  expect(dockerfile).toContain('CMD ["bun", "run", "sync"]');
  expect(dockerfile).not.toContain("DOPPLER_VERSION");
  expect(dockerfile).not.toContain("doppler run");
  expect(dockerfile).not.toMatch(/CANVAS_TOKEN|RESEND_API_KEY|NOTION_TOKEN|GH_TOKEN/);
  expect(dockerfile).not.toContain("cron");
  expect(dockerignore).toContain(".repos");
  expect(dockerignore).toContain(".agents");
  expect(dockerignore).toContain(".claude");
  expect(dockerignore).toContain("skills-lock.json");
});
