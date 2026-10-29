import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  // The stage's nav grids and building kinds live with the CLI's stage faculties (src/ground/stage): the dev server serves that folder too.
  server: { port: 5173, fs: { allow: [".", "../../src/ground/stage"] } },
});
