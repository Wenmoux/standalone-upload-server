/**
 * [INPUT]: 依赖 Express、Bot Token Scope、system-jobs/bot-audit/config 服务与搜索需求写入能力
 * [OUTPUT]: 对外提供 Bot 健康、持久任务登记/更新、审计、搜索需求和命令配置内部路由
 * [POS]: routes 的 Bot 系统协作边界，让 Worker 通过 HTTP 管理任务生命周期而不直连数据库
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

    router.get("/bot-api/health", requireBotApi, (req, res) => res.json({ ok: true }));

    router.get("/bot-api/jobs", requireBotApi, async (req, res, next) => {
        try {
            if (typeof listSystemJobs !== "function") return res.status(503).json({ error: "system jobs unavailable" });
            const telegramId = String(req.query.telegram_id || req.query.telegramId || "").trim();
            if (!telegramId) return res.status(400).json({ error: "telegram_id is required" });
            res.json(await listSystemJobs({
                page: req.query.page,
                limit: Math.min(20, Number(req.query.limit || 8)),
                status: req.query.status || "",
                createdBy: `telegram:${telegramId}`
            }));
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
            const createdBy = bodyString(req.body || {}, ["created_by", "createdBy"], { defaultValue: "telegram_bot", maxLength: 120 }) || "telegram_bot";
            const createInput = { type, input, createdBy };
            if (req.body?.priority !== undefined) createInput.priority = req.body.priority;
            if (req.body?.max_attempts !== undefined || req.body?.maxAttempts !== undefined) createInput.maxAttempts = req.body.max_attempts ?? req.body.maxAttempts;
            if (req.body?.idempotency_key !== undefined || req.body?.idempotencyKey !== undefined) createInput.idempotencyKey = req.body.idempotency_key ?? req.body.idempotencyKey;
            if (req.body?.next_run_at !== undefined || req.body?.nextRunAt !== undefined) createInput.nextRunAt = req.body.next_run_at ?? req.body.nextRunAt ?? null;
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
            const job = await updateSystemJob(id, botJobPatch(req.body || {}));
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
            const owner = String(current.created_by || "") === `telegram:${telegramId}`
                || String(current.input_json?.telegram_id || "") === telegramId;
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
