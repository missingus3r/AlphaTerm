import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

// Tauri espera un puerto fijo y no debe tapar los errores de Rust.
export default defineConfig({
  plugins: [solid()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } },
  build: { target: "es2022", sourcemap: false },
});
