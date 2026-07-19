import { App, Modal, Notice, Setting, SuggestModal, TFile, normalizePath } from "obsidian";
import type { SearchMode, VaultSearchHit } from "./types";
import { YapsCli, downloadUrl } from "./yaps-cli";

const MAX_SNIPPET_LENGTH = 180;

export class YapsSearchModal extends SuggestModal<VaultSearchHit> {
  private requestSequence = 0;

  constructor(
    app: App,
    private readonly cli: YapsCli,
    private readonly searchMode: SearchMode,
    private readonly resultLimit: number,
  ) {
    super(app);
    this.limit = resultLimit;
    this.setPlaceholder("Search titles and note contents…");
    this.setInstructions([
      { command: "↵", purpose: "open note" },
      { command: "esc", purpose: "close" },
    ]);
    this.emptyStateText = "No Yaps notes found";
  }

  override async getSuggestions(query: string): Promise<VaultSearchHit[]> {
    const sequence = ++this.requestSequence;
    try {
      const trimmed = query.trim();
      const hits = trimmed
        ? (await this.cli.search(trimmed, this.resultLimit, this.searchMode)).hits
        : (await this.cli.listNotes(this.resultLimit)).map((note) => ({
            note_id: note.id,
            path: note.path,
            snippet: note.markdown,
            title: note.title,
          }));
      return sequence === this.requestSequence ? hits : [];
    } catch (error) {
      if (sequence === this.requestSequence) {
        this.emptyStateText = readableError(error);
      }
      return [];
    }
  }

  override renderSuggestion(hit: VaultSearchHit, element: HTMLElement): void {
    element.createDiv({ cls: "yaps-search-title", text: hit.title || hit.path });
    element.createDiv({ cls: "yaps-search-path", text: hit.path });
    const snippet = compactSnippet(hit.snippet);
    if (snippet) {
      element.createDiv({ cls: "yaps-search-snippet", text: snippet });
    }
  }

  override onChooseSuggestion(hit: VaultSearchHit): void {
    void openVaultNote(this.app, hit.path);
  }
}

export class YapsRequiredModal extends Modal {
  constructor(
    app: App,
    private readonly reason: string,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.setTitle("Get Yaps for Obsidian");
    this.contentEl.createEl("p", { text: this.reason });
    this.contentEl.createEl("p", {
      text: "Yaps adds private, on-device dictation and local AI workflows to any text field, including Obsidian.",
    });

    new Setting(this.contentEl)
      .addButton((button) =>
        button
          .setButtonText("Download Yaps")
          .setCta()
          .onClick(() => {
            openExternal(downloadUrl());
            this.close();
          }),
      )
      .addButton((button) => button.setButtonText("Not now").onClick(() => this.close()));
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

export async function openVaultNote(app: App, path: string): Promise<boolean> {
  const normalized = normalizePath(path);
  if (normalized.startsWith("../") || normalized === "..") {
    new Notice("Yaps refused to open a note outside this vault");
    return false;
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const file = app.vault.getAbstractFileByPath(normalized);
    if (file instanceof TFile) {
      await app.workspace.getLeaf(false).openFile(file);
      return true;
    }
    await delay(100);
  }

  new Notice(`Yaps created ${normalized}, but Obsidian has not indexed it yet`);
  return false;
}

export function readableError(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected Yaps error";
}

function compactSnippet(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > MAX_SNIPPET_LENGTH
    ? `${compact.slice(0, MAX_SNIPPET_LENGTH - 1).trimEnd()}…`
    : compact;
}

function openExternal(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
