/**
 * [INPUT]: 依赖 PikPak WebDAV 适配器、Telegram 文件投递、群聊判定和临时文件系统
 * [OUTPUT]: 对外提供 PikPak 目录、搜索与下载命令处理器
 * [POS]: bot 的外部存储交互层，隔离 WebDAV 文件流和临时目录生命周期，不参与其它命令路由
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const fs = require("fs/promises");
const { createWriteStream } = require("fs");
const os = require("os");
const path = require("path");
const { pipeline } = require("stream/promises");

function createPikpakHandler(options = {}) {
    const ensureRegistered = options.ensureRegistered;
    const pikpakConfig = options.pikpakConfig;
    const webdavRequest = options.webdavRequest;
    const pikpakList = options.pikpakList;
    const pikpakSearch = options.pikpakSearch;
    const sendMessage = options.sendMessage;
    const editMessage = options.editMessage;
    const sendDocument = options.sendDocument;
    const deliverLongGroupResult = options.deliverLongGroupResult;
    const escapeHtml = options.escapeHtml;
    const bytes = options.bytes;
    const safeFileName = options.safeFileName;
    const isGroup = options.isGroup;

    return async function handlePikpak(message, args) {
        await ensureRegistered(message.from);
        const config = pikpakConfig();
        if (!config.url || !config.username || !config.password) {
            return sendMessage(message.chat.id, "管理员尚未配置 PikPak WebDAV。需要设置 PIKPAK_WEBDAV_URL / USERNAME / PASSWORD。");
        }
        const parts = String(args || "")
            .split(/\s+/)
            .filter(Boolean);
        const sub = (parts.shift() || "").toLowerCase();
        if (["search", "s", "搜", "查"].includes(sub)) {
            const keyword = parts.join(" ").trim();
            if (!keyword) return sendMessage(message.chat.id, "用法：/pikpak search 关键词");
            const progress = await sendMessage(message.chat.id, `正在搜索「${escapeHtml(keyword)}」...`);
            const files = await pikpakSearch(config, keyword);
            if (!files.length)
                return editMessage(message.chat.id, progress.message_id, `没找到「${escapeHtml(keyword)}」相关的文件。`).catch(() => {});
            const lines = [`<b>PikPak 搜索：${escapeHtml(keyword)}</b>`, `找到 ${files.length} 个文件`, ""];
            for (const file of files.slice(0, 20)) {
                lines.push(`📄 <b>${escapeHtml(file.name)}</b>`);
                lines.push(`   ${bytes(file.size)} · <code>${escapeHtml(file.path)}</code>`);
                if (/\.(epub|txt|pdf)$/i.test(file.name)) lines.push(`   /pikpak dl ${escapeHtml(file.path)}`);
            }
            if (files.length > 20) lines.push("", "仅显示前 20 个。");
            return deliverLongGroupResult(
                message,
                lines.join("\n"),
                {},
                {
                    title: "PikPak 搜索结果",
                    editTarget: { chatId: message.chat.id, messageId: progress.message_id }
                }
            ).catch(() => sendMessage(message.chat.id, lines.join("\n")));
        }
        if (["dl", "down", "下载"].includes(sub)) {
            const remotePath = parts.join(" ").trim();
            if (!remotePath) return sendMessage(message.chat.id, "用法：/pikpak dl /epub/xxx.epub");
            const fileName = safeFileName(remotePath.split("/").filter(Boolean).pop() || "pikpak-file", "pikpak-file");
            const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pikpak-"));
            const filePath = path.join(dir, fileName);
            const progress = await sendMessage(message.chat.id, `正在下载：${escapeHtml(fileName)}`);
            try {
                const response = await webdavRequest(config, "GET", remotePath);
                if (!response.ok)
                    return editMessage(message.chat.id, progress.message_id, `下载失败：HTTP ${response.status}`).catch(() => {});
                await pipeline(response.body, createWriteStream(filePath));
                await editMessage(message.chat.id, progress.message_id, "下载完成，正在发送...").catch(() => {});
                await sendDocument(isGroup(message.chat) ? message.from.id : message.chat.id, filePath, escapeHtml(fileName));
                if (isGroup(message.chat))
                    await editMessage(message.chat.id, progress.message_id, "已私聊发送 PikPak 文件。").catch(() => {});
                else await editMessage(message.chat.id, progress.message_id, "PikPak 文件已发送。").catch(() => {});
            } finally {
                await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
            }
            return;
        }
        const listPath = sub && sub.startsWith("/") ? sub : config.root;
        const files = await pikpakList(config, listPath);
        if (!files.length) return sendMessage(message.chat.id, "PikPak 目录为空或连接失败。");
        const lines = [`<b>PikPak</b> ${escapeHtml(listPath)}`, `共 ${files.length} 项`, ""];
        for (const file of files.slice(0, 20)) {
            if (file.is_dir) lines.push(`📂 <b>${escapeHtml(file.name)}</b>/\n   <code>${escapeHtml(file.path)}</code>`);
            else {
                lines.push(`📄 <b>${escapeHtml(file.name)}</b> · ${bytes(file.size)}`);
                if (/\.(epub|txt|pdf)$/i.test(file.name)) lines.push(`   /pikpak dl ${escapeHtml(file.path)}`);
            }
        }
        if (files.length > 20) lines.push("", "仅显示前 20 个。");
        return deliverLongGroupResult(message, lines.join("\n"), {}, { title: "PikPak 目录" });
    };
}

module.exports = {
    createPikpakHandler
};
