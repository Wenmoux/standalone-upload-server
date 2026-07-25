/**
 * [INPUT]: 依赖 Express、Bot Token Scope、QQ/Telegram 配置、system-jobs/bot-audit、管理员身份与注册用户广播收件人服务
 * [OUTPUT]: 对外提供 Bot 健康、QQ 运行配置、带 worker/attempt 所有权校验的持久任务更新、管理员广播、审计和命令配置内部路由
 * [POS]: routes 的 Bot 系统协作边界，让各 Bot Worker 通过受鉴权 HTTP 协议读取配置和管理任务而不直连数据库
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const express = require("express");
const { bodyString, compactJson, enumValue, paramPositiveInt } = require("../services/validation");

const JOB_STATUSES = ["queued", "running", "succeeded", "failed", "canceled"];

function botJobPatch(body = {}) {
    const patch = {};
    const status = enumValue(body.status, JOB_STATUSES, { name: "job status" });
    if (status) patch.status = status;
    if (body.progress !== undefined) {
        const progress = Number(body.progress);
        if (!Number.isFinite(progress)) {
            const err = new Error("invalid job progress");
            err.status = 400;
            throw err;
        }
        patch.progress = Math.max(0, Math.min(100, Math.trunc(progress)));
    }
    if (body.result && typeof body.result === "object") patch.result = compactJson(body.result);
    if (body.error !== undefined) patch.error = String(body.error || "").slice(0, 2000);
    if (body.next_run_at !== undefined || body.nextRunAt !== undefined) patch.nextRunAt = body.next_run_at ?? body.nextRunAt ?? null;
    if (body.started !== undefined) patch.started = !!body.started;
    if (body.finished !== undefined) patch.finished = !!body.finished;
    const workerId = body.worker_id ?? body.workerId;
    const attempt = Number(body.attempt);
    const requiresOwnership = Object.keys(patch).length > 0;
    if (workerId !== undefined || body.attempt !== undefined) {
        if (!String(workerId || "").trim() || !Number.isFinite(attempt) || attempt < 1) {
            const err = new Error("job update ownership requires worker_id and positive attempt");
            err.status = 400;
            throw err;
        }
        patch.workerId = String(workerId).trim().slice(0, 120);
        patch.attempt = Math.trunc(attempt);
    } else if (requiresOwnership) {
        const err = new Error("job update ownership is required");
        err.status = 409;
        throw err;
    }
    return patch;
}

function createBotApiSystemRoutes(deps = {}) {
    const router = express.Router();
    const requireBotApi = deps.requireBotApi || ((req, res, next) => next());
    const createSystemJob = deps.createSystemJob;
    const claimSystemJob = deps.claimSystemJob;
    const claimSystemJobs = deps.claimSystemJobs;
    const getSystemJob = deps.getSystemJob;
    const heartbeatSystemJob = deps.heartbeatSystemJob;
    const updateSystemJob = deps.updateSystemJob;
    const listSystemJobs = deps.listSystemJobs;
    const cancelSystemJob = deps.cancelSystemJob;
    const recordBotAuditLog = deps.recordBotAuditLog;
    const botCommandSettings = deps.botCommandSettings || (async () => ({ commands: [] }));
    const findBotUserByTelegramId = deps.findBotUserByTelegramId;
    const registeredUserRecipients = deps.registeredUserRecipients;
    const qqBotRuntimeConfig = deps.qqBotRuntimeConfig || (async () => ({ enabled: false }));
    const qqBookAccessById = deps.qqBookAccessById || (async () => ({ allowed: false, reason: "not_configured" }));

    router.get("/bot-api/health", requireBotApi, (req, res) => res.json({ ok: true }));

    router.get("/bot-api/config/qq-bot", requireBotApi, async (req, res, next) => {
        try {
            res.json(await qqBotRuntimeConfig());
        } catch (err) {
            next(err);
        }
    });

    router.get("/bot-api/qq/books/:bookId/access", requireBotApi, async (req, res, next) => {
        try {
            const result = await qqBookAccessById(req.params.bookId);
            if (result.reason === "book_not_found") return res.status(404).json(result);
            res.status(result.allowed ? 200 : 403).json(result);
        } catch (err) {
            next(err);
        }
    });

    router.post("/bot-api/broadcasts", requireBotApi, async (req, res, next) => {
        try {
            if (typeof createSystemJob !== "function" || typeof findBotUserByTelegramId !== "function") {
                return res.status(503).json({ error: "broadcast service unavailable" });
            }
            const telegramId = String(req.body?.telegram_id || req.body?.telegramId || "").trim();
            const chatId = String(req.body?.chat_id || req.body?.chatId || "").trim();
            const message = String(req.body?.message || "").trim();
            if (!telegramId) return res.status(400).json({ error: "telegram_id is required" });
            if (!message) return res.status(400).json({ error: "通知内容不能为空" });
            if (Array.from(message).length > 3000) return res.status(400).json({ error: "通知内容最多 3000 字" });
            const user = await findBotUserByTelegramId(telegramId);
            if (!user?.is_admin || user?.is_banned) return res.status(403).json({ error: "只有管理员可以发布全员通知" });
            const job = await createSystemJob({
                type: "bot_registered_user_broadcast",
                input: { message, telegram_id: telegramId, chat_id: chatId, source: "bot" },
                createdBy: `telegram:${telegramId}`,
                maxAttempts: 1
            });
            res.json({ success: true, job });
        } catch (err) {
            next(err);
        }
    });

    router.get("/bot-api/broadcasts/recipients", requireBotApi, async (req, res, next) => {
        try {
            if (typeof registeredUserRecipients !== "function") return res.status(503).json({ error: "broadcast recipients unavailable" });
            res.json(await registeredUserRecipients({ afterId: req.query.after_id || req.query.afterId, limit: req.query.limit }));
        } catch (err) {
            next(err);
        }
    });

    router.get("/bot-api/jobs", requireBotApi, async (req, res, next) => {
        try {
            if (typeof listSystemJobs !== "function") return res.status(503).json({ error: "system jobs unavailable" });
            const telegramId = String(req.query.telegram_id || req.query.telegramId || "").trim();
            if (!telegramId) return res.status(400).json({ error: "telegram_id is required" });
            res.json(
                await listSystemJobs({
                    page: req.query.page,
                    limit: Math.min(20, Number(req.query.limit || 8)),
                    status: req.query.status || "",
                    createdBy: `telegram:${telegramId}`
                })
            );
        } catch (err) {
            next(err);
        }
    });

    router.get("/bot-api/commands", requireBotApi, async (req, res, next) => {
        try {
            res.json(await botCommandSettings());
        } catch (err) {
            next(err);
        }
    });

    router.post("/bot-api/audit", requireBotApi, async (req, res, next) => {
        try {
            if (typeof recordBotAuditLog !== "function") return res.status(503).json({ error: "bot audit unavailable" });
            const row = await recordBotAuditLog(req.body || {});
            res.json({ success: true, row });
        } catch (err) {
            next(err);
        }
    });

    router.post("/bot-api/jobs", requireBotApi, async (req, res, next) => {
        try {
            if (typeof createSystemJob !== "function") return res.status(503).json({ error: "system jobs unavailable" });
            const type = bodyString(req.body || {}, "type", { defaultValue: "bot_task", maxLength: 120 }) || "bot_task";
            const input = compactJson(req.body?.input || {});
            const createdBy =
                bodyString(req.body || {}, ["created_by", "createdBy"], { defaultValue: "telegram_bot", maxLength: 120 }) || "telegram_bot";
            const createInput = { type, input, createdBy };
            if (req.body?.priority !== undefined) createInput.priority = req.body.priority;
            if (req.body?.max_attempts !== undefined || req.body?.maxAttempts !== undefined)
                createInput.maxAttempts = req.body.max_attempts ?? req.body.maxAttempts;
            if (req.body?.idempotency_key !== undefined || req.body?.idempotencyKey !== undefined)
                createInput.idempotencyKey = req.body.idempotency_key ?? req.body.idempotencyKey;
            if (req.body?.next_run_at !== undefined || req.body?.nextRunAt !== undefined)
                createInput.nextRunAt = req.body.next_run_at ?? req.body.nextRunAt ?? null;
            const job = await createSystemJob(createInput);
            res.json({ success: true, job });
        } catch (err) {
            next(err);
        }
    });

    router.post("/bot-api/jobs/claim", requireBotApi, async (req, res, next) => {
        try {
            if (typeof claimSystemJobs !== "function") return res.status(503).json({ error: "persistent job claims unavailable" });
            const jobs = await claimSystemJobs({
                workerId: req.body?.worker_id || req.body?.workerId,
                types: Array.isArray(req.body?.types) ? req.body.types : [],
                limit: req.body?.limit,
                leaseSeconds: req.body?.lease_seconds ?? req.body?.leaseSeconds
            });
            res.json({ success: true, jobs });
        } catch (err) {
            next(err);
        }
    });

    router.post("/bot-api/jobs/:id/claim", requireBotApi, async (req, res, next) => {
        try {
            if (typeof claimSystemJob !== "function") return res.status(503).json({ error: "persistent job claims unavailable" });
            const id = paramPositiveInt(req.params.id, "job id");
            const job = await claimSystemJob(id, {
                workerId: req.body?.worker_id || req.body?.workerId,
                leaseSeconds: req.body?.lease_seconds ?? req.body?.leaseSeconds
            });
            if (!job) return res.status(409).json({ error: "job is not claimable" });
            res.json({ success: true, job });
        } catch (err) {
            next(err);
        }
    });

    router.post("/bot-api/jobs/:id/heartbeat", requireBotApi, async (req, res, next) => {
        try {
            if (typeof heartbeatSystemJob !== "function") return res.status(503).json({ error: "job heartbeat unavailable" });
            const id = paramPositiveInt(req.params.id, "job id");
            const job = await heartbeatSystemJob(id, {
                workerId: req.body?.worker_id || req.body?.workerId,
                attempt: req.body?.attempt,
                progress: req.body?.progress,
                leaseSeconds: req.body?.lease_seconds ?? req.body?.leaseSeconds
            });
            if (!job) return res.status(409).json({ error: "job lease not owned" });
            res.json({ success: true, job });
        } catch (err) {
            next(err);
        }
    });

    router.patch("/bot-api/jobs/:id", requireBotApi, async (req, res, next) => {
        try {
            if (typeof updateSystemJob !== "function") return res.status(503).json({ error: "system jobs unavailable" });
            const id = paramPositiveInt(req.params.id, "job id");
            const patch = botJobPatch(req.body || {});
            const job = await updateSystemJob(id, patch);
            if (!job && patch.workerId) return res.status(409).json({ error: "job lease ownership lost" });
            if (!job) return res.status(404).json({ error: "job not found" });
            res.json({ success: true, job });
        } catch (err) {
            next(err);
        }
    });

    router.get("/bot-api/jobs/:id", requireBotApi, async (req, res, next) => {
        try {
            if (typeof getSystemJob !== "function") return res.status(503).json({ error: "system jobs unavailable" });
            const id = paramPositiveInt(req.params.id, "job id");
            const job = await getSystemJob(id);
            if (!job) return res.status(404).json({ error: "job not found" });
            res.json({ success: true, job });
        } catch (err) {
            next(err);
        }
    });

    router.post("/bot-api/jobs/:id/cancel", requireBotApi, async (req, res, next) => {
        try {
            if (typeof getSystemJob !== "function" || typeof cancelSystemJob !== "function") {
                return res.status(503).json({ error: "job cancellation unavailable" });
            }
            const id = paramPositiveInt(req.params.id, "job id");
            const telegramId = String(req.body?.telegram_id || req.body?.telegramId || "").trim();
            if (!telegramId) return res.status(400).json({ error: "telegram_id is required" });
            const current = await getSystemJob(id);
            if (!current) return res.status(404).json({ error: "job not found" });
            const owner =
                String(current.created_by || "") === `telegram:${telegramId}` ||
                String(current.input_json?.telegram_id || "") === telegramId;
            if (!owner) return res.status(403).json({ error: "job does not belong to this telegram user" });
            const job = await cancelSystemJob(id, { actor: `telegram:${telegramId}` });
            res.json({ success: true, job });
        } catch (err) {
            next(err);
        }
    });

    return router;
}

module.exports = {
    JOB_STATUSES,
    botJobPatch,
    createBotApiSystemRoutes
};
