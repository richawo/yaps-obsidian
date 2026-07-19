import { describe, expect, test } from "bun:test";
import { access } from "node:fs/promises";
import { join } from "node:path";
import manifest from "../manifest.json";
import packageJson from "../package.json";
import versions from "../versions.json";

describe("plugin manifest", () => {
  test("uses a stable public plugin identity", () => {
    expect(manifest.id).toBe("yaps");
    expect(manifest.name).toBe("Yaps");
    expect(manifest.isDesktopOnly).toBe(true);
  });

  test("keeps the release version semver-compatible", () => {
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(packageJson.version).toBe(manifest.version);
    expect(versions[manifest.version as keyof typeof versions]).toBe(
      manifest.minAppVersion,
    );
  });

  test("contains every file required at the public repository root", async () => {
    const root = join(import.meta.dir, "..");
    await Promise.all(
      ["README.md", "LICENSE", "manifest.json", "versions.json"].map((filename) =>
        access(join(root, filename)),
      ),
    );
  });
});
