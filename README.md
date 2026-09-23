# Yaps for Obsidian

Talk naturally in any Obsidian note, then let Yaps clean up and paste the result at your cursor. Search and capture your private local Markdown vault without sending note content to a hosted plugin service.

[Download Yaps](https://yaps.ai/download) · [Yaps website](https://yaps.ai)

## What it does

- **Prepare editor for dictation** focuses the current note, quietly opens Yaps, and shows the exact shortcut configured in the Yaps desktop app.
- **Search local memory** searches the active Obsidian vault through Yaps, with exact matches kept ahead of semantic results.
- **Capture selection as a new note** saves highlighted text into a configurable folder and opens the new note.
- **Open today's local daily note** creates or opens the Yaps-compatible daily note for the active vault.
- A compact status-bar action keeps the dictation shortcut visible and provides a direct install path when Yaps is missing.

The plugin deliberately does not record audio itself. Yaps owns the global dictation shortcut, on-device cleanup, permissions, account, and subscription state, so every supported app gets the same dictation behavior.

## Requirements

- Obsidian 1.5.0 or newer on macOS or Windows.
- The standard [Yaps desktop app](https://yaps.ai/download), version 2.3.124 or newer, installed locally. Sign in and start an available trial or activate Yaps Pro if the app prompts you.
- A local filesystem-backed Obsidian vault. Obsidian Sync is fine; the vault must also exist on disk on this computer.

A Yaps account is required. Some Yaps features require a Yaps Pro subscription after the trial. No API key is required or supported.

## Install

Once the plugin is listed in Obsidian Community plugins:

1. Open **Settings → Community plugins → Browse**.
2. Search for **Yaps**, choose **Install**, then **Enable**.

That is the complete plugin connection setup. **Check connection** remains available in the Yaps
settings tab only as a troubleshooting check.

For a prerelease or local build, copy `main.js`, `manifest.json`, and `styles.css` into `<vault>/.obsidian/plugins/yaps/`, then enable **Yaps** under Installed plugins.

## Use

Open the command palette and search for **Yaps**. The main workflow is:

1. Open a Markdown note and place the cursor where the text should go.
2. Run **Yaps: Prepare editor for dictation** or click the waveform ribbon/status action.
3. Use the shortcut shown by the plugin and speak.

Yaps cleans the transcript and pastes it at the live cursor. You can assign Obsidian hotkeys to every Yaps command from **Settings → Hotkeys**.

## Privacy and safety

- Commands invoke the installed Yaps CLI directly with an argument array; no shell is used. Discovery honors the optional configured path, then `YAPS_CLI_BINARY`, `PATH`, and verified app locations, and accepts a candidate only after bounded probes and a harmless `status` check.
- The plugin follows the desktop app's canonical settings and reuses its signed-in trial or Yaps Pro automatically. Healthy, signed-out, expired, and mobile-only checks never wake the app or request credentials. Only a signed-in cache that temporarily cannot verify access may quietly open the exact verified standard app and retry for a few bounded seconds. **Prepare editor for dictation** can also open that exact app when its user-controlled setting is enabled. There is no separate Obsidian sign-in or Connect button.
- Setapp's Yaps build does not yet expose the same verified CLI/account contract. Automatic Obsidian integration for that distribution requires a future Yaps app update; the plugin does not scan for or launch it by name.
- Every vault operation is explicitly rooted to the active Obsidian vault.
- Capture content is written to a private temporary file, passed to Yaps, and removed in a `finally` block.
- Search, note capture, and daily-note operations remain local. The plugin has no analytics or network client.
- Search results and newly created paths are normalized and must resolve to a Markdown file already indexed by the active vault.

Yaps itself may use services described in the [product privacy policy](https://yaps.ai/privacy) depending on the user's chosen product features. The Obsidian plugin does not add a separate data path.

## Development

This project uses [Bun](https://bun.sh/):

```bash
bun install
bun run check
bun run package
```

`bun run package` creates the exact GitHub release assets under `dist/<version>/`. See [PUBLISHING.md](PUBLISHING.md) for the release and Community plugin checklist.

## Support

Report plugin bugs at [github.com/richawo/yaps-obsidian/issues](https://github.com/richawo/yaps-obsidian/issues). For product help and downloads, visit [yaps.ai](https://yaps.ai).

## License

MIT
