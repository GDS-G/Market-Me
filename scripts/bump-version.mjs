import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Mechanical release metadata update only; no dependency resolution, Git writes, or publishing.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2];
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version ?? "")) throw new Error("Pass an explicit semantic release version");
const readJson = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));
const writeJson = (path, data) => writeFile(resolve(root, path), `${JSON.stringify(data, null, 2)}\n`);
const manifests = ["package.json"];
for (const parent of ["apps", "packages"]) {
  for (const entry of await readdir(resolve(root, parent), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = `${parent}/${entry.name}/package.json`;
    try { await readJson(path); manifests.push(path); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}
const updateInternalDependencies = (manifest) => {
  for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    for (const name of Object.keys(manifest[field] ?? {})) if (name.startsWith("@market-me/")) manifest[field][name] = version;
  }
};
for (const path of manifests) {
  const manifest = await readJson(path);
  if (path !== "package.json" && !manifest.name?.startsWith("@market-me/")) throw new Error(`Unexpected workspace at ${path}`);
  manifest.version = version;
  updateInternalDependencies(manifest);
  await writeJson(path, manifest);
}
const lock = await readJson("package-lock.json");
lock.version = version;
for (const path of manifests) {
  const packagePath = path === "package.json" ? "" : path.slice(0, -"/package.json".length);
  const entry = lock.packages[packagePath];
  if (!entry) throw new Error(`Workspace missing from package lock: ${packagePath}`);
  entry.version = version;
  updateInternalDependencies(entry);
}
await writeJson("package-lock.json", lock);
const tauriPath = "apps/companion/src-tauri/tauri.conf.json";
const tauri = await readJson(tauriPath);
tauri.version = version;
await writeJson(tauriPath, tauri);
for (const path of ["apps/companion/src-tauri/Cargo.toml", "apps/companion/src-tauri/Cargo.lock"]) {
  const source = await readFile(resolve(root, path), "utf8");
  const pattern = /(name = "market-me-companion"\r?\nversion = ")[^"]+("\r?\n)/g;
  if ([...source.matchAll(pattern)].length !== 1) throw new Error(`Expected exactly one native package version in ${path}`);
  await writeFile(resolve(root, path), source.replace(pattern, `$1${version}$2`));
}
console.log(JSON.stringify({ version, workspaceManifests: manifests.length - 1, nativeMetadataUpdated: true, dependencyResolutionChanged: false }));
