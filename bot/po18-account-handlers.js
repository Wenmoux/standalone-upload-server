/**
 * [INPUT]: 依赖 PgBotClient、PO18 受保护会话/已购书架能力、Telegram 消息与图片接口及用户注册守卫
 * [OUTPUT]: 对外提供仅私聊可用的 PO18 凭据保存、验证码登录、在线状态、保留绑定的登出和完整已购书架同步处理器
 * [POS]: bot 的 PO18 账户交互层，区分过期登录、真空书架与上游失败，持久凭据仍只由服务端加密 API 管理
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
        fetchPo18Bookshelf,
        validatePo18Session,
        isGroup = (chat) => ["group", "supergroup", "channel"].includes(String(chat?.type || ""))
    } = options;
    const loginSessions = new Map();
    const loginSessionTtlMs = Math.max(60000, Number(options.loginSessionTtlMs || 10 * 60 * 1000));
    const loginSessionMax = Math.max(10, Number(options.loginSessionMax || 1000));

    function authExpired(error) {
        return error?.code === "PO18_AUTH_EXPIRED";
    }

    async function requirePrivate(message) {
        if (!isGroup(message.chat)) return true;
        await sendMessage(message.chat.id, "PO18 账号、验证码和已购书架只能在 Bot 私聊中操作，请打开私聊后重试。");
        return false;
    }

    function rememberLoginSession(userId, session) {
        const key = String(userId);
        loginSessions.delete(key);
        loginSessions.set(key, session);
        while (loginSessions.size > loginSessionMax) loginSessions.delete(loginSessions.keys().next().value);
    }

    async function handlePo18Set(message, args) {
        if (!(await requirePrivate(message))) return;
        await ensureRegistered(message.from);
        const parts = String(args || "").split(/\s+/).filter(Boolean);
        if (parts.length < 2) return sendMessage(message.chat.id, "用法：/po18set 账号 密码");
        await client.savePo18Account(message.from.id, {
            account: parts[0],
            password: parts.slice(1).join(" "),
            last_status: "account_saved"
        });
        return sendMessage(message.chat.id, "PO18 账号密码已保存，旧账号或旧密码的登录态会自动清除。接着发 /loginpo18 获取验证码。");
    }

    async function handleLoginPo18(message) {
        if (!(await requirePrivate(message))) return;
        await ensureRegistered(message.from);
        const account = await client.po18Account(message.from.id);
        if (!account.account || !account.password) return sendMessage(message.chat.id, "先用 /po18set 账号 密码 保存登录信息。");
        const loginUrl = "https://members.po18.tw/apps/login.php?u=https://www.po18.tw/site/alarm";
        const { response, cookies } = await po18Fetch(loginUrl, { redirect: "follow" });
        if (!response.ok) return sendMessage(message.chat.id, `获取登录页失败：HTTP ${response.status}`);
        const html = await response.text();
        const fields = parseLoginFields(html);
        const captcha = await po18Fetch(
            `https://members.po18.tw/apps/images.php?${Date.now()}`,
            { redirect: "follow", headers: { Referer: loginUrl } },
            cookies
        );
        if (!captcha.response.ok) {
            return sendMessage(message.chat.id, `PO18 验证码获取失败：HTTP ${captcha.response.status}。稍后重试 /loginpo18。`);
        }
        const contentType = String(captcha.response.headers.get("content-type") || "").toLowerCase();
        const image = Buffer.from(await captcha.response.arrayBuffer());
        if (!image.length) return sendMessage(message.chat.id, "PO18 验证码图片为空，请稍后重试 /loginpo18。");
        if (/text\/html|application\/json|text\/plain/.test(contentType)) {
            return sendMessage(message.chat.id, "PO18 没有返回验证码图片，可能遇到临时风控，请稍后重试。");
        }
        rememberLoginSession(message.from.id, {
            fields,
            cookies: captcha.cookies,
            account: account.account,
            password: account.password,
            createdAt: Date.now()
        });
        return sendPhoto(message.chat.id, image, "po18-captcha.jpg", "PO18 验证码来了，发 /po18code xxxx 提交（10 分钟内有效）。");
    }

    async function handlePo18Code(message, args) {
        if (!(await requirePrivate(message))) return;
        await ensureRegistered(message.from);
        const code = String(args || "").trim().split(/\s+/)[0];
        if (!code) return sendMessage(message.chat.id, "用法：/po18code 验证码");
        const key = String(message.from.id);
        const session = loginSessions.get(key);
        if (!session) return sendMessage(message.chat.id, "先发 /loginpo18 获取验证码。");
        if (Date.now() - Number(session.createdAt || 0) > loginSessionTtlMs) {
            loginSessions.delete(key);
            return sendMessage(message.chat.id, "验证码会话已过期，请重新发送 /loginpo18。");
        }
        const fields = { ...session.fields, account: session.account, pwd: session.password, captcha: code };
        if (!fields.remember_me) fields.remember_me = "1";
        const result = await po18Fetch(
            "https://members.po18.tw/apps/login.php",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    Origin: "https://members.po18.tw",
                    Referer: "https://members.po18.tw/apps/login.php?u=https://www.po18.tw/site/alarm"
                },
                body: new URLSearchParams(fields)
            },
            session.cookies
        );
        if (!hasPo18Auth(result.cookies)) return sendMessage(message.chat.id, "验证码不对或登录失败，重新发 /loginpo18 再试。");
        try {
            const validation = await validatePo18Session(result.cookies);
            await client.savePo18Account(message.from.id, {
                account: session.account,
                password: session.password,
                cookies: validation.cookies,
                last_status: "login_ok"
            });
        } catch (error) {
            if (authExpired(error)) return sendMessage(message.chat.id, "PO18 没有建立有效登录，请重新获取验证码。");
            throw error;
        }
        loginSessions.delete(key);
        return sendMessage(message.chat.id, "PO18 登录成功，已通过受保护页面验证。");
    }

    async function handlePo18Status(message) {
        if (!(await requirePrivate(message))) return;
        await ensureRegistered(message.from);
        const account = await client.po18Account(message.from.id);
        let status = "未登录";
        if (account.cookies?.length && hasPo18Auth(account.cookies)) {
            try {
                const validation = await validatePo18Session(account.cookies);
                status = "已登录（在线验证通过）";
                if (JSON.stringify(validation.cookies) !== JSON.stringify(account.cookies)) {
                    await client.savePo18Account(message.from.id, { cookies: validation.cookies, last_status: "session_valid" });
                }
            } catch (error) {
                if (authExpired(error)) {
                    status = "登录已失效";
                    await client.savePo18Account(message.from.id, { cookies: [], last_status: "session_expired" });
                } else {
                    status = "Cookie 已保存，但 PO18 暂时无法完成在线验证";
                }
            }
        }
        return sendMessage(
            message.chat.id,
            [
                `PO18 账号：${escapeHtml(account.account || "未绑定")}`,
                `状态：${status}`,
                account.updated_at ? `更新时间：${escapeHtml(String(account.updated_at).slice(0, 19).replace("T", " "))}` : ""
            ]
                .filter(Boolean)
                .join("\n")
        );
    }

    async function handlePo18Logout(message) {
        if (!(await requirePrivate(message))) return;
        await ensureRegistered(message.from);
        loginSessions.delete(String(message.from.id));
        const account = await client.po18Account(message.from.id);
        if (!account.account && !account.cookies?.length) return sendMessage(message.chat.id, "尚未绑定 PO18 账号。");
        await client.savePo18Account(message.from.id, { cookies: [], last_status: "logged_out" });
        return sendMessage(message.chat.id, "PO18 登录状态已清除，绑定的账号密码已保留，下次可直接 /loginpo18。");
    }

    async function handleMyBookshelf(message) {
        if (!(await requirePrivate(message))) return;
        await ensureRegistered(message.from);
        const account = await client.po18Account(message.from.id);
        if (!account.cookies?.length || !hasPo18Auth(account.cookies)) {
            return sendMessage(message.chat.id, "还没有有效的 PO18 登录，先 /po18set 账号 密码，再 /loginpo18。");
        }
        const progress = await sendMessage(message.chat.id, `正在按年份完整拉取 PO18 已购书架（账号：${escapeHtml(account.account || "?")}）...`);
        let books;
        try {
            books = await fetchPo18Bookshelf(account.cookies);
        } catch (error) {
            if (authExpired(error)) {
                await client.savePo18Account(message.from.id, { cookies: [], last_status: "session_expired" });
                return editMessage(message.chat.id, progress.message_id, "PO18 登录已失效，请重新发送 /loginpo18。").catch(() => {});
            }
            await editMessage(message.chat.id, progress.message_id, "PO18 暂时访问失败，后台任务会按规则重试。").catch(() => {});
            throw error;
        }
        if (!books.length) {
            return editMessage(message.chat.id, progress.message_id, "已成功验证 PO18 登录，但账号的已购书架为空。").catch(() => {});
        }
        let added = 0;
        let failed = 0;
        for (const book of books) {
            try {
                await client.addBookshelf(message.from.id, book.book_id);
                added += 1;
            } catch {
                failed += 1;
            }
        }
        const lines = [
            `<b>我的 PO18 已购书架</b>（共 ${books.length} 本，同步收藏 ${added} 本${failed ? `，失败 ${failed} 本` : ""}）`,
            ""
        ];
        for (const book of books.slice(0, 30)) {
            lines.push(`• ${escapeHtml(book.title || book.book_id)} / ${escapeHtml(book.author || "未知")}`);
            lines.push(`  /info_${book.book_id}`);
        }
        if (books.length > 30) lines.push("", `还有 ${books.length - 30} 本未展示。`);
        const shareMarkup = { reply_markup: { inline_keyboard: [[{ text: "上传共享已购书架", callback_data: callback(["sharebs"]) }]] } };
        await deliverLongGroupResult(message, lines.join("\n"), shareMarkup, {
            title: "PO18 已购书架",
            editTarget: { chatId: message.chat.id, messageId: progress.message_id }
        }).catch(() => sendMessage(message.chat.id, lines.join("\n"), shareMarkup));
    }

    return { handleLoginPo18, handleMyBookshelf, handlePo18Code, handlePo18Logout, handlePo18Set, handlePo18Status };
}

module.exports = { createPo18AccountHandlers };
