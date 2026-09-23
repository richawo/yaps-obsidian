import { execFile, spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdtemp, open, realpath, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, resolve, sep, win32 } from "node:path";
import { promisify } from "node:util";
import { mergeSearchHits, normalizedFolder } from "./format";
import type {
  SearchMode,
  ShortcutBindingResult,
  VaultNote,
  VaultNoteMutationResult,
  VaultNoteResult,
  VaultNotesListResult,
  VaultSearchResult,
  VaultStatus,
} from "./types";

const execFileAsync = promisify(execFile);
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const CLI_TIMEOUT_MS = 30_000;
const CLI_DISCOVERY_TIMEOUT_MS = 5_000;
const CLI_DISCOVERY_TOTAL_TIMEOUT_MS = 15_000;
const MAX_CLI_DISCOVERY_PROBES = 8;
const MAX_DISCOVERY_OUTPUT_BYTES = 64 * 1024;
const MAX_METADATA_BYTES = 64 * 1024;
const MAX_WINDOWS_SHIM_BYTES = 4 * 1024;
const MIN_SAFE_AUTH_STATUS_VERSION = [2, 3, 124] as const;
const YAPS_DOWNLOAD_URL = "https://yaps.ai/download";
const AUTH_RECOVERY_TIMEOUT_MS = 8_000;
const AUTH_RETRY_DELAYS_MS = [250, 500, 1_000, 2_000] as const;
const REFRESHABLE_AUTH_STATES = new Set(["cached_offline", "verification_unavailable"]);
const REFRESHABLE_AUTH_DIAGNOSTICS = new Set([
  "account_cache_incomplete",
  "credential_missing",
  "profile_lookup_failed",
  "refresh_failed",
]);
type AuthStatusSafety = "safe" | "unsafe" | "unverified";

export class YapsCliNotFoundError extends Error {
  constructor() {
    super("The Yaps CLI could not be found or validated. Update Yaps or correct the configured CLI path.");
    this.name = "YapsCliNotFoundError";
  }
}

export interface YapsCliOptions {
  authRecoveryTimeoutMs?: number;
  authRetryDelaysMs?: readonly number[];
  configuredPath?: string;
  credentialFreeAuthStatus?: (cliPath: string) => Promise<boolean | AuthStatusSafety>;
  discoveryTimeoutMs?: number;
  launchYapsApp?: (cliPath: string) => Promise<boolean>;
  maxDiscoveryProbes?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  vaultRoot: string;
}

export class YapsCli {
  private cachedCliPath: string | undefined;
  private sessionPromise: Promise<AccountSession> | undefined;

  constructor(private readonly options: YapsCliOptions) {}

  async status(): Promise<VaultStatus> {
    return this.run<VaultStatus>(["vault", "status"]);
  }

  async listNotes(limit: number): Promise<VaultNote[]> {
    const result = await this.run<VaultNotesListResult>([
      "vault",
      "list",
      "--limit",
      String(limit),
    ]);
    return [...result.notes].sort((left, right) => right.updated_at - left.updated_at);
  }

  async search(query: string, limit: number, mode: SearchMode): Promise<VaultSearchResult> {
    if (mode === "lexical") {
      return this.runLexicalSearch(query, limit);
    }
    if (mode === "semantic") {
      return this.runSemanticSearch(query, limit, "semantic");
    }

    const [lexical, semantic] = await Promise.all([
      this.runLexicalSearch(query, limit),
      this.runSemanticSearch(query, limit, "hybrid"),
    ]);
    const hits = mergeSearchHits(lexical.hits, semantic.hits, limit);
    return {
      count: hits.length,
      hits,
      mode: semantic.fell_back ? "lexical" : "smart",
      fell_back: semantic.fell_back,
    };
  }

  async getNote(path: string): Promise<VaultNote | null> {
    const result = await this.run<VaultNoteResult>(["vault", "get", path]);
    return result.note;
  }

  async openDailyNote(): Promise<VaultNote> {
    const result = await this.run<VaultNoteMutationResult>(["vault", "daily-open"]);
    return result.note;
  }

