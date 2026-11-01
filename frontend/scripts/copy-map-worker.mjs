// MapLibre's background worker must be served as plain files: the bundler can't resolve the path
// it uses by default. It imports the shared file, so both go in the same folder.
import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("public/maplibre", { recursive: true });
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(`node_modules/maplibre-gl/dist/${file}`, `public/maplibre/${file}`);
}
