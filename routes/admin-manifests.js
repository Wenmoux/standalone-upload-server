/**
 * [INPUT]: 依赖 Express、Admin 权限、Book Manifest 服务与导入确认约定
 * [OUTPUT]: 对外提供 单书 Manifest 导出、包校验和确认导入路由
 * [POS]: routes 的书籍可移植协议边界，保持校验和/身份冲突规则集中在 book-manifest 服务
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const express = require("express");

function createAdminManifestRoutes(options = {}) {
    const router = express.Router();
    const requireAdmin = options.requireAdmin || ((req, res, next) => next());
    const service = options.bookManifestService;
    const logEvent = options.logEvent || (() => {});

    router.get("/admin-api/books/:metadataId/manifest", requireAdmin, async (req, res, next) => {
        try {
            const metadataId = Number(req.params.metadataId);
            if (!Number.isSafeInteger(metadataId) || metadataId <= 0) return res.status(400).json({ error: "invalid metadata id" });
            const includeContent = !/^(0|false|no)$/i.test(String(req.query.include_content ?? "1"));
            const manifest = await service.exportManifest(metadataId, { includeContent });
            const safeName = `${manifest.book.platform}-${manifest.book.book_id}`.replace(/[^0-9A-Za-z._-]+/g, "_").slice(0, 100);
            res.setHeader("Content-Disposition", `attachment; filename="${safeName || "book"}.manifest.json"`);
            res.json(manifest);
        } catch (error) {
            next(error);
        }
    });

    router.post("/admin-api/books/manifests/validate", requireAdmin, async (req, res, next) => {
        try {
            const manifest = req.body?.manifest || req.body;
            const validated = service.validateManifest(manifest);
            res.json({
                valid: true,
                format: manifest.format,
                version: manifest.version,
                book: { book_id: validated.book.book_id, platform: validated.book.platform, title: validated.book.title },
                chapters: validated.chapters.length,
                checksum: validated.checksum,
                expected_confirmation: `IMPORT ${validated.book.platform}:${validated.book.book_id}`
            });
        } catch (error) {
            next(error);
        }
    });

    router.post("/admin-api/books/manifests/import", requireAdmin, async (req, res, next) => {
        try {
            const manifest = req.body?.manifest || req.body;
            const validated = service.validateManifest(manifest);
            const expected = `IMPORT ${validated.book.platform}:${validated.book.book_id}`;
            const confirmation = req.body?.manifest
                ? (req.body.confirmation || req.body.confirm)
                : req.get("x-manifest-confirmation");
            if (String(confirmation || "").trim() !== expected) {
                return res.status(400).json({ error: "confirmation phrase mismatch", expected_confirmation: expected });
            }
            const result = await service.importManifest(manifest);
            logEvent("info", "server-pg", "book-manifest-imported", {
                book_id: result.book_id,
                platform: result.platform,
                checksum: result.checksum,
                chapters_inserted: result.chapters.inserted,
                chapters_updated: result.chapters.updated,
                chapters_unchanged: result.chapters.unchanged
            });
            res.json(result);
        } catch (error) {
            logEvent("error", "server-pg", "book-manifest-import-failed", { error: error.message || String(error) });
            next(error);
        }
    });

    return router;
}

module.exports = { createAdminManifestRoutes };
