const { pool, query } = require("../pg-store");

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

async function collectSystemJobMetrics() {
    try {
        const exists = await query("SELECT to_regclass('public.system_jobs')::text regclass");
        if (!exists.rows[0]?.regclass) return { available: false };
        const result = await query(
            `SELECT
                COUNT(*) FILTER (WHERE status='queued')::int queued,
                COUNT(*) FILTER (WHERE status='running')::int running,
                COUNT(*) FILTER (WHERE status='succeeded')::int succeeded,
                COUNT(*) FILTER (WHERE status='failed')::int failed,
                COUNT(*) FILTER (WHERE status='canceled')::int canceled,
                COUNT(*) FILTER (WHERE status='running' AND lease_expires_at < CURRENT_TIMESTAMP)::int expired_leases,
                COUNT(*) FILTER (WHERE cancel_requested_at IS NOT NULL AND status='running')::int cancel_requested,
                COALESCE(SUM(GREATEST(attempt - 1, 0)), 0)::int retries,
                COUNT(*) FILTER (WHERE status='failed' AND attempt >= max_attempts)::int exhausted,
                COUNT(*) FILTER (WHERE attempt > 1)::int retried_jobs,
                COALESCE(ROUND(
                    COUNT(*) FILTER (WHERE status='failed')::numeric /
                    NULLIF(COUNT(*) FILTER (WHERE status IN ('succeeded','failed')), 0), 4
                ), 0)::float8 failure_rate,
                COALESCE(ROUND(
                    COUNT(*) FILTER (WHERE attempt > 1)::numeric / NULLIF(COUNT(*), 0), 4
                ), 0)::float8 retry_rate,
                COALESCE(percentile_cont(0.50) WITHIN GROUP (
                    ORDER BY EXTRACT(EPOCH FROM (started_at - created_at)) * 1000
                ) FILTER (WHERE started_at IS NOT NULL), 0)::bigint queue_p50_ms,
                COALESCE(percentile_cont(0.95) WITHIN GROUP (
                    ORDER BY EXTRACT(EPOCH FROM (started_at - created_at)) * 1000
                ) FILTER (WHERE started_at IS NOT NULL), 0)::bigint queue_p95_ms,
                COALESCE(percentile_cont(0.99) WITHIN GROUP (
                    ORDER BY EXTRACT(EPOCH FROM (started_at - created_at)) * 1000
                ) FILTER (WHERE started_at IS NOT NULL), 0)::bigint queue_p99_ms,
                COALESCE(percentile_cont(0.50) WITHIN GROUP (
                    ORDER BY EXTRACT(EPOCH FROM (finished_at - started_at)) * 1000
                ) FILTER (WHERE started_at IS NOT NULL AND finished_at IS NOT NULL), 0)::bigint run_p50_ms,
                COALESCE(percentile_cont(0.95) WITHIN GROUP (
                    ORDER BY EXTRACT(EPOCH FROM (finished_at - started_at)) * 1000
                ) FILTER (WHERE started_at IS NOT NULL AND finished_at IS NOT NULL), 0)::bigint run_p95_ms,
                COALESCE(percentile_cont(0.99) WITHIN GROUP (
                    ORDER BY EXTRACT(EPOCH FROM (finished_at - started_at)) * 1000
                ) FILTER (WHERE started_at IS NOT NULL AND finished_at IS NOT NULL), 0)::bigint run_p99_ms,
                COALESCE(MAX(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - started_at)) * 1000)
                    FILTER (WHERE status='running' AND started_at IS NOT NULL), 0)::bigint running_max_ms
             FROM system_jobs`
        );
        return { available: true, ...result.rows[0] };
    } catch (err) {
        return { available: false, error: err.message || String(err) };
    }
}

