import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

// The current tests are pure logic: no simulated DOM is needed.
export default mergeConfig(viteConfig, defineConfig({ test: { environment: "node" } }));
