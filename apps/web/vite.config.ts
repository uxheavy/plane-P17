import { execFileSync } from "node:child_process";
import path from "node:path";
import * as dotenv from "dotenv";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig, searchForWorkspaceRoot } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

dotenv.config({ path: path.resolve(__dirname, ".env") });

const excalidrawSource = process.env.EXCALIDRAW_SOURCE_DIR;
const backend = process.env.DEV_BACKEND_URL;
const sourceAliases = excalidrawSource
  ? [
      {
        find: "@excalidraw/excalidraw/index.css",
        replacement: path.resolve(excalidrawSource, "packages/excalidraw/css/app.scss"),
      },
      ...["common", "element", "math", "utils", "fractional-indexing", "laser-pointer", "excalidraw"].flatMap(
        (name) => {
          const directory = path.resolve(excalidrawSource, "packages", name, name === "excalidraw" ? "." : "src");
          return [
            {
              find: new RegExp(`^@excalidraw/${name}$`),
              replacement: path.join(directory, name === "excalidraw" ? "index.tsx" : "index.ts"),
            },
            { find: new RegExp(`^@excalidraw/${name}/`), replacement: `${directory}/` },
          ];
        }
      ),
    ]
  : [];

// Expose only vars starting with VITE_
const viteEnv = Object.keys(process.env)
  .filter((k) => k.startsWith("VITE_"))
  .reduce<Record<string, string>>((a, k) => {
    a[k] = process.env[k] ?? "";
    return a;
  }, {});

const REVISION_PATTERN = /^[0-9a-f]{5,40}$/i;
const BUILD_ENVIRONMENTS = new Set(["DEV", "PREVIEW", "PROD"]);
const PRODUCT_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

// The product version belongs to the repository that builds this application,
// which this checkout cannot see, so it arrives as a build input.
//
// A value that is PRESENT must be valid: a malformed version is supplied
// garbage and always fails. Whether a version must be present is the caller's
// decision, not this build's, because the caller is the only party that knows
// whether it is producing a release. Container and CI callers declare that by
// requiring the variable, the same way they already require the revision.
//
// Absence is therefore meaningful rather than an error state: a build with no
// product version renders a label without one. This also keeps the rule
// independent of build mode, which is a tooling detail that prerender steps
// re-evaluate independently.
function resolveProductVersion() {
  const version = process.env.VITE_APP_PRODUCT_VERSION?.trim();
  if (!version) return "";
  if (!PRODUCT_VERSION_PATTERN.test(version)) {
    throw new Error("VITE_APP_PRODUCT_VERSION must be a Semantic Version such as 1.0.0.");
  }
  return version;
}

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

export default defineConfig(({ mode }) => {
  const environment = resolveEnvironment(mode);
  return {
    define: {
      "import.meta.env.VITE_APP_ENVIRONMENT": JSON.stringify(environment),
      "import.meta.env.VITE_APP_REVISION": JSON.stringify(resolveRevision()),
      "import.meta.env.VITE_APP_PRODUCT_VERSION": JSON.stringify(resolveProductVersion()),
      "process.env": JSON.stringify(viteEnv),
    },
    build: {
      assetsInlineLimit: 0,
    },
    plugins: [reactRouter(), tsconfigPaths({ projects: [path.resolve(__dirname, "tsconfig.json")] })],
    resolve: {
      alias: [
        ...sourceAliases,
        // Next.js compatibility shims used within web
        { find: "next/link", replacement: path.resolve(__dirname, "app/compat/next/link.tsx") },
        { find: "next/navigation", replacement: path.resolve(__dirname, "app/compat/next/navigation.ts") },
        { find: "next/script", replacement: path.resolve(__dirname, "app/compat/next/script.tsx") },
      ],
      dedupe: ["react", "react-dom", "@headlessui/react"],
    },
    server: {
      // Loopback by default, which is what a host-run dev server should use.
      // A container publishes its port through Docker, so Vite must bind the
      // container's interface instead; DEV_SERVER_HOST supplies that without
      // changing the default for every other case.
      host: process.env.DEV_SERVER_HOST || "127.0.0.1",
      ...(excalidrawSource ? { fs: { allow: [searchForWorkspaceRoot(__dirname), excalidrawSource] } } : {}),
      ...(backend
        ? {
            proxy: Object.fromEntries(
              ["/api", "/auth", "/static", "/uploads", "/live"].map((route) => [
                route,
                { target: backend, ws: route === "/live" },
              ])
            ),
          }
        : {}),
    },
    // No SSR-specific overrides needed; alias resolves to ESM build
  };
});