  async createNote(title: string, markdown: string, folder: string): Promise<VaultNote> {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "yaps-obsidian-"));
    const markdownPath = join(temporaryDirectory, "capture.md");
    await writeFile(markdownPath, markdown, { encoding: "utf8", mode: 0o600 });

    try {
      const result = await this.run<VaultNoteMutationResult>([
        "vault",
        "create",
        "--folder",
        normalizedFolder(folder),
        "--title",
        title,
        "--markdown-file",
        markdownPath,
        "--source",
        "manual",
      ]);
      return result.note;
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }

  async getDictationShortcut(): Promise<ShortcutBindingResult> {
    return this.run<ShortcutBindingResult>(["settings", "get", "stt_binding"]);
  }

  async launchYapsInBackground(): Promise<void> {
    const cliPath = await this.resolveCliPath();
    if (await launchInstalledYaps(cliPath)) return;
    if (!["darwin", "win32"].includes(process.platform)) {
      throw new Error("Yaps desktop currently supports macOS and Windows.");
    }
    throw new Error("The validated Yaps CLI is working, but the matching installed Yaps app could not be opened safely. Update or reinstall Yaps and try again.");
  }

  async resolveCliPath(): Promise<string> {
    if (this.cachedCliPath) {
      return this.cachedCliPath;
    }

    const configured = this.options.configuredPath?.trim()
      || process.env.YAPS_CLI_BINARY?.trim();
    if (configured) {
      const override = expandHome(configured);
      const resolvedOverride = await resolveCliCandidate(override);
      if (resolvedOverride && await isValidatedYapsCli(
        resolvedOverride,
        Math.min(CLI_DISCOVERY_TIMEOUT_MS, this.options.discoveryTimeoutMs ?? CLI_DISCOVERY_TOTAL_TIMEOUT_MS),
      )) {
        this.cachedCliPath = resolvedOverride;
        return resolvedOverride;
      }
      throw new YapsCliNotFoundError();
    }
    const candidates = [
      ...pathCliCandidates(),
      ...(process.platform === "darwin"
        ? [
            "/Applications/Yaps.app/Contents/MacOS/yaps_cli",
            join(homedir(), "Applications", "Yaps.app", "Contents", "MacOS", "yaps_cli"),
          ]
        : []),
      ...(process.platform === "win32" ? windowsCliCandidates() : []),
      ...(process.platform === "linux" ? ["/usr/bin/yaps_cli"] : []),
    ].filter((candidate): candidate is string => Boolean(candidate));

    const deadline = Date.now() + (this.options.discoveryTimeoutMs ?? CLI_DISCOVERY_TOTAL_TIMEOUT_MS);
    let probes = 0;
    for (const candidate of candidates) {
      if (Date.now() >= deadline || probes >= (this.options.maxDiscoveryProbes ?? MAX_CLI_DISCOVERY_PROBES)) break;
      const resolvedCandidate = await resolveCliCandidate(candidate);
      if (!resolvedCandidate) continue;
      probes += 1;
      if (await isValidatedYapsCli(resolvedCandidate, Math.min(CLI_DISCOVERY_TIMEOUT_MS, Math.max(1, deadline - Date.now())))) {
        this.cachedCliPath = resolvedCandidate;
        return resolvedCandidate;
      }
    }
    throw new YapsCliNotFoundError();
  }

  private async runLexicalSearch(query: string, limit: number): Promise<VaultSearchResult> {
    return this.run<VaultSearchResult>([
      "vault",
      "search",
      query,
      "--limit",
      String(limit),
    ]);
  }

  private async runSemanticSearch(
    query: string,
    limit: number,
    mode: "semantic" | "hybrid",
  ): Promise<VaultSearchResult> {
    return this.run<VaultSearchResult>([
      "vault",
      "search-semantic",
      query,
      "--limit",
      String(limit),
      "--mode",
      mode,
    ]);
  }

  private async run<T>(args: string[]): Promise<T> {
    const cliPath = await this.resolveCliPath();
    const session = await this.resolveAccountSession(cliPath);
    if (args[0] === "vault") {
      const diagnosis = diagnoseAccount(session);
      if (diagnosis) throw new Error(diagnosis);
    }
    const vaultRoot = resolve(this.options.vaultRoot);
    try {
      const { stdout } = await execFileAsync(
        cliPath,
        [
          ...(session.settingsPath ? ["--settings-path", session.settingsPath] : []),
          "--vault-root",
          vaultRoot,
          ...args,
          "--pretty",
        ],
        {
          encoding: "utf8",
          maxBuffer: MAX_OUTPUT_BYTES,
          timeout: CLI_TIMEOUT_MS,
          windowsHide: true,
        },
      );
      return JSON.parse(stdout) as T;
    } catch (error) {
      throw cliError(error);
    }
  }

  private async resolveAccountSession(cliPath: string): Promise<AccountSession> {
    this.sessionPromise ??= this.recoverAccountSession(cliPath).finally(() => {
      this.sessionPromise = undefined;
    });
    return this.sessionPromise;
  }

  private async recoverAccountSession(cliPath: string): Promise<AccountSession> {
    const credentialFree = this.options.credentialFreeAuthStatus ?? supportsCredentialFreeAuthStatus;
    const safetyResult = await credentialFree(cliPath);
    const authStatusSafety: AuthStatusSafety = safetyResult === true
      ? "safe"
      : safetyResult === false
        ? "unverified"
        : safetyResult;
    if (authStatusSafety !== "safe") {
      return { authStatusSafety };
    }
    const explicitSettings = Boolean(process.env.YAPS_SETTINGS_PATH?.trim());
    let settingsPath: string | undefined;
    let auth = await readAuthStatus(cliPath);
    if (!explicitSettings && auth?.status === "settings_path_mismatch" && auth.recommendedSettingsPath) {
      const retry = await readAuthStatus(cliPath, auth.recommendedSettingsPath);
      if (retry) {
        settingsPath = auth.recommendedSettingsPath;
        auth = retry;
      }
    }

    if (refreshableSignedInAuth(auth)) {
      const launch = this.options.launchYapsApp ?? launchInstalledYaps;
      if (await launch(cliPath)) {
        const now = this.options.now ?? Date.now;
        const sleep = this.options.sleep ?? delay;
        const deadline = now() + (this.options.authRecoveryTimeoutMs ?? AUTH_RECOVERY_TIMEOUT_MS);
        for (const delayMs of this.options.authRetryDelaysMs ?? AUTH_RETRY_DELAYS_MS) {
          const beforeSleep = deadline - now();
          if (beforeSleep <= 0) break;
          await sleep(Math.min(Math.max(0, delayMs), beforeSleep));
          const remaining = deadline - now();
          if (remaining <= 0) break;
          const retry = await readAuthStatus(
            cliPath,
            settingsPath,
            Math.min(CLI_DISCOVERY_TIMEOUT_MS, remaining),
          );
          if (!retry) continue;
          auth = retry;
          if (!refreshableSignedInAuth(auth)) break;
        }
      }
    }

    return { auth, authStatusSafety, settingsPath };
  }

}

