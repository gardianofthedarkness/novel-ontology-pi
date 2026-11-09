import { defineConfig, type Plugin } from "vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)), SETTINGS = resolve(here, "../../src/v2/settings.ts"), BROWSER = resolve(here, "src/data/settingsBrowser.ts");
/** The world modules the pages share read the world generator schema through src/v2/settings.ts, which reads files: in the browser they read the bundled defaults instead. */
const browserSettings: Plugin = { name: "browser-settings", enforce: "pre", resolveId(source, importer) { if (!importer || !source.startsWith(".")) return null; return resolve(dirname(importer), source).replace(/\.js$/, ".ts") === SETTINGS ? BROWSER : null; } };
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [browserSettings, react()],
  // The stage's nav grids and building kinds live with the CLI's stage faculties (src/v2/world): the dev server serves that folder too.
  server: { port: 5173, fs: { allow: [".", "../../src/v2/world"] } },
});
