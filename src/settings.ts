import { App, PluginSettingTab, Setting } from "obsidian";
import type YapsPlugin from "./main";
import type { SearchMode, YapsPluginSettings } from "./types";
import { downloadUrl } from "./yaps-cli";

const DEFAULT_CLI_PLACEHOLDER = "/Applications/Yaps.app/Contents/MacOS/yaps_cli";

export const DEFAULT_SETTINGS: YapsPluginSettings = {
  cliPath: "",
  captureFolder: "Inbox",
  searchMode: "smart",
  searchLimit: 20,
  launchYapsBeforeDictation: true,
  showStatusBar: true,
};

export class YapsSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly yapsPlugin: YapsPlugin,
  ) {
    super(app, yapsPlugin);
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("Connection").setHeading();
    new Setting(containerEl)
      .setName("Check local connection")
      .setDesc("Verify the Yaps CLI against this Obsidian vault.")
      .addButton((button) =>
        button.setButtonText("Check connection").onClick(async () => {
          button.setDisabled(true).setButtonText("Checking…");
          await this.yapsPlugin.checkConnection(true);
          button.setDisabled(false).setButtonText("Check connection");
        }),
      );

    new Setting(containerEl)
      .setName("Yaps CLI path")
      .setDesc("Usually detected automatically. Set an absolute path only for a custom install.")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_CLI_PLACEHOLDER)
          .setValue(this.yapsPlugin.preferences.cliPath)
          .onChange(async (value) => {
            this.yapsPlugin.preferences.cliPath = value.trim();
            await this.yapsPlugin.savePreferences();
          }),
      );

    new Setting(containerEl).setName("Dictation").setHeading();
    new Setting(containerEl)
      .setName("Launch Yaps when preparing dictation")
      .setDesc("Starts Yaps quietly in the background while keeping the Obsidian editor focused.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.yapsPlugin.preferences.launchYapsBeforeDictation)
          .onChange(async (value) => {
            this.yapsPlugin.preferences.launchYapsBeforeDictation = value;
            await this.yapsPlugin.savePreferences();
          }),
      );

    new Setting(containerEl)
      .setName("Show status bar shortcut")
      .setDesc("Displays a compact Yaps dictation shortcut in the Obsidian status bar.")
      .addToggle((toggle) =>
        toggle.setValue(this.yapsPlugin.preferences.showStatusBar).onChange(async (value) => {
          this.yapsPlugin.preferences.showStatusBar = value;
          await this.yapsPlugin.savePreferences();
          this.yapsPlugin.refreshStatusBarVisibility();
        }),
      );

    new Setting(containerEl).setName("Search and capture").setHeading();
    new Setting(containerEl)
      .setName("Search mode")
      .setDesc("Smart search keeps exact matches first, then adds locally related results.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("smart", "Smart (recommended)")
          .addOption("lexical", "Exact words")
          .addOption("semantic", "Related meaning")
          .setValue(this.yapsPlugin.preferences.searchMode)
          .onChange(async (value) => {
            this.yapsPlugin.preferences.searchMode = value as SearchMode;
            await this.yapsPlugin.savePreferences();
          }),
      );

    new Setting(containerEl)
      .setName("Maximum search results")
      .setDesc("Limits the number of local notes shown in the search palette.")
      .addSlider((slider) =>
        slider
          .setLimits(5, 50, 5)
          .setValue(this.yapsPlugin.preferences.searchLimit)
          .onChange(async (value) => {
            this.yapsPlugin.preferences.searchLimit = value;
            await this.yapsPlugin.savePreferences();
          }),
      );

    new Setting(containerEl)
      .setName("Capture folder")
      .setDesc("Selected text is saved into this folder in the current vault.")
      .addText((text) =>
        text
          .setPlaceholder("Inbox")
          .setValue(this.yapsPlugin.preferences.captureFolder)
          .onChange(async (value) => {
            this.yapsPlugin.preferences.captureFolder = value;
            await this.yapsPlugin.savePreferences();
          }),
      );

    new Setting(containerEl).setName("About").setHeading();
    new Setting(containerEl)
      .setName("Private voice typing for every app")
      .setDesc("Download Yaps or learn more about on-device dictation and local AI.")
      .addButton((button) =>
        button.setButtonText("Visit yaps.ai").onClick(() => {
          window.open(downloadUrl(), "_blank", "noopener,noreferrer");
        }),
      );
  }
}