function parsedVersion(value: string | undefined): number[] | undefined {
  const match = value?.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:\D|$)/);
  if (!match) return undefined;
  const parts = match.slice(1).map(Number);
  return parts.every(Number.isSafeInteger) ? parts : undefined;
}

function versionAtLeast(value: string | undefined): boolean {
  const parts = parsedVersion(value);
  if (!parts) return false;
  for (let index = 0; index < MIN_SAFE_AUTH_STATUS_VERSION.length; index += 1) {
    const installed = parts[index] ?? -1;
    const minimum = MIN_SAFE_AUTH_STATUS_VERSION[index] ?? Number.MAX_SAFE_INTEGER;
    if (installed > minimum) return true;
    if (installed < minimum) return false;
  }
  return true;
}

function authStatusSafetyForVersion(value: string | undefined): AuthStatusSafety {
  return parsedVersion(value) ? (versionAtLeast(value) ? "safe" : "unsafe") : "unverified";
}

async function readBoundedText(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(command, args, {
      encoding: "utf8",
      env,
      killSignal: "SIGKILL",
      maxBuffer: 4 * 1024,
      timeout: CLI_DISCOVERY_TIMEOUT_MS,
      windowsHide: true,
    });
    return stdout.trim();
  } catch {
    return undefined;
  }
}

