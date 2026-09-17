import { execFileSync } from "node:child_process";
import path from "node:path";
import * as dotenv from "dotenv";
import { reactRouter } from "@react-router/dev/vite";
import packageJson from "./package.json";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

dotenv.config({ path: path.resolve(__dirname, ".env") });

// Expose only vars starting with VITE_
const viteEnv = Object.keys(process.env)
  .filter((k) => k.startsWith("VITE_"))
  .reduce<Record<string, string>>((a, k) => {
    a[k] = process.env[k] ?? "";
    return a;
  }, {});

const REVISION_PATTERN = /^[0-9a-f]{5,40}$/i;
const BUILD_ENVIRONMENTS = new Set(["DEV", "PREVIEW", "PROD"]);

function resolveRevision() {
  let revision = process.env.VITE_APP_REVISION?.trim();
  if (!revision) {
    try {
      revision = execFileSync("git", ["rev-parse", "--short=5", "HEAD"], {
        cwd: path.resolve(__dirname, "../.."),
        encoding: "utf8",
      }).trim();
    } catch {
      throw new Error("Web build revision is unavailable. Set VITE_APP_REVISION to a 5 to 40 character Git SHA.");
    }
  }
  if (!REVISION_PATTERN.test(revision)) {
    throw new Error("VITE_APP_REVISION must be a 5 to 40 character Git SHA.");
  }
  return revision.slice(0, 5).toLowerCase();
}

function resolveEnvironment(mode: string) {
  let environment = process.env.VITE_APP_ENVIRONMENT?.trim().toUpperCase();
  if (!environment) {
    if (mode === "development") environment = "DEV";
    else if (mode === "preview") environment = "PREVIEW";
    else if (mode === "production") environment = "PROD";
    else throw new Error("VITE_APP_ENVIRONMENT is required for custom Vite modes.");
  }
  if (!BUILD_ENVIRONMENTS.has(environment)) {
    throw new Error("VITE_APP_ENVIRONMENT must be DEV, PREVIEW, or PROD.");
  }
  return environment;
}

export default defineConfig(({ mode }) => ({
  define: {
    "import.meta.env.VITE_APP_ENVIRONMENT": JSON.stringify(resolveEnvironment(mode)),
    "import.meta.env.VITE_APP_REVISION": JSON.stringify(resolveRevision()),
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(packageJson.version),
    "process.env": JSON.stringify(viteEnv),
  },
  build: {
    assetsInlineLimit: 0,
  },
  plugins: [reactRouter(), tsconfigPaths({ projects: [path.resolve(__dirname, "tsconfig.json")] })],
  resolve: {
    alias: {
      // Next.js compatibility shims used within web
      "next/link": path.resolve(__dirname, "app/compat/next/link.tsx"),
      "next/navigation": path.resolve(__dirname, "app/compat/next/navigation.ts"),
      "next/script": path.resolve(__dirname, "app/compat/next/script.tsx"),
    },
    dedupe: ["react", "react-dom", "@headlessui/react"],
  },
  server: {
    host: "127.0.0.1",
  },
  // No SSR-specific overrides needed; alias resolves to ESM build
}));
