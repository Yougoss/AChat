import { rmSync } from "node:fs";
import path from "node:path";

export default async function teardownSearchFixture() {
  const dataDir = process.env.ACHAT_TASK9_E2E_DATA_DIR;
  if (!dataDir) return;

  const fixtureRoot = path.resolve(
    process.cwd(),
    ".superpowers",
    "sdd",
    "2026-10-15-achat-poc-v1",
  );
  const resolvedDataDir = path.resolve(dataDir);
  if (!resolvedDataDir.startsWith(`${fixtureRoot}${path.sep}`)) {
    throw new Error("Refusing to remove a search E2E fixture outside the Task 9 data directory");
  }
  rmSync(resolvedDataDir, { recursive: true, force: true });
}
