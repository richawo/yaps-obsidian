import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  macBundleMetadataAuthSafety,
  resolveWindowsShim,
  windowsCliAuthSafety,
  windowsPathCliCandidates,
  YapsCli,
  YapsCliNotFoundError,
} from "../src/yaps-cli";

const temporaryDirectories: string[] = [];
const originalPath = process.env.PATH;
const originalCliOverride = process.env.YAPS_CLI_BINARY;
const originalSettingsOverride = process.env.YAPS_SETTINGS_PATH;

afterEach(async () => {
  restoreEnvironment("PATH", originalPath);
  restoreEnvironment("YAPS_CLI_BINARY", originalCliOverride);
  restoreEnvironment("YAPS_SETTINGS_PATH", originalSettingsOverride);
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
      credentialFreeAuthStatus: async () => true,
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
      credentialFreeAuthStatus: async () => true,
      vaultRoot: fixture.vault,
    });

    expect(await cli.getNote("Missing.md")).toBeNull();
  });

  test("automatically follows the desktop app's canonical settings path", async () => {
    const fixture = await createFixtureCli();
    await writeFile(fixture.mismatch, "");
    const cli = new YapsCli({
      configuredPath: fixture.executable,
      credentialFreeAuthStatus: async () => true,
      vaultRoot: fixture.vault,
    });

    await cli.createNote("Captured thought", "A local note", "Inbox");

    const invocation = await readFile(fixture.invocation, "utf8");
    expect(invocation).toContain(`--settings-path ${fixture.settingsPath}`);
  });

  test("does not run auth status when the installed helper is not proven credential-free", async () => {
    const fixture = await createFixtureCli();
    const cli = new YapsCli({
      configuredPath: fixture.executable,
      credentialFreeAuthStatus: async () => false,
      vaultRoot: fixture.vault,
    });

    expect((await captureError(cli.createNote("Captured thought", "A local note", "Inbox"))).message)
      .toMatch(/could not verify that its account check is credential-free/);

    expect(await readFile(fixture.authInvocation, "utf8").catch(() => null)).toBeNull();
    expect(await readFile(fixture.invocation, "utf8").catch(() => null)).toBeNull();
  });

  test("never runs auth status for a known pre-2.3.124 helper", async () => {
    const fixture = await createFixtureCli();
    const cli = new YapsCli({
      configuredPath: fixture.executable,
      credentialFreeAuthStatus: async () => "unsafe",
      vaultRoot: fixture.vault,
    });

    expect((await captureError(cli.status())).message).toMatch(/Update Yaps to 2\.3\.124 or newer/);
    expect(await readFile(fixture.authInvocation, "utf8").catch(() => null)).toBeNull();
  });

  for (const account of ["expired", "platform_mismatch", "signed_out"] as const) {
    test(`blocks vault access when the desktop account is ${account}`, async () => {
      const fixture = await createFixtureCli({ account });
      const cli = new YapsCli({
        configuredPath: fixture.executable,
        credentialFreeAuthStatus: async () => true,
        launchYapsApp: async () => {
          throw new Error("non-refreshable accounts must never launch Yaps");
        },
        vaultRoot: fixture.vault,
      });

      expect((await captureError(cli.createNote("Blocked", "Never written", "Inbox"))).message).toMatch(
        account === "expired"
          ? /trial or Yaps Pro access is not active/
          : account === "platform_mismatch"
            ? /only has mobile access/
            : /no active desktop account is signed in/,
      );
      expect(await readFile(fixture.invocation, "utf8").catch(() => null)).toBeNull();
    });
  }

  test("configured path takes precedence over the environment and PATH", async () => {
    const configured = await createFixtureCli();
    const environment = await createFixtureCli();
    process.env.YAPS_CLI_BINARY = environment.executable;
    process.env.PATH = join(environment.directory, "unused-path");
    const cli = new YapsCli({
      configuredPath: configured.executable,
      credentialFreeAuthStatus: async () => true,
      vaultRoot: configured.vault,
    });

    await cli.createNote("Configured", "Chosen", "Inbox");

    expect(await readFile(configured.invocation, "utf8")).toContain("vault create");
    expect(await readFile(environment.invocation, "utf8").catch(() => null)).toBeNull();
  });

  test("uses the environment override without requiring PATH setup", async () => {
    const fixture = await createFixtureCli();
    process.env.YAPS_CLI_BINARY = fixture.executable;
    process.env.PATH = "";
    const cli = new YapsCli({
      credentialFreeAuthStatus: async () => true,
      vaultRoot: fixture.vault,
    });

    expect(await cli.resolveCliPath()).toBe(fixture.executable);
  });

  test("rejects the canonical macOS GUI executable before spawning it as a CLI", async () => {
    const directory = await temporaryDirectory("yaps-obsidian-gui-guard-");
    const executable = join(directory, "Yaps.app", "Contents", "MacOS", "yaps");
    const spawnSentinel = join(directory, "gui-was-spawned");
    await mkdir(join(executable, ".."), { recursive: true });
    await writeExecutable(executable, `#!/bin/sh\nprintf x > ${JSON.stringify(spawnSentinel)}\nprintf '%s\\n' '{"settings_path":"/settings","settings_exists":true,"auth_store_path":"/auth","models_dir":"/models"}'`);
    const cli = new YapsCli({ configuredPath: executable, vaultRoot: directory });

    expect(await captureError(cli.resolveCliPath())).toBeInstanceOf(YapsCliNotFoundError);
    expect(await readFile(spawnSentinel, "utf8").catch(() => null)).toBeNull();
  });

  test("still accepts a real PATH wrapper named yaps", async () => {
    const fixture = await createFixtureCli();
    const pathDirectory = await temporaryDirectory("yaps-obsidian-wrapper-");
    const wrapper = join(pathDirectory, "yaps");
    await symlink(fixture.executable, wrapper);
    process.env.PATH = pathDirectory;
    delete process.env.YAPS_CLI_BINARY;
    const cli = new YapsCli({
      credentialFreeAuthStatus: async () => true,
      vaultRoot: fixture.vault,
    });

    expect(await cli.resolveCliPath()).toBe(wrapper);
  });

  test("continues past an unverifiable PATH wrapper to a supported helper", async () => {
    const wrapperFixture = await createFixtureCli();
    const helperFixture = await createFixtureCli();
    const directory = await temporaryDirectory("yaps-obsidian-path-fallback-");
    const wrapper = join(directory, "yaps");
    const helper = join(directory, "yaps_cli");
    await symlink(wrapperFixture.executable, wrapper);
    await symlink(helperFixture.executable, helper);
    process.env.PATH = directory;
    delete process.env.YAPS_CLI_BINARY;
    const cli = new YapsCli({
      credentialFreeAuthStatus: async (path) => path === helper ? "safe" : "unverified",
      vaultRoot: helperFixture.vault,
    });

    expect((await cli.status()).note_count).toBe(0);
    expect(await cli.resolveCliPath()).toBe(helper);
    expect(await readFile(wrapperFixture.authInvocation, "utf8").catch(() => null)).toBeNull();
    expect(await readFile(helperFixture.authInvocation, "utf8")).toContain("auth status");
  });

  test("stops after the configured discovery probe limit", async () => {
    const directory = await temporaryDirectory("yaps-obsidian-bounds-");
    const invalid = join(directory, "yaps");
    const valid = join(directory, "yaps_cli");
    const validInvocation = join(directory, "valid-invocation");
    await writeExecutable(invalid, "#!/bin/sh\nprintf '%s\\n' '{}'");
    await writeExecutable(valid, `#!/bin/sh\nprintf x > ${JSON.stringify(validInvocation)}\nprintf '%s\\n' '{"settings_path":"/settings","settings_exists":true,"auth_store_path":"/auth","models_dir":"/models"}'`);
    process.env.PATH = directory;
    delete process.env.YAPS_CLI_BINARY;
    const cli = new YapsCli({
      credentialFreeAuthStatus: async () => true,
      maxDiscoveryProbes: 1,
      vaultRoot: directory,
    });

    expect(await captureError(cli.resolveCliPath())).toBeInstanceOf(YapsCliNotFoundError);
    expect(await readFile(validInvocation, "utf8").catch(() => null)).toBeNull();
  });

  test("bounds discovery when account-safety metadata never settles", async () => {
    const fixture = await createFixtureCli();
    const directory = await temporaryDirectory("yaps-obsidian-metadata-deadline-");
    const wrapper = join(directory, "yaps");
    await symlink(fixture.executable, wrapper);
    process.env.PATH = directory;
    delete process.env.YAPS_CLI_BINARY;
    const cli = new YapsCli({
      credentialFreeAuthStatus: () => new Promise(() => {}),
      discoveryTimeoutMs: 800,
      maxDiscoveryProbes: 1,
      vaultRoot: fixture.vault,
    });
    const started = Date.now();

    expect(await cli.resolveCliPath()).toBe(wrapper);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(await readFile(fixture.authInvocation, "utf8").catch(() => null)).toBeNull();
  });

  test("rejects a Setapp bundle reached through a PATH symlink without running auth status", async () => {
    const fixture = await createFixtureCli({ layout: "setapp" });
    const pathDirectory = await temporaryDirectory("yaps-obsidian-setapp-path-");
    await symlink(fixture.executable, join(pathDirectory, "yaps"));
    process.env.PATH = pathDirectory;
    delete process.env.YAPS_CLI_BINARY;
    const cli = new YapsCli({ maxDiscoveryProbes: 1, vaultRoot: fixture.vault });

    expect((await captureError(cli.status())).message).toMatch(/could not verify that its account check is credential-free/);
    expect(await readFile(fixture.authInvocation, "utf8").catch(() => null)).toBeNull();
  });

  test("boundedly wakes the verified app and recovers a refreshable signed-in cache", async () => {
    const fixture = await createFixtureCli({ account: "verification_unavailable" });
    let launchCount = 0;
    const cli = new YapsCli({
      authRecoveryTimeoutMs: 100,
      authRetryDelaysMs: [0],
      configuredPath: fixture.executable,
      credentialFreeAuthStatus: async () => true,
      launchYapsApp: async () => {
        launchCount += 1;
        await writeFile(fixture.activeMarker, "");
        return true;
      },
      sleep: async () => undefined,
      vaultRoot: fixture.vault,
    });

    expect((await cli.status()).note_count).toBe(0);
    expect(launchCount).toBe(1);
    expect((await readFile(fixture.authInvocation, "utf8")).trim().split("\n")).toHaveLength(2);
  });

  test("refuses to wake or retry from an arbitrary refreshable CLI path", async () => {
    const fixture = await createFixtureCli({ account: "cached_offline" });
    const cli = new YapsCli({
      configuredPath: fixture.executable,
      credentialFreeAuthStatus: async () => true,
      vaultRoot: fixture.vault,
    });

    expect((await captureError(cli.status())).message).toMatch(/could not verify current trial or Yaps Pro access/);
    expect((await readFile(fixture.authInvocation, "utf8")).trim().split("\n")).toHaveLength(1);
  });

  test("does not wake Yaps for an already healthy account", async () => {
    const fixture = await createFixtureCli();
    let launchCount = 0;
    const cli = new YapsCli({
      configuredPath: fixture.executable,
      credentialFreeAuthStatus: async () => true,
      launchYapsApp: async () => {
        launchCount += 1;
        return true;
      },
      vaultRoot: fixture.vault,
    });

    await cli.status();
    expect(launchCount).toBe(0);
  });

  test("requires the standard macOS bundle identifier as well as a safe version", () => {
    const plist = (bundleIdentifier: string) => `<?xml version="1.0"?><plist><dict>
      <key>CFBundleIdentifier</key><string>${bundleIdentifier}</string>
      <key>CFBundleShortVersionString</key><string>2.3.124</string>
    </dict></plist>`;

    expect(macBundleMetadataAuthSafety(plist("com.yaps.app"))).toBe("safe");
    expect(macBundleMetadataAuthSafety(plist("com.yaps.app-setapp"))).toBe("unverified");
  });

  test("prefers the official Windows yaps.cmd PATH shim over a stale yaps.exe", () => {
    const candidates = windowsPathCliCandidates(
      "C:\\Users\\tester\\.local\\bin",
      ".EXE;.CMD",
    );

    expect(candidates.indexOf("C:\\Users\\tester\\.local\\bin\\yaps.cmd"))
      .toBeLessThan(candidates.indexOf("C:\\Users\\tester\\.local\\bin\\yaps.exe"));
  });

  test("resolves a strict Windows shim target without executing the command file", async () => {
    const shim = "C:\\Users\\tester\\.local\\bin\\yaps.cmd";
    const binary = "C:\\Program Files\\Yaps\\yaps_cli.exe";
    expect(await resolveWindowsShim(shim, {
      canAccess: async (candidate) => candidate === binary,
      platform: "win32",
      readFile: async () => `@echo off\r\n"${binary}" %*\r\n`,
    })).toBe(binary);
    expect(await resolveWindowsShim(shim, {
      canAccess: async () => true,
      platform: "win32",
      readFile: async () => `@echo off\r\n"${binary}" %* & whoami\r\n`,
    })).toBeUndefined();
  });

  test("accepts a configured custom-directory Windows CLI from its own safe ProductVersion", async () => {
    const configured = "D:\\Tools\\Yaps Custom\\yaps_cli.exe";
    let inspected: string | undefined;

    expect(await windowsCliAuthSafety(configured, async (target) => {
      inspected = target;
      return "2.3.124";
    })).toBe("safe");
    expect(inspected).toBe(configured);
    expect(await windowsCliAuthSafety(configured, async () => "2.3.123")).toBe("unsafe");
    expect(await windowsCliAuthSafety("D:\\Tools\\Yaps.exe", async () => "9.0.0")).toBe("unverified");
  });
});

