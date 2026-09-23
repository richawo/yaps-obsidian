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

Obsidian now accepts initial submissions through the [Community directory](https://community.obsidian.md), not a pull request to `obsidianmd/obsidian-releases`.

1. Sign in with the Yaps maintainer's Obsidian account and connect the GitHub account that owns `richawo/yaps-obsidian` in the Community profile.
2. Verify that the public repository's default branch contains the release version of `manifest.json` and the current `README.md`, `LICENSE`, and `versions.json`.
3. Verify that a published GitHub release has a tag exactly matching the root manifest's version and separate `main.js`, `manifest.json`, and `styles.css` assets.
4. From the profile's **Plugins** page, select **New plugin**, enter `https://github.com/richawo/yaps-obsidian`, select the intended owner, review the developer policies, and submit.
5. Follow the directory's automated review feedback. Resolve any errors in the public repository and publish a new version before selecting **Publish** for the listing.

The listing and README should clearly disclose that the free plugin requires the separately installed Yaps desktop app and a Yaps account; never imply that audio recording is implemented by the plugin itself. Obsidian only requires the initial submission; later plugin updates are delivered through matching GitHub releases.

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