async function createSystemJob({ type, input = {}, createdBy = "", priority = 0, maxAttempts = 3, idempotencyKey = "", nextRunAt = null } = {}) {
    const params = [
        String(type || "job").slice(0, 120),
        JSON.stringify(input || {}),
        String(createdBy || "").slice(0, 120),
        Math.max(-1000, Math.min(1000, Math.trunc(Number(priority || 0)))),
        Math.max(1, Math.min(100, Math.trunc(Number(maxAttempts || 3)))),
        String(idempotencyKey || "").trim().slice(0, 240),
        nextRunAt || null
    ];
    try {
        const result = await query(
            `INSERT INTO system_jobs(type, status, progress, input_json, created_by, priority, max_attempts, idempotency_key, next_run_at)
             VALUES ($1, 'queued', 0, $2::jsonb, $3, $4, $5, $6, $7)
             RETURNING id, type, status, progress, priority, max_attempts, attempt, idempotency_key, next_run_at, created_at`,
            params
        );
        return result.rows[0];
    } catch (err) {
        if (err.code !== "23505" || !params[5]) throw err;
        const existing = await query(
            `SELECT id, type, status, progress, priority, max_attempts, attempt, idempotency_key, next_run_at, created_at
             FROM system_jobs WHERE idempotency_key=$1 AND status IN ('queued','running') ORDER BY id DESC LIMIT 1`,
            [params[5]]
        );
        if (existing.rows[0]) return { ...existing.rows[0], duplicate: true };
        throw err;
    }
}

