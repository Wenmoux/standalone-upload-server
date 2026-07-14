/**
 * [INPUT]: 依赖 PostgreSQL 事务、Reader 用户投影、日期键与学者等级/签到经验规则
 * [OUTPUT]: 对外提供按 Reader id 或 Telegram id 执行的原子签到与奖励流水服务
 * [POS]: services 的签到用例边界，在同一行锁事务内结算余额、经验、周期和全部流水
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
function checkInError(status, message) {
    return Object.assign(new Error(message), { status });
}

function createReaderCheckInService(options = {}) {
    const pool = options.pool;
    const botUserSelect = options.botUserSelect || (() => "*");
    const todayDateKey = options.todayDateKey;
    const signExpReward = options.signExpReward;
    const scholarProfile = options.scholarProfile;
    if (!pool || typeof pool.connect !== "function") throw new Error("reader check-in pool is required");

    async function recordReward(db, user, { type, currency, amount, balance, detail, source }) {
        if (!amount) return;
        await db.query(
            `INSERT INTO reader_transactions(user_id, telegram_id, type, currency, amount, balance, detail, source)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [user.id, user.telegram_id || "", type, currency, amount, balance, detail, source]
        );
    }

    async function checkInUser({ userId = "", telegramId = "", source = "reader" } = {}) {
        const byUserId = userId !== "" && userId !== null && userId !== undefined;
        if (!byUserId && !String(telegramId || "").trim()) throw checkInError(400, "missing user identity");
        const today = todayDateKey();
        const db = await pool.connect();
        try {
            await db.query("BEGIN");
            const locked = await db.query(
                `SELECT ${botUserSelect()}, (last_sign_date = $2::date) AS signed_today
                 FROM reader_users
                 WHERE ${byUserId ? "id" : "telegram_id"} = $1
                 FOR UPDATE`,
                [byUserId ? userId : String(telegramId).trim(), today]
            );
            const user = locked.rows[0];
            if (!user) throw checkInError(404, "user not found");
            if (user.is_banned) throw checkInError(403, source === "reader" ? "账号已被禁用" : "user banned");
            if (user.signed_today) throw checkInError(409, "今天已经签到过了");

            const nextDay = Number(user.sign_cycle_day || 0) >= 7 ? 1 : Number(user.sign_cycle_day || 0) + 1;
            const copper = 100;
            const silver = nextDay === 7 ? 100 : 0;
            const exp = Math.max(1, Math.trunc(Number(signExpReward(nextDay) || 1)));
            const beforeScholar = scholarProfile(user.scholar_exp);
            const updated = await db.query(
                `UPDATE reader_users
                 SET copper_coins = COALESCE(copper_coins,0) + $1,
                     silver_coins = COALESCE(silver_coins,0) + $2,
                     scholar_exp = COALESCE(scholar_exp,0) + $3,
                     sign_cycle_day = $4,
                     last_sign_date = $5::date
                 WHERE id = $6
                 RETURNING ${botUserSelect()}`,
                [copper, silver, exp, nextDay, today, user.id]
            );
            const current = updated.rows[0];
            const detail = `${source === "reader" ? "网页签到" : "每日签到"} day=${nextDay}`;
            await recordReward(db, current, {
                type: "sign",
                currency: "copper",
                amount: copper,
                balance: current.copper_coins,
                detail,
                source
            });
            await recordReward(db, current, {
                type: "sign_exp",
                currency: "exp",
                amount: exp,
                balance: current.scholar_exp,
                detail,
                source
            });
            await recordReward(db, current, {
                type: "sign",
                currency: "silver",
                amount: silver,
                balance: current.silver_coins,
                detail,
                source
            });
            await db.query("COMMIT");
            const afterScholar = scholarProfile(current.scholar_exp);
            return {
                user: current,
                reward: {
                    copper,
                    silver,
                    exp,
                    day: nextDay,
                    scholar: afterScholar,
                    level_up: afterScholar.level > beforeScholar.level
                }
            };
        } catch (error) {
            await db.query("ROLLBACK").catch(() => {});
            throw error;
        } finally {
            db.release();
        }
    }

    return { checkInUser };
}

module.exports = {
    createReaderCheckInService
};