async function createFixtureCli(options: {
  account?: "active" | "cached_offline" | "expired" | "platform_mismatch" | "signed_out" | "verification_unavailable";
  layout?: "plain" | "setapp";
} = {}): Promise<{
  executable: string;
  activeMarker: string;
  authInvocation: string;
  directory: string;
  invocation: string;
  mismatch: string;
  settingsPath: string;
  vault: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), "yaps-obsidian-cli-test-"));
  temporaryDirectories.push(directory);
  const executable = options.layout === "setapp"
    ? join(directory, "Applications", "Setapp", "Yaps.app", "Contents", "MacOS", "yaps_cli")
    : join(directory, "fake-yaps-cli");
  const invocation = join(directory, "invocation.txt");
  const authInvocation = join(directory, "auth-invocation.txt");
  const activeMarker = join(directory, "account-active");
  const mismatch = join(directory, "settings-mismatch");
  const settingsPath = join(directory, "canonical settings", "settings.json");
  const vault = join(directory, "vault with spaces");
  const account = options.account ?? "active";
  const accountResponse = JSON.stringify({
    authenticated: !["signed_out", "verification_unavailable"].includes(account),
    status: account,
  });
  await mkdir(join(executable, ".."), { recursive: true });
  if (options.layout === "setapp") {
    await writeFile(join(executable, "..", "..", "Info.plist"), `<?xml version="1.0"?><plist><dict>
      <key>CFBundleIdentifier</key><string>com.yaps.app-setapp</string>
      <key>CFBundleShortVersionString</key><string>2.3.124</string>
    </dict></plist>`);
  }
  await writeFile(
    executable,
    `#!/bin/sh
case " $* " in
  " status --pretty ")
    printf '%s\n' '{"settings_path":"/settings","settings_exists":true,"auth_store_path":"/auth","models_dir":"/models"}'
    ;;
  *" auth status "*)
    printf '%s\n' "$*" >> ${JSON.stringify(authInvocation)}
    if [ -f ${JSON.stringify(mismatch)} ] && ! printf '%s' "$*" | grep -q -- '--settings-path'; then
      printf '%s\n' '{"authenticated":false,"status":"settings_path_mismatch","recommended_settings_path":${JSON.stringify(settingsPath)}}'
    elif [ -f ${JSON.stringify(activeMarker)} ]; then
      printf '%s\n' '{"authenticated":true,"status":"active"}'
    else
      printf '%s\n' ${JSON.stringify(accountResponse)}
    fi
    ;;
  *" vault create "*)
    printf '%s' "$*" > ${JSON.stringify(invocation)}
    printf '%s\\n' '{"changed_fields":["create"],"note":{"aliases":[],"created_at":1,"id":"created","kind":"text","markdown":"A local note","path":"Inbox/Captured thought.md","pinned":false,"source":"manual","tags":[],"title":"Captured thought","updated_at":1}}'
    ;;
  *" vault status "*)
    printf '%s\\n' ${JSON.stringify(JSON.stringify({ index_initialized: true, note_count: 0, root: vault }))}
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
  return { activeMarker, executable, authInvocation, directory, invocation, mismatch, settingsPath, vault };
}

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeExecutable(path: string, contents: string): Promise<void> {
  await writeFile(path, `${contents}\n`, { mode: 0o700 });
  await chmod(path, 0o700);
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

async function captureError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
  }
  throw new Error("Expected the operation to fail");
}
