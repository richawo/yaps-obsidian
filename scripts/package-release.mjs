import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const versions = JSON.parse(await readFile(join(root, "versions.json"), "utf8"));

if (manifest.version !== packageJson.version) {
  throw new Error("manifest.json and package.json versions must match");
}
if (versions[manifest.version] !== manifest.minAppVersion) {
  throw new Error("versions.json must map the release to manifest.minAppVersion");
}

const releaseDirectory = join(root, "dist", manifest.version);
const releaseFiles = ["main.js", "manifest.json", "styles.css"];
await rm(releaseDirectory, { recursive: true, force: true });
await mkdir(releaseDirectory, { recursive: true });

const checksums = [];
for (const filename of releaseFiles) {
  const source = join(root, filename);
  const destination = join(releaseDirectory, filename);
  await cp(source, destination);
  const digest = createHash("sha256").update(await readFile(destination)).digest("hex");
  checksums.push(`${digest}  ${basename(destination)}`);
}

await writeFile(
  join(releaseDirectory, "checksums-sha256.txt"),
  `${checksums.join("\n")}\n`,
  "utf8",
);

console.log(`Prepared Obsidian ${manifest.version} release assets in ${releaseDirectory}`);
