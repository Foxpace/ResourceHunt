import { build, context, type BuildOptions } from "esbuild";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const webDirectory = new URL("../web/", import.meta.url);
export interface WebAsset {
  body: string | Uint8Array;
  contentType: string;
}

/** Bundle TypeScript once, or watch browser imports during development. */
export async function createWebAssets(watch = false) {
  const files = new Map<string, WebAsset>();
  const options = browserBuildOptions(files, watch);
  const builder = watch ? await context(options) : undefined;
  try {
    if (builder) {
      await builder.rebuild();
      await builder.watch();
    } else await build(options);
  } catch (error) {
    await builder?.dispose();
    throw error;
  }

  return {
    get: (path: string) => readWebAsset(path, files),
    async dispose() {
      await builder?.dispose();
    },
  };
}

function browserBuildOptions(files: Map<string, WebAsset>, watch: boolean): BuildOptions {
  return {
    entryPoints: [fileURLToPath(new URL("app.ts", webDirectory))],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    minify: !watch,
    sourcemap: watch ? "inline" : false,
    outfile: "app.js",
    plugins: [
      {
        name: "browser-assets",
        setup(builder) {
          builder.onEnd((result) => {
            const output = result.outputFiles?.[0];
            const bundleReady = !!(output && !result.errors.length);
            if (bundleReady)
              files.set("/assets/app.js", {
                body: output.contents,
                contentType: "text/javascript; charset=utf-8",
              });
          });
        },
      },
    ],
  };
}

async function readWebAsset(
  path: string,
  files: Map<string, WebAsset>,
): Promise<WebAsset | undefined> {
  if (path === "/favicon.png") {
    return {
      body: await readFile(new URL("../../docs/assets/resource-hunt-icon.png", import.meta.url)),
      contentType: "image/png",
    };
  }
  if (path === "/") {
    const html = await readFile(new URL("index.html", webDirectory), "utf8");
    return {
      body: html.replace("./app.ts", "/assets/app.js").replace("./style.css", "/assets/style.css"),
      contentType: "text/html; charset=utf-8",
    };
  }
  if (path === "/assets/style.css")
    return {
      body: await readFile(new URL("style.css", webDirectory), "utf8"),
      contentType: "text/css; charset=utf-8",
    };

  return files.get(path);
}
