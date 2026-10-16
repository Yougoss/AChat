import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

export async function discoverTestFiles(testRoot) {
  const root = resolve(testRoot);
  const files = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile() && entry.name.endsWith(".test.mjs")) {
        files.push(path);
      }
    }
  }

  await visit(root);
  return files;
}
