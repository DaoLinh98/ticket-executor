// Lets `node --test` run the app's TypeScript sources directly.
//
// Node 24 strips type annotations on its own, but it still resolves imports the
// ESM way: `./prompts` is not a file. The app is written for a bundler, where
// extensionless imports are normal, so rather than rewrite every import for the
// sake of the tests, this hook fills in what the bundler would have:
//   ./x   → ./x.ts  or  ./x/index.ts
//   @/x   → <ticket-executor>/x        (the tsconfig path alias)
//
// Deliberately dependency-free: the alternative was adding a TS runner to a
// project that has none, for a test suite whose whole point is that it costs
// nothing to run.
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");

registerHooks({
  resolve(specifier, context, nextResolve) {
    const spec = specifier.startsWith("@/")
      ? pathToFileURL(path.join(ROOT, specifier.slice(2))).href
      : specifier;
    try {
      return nextResolve(spec, context);
    } catch (err) {
      if (!spec.startsWith(".") && !spec.startsWith("file:")) throw err;
      const base = new URL(spec, context.parentURL);
      for (const candidate of [`${base.href}.ts`, `${base.href}/index.ts`]) {
        if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate, context);
      }
      throw err;
    }
  },
});