async function readBoundedFile(path: string, maximumBytes: number): Promise<string | undefined> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, "r");
    const buffer = Buffer.alloc(maximumBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return bytesRead <= maximumBytes ? buffer.subarray(0, bytesRead).toString("utf8") : undefined;
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function plistString(contents: string, key: string): string | undefined {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return contents.match(new RegExp(`<key>${escapedKey}<\\/key>\\s*<string>([^<]+)<\\/string>`))?.[1]?.trim();
}

export function macBundleMetadataAuthSafety(contents: string): AuthStatusSafety {
  if (plistString(contents, "CFBundleIdentifier") !== "com.yaps.app") return "unverified";
  return authStatusSafetyForVersion(plistString(contents, "CFBundleShortVersionString"));
}

async function supportsCredentialFreeAuthStatus(cliPath: string): Promise<AuthStatusSafety> {
  let canonical = cliPath;
  try {
    canonical = await realpath(cliPath);
  } catch {
    // A validated path may disappear between discovery and this check.
  }

  if (process.platform === "darwin") {
    const suffix = `${sep}Contents${sep}MacOS${sep}yaps_cli`;
    if (!canonical.endsWith(suffix)) return "unverified";
    const application = canonical.slice(0, -suffix.length);
    if (basename(application) !== "Yaps.app") return "unverified";
    if (!(await canonicalMacApplications()).includes(application)) return "unverified";
    const plist = join(application, "Contents", "Info.plist");
    const contents = await readBoundedFile(plist, MAX_METADATA_BYTES);
    if (contents?.includes("<plist")) {
      return macBundleMetadataAuthSafety(contents);
    }
    const bundleIdentifier = await readBoundedText("/usr/bin/plutil", [
      "-extract", "CFBundleIdentifier", "raw", "-o", "-", plist,
    ]);
    if (bundleIdentifier !== "com.yaps.app") return "unverified";
    return authStatusSafetyForVersion(await readBoundedText("/usr/bin/plutil", [
      "-extract", "CFBundleShortVersionString", "raw", "-o", "-", plist,
    ]));
  }

  if (process.platform === "win32") {
    const systemRoot = process.env.SystemRoot || process.env.WINDIR;
    if (!systemRoot) return "unverified";
    const powershell = join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    if (!(await isExecutable(powershell))) return "unverified";
    return windowsCliAuthSafety(
      canonical,
      (target) => readBoundedText(
        powershell,
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "(Get-Item -LiteralPath $env:YAPS_PLUGIN_VERSION_TARGET).VersionInfo.ProductVersion"],
        { ...process.env, YAPS_PLUGIN_VERSION_TARGET: target },
      ),
    );
  }

  if (process.platform === "linux" && canonical === "/usr/bin/yaps_cli") {
    if (await isExecutable("/usr/bin/dpkg-query")) {
      const owner = await readBoundedText("/usr/bin/dpkg-query", ["-S", "/usr/bin/yaps_cli"]);
      const packageMatch = owner?.match(/^(yaps(?::[a-z0-9-]+)?):\s+\/usr\/bin\/yaps_cli$/);
      const packageName = packageMatch?.[1];
      if (packageName) {
        const version = await readBoundedText("/usr/bin/dpkg-query", ["-W", "-f=${Version}", packageName]);
        return authStatusSafetyForVersion(version);
      }
    }
    if (await isExecutable("/usr/bin/rpm")) {
      const owned = await readBoundedText("/usr/bin/rpm", ["-qf", "--queryformat", "%{NAME} %{VERSION}", "/usr/bin/yaps_cli"]);
      const match = owned?.match(/^yaps\s+(\S+)$/);
      return authStatusSafetyForVersion(match?.[1]);
    }
  }
  return "unverified";
}

