import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = dirname(fileURLToPath(import.meta.url));
const nextConfig: NextConfig = {
  outputFileTracingRoot: appRoot,
  serverExternalPackages: [
    "better-sqlite3",
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-codemode",
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-mcp",
    "@earendil-works/pi-telemetry",
    "@earendil-works/pi-tui",
  ],
};

export default nextConfig;
