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
    if (body.started !== undefined) patch.started = !!body.started;
    if (body.finished !== undefined) patch.finished = !!body.finished;
    return patch;
}

function createBotApiSystemRoutes(deps = {}) {
    const router = express.Router();
    const requireBotApi = deps.requireBotApi || ((req, res, next) => next());
    const createSystemJob = deps.createSystemJob;
    const getSystemJob = deps.getSystemJob;
    const updateSystemJob = deps.updateSystemJob;
    const recordBotAuditLog = deps.recordBotAuditLog;
    const botCommandSettings = deps.botCommandSettings || (async () => ({ commands: [] }));

    router.get("/bot-api/health", requireBotApi, (req, res) => res.json({ ok: true }));

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
            const job = await createSystemJob({ type, input, createdBy });
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

    return router;
}

module.exports = {
    JOB_STATUSES,
    botJobPatch,
    createBotApiSystemRoutes
};
