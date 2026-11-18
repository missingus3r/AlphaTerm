import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

// Los tests actuales son lógica pura: no hace falta un DOM simulado.
export default mergeConfig(viteConfig, defineConfig({ test: { environment: "node" } }));
