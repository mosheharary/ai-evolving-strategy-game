import { defineConfig } from "tsup";

// Bundle workspace packages (TypeScript sources) into one ESM file; keep npm deps external.
export default defineConfig({
  entry: ["src/main.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  noExternal: [/^@echoes\//],
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
});
