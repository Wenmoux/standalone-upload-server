/**
 * [INPUT]: 依赖 PostgreSQL query/事务、密码散列、CDK 时长及 Reader/Telegram 身份规范化能力
 * [OUTPUT]: 对外提供 CDK 注册、密码登录、Telegram 登录与 Bot 用户注册的原子账户服务
 * [POS]: services 的 Reader 账户生命周期边界，把唯一键竞争、CDK 消费、注册赠送与邀请计数收敛到事务
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const defaultCrypto = require("crypto");

function accountError(status, message, code = "") {
    return Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
}

function isUniqueViolation(error) {
    return error?.code === "23505";
}

function importedInteger(value, fallback, { min = 0, max = 2147483647, field = "value" } = {}) {
    if (value === undefined || value === null || value === "") return fallback;
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < min || number > max) throw accountError(400, `invalid ${field}`);
    return number;
}

function importedBoolean(value, fallback = false, field = "value") {
    if (value === undefined || value === null || value === "") return fallback;
    if (typeof value === "boolean") return value;
    const normalized = String(value).trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
    throw accountError(400, `invalid ${field}`);
}

function importedDate(value, field, dateOnly = false) {
    const text = String(value || "").trim();
    if (!text) return null;
    const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00.000Z` : text);
    if (!Number.isFinite(parsed.getTime())) throw accountError(400, `invalid ${field}`);
    return dateOnly ? parsed.toISOString().slice(0, 10) : parsed.toISOString();
}

function createReaderAccountService(options = {}) {
    const crypto = options.crypto || defaultCrypto;
    const query = options.query;
    const pool = options.pool;
    const hashPassword = options.hashPassword;
    const verifyPassword = options.verifyPassword;
    const cdkDuration = options.cdkDuration;
    const botUserSelect = options.botUserSelect || (() => "*");
    const normalizeTelegramId = options.normalizeTelegramId || ((value) => String(value || "").trim());
    const botUsernameForTelegram = options.botUsernameForTelegram || ((telegramId) => `tg_${telegramId}`);
    const telegramLoginNickname = options.telegramLoginNickname || ((payload) => payload?.username || `tg_${payload?.id || "user"}`);

    if (typeof query !== "function") throw new Error("reader account query function is required");
    if (!pool || typeof pool.connect !== "function") throw new Error("reader account pool is required");
    if (typeof hashPassword !== "function" || typeof verifyPassword !== "function") {
        throw new Error("reader account password helpers are required");
    }

    async function withTransaction(work) {
        const db = await pool.connect();
        try {
            await db.query("BEGIN");
            const result = await work(db);
            await db.query("COMMIT");
            return result;
        } catch (error) {
            await db.query("ROLLBACK").catch(() => {});
            throw error;
        } finally {
            db.release();
        }
    }

    async function registerReaderWithCdk({ username, password, nickname, cdkCode }) {
        try {
            return await withTransaction(async (db) => {
                const cdk = await db.query("SELECT * FROM reader_cdks WHERE upper(code) = $1 FOR UPDATE", [cdkCode]);
                const cdkRow = cdk.rows[0];
                if (!cdkRow) throw accountError(404, "CDK 不存在");
                if (cdkRow.used_by || cdkRow.used_at) throw accountError(409, "CDK 已被使用");
                if (String(cdkRow.cdk_type || "membership") === "export_quota") {
                    throw accountError(400, "下载次数 CDK 不能用于注册");
                }
                const duration = cdkDuration(cdkRow.duration_type);
                if (!duration) throw accountError(400, "CDK 时长配置无效");
                const found = await db.query("SELECT id FROM reader_users WHERE username = $1", [username]);
                if (found.rows.length) throw accountError(409, "用户名已存在");

                const { salt, hash } = hashPassword(password);
                const expires = duration.type === "permanent" ? null : new Date(Date.now() + duration.days * 86400000).toISOString();
                const created = await db.query(
                    `INSERT INTO reader_users(username, password_hash, salt, nickname, membership_expires_at, membership_permanent, library_access)
                     VALUES ($1,$2,$3,$4,$5,$6,TRUE)
                     RETURNING ${botUserSelect()}`,
                    [username, hash, salt, nickname, expires, duration.type === "permanent"]
                );
                const consumed = await db.query(
                    `UPDATE reader_cdks
                     SET used_by = $1, used_at = CURRENT_TIMESTAMP
                     WHERE id = $2 AND used_by IS NULL AND used_at IS NULL
                     RETURNING id`,
                    [created.rows[0].id, cdkRow.id]
                );
                if (!consumed.rows.length) throw accountError(409, "CDK 已被使用");
                return created.rows[0];
            });
        } catch (error) {
            if (isUniqueViolation(error)) throw accountError(409, "用户名已存在");
            throw error;
        }
    }

    async function loginReaderWithPassword({ username, password }) {
        const found = await query("SELECT * FROM reader_users WHERE username = $1", [username]);
        const user = found.rows[0];
        if (!user || !verifyPassword(password, user)) throw accountError(401, "用户名或密码错误");
        if (user.is_banned) throw accountError(403, "账号已被禁用");
        const updated = await query(
            `UPDATE reader_users
             SET last_login_at = CURRENT_TIMESTAMP
             WHERE id = $1 AND COALESCE(is_banned, FALSE) = FALSE
             RETURNING ${botUserSelect()}`,
            [user.id]
        );
        if (!updated.rows.length) throw accountError(403, "账号已被禁用");
        return updated.rows[0];
    }

    function usernameCandidate(base, telegramId, attempt) {
        const normalized =
            String(base || botUsernameForTelegram(telegramId))
                .trim()
                .replace(/[^0-9A-Za-z_\u4e00-\u9fa5-]/g, "_") || `tg_${telegramId}`;
        if (attempt === 0) return normalized.slice(0, 32);
        const suffix = `_${crypto.createHash("sha256").update(`${telegramId}:${attempt}`).digest("hex").slice(0, 8)}`;
        return `${normalized.slice(0, 32 - suffix.length)}${suffix}`;
    }

    async function recordRegistrationReward(db, user, currency, amount) {
        if (amount <= 0) return;
        const balance = currency === "silver" ? user.silver_coins : user.copper_coins;
        await db.query(
            `INSERT INTO reader_transactions(user_id, telegram_id, type, currency, amount, balance, detail, source)
             VALUES ($1,$2,'register',$3,$4,$5,'注册赠送','telegram_bot')`,
            [user.id, user.telegram_id, currency, amount, balance]
        );
    }

    async function upsertTelegramAccount(input = {}) {
        const telegramId = normalizeTelegramId(input.telegramId);
        if (!telegramId) throw accountError(400, "missing telegram_id");
        const telegramUsername = String(input.telegramUsername || "")
            .trim()
            .replace(/^@/, "")
            .slice(0, 64);
        const nickname = String(input.nickname || telegramUsername || botUsernameForTelegram(telegramId))
            .trim()
            .slice(0, 32);
        const avatarUrl = String(input.avatarUrl || "")
            .trim()
            .slice(0, 1000);
        const inviterTelegramId = normalizeTelegramId(input.inviterTelegramId);
        const initialCopper = Math.max(0, Math.min(1000000, Math.trunc(Number(input.initialCopper || 0))));
        const initialSilver = Math.max(0, Math.min(1000000, Math.trunc(Number(input.initialSilver || 0))));
        const markLogin = !!input.markLogin;
        const rejectBanned = !!input.rejectBanned;
        const { salt, hash } = hashPassword(crypto.randomBytes(18).toString("base64url"));

        return withTransaction(async (db) => {
            let account = null;
            for (let attempt = 0; attempt < 5; attempt += 1) {
                await db.query("SAVEPOINT reader_account_username");
                try {
                    account = await db.query(
                        `INSERT INTO reader_users(username, password_hash, salt, nickname, avatar_url, library_access, membership_permanent,
                                                  copper_coins, silver_coins, telegram_id, telegram_username, last_login_at, inviter_telegram_id)
                         VALUES ($1,$2,$3,$4,$5,TRUE,TRUE,$6,$7,$8,$9,CASE WHEN $10::boolean THEN CURRENT_TIMESTAMP ELSE NULL END,$11)
                         ON CONFLICT (telegram_id) DO UPDATE SET
                            telegram_username = EXCLUDED.telegram_username,
                            nickname = CASE WHEN BTRIM(COALESCE(reader_users.nickname, '')) = '' THEN EXCLUDED.nickname ELSE reader_users.nickname END,
                            avatar_url = COALESCE(NULLIF(EXCLUDED.avatar_url, ''), reader_users.avatar_url),
                            last_login_at = CASE WHEN $10::boolean THEN CURRENT_TIMESTAMP ELSE reader_users.last_login_at END
                         WHERE $12::boolean = FALSE OR COALESCE(reader_users.is_banned, FALSE) = FALSE
                         RETURNING ${botUserSelect()}, (xmax = 0) AS account_inserted`,
                        [
                            usernameCandidate(input.username, telegramId, attempt),
                            hash,
                            salt,
                            nickname,
                            avatarUrl,
                            initialCopper,
                            initialSilver,
                            telegramId,
                            telegramUsername,
                            markLogin,
                            inviterTelegramId && inviterTelegramId !== telegramId ? inviterTelegramId : "",
                            rejectBanned
                        ]
                    );
                    await db.query("RELEASE SAVEPOINT reader_account_username");
                    break;
                } catch (error) {
                    await db.query("ROLLBACK TO SAVEPOINT reader_account_username");
                    if (!isUniqueViolation(error) || attempt === 4) throw error;
                }
            }

            const user = account?.rows?.[0];
            if (!user && rejectBanned) throw accountError(403, "账号已被禁用");
            if (!user) throw accountError(409, "Telegram 账户创建冲突");
            const inserted = user.account_inserted === true;
            delete user.account_inserted;
            if (inserted) {
                await recordRegistrationReward(db, user, "copper", initialCopper);
                await recordRegistrationReward(db, user, "silver", initialSilver);
                if (inviterTelegramId && inviterTelegramId !== telegramId) {
                    await db.query("UPDATE reader_users SET invite_count = COALESCE(invite_count, 0) + 1 WHERE telegram_id = $1", [
                        inviterTelegramId
                    ]);
                }
            }
            return { user, existed: !inserted };
        });
    }

    async function loginReaderWithTelegram(payload = {}) {
        const telegramId = normalizeTelegramId(payload.id);
        return upsertTelegramAccount({
            telegramId,
            username: botUsernameForTelegram(telegramId),
            telegramUsername: payload.username,
            nickname: telegramLoginNickname(payload),
            avatarUrl: payload.photo_url,
            markLogin: true,
            rejectBanned: true
        });
    }

    async function registerBotUser(profile = {}) {
        return upsertTelegramAccount({
            telegramId: profile.telegramId,
            username: botUsernameForTelegram(profile.telegramId),
            telegramUsername: profile.telegramUsername,
            nickname: profile.nickname,
            inviterTelegramId: profile.inviterTelegramId,
            initialCopper: 100,
            initialSilver: 0
        });
    }

    async function importBotUsers(rows = []) {
        if (!Array.isArray(rows)) throw accountError(400, "users must be an array");
        if (rows.length > 2000) throw accountError(413, "too many users; maximum is 2000");
        const importedPassword = hashPassword(crypto.randomBytes(32).toString("base64url"));
        return withTransaction(async (db) => {
            const result = { imported: 0, updated: 0, skipped: 0 };
            for (let index = 0; index < rows.length; index += 1) {
                const row = rows[index] || {};
                const telegramId = normalizeTelegramId(row.telegram_id || row.telegramId || row.user_id || row.userId);
                if (!telegramId) {
                    result.skipped += 1;
                    continue;
                }
                const baseUsername = String(row.username || botUsernameForTelegram(telegramId))
                    .trim()
                    .replace(/^@/, "");
                const telegramUsername = String(row.telegram_username || row.telegramUsername || row.username || "")
                    .trim()
                    .replace(/^@/, "")
                    .slice(0, 64);
                const nickname = String(row.nickname || row.display_name || row.displayName || baseUsername)
                    .trim()
                    .slice(0, 32);
                const copper = importedInteger(row.copper_coins ?? row.copper, 0, { field: `users[${index}].copper_coins` });
                const silver = importedInteger(row.silver_coins ?? row.silver, 0, { field: `users[${index}].silver_coins` });
                const signCycleDay = importedInteger(row.sign_cycle_day ?? row.signStreak ?? row.sign_streak, 0, {
                    min: 0,
                    max: 7,
                    field: `users[${index}].sign_cycle_day`
                });
                const inviteCount = importedInteger(row.invite_count, 0, { field: `users[${index}].invite_count` });
                const isAdmin = importedBoolean(row.is_admin, false, `users[${index}].is_admin`);
                const isBanned = importedBoolean(row.is_banned, false, `users[${index}].is_banned`);
                const lastSignDate = importedDate(row.last_sign_date || row.sign_date, `users[${index}].last_sign_date`, true);
                const createdAt = importedDate(row.created_at, `users[${index}].created_at`);
                const exportUnlockedAt = importedDate(row.export_unlocked_at || row.unlocked_at, `users[${index}].export_unlocked_at`);
                const inviterTelegramId = normalizeTelegramId(row.inviter_telegram_id || row.inviter_id || "");
                let inserted = null;
                for (let attempt = 0; attempt < 5; attempt += 1) {
                    await db.query("SAVEPOINT reader_import_username");
                    try {
                        inserted = await db.query(
                            `INSERT INTO reader_users(username, password_hash, salt, nickname, created_at, library_access, membership_permanent,
                                                      copper_coins, silver_coins, sign_cycle_day, last_sign_date,
                                                      telegram_id, telegram_username, is_admin, is_banned, invite_count, inviter_telegram_id, export_unlocked_at)
                             VALUES ($1,$2,$3,$4,COALESCE($5::timestamp, CURRENT_TIMESTAMP),$6,TRUE,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
                             ON CONFLICT (telegram_id) DO UPDATE SET
                                nickname = EXCLUDED.nickname,
                                telegram_username = EXCLUDED.telegram_username,
                                copper_coins = EXCLUDED.copper_coins,
                                silver_coins = EXCLUDED.silver_coins,
                                sign_cycle_day = EXCLUDED.sign_cycle_day,
                                last_sign_date = EXCLUDED.last_sign_date,
                                library_access = EXCLUDED.library_access,
                                is_admin = EXCLUDED.is_admin,
                                is_banned = EXCLUDED.is_banned,
                                invite_count = EXCLUDED.invite_count,
                                inviter_telegram_id = EXCLUDED.inviter_telegram_id,
                                export_unlocked_at = COALESCE(EXCLUDED.export_unlocked_at, reader_users.export_unlocked_at)
                             RETURNING xmax = 0 AS inserted`,
                            [
                                usernameCandidate(baseUsername, telegramId, attempt),
                                importedPassword.hash,
                                importedPassword.salt,
                                nickname || botUsernameForTelegram(telegramId),
                                createdAt,
                                !isBanned,
                                copper,
                                silver,
                                signCycleDay,
                                lastSignDate,
                                telegramId,
                                telegramUsername,
                                isAdmin,
                                isBanned,
                                inviteCount,
                                inviterTelegramId,
                                exportUnlockedAt
                            ]
                        );
                        await db.query("RELEASE SAVEPOINT reader_import_username");
                        break;
                    } catch (error) {
                        await db.query("ROLLBACK TO SAVEPOINT reader_import_username");
                        if (!isUniqueViolation(error) || attempt === 4) throw error;
                    }
                }
                if (inserted?.rows?.[0]?.inserted) result.imported += 1;
                else result.updated += 1;
            }
            return result;
        });
    }

    return {
        loginReaderWithPassword,
        loginReaderWithTelegram,
        importBotUsers,
        registerBotUser,
        registerReaderWithCdk
    };
}

module.exports = {
    accountError,
    createReaderAccountService
};
