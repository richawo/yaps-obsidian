import {
  Editor,
  FileSystemAdapter,
  MarkdownView,
  Notice,
  Plugin,
  setIcon,
} from "obsidian";
import { formatShortcut, titleFromText } from "./format";
import {
  YapsRequiredModal,
  YapsSearchModal,
  openVaultNote,
  readableError,
} from "./modals";
import { DEFAULT_SETTINGS, YapsSettingTab } from "./settings";
import type { YapsPluginSettings } from "./types";
import { YapsCli, YapsCliNotFoundError } from "./yaps-cli";

const DICTATION_NOTICE_MS = 6_000;

export default class YapsPlugin extends Plugin {
  preferences: YapsPluginSettings = { ...DEFAULT_SETTINGS };
  private cli: YapsCli | undefined;
  private statusBarElement: HTMLElement | undefined;

  override async onload(): Promise<void> {
    await this.loadPreferences();
    this.rebuildCli();
    this.addSettingTab(new YapsSettingTab(this.app, this));

    const ribbon = this.addRibbonIcon("audio-waveform", "Prepare Yaps dictation", () => {
      void this.prepareDictation();
    });
    ribbon.addClass("yaps-ribbon-button");

    this.statusBarElement = this.addStatusBarItem();
    this.statusBarElement.addClass("yaps-status-bar");
    this.statusBarElement.setAttribute("aria-label", "Prepare Yaps dictation");
    this.statusBarElement.addEventListener("click", () => void this.prepareDictation());
    this.refreshStatusBarVisibility();

    this.addCommand({
      id: "prepare-dictation",
      name: "Prepare editor for dictation",
      editorCallback: (editor) => void this.prepareDictation(editor),
    });

    this.addCommand({
      id: "search-memory",
      name: "Search local memory",
      callback: () => this.openSearch(),
    });

    this.addCommand({
      id: "capture-selection",
      name: "Capture selection as a new note",
      editorCheckCallback: (checking, editor) => {
        const selectedText = editor.getSelection().trim();
        if (!selectedText) {
          return false;
        }
        if (!checking) {
          void this.captureSelection(selectedText);
        }
        return true;
      },
    });

    this.addCommand({
      id: "open-daily-note",
      name: "Open today's local daily note",
      callback: () => void this.openDailyNote(),
    });

    this.addCommand({
      id: "check-connection",
      name: "Check local connection",
      callback: () => void this.checkConnection(true),
    });

    this.app.workspace.onLayoutReady(() => void this.refreshShortcutStatus());
  }

  async savePreferences(): Promise<void> {
    await this.saveData(this.preferences);
    this.rebuildCli();
  }

  async checkConnection(showSuccess: boolean): Promise<boolean> {
    try {
      const status = await this.getCli().status();
      if (showSuccess) {
        new Notice(
          `Yaps is connected to this vault · ${status.note_count.toLocaleString()} notes`,
        );
      }
      return true;
    } catch (error) {
      this.handleCliError(error);
      return false;
    }
  }

  refreshStatusBarVisibility(): void {
    if (!this.statusBarElement) {
      return;
    }
    this.statusBarElement.toggleClass(
      "yaps-status-bar-hidden",
      !this.preferences.showStatusBar,
    );
  }

  private async loadPreferences(): Promise<void> {
    const stored = (await this.loadData()) as Partial<YapsPluginSettings> | null;
    this.preferences = { ...DEFAULT_SETTINGS, ...stored };
  }

  private rebuildCli(): void {
    this.cli = new YapsCli({
      configuredPath: this.preferences.cliPath,
      vaultRoot: this.getVaultRoot(),
    });
  }

  private getCli(): YapsCli {
    this.cli ??= new YapsCli({
      configuredPath: this.preferences.cliPath,
      vaultRoot: this.getVaultRoot(),
    });
    return this.cli;
  }

  private getVaultRoot(): string {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      throw new Error("Yaps requires a local desktop Obsidian vault.");
    }
    return adapter.getBasePath();
  }

  private async prepareDictation(editor?: Editor): Promise<void> {
    const activeEditor = editor ?? this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
    if (!activeEditor) {
      new Notice("Open a Markdown note before starting Yaps dictation");
      return;
    }

    try {
      const cli = this.getCli();
      await cli.status();
      if (this.preferences.launchYapsBeforeDictation) {
        await cli.launchYapsInBackground();
      }
      const shortcut = formatShortcut(await cli.getDictationShortcut());
      activeEditor.focus();
      new Notice(`${shortcut} to dictate here. Yaps cleans and pastes locally.`, DICTATION_NOTICE_MS);
      this.renderStatusBar(shortcut);
    } catch (error) {
      this.handleCliError(error);
    }
  }

  private openSearch(): void {
    try {
      new YapsSearchModal(
        this.app,
        this.getCli(),
        this.preferences.searchMode,
        this.preferences.searchLimit,
      ).open();
    } catch (error) {
      this.handleCliError(error);
    }
  }

  private async captureSelection(selectedText: string): Promise<void> {
    try {
      const note = await this.getCli().createNote(
        titleFromText(selectedText),
        `${selectedText.trim()}\n`,
        this.preferences.captureFolder,
      );
      new Notice(`Saved to ${note.path}`);
      await openVaultNote(this.app, note.path);
    } catch (error) {
      this.handleCliError(error);
    }
  }

  private async openDailyNote(): Promise<void> {
    try {
      const note = await this.getCli().openDailyNote();
      await openVaultNote(this.app, note.path);
    } catch (error) {
      this.handleCliError(error);
    }
  }

  private async refreshShortcutStatus(): Promise<void> {
    if (!this.preferences.showStatusBar) {
      return;
    }
    try {
      const shortcut = formatShortcut(await this.getCli().getDictationShortcut());
      this.renderStatusBar(shortcut);
    } catch {
      this.renderStatusBar("Get Yaps");
    }
  }

  private renderStatusBar(label: string): void {
    if (!this.statusBarElement) {
      return;
    }
    this.statusBarElement.empty();
    const icon = this.statusBarElement.createSpan({ cls: "yaps-status-icon" });
    setIcon(icon, "audio-waveform");
    this.statusBarElement.createSpan({ text: `Yaps · ${label}` });
  }

  private handleCliError(error: unknown): void {
    if (error instanceof YapsCliNotFoundError) {
      new YapsRequiredModal(this.app, error.message).open();
      this.renderStatusBar("Get Yaps");
      return;
    }
    new Notice(readableError(error), 8_000);
  }
}
