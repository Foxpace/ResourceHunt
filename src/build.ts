import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createWebAssets } from "./http/web-assets.ts";

const assets = await createWebAssets();
try {
  const entries = [
    ["/", "index.html"],
    ["/assets/app.js", "assets/app.js"],
    ["/assets/style.css", "assets/style.css"],
    ["/favicon.png", "favicon.png"],
  ] as const;
  for (const [url, file] of entries) {
    const asset = await assets.get(url);
    if (!asset) throw new Error(`Missing browser asset: ${url}`);
    const path = resolve("dist", file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, asset.body);
  }
  console.log("Built browser assets in dist/");
} finally {
  await assets.dispose();
}
