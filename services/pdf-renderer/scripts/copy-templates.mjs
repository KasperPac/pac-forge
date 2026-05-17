// Copy src/templates/** to dist/templates/** after tsc finishes.
// Node 22 ships fs.cp with recursive support, so this is one call.

import { cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "..", "src", "templates");
const dst = resolve(here, "..", "dist", "templates");

await cp(src, dst, { recursive: true, force: true });
console.log(`copied templates: ${src} -> ${dst}`);
