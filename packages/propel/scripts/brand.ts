/* eslint-disable no-await-in-loop -- Render one animation at a time before publishing any outputs. */
/** Generate declared identity exports; artwork lives in the runtime components. */
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SITE_NAME } from "@plane/constants";
import {
  DARK,
  renderMarkSvg,
  renderWordmarkSvg,
  renderLockupSvg,
  renderStackedSvg,
  renderAppIconSvg,
  renderMarkCanvasSvg,
  renderHorizontalSvg,
  rasterSvg,
  animatedGif,
  pngIco,
  renderTakeoffSvg,
  renderSpaceLogoSvg,
} from "./brand-artwork";

const SOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
type Rendered = Buffer | string;
type Target = { path: string; render: () => Promise<Rendered> | Rendered };

const target = (path: string, render: () => Promise<Rendered> | Rendered): Target => ({
  path,
  render,
});

const targets: Target[] = [
  target("apps/web/app/assets/company-runner-logos/mark.svg", () => renderMarkSvg()),
  target("apps/web/app/assets/company-runner-logos/lockup-light.svg", () => renderLockupSvg(DARK)),
  target("apps/web/app/assets/company-runner-logos/lockup-dark.svg", () => renderLockupSvg("#FFFFFF")),
  target("apps/web/app/assets/company-runner-logos/lockup-stacked.svg", () => renderStackedSvg(DARK)),
  target("apps/web/app/assets/company-runner-logos/wordmark-light.svg", () => renderWordmarkSvg(DARK)),
  target("apps/web/app/assets/company-runner-logos/wordmark-dark.svg", () => renderWordmarkSvg("#FFFFFF")),
  target("apps/web/app/assets/icons/app-icon.svg", () => renderAppIconSvg(64)),
  target("apps/admin/app/assets/logos/takeoff-icon-dark.svg", () => renderTakeoffSvg(DARK)),
  target("apps/admin/app/assets/logos/takeoff-icon-light.svg", () => renderTakeoffSvg("#F7F9FF")),
  target("apps/space/app/assets/company-runner-logo.svg", () => renderSpaceLogoSvg()),
  target("apps/space/app/assets/company-runner-logos/company-runner-white-horizontal.svg", () =>
    renderHorizontalSvg("#FFFFFF")
  ),
  target("apps/web/app/assets/company-runner-logos/company-runner-white-horizontal.svg", () =>
    renderHorizontalSvg("#FFFFFF")
  ),
];

function appPng(path: string, width: number) {
  return target(path, () => rasterSvg(renderAppIconSvg(width), "png"));
}

function markPng(path: string, width: number, height: number) {
  return target(path, () => rasterSvg(renderMarkCanvasSvg(width, height), "png"));
}

function horizontalPng(path: string, color: string) {
  return target(path, () => rasterSvg(renderHorizontalSvg(color, 269, 60), "png"));
}

targets.push(
  appPng("apps/admin/app/assets/favicon/apple-touch-icon.png", 180),
  appPng("apps/admin/app/assets/favicon/favicon-16x16.png", 16),
  appPng("apps/admin/app/assets/favicon/favicon-32x32.png", 32),
  appPng("apps/admin/public/favicon/android-chrome-192x192.png", 192),
  appPng("apps/admin/public/favicon/android-chrome-512x512.png", 512),
  appPng("apps/space/app/assets/favicon/apple-touch-icon.png", 180),
  appPng("apps/space/app/assets/favicon/favicon-16x16.png", 16),
  appPng("apps/space/app/assets/favicon/favicon-32x32.png", 32),
  appPng("apps/space/public/favicon/android-chrome-192x192.png", 192),
  appPng("apps/space/public/favicon/android-chrome-512x512.png", 512),
  appPng("apps/web/app/assets/favicon/apple-touch-icon.png", 180),
  appPng("apps/web/app/assets/favicon/favicon-16x16.png", 16),
  appPng("apps/web/app/assets/favicon/favicon-32x32.png", 32),
  appPng("apps/web/app/assets/icons/icon-180x180.png", 180),
  appPng("apps/web/app/assets/icons/icon-512x512.png", 512),
  appPng("apps/web/public/favicon/android-chrome-192x192.png", 192),
  appPng("apps/web/public/favicon/android-chrome-512x512.png", 512),
  appPng("apps/web/public/icons/icon-192x192.png", 192),
  appPng("apps/web/public/icons/icon-348x348.png", 348),
  appPng("apps/web/public/icons/icon-512x512.png", 512),
  appPng("apps/web/public/company-runner-logos/company-runner-mobile-pwa-192.png", 192),
  appPng("apps/web/public/company-runner-logos/company-runner-mobile-pwa.png", 1024),
  horizontalPng("apps/space/app/assets/company-runner-logos/company-runner-black-horizontal-with-blue-logo.png", DARK),
  markPng("apps/space/app/assets/company-runner-logos/company-runner-blue-without-text-new.png", 276, 276),
  markPng("apps/space/app/assets/company-runner-logos/company-runner-blue-without-text.png", 276, 276),
  horizontalPng(
    "apps/space/app/assets/company-runner-logos/company-runner-white-horizontal-with-blue-logo.png",
    "#FFFFFF"
  ),
  horizontalPng("apps/web/app/assets/company-runner-logos/company-runner-horizontal-with-blue-logo.png", DARK),
  horizontalPng(
    "apps/web/app/assets/company-runner-logos/company-runner-white-horizontal-with-blue-logo.png",
    "#FFFFFF"
  ),
  markPng("apps/web/app/assets/company-runner-logos/company-runner-without-text.png", 276, 276)
);

