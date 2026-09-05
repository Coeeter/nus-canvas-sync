import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BunServices } from "@effect/platform-bun";
import { Effect } from "effect";
import { withRunLock } from "../../src/state/lock";

test("kernel lock excludes overlap and releases on SIGKILL, without deleting the inode", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nus-lock-"));
  const module = join(import.meta.dir, "../../src/state/lock.ts");
  const script = `import {withRunLock} from ${JSON.stringify(module)}; import {Effect} from 'effect'; import {BunServices} from '@effect/platform-bun'; await Effect.runPromise(withRunLock(process.argv[1],Effect.gen(function*(){console.log('locked');yield* Effect.never;})).pipe(Effect.provide(BunServices.layer)));`;
  const child = Bun.spawn([process.execPath, "--eval", script, dir], {
    stdout: "pipe",
    stderr: "pipe",
    cwd: process.cwd(),
  });
  try {
    const reader = child.stdout.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain("locked");
    reader.releaseLock();
    await expect(
      Effect.runPromise(withRunLock(dir, Effect.void).pipe(Effect.provide(BunServices.layer))),
    ).rejects.toThrow();
    child.kill(9);
    await child.exited;
    expect(
      await Effect.runPromise(
        withRunLock(dir, Effect.succeed("recovered")).pipe(Effect.provide(BunServices.layer)),
      ),
    ).toBe("recovered");
    expect(await Bun.file(join(dir, "run.lock")).exists()).toBe(true);
  } finally {
    child.kill();
    await child.exited;
    await rm(dir, { recursive: true, force: true });
  }
}, 10000);
