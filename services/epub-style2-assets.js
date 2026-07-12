/**
 * [INPUT]: 依赖文件系统、Style2 资源槽定义和上传请求流，校验图片媒体类型、尺寸与字节预算
 * [OUTPUT]: 对外提供老二次元 EPUB 资源服务、图片探测函数、请求体读取器及大小上限
 * [POS]: services 的 Style2 可替换资源边界，把 /config 覆盖文件约束在模板声明的安全槽位内
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const fs = require("fs/promises");
const path = require("path");
const {
    STYLE2_ASSET_BY_SLOT,
    STYLE2_ASSET_DEFINITIONS,
    style2AssetPaths,
    style2CustomAssetDir
} = require("./epub-style2-template");

const MAX_STYLE2_ASSET_BYTES = 20 * 1024 * 1024;

function imageMediaType(bytes) {
    if (!Buffer.isBuffer(bytes) || !bytes.length) return "";
    if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
    if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) return "image/gif";
    if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
    return "";
}

function imageDimensions(bytes, mediaType = imageMediaType(bytes)) {
    if (mediaType === "image/png" && bytes.length >= 24) {
        return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    }
    if (mediaType === "image/gif" && bytes.length >= 10) {
        return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
    }
    if (mediaType === "image/jpeg") {
        let offset = 2;
        while (offset + 9 < bytes.length && bytes[offset] === 0xff) {
            const marker = bytes[offset + 1];
            const length = bytes.readUInt16BE(offset + 2);
            if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
                return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
            }
            if (length < 2) break;
            offset += 2 + length;
        }
    }
    return { width: 0, height: 0 };
}

async function existingFile(paths = []) {
    for (const filePath of paths) {
        try {
            const stat = await fs.stat(filePath);
            if (stat.isFile() && stat.size > 0) return { filePath, stat };
        } catch {
            // Try the packaged fallback.
        }
    }
    return null;
}

async function readRequestBuffer(req, maxBytes = MAX_STYLE2_ASSET_BYTES) {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buffer.length;
        if (total > maxBytes) {
            const error = new Error(`图片不能超过 ${Math.round(maxBytes / 1024 / 1024)} MB`);
            error.status = 413;
            throw error;
        }
        chunks.push(buffer);
    }
    return Buffer.concat(chunks);
}

function createEpubStyle2AssetService(options = {}) {
    const configFile = options.configFile || process.env.PO18_CONFIG_FILE || "/config/app.env";
    const customDir = options.customDir || style2CustomAssetDir(configFile);

    function definitionFor(slot) {
        return STYLE2_ASSET_BY_SLOT.get(String(slot || "").trim()) || null;
    }

    function customPath(definition) {
        return path.join(customDir, `${definition.slot}.asset`);
    }

    async function resolveAsset(slot) {
        const definition = definitionFor(slot);
        if (!definition) return null;
        const paths = style2AssetPaths(definition, configFile);
        paths[0] = customPath(definition);
        const found = await existingFile(paths);
        if (!found) return { definition, missing: true, custom: false };
        const bytes = await fs.readFile(found.filePath);
        const mediaType = imageMediaType(bytes) || definition.mediaType;
        return {
            definition,
            filePath: found.filePath,
            bytes,
            size: found.stat.size,
            mediaType,
            ...imageDimensions(bytes, mediaType),
            custom: path.resolve(found.filePath) === path.resolve(customPath(definition))
        };
    }

    async function listAssets() {
        const rows = [];
        for (const definition of STYLE2_ASSET_DEFINITIONS) {
            const asset = await resolveAsset(definition.slot);
            rows.push({
                slot: definition.slot,
                label: definition.label,
                custom: !!asset?.custom,
                missing: !!asset?.missing,
                bytes: Number(asset?.size || 0),
                width: Number(asset?.width || 0),
                height: Number(asset?.height || 0),
                recommendedWidth: definition.width,
                recommendedHeight: definition.height,
                mediaType: asset?.mediaType || definition.mediaType,
                url: `/admin-api/config/export/style2-assets/${encodeURIComponent(definition.slot)}`
            });
        }
        return rows;
    }

    async function sendAsset(slot, res) {
        const asset = await resolveAsset(slot);
        if (!asset) return res.status(404).json({ error: "未知的样式图片资源" });
        if (asset.missing) return res.status(404).json({ error: "样式图片资源不存在" });
        res.set("Content-Type", asset.mediaType);
        res.set("Content-Length", String(asset.bytes.length));
        res.set("Cache-Control", asset.custom ? "private, no-cache" : "private, max-age=3600");
        return res.send(asset.bytes);
    }

    async function uploadAsset(slot, req) {
        const definition = definitionFor(slot);
        if (!definition) {
            const error = new Error("未知的样式图片资源");
            error.status = 404;
            throw error;
        }
        const bytes = await readRequestBuffer(req);
        const mediaType = imageMediaType(bytes);
        if (!mediaType) {
            const error = new Error("仅支持 JPEG、PNG、GIF 或 WebP 图片");
            error.status = 400;
            throw error;
        }
        await fs.mkdir(customDir, { recursive: true });
        const target = customPath(definition);
        const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
        await fs.writeFile(temp, bytes);
        await fs.rm(target, { force: true }).catch(() => {});
        await fs.rename(temp, target);
        return {
            slot: definition.slot,
            label: definition.label,
            custom: true,
            bytes: bytes.length,
            mediaType,
            ...imageDimensions(bytes, mediaType),
            recommendedWidth: definition.width,
            recommendedHeight: definition.height
        };
    }

    async function restoreAsset(slot) {
        const definition = definitionFor(slot);
        if (!definition) {
            const error = new Error("未知的样式图片资源");
            error.status = 404;
            throw error;
        }
        await fs.rm(customPath(definition), { force: true });
        return { slot: definition.slot, label: definition.label, custom: false };
    }

    return { listAssets, resolveAsset, restoreAsset, sendAsset, uploadAsset };
}

module.exports = {
    MAX_STYLE2_ASSET_BYTES,
    createEpubStyle2AssetService,
    imageDimensions,
    imageMediaType,
    readRequestBuffer
};