targets.push(
  target("apps/web/app/assets/auth/gradient-logo.webp", () =>
    rasterSvg(renderMarkCanvasSvg(561, 312, { gradient: true }), "webp")
  ),
  target("apps/web/app/assets/auth/gradient-bg-logo.webp", () =>
    rasterSvg(renderMarkCanvasSvg(1080, 672, { gradient: true }), "webp")
  )
);

for (const root of ["apps/admin", "apps/space"]) {
  targets.push(
    target(`${root}/app/assets/images/logo-spinner-dark.gif`, () => animatedGif(553, 306, 65)),
    target(`${root}/app/assets/images/logo-spinner-light.gif`, () => animatedGif(552, 308, 65))
  );
}
targets.push(
  target("apps/web/app/assets/images/logo-spinner-dark.gif", () => animatedGif(170, 104, 24)),
  target("apps/web/app/assets/images/logo-spinner-light.gif", () => animatedGif(170, 104, 24))
);

const manifestNames: Array<{ path: string; admin?: boolean }> = [
  { path: "apps/web/manifest.json" },
  { path: "apps/web/public/manifest.json" },
  { path: "apps/web/public/site.webmanifest.json" },
  { path: "apps/admin/public/site.webmanifest.json", admin: true },
];

for (const manifest of manifestNames) {
  targets.push(
    target(manifest.path, async () => {
      const source = await readFile(join(SOURCE_ROOT, manifest.path), "utf8");
      const policy = JSON.parse(source) as { name: string; short_name: string; description?: string };
      const name = manifest.admin ? `${SITE_NAME} Admin` : SITE_NAME;
      const identity: Record<string, string> = { name, short_name: name };
      const previousName = manifest.admin ? policy.name.replace(/ Admin$/, "") : policy.name;
      if (previousName && policy.description?.startsWith(previousName)) {
        identity.description = SITE_NAME + policy.description.slice(previousName.length);
      }
      return `${JSON.stringify({ ...policy, ...identity }, null, 2)}\n`;
    })
  );
}

const icoPaths = [
  { path: "apps/admin/app/assets/favicon/favicon.ico", sizes: [16, 32, 48] },
  { path: "apps/space/app/assets/favicon/favicon.ico", sizes: [16, 32, 48] },
  { path: "apps/web/app/assets/favicon/favicon.ico", sizes: [16, 32] },
];
for (const ico of icoPaths) {
  targets.push(
    target(ico.path, async () =>
      pngIco(
        await Promise.all(
          ico.sizes.map(async (size) => ({ width: size, data: await rasterSvg(renderAppIconSvg(size), "png") }))
        )
      )
    )
  );
}

function parseArgs() {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  const mode = args.shift();
  if (mode !== "check" && mode !== "generate") throw new Error("usage: brand.ts <generate|check> [--root <path>]");
  let root: string | undefined;
  while (args.length) {
    const arg = args.shift();
    if (arg === "--root" || arg === "--output-root") {
      root = args.shift();
      if (!root || root.startsWith("--")) throw new Error(`${arg} requires a path`);
      continue;
    }
    if (arg?.startsWith("--root=") || arg?.startsWith("--output-root=")) {
      root = arg.slice(arg.indexOf("=") + 1);
      if (!root) throw new Error(`${arg.slice(0, arg.indexOf("="))} requires a path`);
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return { mode, outputRoot: resolve(root ?? SOURCE_ROOT) };
}

async function readExisting(path: string) {
  try {
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return undefined;
  }
}

async function writeAtomic(path: string, data: Buffer) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  try {
    await writeFile(temp, data);
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true });
  }
}

async function main() {
  const { mode, outputRoot } = parseArgs();
  const failures: string[] = [];
  const rendered: Array<{ expected: Buffer; path: string }> = [];
  for (const item of targets) {
    const output = await item.render();
    const expected = Buffer.isBuffer(output) ? output : Buffer.from(output);
    const path = join(outputRoot, item.path);
    const actual = await readExisting(path);
    if (!actual) {
      failures.push(`${item.path}: missing`);
    } else if (!actual.equals(expected)) {
      failures.push(`${item.path}: stale or tampered`);
    }
    if (!actual?.equals(expected)) rendered.push({ expected, path });
  }
  if (mode === "generate") {
    for (const { expected, path } of rendered) await writeAtomic(path, expected);
    console.log(`brand:generate updated ${rendered.length} of ${targets.length} outputs`);
    return;
  }
  if (failures.length) {
    throw new Error(`brand:check failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  }
  console.log(`brand:check passed (${targets.length} outputs)`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
