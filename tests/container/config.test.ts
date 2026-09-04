import { expect, test } from "bun:test";

test("container pins required tools and delegates scheduling to Dokploy", async () => {
  const dockerfile = await Bun.file("Dockerfile").text();
  expect(dockerfile).toContain("canvas@v1.13.0");
  expect(dockerfile).toContain("CODEX_VERSION=0.150.1");
  expect(dockerfile).toContain("USER nus-sync");
  expect(dockerfile).toContain('CMD ["bun", "run", "sync"]');
  expect(dockerfile).not.toContain("DOPPLER_VERSION");
  expect(dockerfile).not.toContain("doppler run");
  expect(dockerfile).not.toMatch(/CANVAS_TOKEN|RESEND_API_KEY|NOTION_TOKEN|GH_TOKEN/);
  expect(dockerfile).not.toContain("cron");
});
