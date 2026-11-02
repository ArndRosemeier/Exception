import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

// base "./" so the build works from any sub-path, e.g. apps.futuremagic.de/Exception/
export default defineConfig({
  base: "./",
  plugins: [preact()],
  server: { port: 5175 },
  test: { environment: "node" },
} as any);
