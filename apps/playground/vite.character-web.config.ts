import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { characterData } from "./character-web/server/volumes";

// The character web: its own page, port and build, sharing the playground's
// dependencies. It serves a private book's records, so it stays on loopback.
export default defineConfig({
  root: "character-web",
  base: "./",
  plugins: [react(), characterData()],
  server: { host: "127.0.0.1", port: 5181, strictPort: true },
  preview: { host: "127.0.0.1", port: 5182, strictPort: true },
  build: { outDir: "../dist-character-web", emptyOutDir: true },
});
