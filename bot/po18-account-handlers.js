/**
 * [INPUT]: 依赖 PgBotClient、PO18 HTTP/HTML 解析能力、Telegram 消息与图片接口及用户注册守卫
 * [OUTPUT]: 对外提供 PO18 凭据保存、验证码登录、会话状态、登出和已购书架交互处理器
 * [POS]: bot 的 PO18 账户交互层，编排短期验证码会话并把持久凭据交由服务端加密 API 管理
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
function createPo18AccountHandlers(options = {}) {
    const {
        client,
        ensureRegistered,
        sendMessage,
        sendPhoto,
        editMessage,
        deliverLongGroupResult,
        escapeHtml,
        callback,
        po18Fetch,
        parseLoginFields,
        hasPo18Auth,
        fetchPo18Bookshelf
    } = options;
    const loginSessions = new Map();

    async function handlePo18Set(message, args) {
        await ensureRegistered(message.from);
        const parts = String(args || "").split(/\s+/).filter(Boolean);
        if (parts.length < 2) return sendMessage(message.chat.id, "用法：/po18set 账号 密码");
        await client.savePo18Account(message.from.id, { account: parts[0], password: parts.slice(1).join(" "), last_status: "account_saved" });
        return sendMessage(message.chat.id, "PO18 账号密码已保存。接着发 /loginpo18 获取验证码。");
    }

    async function handleLoginPo18(message) {
        await ensureRegistered(message.from);
        const account = await client.po18Account(message.from.id);
        if (!account.account) return sendMessage(message.chat.id, "先用 /po18set 账号 密码 保存登录信息。");
        const loginUrl = "https://members.po18.tw/apps/login.php?u=https://www.po18.tw/site/alarm";
        const { response, cookies } = await po18Fetch(loginUrl, { redirect: "follow" });
        if (!response.ok) return sendMessage(message.chat.id, `获取登录页失败：HTTP ${response.status}`);
        const html = await response.text();
        const fields = parseLoginFields(html);
        const captcha = await po18Fetch(`https://members.po18.tw/apps/images.php?${Date.now()}`, {
            redirect: "follow",
            headers: { Referer: loginUrl }
        }, cookies);
        if (!captcha.response.ok) {
            return sendMessage(message.chat.id, `PO18 验证码获取失败：HTTP ${captcha.response.status}。稍后重试 /loginpo18，或先在浏览器确认 PO18 账号能打开登录页。`);
        }
        const contentType = String(captcha.response.headers.get("content-type") || "").toLowerCase();
        const image = Buffer.from(await captcha.response.arrayBuffer());
        if (!image.length) {
            return sendMessage(message.chat.id, "PO18 验证码图片为空，可能是 PO18 登录页临时跳转、风控或验证码接口没返回图片。请稍后重试 /loginpo18。");
        }
        if (/text\/html|application\/json|text\/plain/.test(contentType)) {
            return sendMessage(message.chat.id, "PO18 没有返回验证码图片，而是返回了页面内容。请稍后重试 /loginpo18，或先在浏览器打开 PO18 登录页确认没有验证/风控。");
        }
        loginSessions.set(String(message.from.id), { fields, cookies: captcha.cookies, account: account.account, password: account.password || "", createdAt: Date.now() });
        return sendPhoto(message.chat.id, image, "po18-captcha.jpg", "PO18 验证码来了，发 /po18code xxxx 提交。");
    }

    async function handlePo18Code(message, args) {
        await ensureRegistered(message.from);
        const code = String(args || "").trim().split(/\s+/)[0];
        if (!code) return sendMessage(message.chat.id, "用法：/po18code 验证码");
        const session = loginSessions.get(String(message.from.id));
        if (!session) return sendMessage(message.chat.id, "先发 /loginpo18 获取验证码。");
        const fields = { ...session.fields, account: session.account, pwd: session.password, captcha: code };
        if (!fields.remember_me) fields.remember_me = "1";
        const result = await po18Fetch("https://members.po18.tw/apps/login.php", {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                Origin: "https://members.po18.tw",
                Referer: "https://members.po18.tw/apps/login.php?u=https://www.po18.tw/site/alarm"
            },
            body: new URLSearchParams(fields)
        }, session.cookies);
        if (hasPo18Auth(result.cookies)) {
            await client.savePo18Account(message.from.id, { account: session.account, password: session.password, cookies: result.cookies, last_status: "login_ok" });
            loginSessions.delete(String(message.from.id));
            return sendMessage(message.chat.id, "PO18 登录成功，Cookie 已保存。");
        }
        return sendMessage(message.chat.id, "验证码不对或登录失败，重新发 /loginpo18 再试。");
    }

    async function handlePo18Status(message) {
        await ensureRegistered(message.from);
        const account = await client.po18Account(message.from.id);
        const ok = account.cookies?.length && hasPo18Auth(account.cookies);
        return sendMessage(message.chat.id, [
            `PO18 账号：${escapeHtml(account.account || "未绑定")}`,
            `状态：${ok ? "已保存 Cookie" : "未登录/已失效"}`,
            account.updated_at ? `更新时间：${escapeHtml(String(account.updated_at).slice(0, 19).replace("T", " "))}` : ""
        ].filter(Boolean).join("\n"));
    }

    async function handlePo18Logout(message) {
        loginSessions.delete(String(message.from.id));
        await client.clearPo18Account(message.from.id);
        return sendMessage(message.chat.id, "PO18 登录状态已清除。");
    }

    async function handleMyBookshelf(message) {
        await ensureRegistered(message.from);
        const account = await client.po18Account(message.from.id);
        if (!account.cookies?.length || !hasPo18Auth(account.cookies)) return sendMessage(message.chat.id, "还没绑定 PO18 账号，先 /po18set 账号 密码，再 /loginpo18。");
        const progress = await sendMessage(message.chat.id, `正在拉取你的 PO18 书架（账号：${escapeHtml(account.account || "?")}），请稍候...`);
        const books = await fetchPo18Bookshelf(account.cookies);
        if (!books.length) return editMessage(message.chat.id, progress.message_id, "没拉到已购书籍。要么书架是空的，要么 Cookie 失效了。").catch(() => {});
        let added = 0;
        for (const book of books) {
            await client.addBookshelf(message.from.id, book.book_id).catch(() => {});
            added += 1;
        }
        const lines = [`<b>我的 PO18 书架</b>（共 ${books.length} 本，已加入收藏 ${added} 本）`, ""];
        for (const book of books.slice(0, 30)) {
            lines.push(`• ${escapeHtml(book.title || book.book_id)} / ${escapeHtml(book.author || "未知")}`);
            lines.push(`  /info_${book.book_id}`);
        }
        if (books.length > 30) lines.push("", `还有 ${books.length - 30} 本未展示。`);
        const shareMarkup = { reply_markup: { inline_keyboard: [[{ text: "上传共享已购书架", callback_data: callback(["sharebs"]) }]] } };
        await deliverLongGroupResult(message, lines.join("\n"), shareMarkup, {
            title: "PO18 书架",
            editTarget: { chatId: message.chat.id, messageId: progress.message_id }
        }).catch(() => sendMessage(message.chat.id, lines.join("\n"), shareMarkup));
    }

    return { handleLoginPo18, handleMyBookshelf, handlePo18Code, handlePo18Logout, handlePo18Set, handlePo18Status };
}

module.exports = { createPo18AccountHandlers };
