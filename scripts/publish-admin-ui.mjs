/**
 * [INPUT]: 依赖 admin-ui/dist、根 public 目录与 Node.js 文件系统
 * [OUTPUT]: 清理旧 public/assets 并复制 Admin dist，同时保留 public 中 Reader/书源等非 Admin 兼容文件
 * [POS]: scripts 的 Admin 发布边界，保证 index/assets 来自当前构建且不误删其它公共发布内容
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
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
