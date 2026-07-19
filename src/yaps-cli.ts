import { execFile, spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, join, resolve, sep } from "node:path";
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
const YAPS_DOWNLOAD_URL = "https://yaps.ai/download";

export class YapsCliNotFoundError extends Error {
  constructor() {
    super("Yaps is not installed, or its local CLI could not be found.");
    this.name = "YapsCliNotFoundError";
  }
}

export interface YapsCliOptions {
  configuredPath?: string;
  vaultRoot: string;
}

export class YapsCli {
  private cachedCliPath: string | undefined;

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
    if (process.platform === "darwin") {
      await execFileAsync("/usr/bin/open", ["-gj", "-a", "Yaps"], {
        timeout: 10_000,
        windowsHide: true,
      });
      return;
    }

    if (process.platform === "win32") {
      const executable = await this.resolveWindowsAppPath();
      const child = spawn(executable, [], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.unref();
      return;
    }

    throw new Error("Yaps desktop currently supports macOS and Windows.");
  }

  async resolveCliPath(): Promise<string> {
    if (this.cachedCliPath) {
      return this.cachedCliPath;
    }

    const configured = this.options.configuredPath?.trim();
    const candidates = [
      configured ? expandHome(configured) : undefined,
      join(homedir(), ".local", "bin", executableName("yaps")),
      ...(process.platform === "darwin"
        ? [
            "/opt/homebrew/bin/yaps",
            "/usr/local/bin/yaps",
            "/Applications/Yaps.app/Contents/MacOS/yaps_cli",
          ]
        : []),
      ...(process.platform === "win32" ? windowsCliCandidates() : []),
      ...pathCliCandidates(),
    ].filter((candidate): candidate is string => Boolean(candidate));

    for (const candidate of candidates) {
      if (await isExecutable(candidate)) {
        this.cachedCliPath = candidate;
        return candidate;
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
    const vaultRoot = resolve(this.options.vaultRoot);
    try {
      const { stdout } = await execFileAsync(
        cliPath,
        ["--vault-root", vaultRoot, ...args, "--pretty"],
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

  private async resolveWindowsAppPath(): Promise<string> {
    const cliPath = await this.resolveCliPath();
    const candidates = [
      join(dirname(cliPath), "Yaps.exe"),
      ...windowsAppCandidates(),
    ];
    for (const candidate of candidates) {
      if (await isExecutable(candidate)) {
        return candidate;
      }
    }
    throw new YapsCliNotFoundError();
  }
}

export function downloadUrl(): string {
  return YAPS_DOWNLOAD_URL;
}

function pathCliCandidates(): string[] {
  const names = [executableName("yaps"), executableName("yaps_cli")];
  return (process.env.PATH ?? "")
    .split(delimiter)
    .filter(Boolean)
    .flatMap((entry) => names.map((name) => join(entry, name)));
}

function windowsCliCandidates(): string[] {
  return windowsInstallDirectories().flatMap((directory) => [
    join(directory, "yaps_cli.exe"),
    join(directory, "yaps.exe"),
  ]);
}

function windowsAppCandidates(): string[] {
  return windowsInstallDirectories().map((directory) => join(directory, "Yaps.exe"));
}

function windowsInstallDirectories(): string[] {
  return [
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Programs", "Yaps") : undefined,
    process.env.ProgramFiles ? join(process.env.ProgramFiles, "Yaps") : undefined,
    process.env["ProgramFiles(x86)"]
      ? join(process.env["ProgramFiles(x86)"], "Yaps")
      : undefined,
  ].filter((value): value is string => Boolean(value));
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
