import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { YapsCli } from "../src/yaps-cli";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("YapsCli response contracts", () => {
  test("unwraps note envelopes returned by create and daily-open", async () => {
    const fixture = await createFixtureCli();
    const cli = new YapsCli({
      configuredPath: fixture.executable,
      vaultRoot: fixture.vault,
    });

    const created = await cli.createNote("Captured thought", "A local note", "Inbox");
    const daily = await cli.openDailyNote();

    expect(created.path).toBe("Inbox/Captured thought.md");
    expect(created.source).toBe("manual");
    expect(daily.path).toBe("Daily/2026-07-19.md");
  });

  test("returns null when Yaps cannot find a requested note", async () => {
    const fixture = await createFixtureCli();
    const cli = new YapsCli({
      configuredPath: fixture.executable,
      vaultRoot: fixture.vault,
    });

    expect(await cli.getNote("Missing.md")).toBeNull();
  });
});

async function createFixtureCli(): Promise<{ executable: string; vault: string }> {
  const directory = await mkdtemp(join(tmpdir(), "yaps-obsidian-cli-test-"));
  temporaryDirectories.push(directory);
  const executable = join(directory, "fake-yaps-cli");
  const vault = join(directory, "vault with spaces");
  await writeFile(
    executable,
    `#!/bin/sh
case " $* " in
  *" vault create "*)
    printf '%s\\n' '{"changed_fields":["create"],"note":{"aliases":[],"created_at":1,"id":"created","kind":"text","markdown":"A local note","path":"Inbox/Captured thought.md","pinned":false,"source":"manual","tags":[],"title":"Captured thought","updated_at":1}}'
    ;;
  *" vault daily-open "*)
    printf '%s\\n' '{"changed_fields":["daily_open"],"note":{"aliases":[],"created_at":1,"id":"daily","kind":"text","markdown":"","path":"Daily/2026-07-19.md","pinned":false,"source":"manual","tags":["daily"],"title":"2026-07-19","updated_at":1}}'
    ;;
  *" vault get "*)
    printf '%s\\n' '{"note":null}'
    ;;
  *)
    printf '%s\\n' '{"error":"unexpected fixture invocation"}'
    ;;
esac
`,
    { mode: 0o700 },
  );
  await chmod(executable, 0o700);
  return { executable, vault };
}
