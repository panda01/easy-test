import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import dotenv from "dotenv";

// Load environment variables from .env.local first, then .env. Vite's own
// loadEnv only exposes VITE_-prefixed vars, and SERVER_PORT is deliberately
// NOT VITE_-prefixed (it must never reach the browser bundle), so dotenv is
// read directly here.
dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });

// Hard failures, not defaults. A guessed port would leave the /api proxy
// pointing at nothing and surface much later as an unexplained 500.
if (!process.env.VITE_PORT) {
  throw new Error("VITE_PORT is not defined in environment variables");
}
if (!process.env.SERVER_PORT) {
  throw new Error("SERVER_PORT is not defined in environment variables");
}

const vitePort = parseInt(process.env.VITE_PORT, 10);
const serverPort = parseInt(process.env.SERVER_PORT, 10);

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: vitePort,
    // strictPort so a collision is a loud failure instead of Vite silently
    // moving to the next free port and breaking every bookmark and script.
    strictPort: true,
    proxy: {
      // This proxy is the reason there is no `cors` package in the project:
      // the browser only ever talks to the Vite origin.
      "/api": { target: `http://localhost:${serverPort}`, changeOrigin: false },
    },
  },
  build: { outDir: "dist" },
});
