import { describe, expect, test } from "bun:test";
import {
  formatShortcut,
  mergeSearchHits,
  normalizedFolder,
  titleFromText,
} from "../src/format";
import type { ShortcutBindingResult, VaultSearchHit } from "../src/types";

describe("titleFromText", () => {
  test("uses the first meaningful line and removes lightweight Markdown", () => {
    expect(titleFromText("\n## Launch plan\n\nShip it")).toBe("Launch plan");
  });

  test("caps long note titles", () => {
    expect(titleFromText("A".repeat(100))).toHaveLength(80);
  });
});

describe("formatShortcut", () => {
  const binding = (kind: string): ShortcutBindingResult => ({
    path: "stt_binding",
    value: { kind, keys: [{ id: "function", keycode: null, label: "Fn" }] },
  });

  test("describes hold, toggle, and double-tap bindings", () => {
    expect(formatShortcut(binding("hold"))).toBe("Hold Fn");
    expect(formatShortcut(binding("toggle"))).toBe("Press Fn");
    expect(formatShortcut(binding("double_tap"))).toBe("Double-tap Fn");
  });
});

test("normalizedFolder removes traversal segments", () => {
  expect(normalizedFolder("../ Inbox / ./Voice")).toBe("Inbox/Voice");
  expect(normalizedFolder("../../")).toBe("Inbox");
});

test("mergeSearchHits keeps exact lexical results first and removes duplicates", () => {
  const hit = (path: string, title: string): VaultSearchHit => ({
    note_id: path,
    path,
    snippet: title,
    title,
  });
  expect(
    mergeSearchHits(
      [hit("Exact.md", "Exact")],
      [hit("exact.md", "Duplicate"), hit("Related.md", "Related")],
      10,
    ).map((result) => result.title),
  ).toEqual(["Exact", "Related"]);
});