export async function windowsCliAuthSafety(
  cliPath: string,
  readProductVersion: (target: string) => Promise<string | undefined>,
): Promise<AuthStatusSafety> {
  if (win32.basename(cliPath).toLowerCase() !== "yaps_cli.exe") return "unverified";
  return authStatusSafetyForVersion(await readProductVersion(cliPath));
}

export function downloadUrl(): string {
  return YAPS_DOWNLOAD_URL;
}

function pathCliCandidates(): string[] {
  if (process.platform === "win32") {
    return windowsPathCliCandidates(process.env.PATH ?? "", process.env.PATHEXT ?? ".EXE;.CMD");
  }
  const names = [executableName("yaps"), executableName("yaps_cli")];
  return (process.env.PATH ?? "")
    .split(delimiter)
    .filter(Boolean)
    .flatMap((entry) => names.map((name) => join(entry, name)));
}

export function windowsPathCliCandidates(pathValue: string, pathExtValue: string): string[] {
  const extensions = pathExtValue.split(";").filter(Boolean);
  const yapsExtensions = [...extensions].sort((left, right) =>
    Number(right.toLowerCase() === ".cmd") - Number(left.toLowerCase() === ".cmd"));
  const candidates: string[] = [];
  for (const directory of pathValue.split(win32.delimiter).filter(Boolean)) {
    for (const extension of yapsExtensions) {
      candidates.push(win32.join(directory, `yaps${extension.toLowerCase()}`));
    }
    for (const extension of extensions) {
      candidates.push(win32.join(directory, `yaps_cli${extension.toLowerCase()}`));
    }
  }
  return [...new Set(candidates)];
}

export async function resolveWindowsShim(
  candidate: string,
  options: {
    canAccess?: (path: string) => Promise<boolean>;
    platform?: NodeJS.Platform;
    readFile?: (path: string, maximumBytes: number) => Promise<string | undefined>;
  } = {},
): Promise<string | undefined> {
  if ((options.platform ?? process.platform) !== "win32" || !/\.cmd$/i.test(candidate)) {
    return candidate;
  }
  const canAccess = options.canAccess ?? isExecutable;
  const readFile = options.readFile ?? readBoundedFile;
  const contents = await readFile(candidate, MAX_WINDOWS_SHIM_BYTES);
  if (!contents) return undefined;
  for (const line of contents.split(/\r?\n/)) {
    const match = line.trim().match(/^"([^"]+)"\s+%\*\s*$/i);
    if (!match?.[1]) continue;
    const target = match[1].replace(/%%/g, "%");
    if (await canAccess(target)) return target;
  }
  return undefined;
}

function windowsCliCandidates(): string[] {
  return windowsInstallDirectories().map((directory) => join(directory, "yaps_cli.exe"));
}

function windowsAppCandidates(): string[] {
  return windowsInstallDirectories().map((directory) => join(directory, "Yaps.exe"));
}

function windowsInstallDirectories(): string[] {
  return [
    process.env.ProgramW6432 ? join(process.env.ProgramW6432, "Yaps") : undefined,
    process.env.ProgramFiles ? join(process.env.ProgramFiles, "Yaps") : undefined,
  ].filter((value): value is string => Boolean(value));
}

async function canonicalMacApplications(): Promise<string[]> {
  return Promise.all([
    "/Applications/Yaps.app",
    join(homedir(), "Applications", "Yaps.app"),
  ].map(async (candidate) => {
    try {
      return await realpath(candidate);
    } catch {
      return candidate;
    }
  }));
}

function executableName(name: string): string {
  return process.platform === "win32" ? `${name}.exe` : name;
}

