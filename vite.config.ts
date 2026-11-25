import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

// Tauri expects a fixed port and must not hide Rust errors.
export default defineConfig({
  plugins: [solid()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } },
  build: { target: "es2022", sourcemap: false },
});
