import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(rootDir, "admin-ui", "dist");
const publicDir = path.join(rootDir, "public");
const assetsDir = path.join(publicDir, "assets");

async function copyDir(source, target) {
  await fs.mkdir(target, { recursive: true });
  const entries = await fs.readdir(source, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const from = path.join(source, entry.name);
      const to = path.join(target, entry.name);
      if (entry.isDirectory()) {
        await copyDir(from, to);
        return;
      }
      await fs.copyFile(from, to);
    })
  );
}

await fs.access(path.join(distDir, "index.html"));
await fs.mkdir(publicDir, { recursive: true });
await fs.rm(assetsDir, { recursive: true, force: true });
await copyDir(distDir, publicDir);

console.log(`Published admin-ui dist to ${publicDir}`);
