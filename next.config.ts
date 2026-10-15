import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = dirname(fileURLToPath(import.meta.url));
const nextConfig: NextConfig = {
  outputFileTracingRoot: appRoot,
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
