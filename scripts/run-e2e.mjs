import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(
  projectRoot,
  ".superpowers",
  "sdd",
  "2026-10-15-achat-poc-v1",
  `task-10-e2e-data-${process.pid}-${randomUUID()}`,
);
const agentDir = path.join(dataDir, "pi-agent");
let cleaned = false;
function cleanOwnedData() {
  if (cleaned) return;
  cleaned = true;
  rmSync(dataDir, { recursive: true, force: true });
}
process.on("exit", cleanOwnedData);
mkdirSync(agentDir, { recursive: true, mode: 0o700 });

const cli = path.join(projectRoot, "node_modules", ".bin", "playwright");
const suppliedArgs = process.argv.slice(2);
const hasConfig = suppliedArgs.some((argument) => argument.startsWith("--config"));
const configs = hasConfig
  ? [suppliedArgs]
  : [
      ["--config=playwright.config.ts", ...suppliedArgs],
      ["--config=playwright.search.config.ts", ...suppliedArgs],
    ];
const env = {
  ...process.env,
  ACHAT_E2E_DATA_DIR: dataDir,
  ACHAT_DATA_DIR: dataDir,
  PI_CODING_AGENT_DIR: agentDir,
};

try {
  for (const args of configs) {
    const result = spawnSync(cli, ["test", ...args], {
      cwd: projectRoot,
      env,
      stdio: "inherit",
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1;
      break;
    }
  }
} finally {
  cleanOwnedData();
}
