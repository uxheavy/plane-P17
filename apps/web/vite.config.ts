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

export default defineConfig(() => ({
  define: {
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
    host: "127.0.0.1",
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
}));
