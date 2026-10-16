import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { discoverTestFiles } from "./test-discovery.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const testFiles = await discoverTestFiles(join(projectRoot, "test"));
if (testFiles.length === 0) throw new Error("No .test.mjs files found under test/");

const result = spawnSync(process.execPath, [
  "--experimental-strip-types",
  "--import",
  join(projectRoot, ".test-support/register-tsx-loader.mjs"),
  "--test",
  ...testFiles,
], {
  cwd: projectRoot,
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