function expandHome(path: string): string {
  if (path === "~") {
    return homedir();
  }
  return path.startsWith(`~${sep}`) ? join(homedir(), path.slice(2)) : path;
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveCliCandidate(candidate: string): Promise<string | undefined> {
  if (!(await isExecutable(candidate))) return undefined;
  if (await isMacGuiExecutable(candidate)) return undefined;
  return resolveWindowsShim(candidate);
}

async function isMacGuiExecutable(candidate: string): Promise<boolean> {
  let canonical = candidate;
  try {
    canonical = await realpath(candidate);
  } catch {
    // The normal executable validation remains authoritative if resolution races removal.
  }
  return canonical.endsWith(`${sep}Yaps.app${sep}Contents${sep}MacOS${sep}yaps`);
}

async function isValidatedYapsCli(path: string, timeoutMs = CLI_DISCOVERY_TIMEOUT_MS): Promise<boolean> {
  if (!(await isExecutable(path))) return false;
  try {
    const { stdout } = await execFileAsync(path, ["status", "--pretty"], {
      encoding: "utf8",
      killSignal: "SIGKILL",
      maxBuffer: MAX_DISCOVERY_OUTPUT_BYTES,
      timeout: timeoutMs,
      windowsHide: true,
    });
    const value = JSON.parse(stdout) as Record<string, unknown>;
    return (
      typeof value.settings_path === "string" &&
      typeof value.settings_exists === "boolean" &&
      typeof value.auth_store_path === "string" &&
      typeof value.models_dir === "string"
    );
  } catch {
    return false;
  }
}

interface AuthStatus {
  authenticated: boolean;
  diagnosticCode?: string;
  recommendedSettingsPath?: string;
  status: string;
}

interface AccountSession {
  auth?: AuthStatus;
  authStatusSafety: AuthStatusSafety;
  settingsPath?: string;
}

async function readAuthStatus(
  path: string,
  settingsPath?: string,
  timeoutMs = CLI_DISCOVERY_TIMEOUT_MS,
): Promise<AuthStatus | undefined> {
  try {
    const { stdout } = await execFileAsync(path, [
      ...(settingsPath ? ["--settings-path", settingsPath] : []),
      "--pretty",
      "auth",
      "status",
    ], {
      encoding: "utf8",
      killSignal: "SIGKILL",
      maxBuffer: MAX_DISCOVERY_OUTPUT_BYTES,
      timeout: Math.max(1, timeoutMs),
      windowsHide: true,
    });
    const value = JSON.parse(stdout) as Record<string, unknown>;
    return {
      authenticated: value.authenticated === true,
      diagnosticCode: typeof value.diagnostic_code === "string" ? value.diagnostic_code : undefined,
      status: typeof value.status === "string" ? value.status : "unknown",
      recommendedSettingsPath: validRecommendedSettingsPath(value.recommended_settings_path),
    };
  } catch {
    return undefined;
  }
}

function refreshableSignedInAuth(auth: AuthStatus | undefined): boolean {
  if (!auth || [
    "active",
    "expired",
    "platform_mismatch",
    "settings_path_mismatch",
    "signed_out",
    "unauthenticated",
  ].includes(auth.status)) return false;
  return (
    REFRESHABLE_AUTH_STATES.has(auth?.status ?? "")
    || REFRESHABLE_AUTH_DIAGNOSTICS.has(auth?.diagnosticCode ?? "")
  );
}

function diagnoseAccount(session: AccountSession): string | undefined {
  if (session.authStatusSafety === "unsafe") {
    return "This installed Yaps version uses an older credential-based account check, so the Obsidian plugin deliberately did not run it. Update Yaps to 2.3.124 or newer; the plugin will then reuse the desktop sign-in, trial, or Yaps Pro automatically. Do not approve a Keychain prompt or connect a separate account.";
  }
  if (session.authStatusSafety === "unverified") {
    return "The Yaps CLI is working, but the Obsidian plugin could not verify that its account check is credential-free, so it deliberately did not run it. Update or reinstall the official Yaps app; the plugin will then reuse its desktop sign-in, trial, or Yaps Pro automatically. Do not reconnect the plugin or approve a Keychain prompt.";
  }

  const auth = session.auth;
  if (!auth) {
    return "The Yaps CLI is installed, but the Obsidian plugin could not read the desktop account status. Update Yaps, open it once, and retry. No separate plugin connection or account is required.";
  }
  if (auth.authenticated && auth.status === "active") return undefined;
  if (auth.status === "platform_mismatch") {
    return "Yaps is signed in, but this account only has mobile access. Activate desktop-compatible access in Yaps; the Obsidian plugin will use it automatically.";
  }
  if (auth.status === "expired") {
    return "Yaps is signed in, but its trial or Yaps Pro access is not active. Open Yaps to review the available trial or Yaps Pro options; the Obsidian plugin will pick up the change automatically.";
  }
  if (auth.status === "settings_path_mismatch") {
    return "Yaps is installed, but the desktop account settings could not be validated automatically. Update or reinstall Yaps and retry; do not edit PATH or reconnect the plugin.";
  }
  if (["signed_out", "unauthenticated"].includes(auth.status)) {
    return "Yaps is installed, but no active desktop account is signed in. Sign in inside Yaps and start an available trial or activate Yaps Pro; the Obsidian plugin then uses that same session automatically, with no separate connection.";
  }
  if (["credential_unavailable", "credential_missing"].includes(auth.status)
    || auth.diagnosticCode === "keychain_unavailable") {
    return "The installed Yaps helper could not provide a credential-free account result. Update Yaps and retry. Do not approve a Keychain prompt or create a separate plugin account.";
  }
  if (["cached_offline", "verification_unavailable"].includes(auth.status)
    || ["account_cache_incomplete", "profile_lookup_failed", "refresh_failed"].includes(auth.diagnosticCode ?? "")) {
    return "Yaps found the desktop sign-in but could not verify current trial or Yaps Pro access. Check the internet connection, open Yaps if needed, and retry; do not create a separate plugin account.";
  }
  return "Yaps returned an account state the Obsidian plugin does not recognize. Update Yaps and retry; do not reconnect the plugin or create another account.";
}

function validRecommendedSettingsPath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const candidate = value.trim();
  return candidate.length <= 4_096 && !candidate.includes("\0") && isAbsolute(candidate)
    && basename(candidate).toLowerCase() === "settings.json"
    ? candidate
    : undefined;
}

