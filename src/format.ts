import type { ShortcutBindingResult, VaultSearchHit } from "./types";

const MAX_TITLE_LENGTH = 80;

export function titleFromText(content: string, fallbackDate = new Date()): string {
  const firstLine = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstLine) {
    return `Obsidian capture ${formatDateTime(fallbackDate)}`;
  }

  const plain = firstLine
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/^>\s+/, "")
    .trim();

  if (plain.length <= MAX_TITLE_LENGTH) {
    return plain;
  }
  return `${plain.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`;
}

export function formatShortcut(binding: ShortcutBindingResult): string {
  const labels = binding.value.keys.map((key) => key.label.trim()).filter(Boolean);
  const keys = labels.length > 0 ? labels.join(" + ") : "your Yaps shortcut";

  switch (binding.value.kind) {
    case "hold":
      return `Hold ${keys}`;
    case "double_tap":
      return `Double-tap ${keys}`;
    case "toggle":
      return `Press ${keys}`;
    default:
      return `Use ${keys}`;
  }
}

export function mergeSearchHits(
  lexical: VaultSearchHit[],
  semantic: VaultSearchHit[],
  limit: number,
): VaultSearchHit[] {
  const merged = new Map<string, VaultSearchHit>();
  for (const hit of [...lexical, ...semantic]) {
    const key = hit.path.toLocaleLowerCase();
    if (!merged.has(key)) {
      merged.set(key, hit);
    }
  }
  return [...merged.values()].slice(0, Math.max(1, limit));
}

export function normalizedFolder(folder: string): string {
  const normalized = folder
    .split(/[\\/]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part !== "." && part !== "..")
    .join("/");
  return normalized || "Inbox";
}

function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
