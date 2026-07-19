# Security policy

Please report a suspected vulnerability privately through the security contact published at [yaps.ai](https://yaps.ai). Do not include private vault contents, account credentials, or raw dictation audio in a public issue.

The plugin accepts only a configured executable path and ordinary plugin settings. It invokes Yaps with `execFile`, never through a shell; roots all vault commands to the active local vault; bounds command runtime and output size; and removes temporary capture files after both success and failure.

Supported releases receive security fixes. Users should keep both Obsidian and the Yaps desktop app current.
