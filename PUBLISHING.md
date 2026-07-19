# Publishing Yaps for Obsidian

Obsidian Community plugins are installed from a dedicated public GitHub repository. Keep `manifest.json`, `README.md`, and `LICENSE` at the root of `richawo/yaps-obsidian`.

The bundled `.github/workflows` directory becomes active after that mirror is created: pull requests run the complete package check, and an exact version tag builds and attaches the required release files automatically.

## Release checklist

1. Update `version` in `manifest.json` and `package.json`.
2. Add the same version and minimum Obsidian version to `versions.json`.
3. Update user-facing release notes and verify every download/signup URL.
4. Run `bun install --frozen-lockfile` and `bun run package`.
5. Install the three generated assets from `dist/<version>/` in a clean disposable vault on both macOS and Windows.
6. Create a GitHub release whose tag exactly matches `manifest.json`'s version, without a `v` prefix.
7. Attach `main.js`, `manifest.json`, and `styles.css` from `dist/<version>/` as separate release assets. Attach `checksums-sha256.txt` as an additional integrity aid.
8. Confirm the public repository root contains `README.md`, `LICENSE`, `manifest.json`, and `versions.json`.

## First Community directory submission

Fork `obsidianmd/obsidian-releases`, add this entry to `community-plugins.json`, and open a pull request:

```json
{
  "id": "yaps",
  "name": "Yaps",
  "author": "Yaps",
  "description": "Dictate into notes and search your private local Markdown vault with Yaps.",
  "repo": "richawo/yaps-obsidian"
}
```

Use `STORE_LISTING.md` for the pull request copy. The submission should clearly disclose that the free plugin requires the separately installed Yaps desktop app and a Yaps account; never imply that audio recording is implemented by the plugin itself.

## Release gate

Do not publish if any of these fail:

- `bun run package`
- Clean-vault install and enable
- **Check local connection** against an installed production Yaps build
- Exact search result opens the intended note
- Selection capture creates one note in the configured folder and opens it
- Daily note creates/opens once without duplicate files
- Missing-Yaps flow opens the product explanation before the download link
- No note content, vault path, account data, or search query is logged or transmitted by plugin code