async function updateSystemJob(id, fields = {}) {
    if (!id) return null;
    const patch = {
        status: fields.status,
        progress: fields.progress,
        result_json: fields.result ? JSON.stringify(fields.result) : undefined,
        error: fields.error,
        next_run_at: fields.nextRunAt,
        heartbeat_at: fields.heartbeat ? "CURRENT_TIMESTAMP" : undefined,
        lease_expires_at: fields.leaseExpiresAt,
        cancel_requested_at: fields.cancelRequested ? "CURRENT_TIMESTAMP" : undefined,
        started_at: fields.started ? "CURRENT_TIMESTAMP" : undefined,
        finished_at: fields.finished ? "CURRENT_TIMESTAMP" : undefined
    };
    const sets = [];
    const params = [];
    for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        if (["started_at", "finished_at", "heartbeat_at", "cancel_requested_at"].includes(key)) {
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
         RETURNING id, type, status, progress, error, priority, max_attempts, attempt, idempotency_key,
                   next_run_at, lease_expires_at, heartbeat_at, cancel_requested_at,
                   created_at, started_at, finished_at, updated_at`,
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

async function listSystemJobs({ page = 1, limit = 30, status = "", type = "", createdBy = "" } = {}) {
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
    if (createdBy) {
        params.push(String(createdBy).trim());
        where.push(`created_by = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total = await query(`SELECT COUNT(*)::int count FROM system_jobs ${whereSql}`, params);
    const rows = await query(
        `SELECT id, type, status, progress, input_json, result_json, error, created_by,
                priority, max_attempts, attempt, idempotency_key, next_run_at, lease_expires_at,
                heartbeat_at, cancel_requested_at, locked_by, locked_at,
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
                priority, max_attempts, attempt, idempotency_key, next_run_at, lease_expires_at,
                heartbeat_at, cancel_requested_at, locked_by, locked_at,
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
    const status = String(job.status || "");
    if (!['queued', 'running'].includes(status)) {
        const err = new Error("only queued or running jobs can be canceled");
        err.status = 409;
        throw err;
    }
    if (status === "running") {
        const result = await query(
            `UPDATE system_jobs SET cancel_requested_at=CURRENT_TIMESTAMP, error=$2, updated_at=CURRENT_TIMESTAMP
             WHERE id=$1 AND status='running'
             RETURNING id, type, status, progress, error, cancel_requested_at, updated_at`,
            [id, actor ? `cancel requested by ${String(actor).slice(0, 120)}` : "cancel requested"]
        );
        return result.rows[0] || null;
    }
    return updateSystemJob(id, {
        status: "canceled",
        progress: Number(job.progress || 0),
        error: actor ? `canceled by ${String(actor).slice(0, 120)}` : "canceled",
        finished: true
    });
}

async function claimSystemJobs({ workerId, types = [], limit = 1, leaseSeconds = 120 } = {}) {
    const worker = String(workerId || "worker").trim().slice(0, 120) || "worker";
    const safeTypes = (Array.isArray(types) ? types : []).map((item) => String(item || "").trim()).filter(Boolean).slice(0, 100);
    const safeLimit = Math.max(1, Math.min(20, Math.trunc(Number(limit || 1))));
    const safeLeaseSeconds = Math.max(15, Math.min(3600, Math.trunc(Number(leaseSeconds || 120))));
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const result = await client.query(
            `WITH candidates AS (
                SELECT id
                FROM system_jobs
                WHERE (
                    (status='queued' AND (next_run_at IS NULL OR next_run_at <= CURRENT_TIMESTAMP))
                    OR (status='running' AND lease_expires_at IS NOT NULL AND lease_expires_at < CURRENT_TIMESTAMP)
                )
                  AND cancel_requested_at IS NULL
                  AND attempt < max_attempts
                  AND ($1::text[] = '{}'::text[] OR type = ANY($1::text[]))
                ORDER BY priority DESC, created_at ASC, id ASC
                FOR UPDATE SKIP LOCKED
                LIMIT $2
             )
             UPDATE system_jobs job
             SET status='running', locked_by=$3, locked_at=CURRENT_TIMESTAMP,
                 lease_expires_at=CURRENT_TIMESTAMP + ($4::text || ' seconds')::interval,
                 heartbeat_at=CURRENT_TIMESTAMP, started_at=COALESCE(started_at, CURRENT_TIMESTAMP),
                 attempt=attempt+1, updated_at=CURRENT_TIMESTAMP
             FROM candidates
             WHERE job.id=candidates.id
             RETURNING job.*`,
            [safeTypes, safeLimit, worker, safeLeaseSeconds]
        );
        await client.query("COMMIT");
        return result.rows;
    } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

async function claimSystemJob(id, { workerId, leaseSeconds = 120 } = {}) {
    const worker = String(workerId || "worker").trim().slice(0, 120) || "worker";
    const safeLeaseSeconds = Math.max(15, Math.min(3600, Math.trunc(Number(leaseSeconds || 120))));
    const result = await query(
        `UPDATE system_jobs
         SET status='running', locked_by=$2, locked_at=CURRENT_TIMESTAMP,
             lease_expires_at=CURRENT_TIMESTAMP + ($3::text || ' seconds')::interval,
             heartbeat_at=CURRENT_TIMESTAMP, started_at=COALESCE(started_at, CURRENT_TIMESTAMP),
             attempt=attempt+1, updated_at=CURRENT_TIMESTAMP
         WHERE id=$1
           AND cancel_requested_at IS NULL
           AND attempt < max_attempts
           AND (
             (status='queued' AND (next_run_at IS NULL OR next_run_at <= CURRENT_TIMESTAMP))
             OR (status='running' AND lease_expires_at IS NOT NULL AND lease_expires_at < CURRENT_TIMESTAMP)
           )
         RETURNING *`,
        [id, worker, safeLeaseSeconds]
    );
    return result.rows[0] || null;
}

async function heartbeatSystemJob(id, { workerId, progress, leaseSeconds = 120 } = {}) {
    const safeLeaseSeconds = Math.max(15, Math.min(3600, Math.trunc(Number(leaseSeconds || 120))));
    const params = [id, String(workerId || "").slice(0, 120), safeLeaseSeconds];
    let progressSql = "";
    if (progress !== undefined && Number.isFinite(Number(progress))) {
        params.push(Math.max(0, Math.min(100, Math.trunc(Number(progress)))));
        progressSql = `, progress=$${params.length}`;
    }
    const result = await query(
        `UPDATE system_jobs
         SET heartbeat_at=CURRENT_TIMESTAMP,
             lease_expires_at=CURRENT_TIMESTAMP + ($3::text || ' seconds')::interval,
             updated_at=CURRENT_TIMESTAMP${progressSql}
         WHERE id=$1 AND status='running' AND locked_by=$2
         RETURNING id, status, progress, heartbeat_at, lease_expires_at, cancel_requested_at`,
        params
    );
    return result.rows[0] || null;
}

module.exports = {
    cancelSystemJob,
    claimSystemJob,
    claimSystemJobs,
    collectSystemJobInfo,
    collectSystemJobMetrics,
    createSystemJob,
    getSystemJob,
    heartbeatSystemJob,
    listSystemJobs,
    runTrackedJob,
    updateSystemJob
};
