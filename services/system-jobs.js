const { query } = require("../pg-store");

function adminActor(req) {
    return req?.session?.adminUser?.username || "admin";
}

function compactJobResult(payload = {}) {
    if (payload.jobResult && typeof payload.jobResult === "object") {
        return payload.jobResult;
    }
    const backup = payload.backup || payload.restore || {};
    return {
        success: payload.success !== false,
        file: payload.file || backup.file || "",
        type: backup.type || payload.type || "",
        bytes: Number(backup.bytes || payload.bytes || 0),
        restarting: !!payload.restarting,
        pre_restore_backup: backup.pre_restore_backup?.file || "",
        deleted_metadata: payload.deletedMetadata,
        deleted_chapters: payload.deletedChapters,
        updated_chapters: payload.updatedChapters,
        repaired_books: payload.repairedBooks,
        backup_count: Array.isArray(payload.backups) ? payload.backups.length : undefined
    };
}

async function collectSystemJobInfo() {
    const info = { available: false, total: 0, byStatus: {}, recent: [] };
    try {
        const exists = await query("SELECT to_regclass('public.system_jobs')::text regclass");
        if (!exists.rows[0]?.regclass) return info;
        info.available = true;
        const [statusRows, recentRows] = await Promise.all([
            query("SELECT status, COUNT(*)::int count FROM system_jobs GROUP BY status ORDER BY status"),
            query(
                `SELECT id, type, status, progress, error, created_by, created_at, started_at, finished_at, updated_at
                 FROM system_jobs
                 ORDER BY created_at DESC
                 LIMIT 12`
            )
        ]);
        for (const row of statusRows.rows) {
            const count = Number(row.count || 0);
            info.byStatus[row.status || "unknown"] = count;
            info.total += count;
        }
        info.recent = recentRows.rows || [];
    } catch (err) {
        info.error = err.message || String(err);
    }
    return info;
}

async function createSystemJob({ type, input = {}, createdBy = "" } = {}) {
    const result = await query(
        `INSERT INTO system_jobs(type, status, progress, input_json, created_by)
         VALUES ($1, 'queued', 0, $2::jsonb, $3)
         RETURNING id, type, status, progress, created_at`,
        [String(type || "job").slice(0, 120), JSON.stringify(input || {}), String(createdBy || "").slice(0, 120)]
    );
    return result.rows[0];
}

async function updateSystemJob(id, fields = {}) {
    if (!id) return null;
    const patch = {
        status: fields.status,
        progress: fields.progress,
        result_json: fields.result ? JSON.stringify(fields.result) : undefined,
        error: fields.error,
        started_at: fields.started ? "CURRENT_TIMESTAMP" : undefined,
        finished_at: fields.finished ? "CURRENT_TIMESTAMP" : undefined
    };
    const sets = [];
    const params = [];
    for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        if (key === "started_at" || key === "finished_at") {
            sets.push(`${key} = ${value}`);
            continue;
        }
        params.push(value);
        sets.push(`${key} = $${params.length}${key === "result_json" ? "::jsonb" : ""}`);
    }
    if (!sets.length) return null;
    params.push(id);
    const result = await query(
        `UPDATE system_jobs
         SET ${sets.join(", ")}, updated_at = CURRENT_TIMESTAMP
         WHERE id = $${params.length}
         RETURNING id, type, status, progress, error, created_at, started_at, finished_at, updated_at`,
        params
    );
    return result.rows[0] || null;
}

async function runTrackedJob(req, type, input, worker) {
    let job = null;
    try {
        job = await createSystemJob({ type, input, createdBy: adminActor(req) });
        await updateSystemJob(job.id, { status: "running", progress: 5, started: true });
    } catch (err) {
        console.warn(`[system-jobs] unable to create job ${type}: ${err.message || String(err)}`);
    }

    try {
        const payload = await worker(job);
        const finalJob = job
            ? await updateSystemJob(job.id, { status: "succeeded", progress: 100, result: compactJobResult(payload), finished: true })
            : null;
        return finalJob ? { ...payload, job: finalJob } : payload;
    } catch (err) {
        if (job) {
            await updateSystemJob(job.id, {
                status: "failed",
                progress: 100,
                error: String(err.message || err).slice(0, 2000),
                finished: true
            }).catch(() => {});
        }
        throw err;
    }
}

async function listSystemJobs({ page = 1, limit = 30, status = "", type = "" } = {}) {
    const safePage = Math.max(1, Number(page || 1));
    const safeLimit = Math.min(100, Math.max(1, Number(limit || 30)));
    const offset = (safePage - 1) * safeLimit;
    const where = [];
    const params = [];
    if (status) {
        params.push(String(status).trim());
        where.push(`status = $${params.length}`);
    }
    if (type) {
        params.push(String(type).trim());
        where.push(`type = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total = await query(`SELECT COUNT(*)::int count FROM system_jobs ${whereSql}`, params);
    const rows = await query(
        `SELECT id, type, status, progress, input_json, result_json, error, created_by,
                created_at, started_at, finished_at, updated_at
         FROM system_jobs
         ${whereSql}
         ORDER BY created_at DESC, id DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, safeLimit, offset]
    );
    return { rows: rows.rows, total: Number(total.rows[0]?.count || 0), page: safePage, limit: safeLimit };
}

async function getSystemJob(id) {
    const result = await query(
        `SELECT id, type, status, progress, input_json, result_json, error, created_by,
                created_at, started_at, finished_at, updated_at
         FROM system_jobs
         WHERE id = $1`,
        [id]
    );
    return result.rows[0] || null;
}

async function cancelSystemJob(id, { actor = "" } = {}) {
    const job = await getSystemJob(id);
    if (!job) return null;
    if (String(job.status || "") !== "queued") {
        const err = new Error("only queued jobs can be canceled");
        err.status = 409;
        throw err;
    }
    return updateSystemJob(id, {
        status: "canceled",
        progress: Number(job.progress || 0),
        error: actor ? `canceled by ${String(actor).slice(0, 120)}` : "canceled",
        finished: true
    });
}

module.exports = {
    cancelSystemJob,
    collectSystemJobInfo,
    createSystemJob,
    getSystemJob,
    listSystemJobs,
    runTrackedJob,
    updateSystemJob
};
