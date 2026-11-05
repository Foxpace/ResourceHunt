import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createWebAssets } from "./http/web-assets.ts";

type BrowserAssets = Awaited<ReturnType<typeof createWebAssets>>;
interface AssetOutput {
  url: string;
  outputFile: string;
}

const outputs: readonly AssetOutput[] = [
  { url: "/", outputFile: "index.html" },
  { url: "/assets/app.js", outputFile: "assets/app.js" },
  { url: "/assets/style.css", outputFile: "assets/style.css" },
  { url: "/favicon.png", outputFile: "favicon.png" },
];

const assets = await createWebAssets();
try {
  for (const output of outputs) await writeBrowserAsset(assets, output);

  console.log("Built browser assets in dist/");
} finally {
  await assets.dispose();
}

async function writeBrowserAsset(assets: BrowserAssets, output: AssetOutput): Promise<void> {
  const asset = await assets.get(output.url);
  if (!asset) throw new Error(`Missing browser asset: ${output.url}`);

  const outputPath = resolve("dist", output.outputFile);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, asset.body);
}