async function launchInstalledYaps(cliPath: string): Promise<boolean> {
  try {
    cliPath = await realpath(cliPath);
  } catch {
    // The already-validated raw path remains the only safe fallback.
  }
  if (process.platform === "darwin") {
    const suffix = `${sep}Contents${sep}MacOS${sep}yaps_cli`;
    if (!cliPath.endsWith(suffix)) return false;
    const application = cliPath.slice(0, -suffix.length);
    if (basename(application) !== "Yaps.app") return false;
    if (!(await canonicalMacApplications()).includes(application)) return false;
    try {
      await execFileAsync("/usr/bin/open", ["-g", application], {
        timeout: 3_000,
        windowsHide: true,
      });
      return true;
    } catch {
      return false;
    }
  }
  if (process.platform === "win32" && basename(cliPath).toLowerCase() === "yaps_cli.exe") {
    const application = join(dirname(cliPath), "Yaps.exe");
    if (!windowsAppCandidates().some((candidate) => candidate.toLowerCase() === application.toLowerCase())) {
      return false;
    }
    if (!(await isExecutable(application))) return false;
    return spawnDetachedApplication(application);
  }
  return false;
}

function spawnDetachedApplication(application: string): Promise<boolean> {
  return new Promise((resolvePromise) => {
    let settled = false;
    let child: ReturnType<typeof spawn> | undefined;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolvePromise(result);
    };
    const timer = window.setTimeout(() => {
      try {
        child?.kill();
      } catch {
        // The bounded launch attempt still resolves as unavailable.
      }
      finish(false);
    }, 3_000);
    try {
      child = spawn(application, [], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.once("error", () => finish(false));
      child.once("spawn", () => {
        child?.unref();
        finish(true);
      });
    } catch {
      finish(false);
    }
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => window.setTimeout(resolvePromise, milliseconds));
}

function cliError(error: unknown): Error {
  if (!(error instanceof Error)) {
    return new Error("Yaps CLI failed unexpectedly.");
  }
  const stderr = "stderr" in error && typeof error.stderr === "string" ? error.stderr.trim() : "";
  if (stderr) {
    return new Error(stderr);
  }
  if (error.name === "SyntaxError") {
    return new Error("Yaps returned an unreadable response. Update Yaps and try again.");
  }
  return error;
}
