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
- The [Yaps desktop app](https://yaps.ai/download), installed locally (sign in if the app prompts you).
- A local filesystem-backed Obsidian vault. Obsidian Sync is fine; the vault must also exist on disk on this computer.

No API key is required or supported.

## Install

Once the plugin is listed in Obsidian Community plugins:

1. Open **Settings → Community plugins → Browse**.
2. Search for **Yaps**, choose **Install**, then **Enable**.
3. Open **Yaps** in Obsidian settings and select **Check connection**.

For a prerelease or local build, copy `main.js`, `manifest.json`, and `styles.css` into `<vault>/.obsidian/plugins/yaps/`, then enable **Yaps** under Installed plugins.

## Use

Open the command palette and search for **Yaps**. The main workflow is:

1. Open a Markdown note and place the cursor where the text should go.
2. Run **Yaps: Prepare editor for dictation** or click the waveform ribbon/status action.
3. Use the shortcut shown by the plugin and speak.

Yaps cleans the transcript and pastes it at the live cursor. You can assign Obsidian hotkeys to every Yaps command from **Settings → Hotkeys**.

## Privacy and safety

- Commands invoke the installed Yaps CLI directly with an argument array; no shell is used.
- Every vault operation is explicitly rooted to the active Obsidian vault.
- Capture content is written to a private temporary file, passed to Yaps, and removed in a `finally` block.
- Search, note capture, and daily-note operations remain local. The plugin has no analytics or network client.
- Search results and newly created paths are normalized and must resolve to a Markdown file already indexed by the active vault.

Yaps itself may use services described in the product privacy policy depending on the user's chosen product features. The Obsidian plugin does not add a separate data path.

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
