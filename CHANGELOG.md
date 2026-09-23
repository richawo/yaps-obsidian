# Changelog

## 1.0.2

- Discover the installed Yaps CLI automatically from overrides, `PATH`, and documented app locations with bounded validation.
- Reuse the desktop settings path and active signed-in trial or Yaps Pro without a separate Obsidian connection.
- Refuse credential-based account checks from Yaps versions older than 2.3.124 and provide specific, private recovery guidance.
- Keep ordinary vault commands wake-free and restrict all app launches to the exact verified standard installation.
- Recover a temporarily unverifiable signed-in account cache by briefly waking only that exact verified app; never wake for healthy, expired, signed-out, mobile-only, Setapp, or arbitrary-path sessions.
- Reject the macOS GUI executable before probing it as a CLI while continuing to support genuine PATH wrappers named `yaps`.
- Accept a custom Windows `yaps_cli.exe` when its own ProductVersion proves the safe auth contract, while keeping automatic app launching restricted to Program Files.
