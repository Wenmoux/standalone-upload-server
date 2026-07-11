const ALLOWED_METRICS = new Set(["page_load", "ttfb", "fcp", "lcp", "cls", "inp", "route", "long_task"]);

function cleanToken(value, max = 120) {
    return String(value || "").trim().replace(/[\x00-\x1f\x7f]/g, "").slice(0, max);
}

function cleanEvent(input = {}) {
    const metric = cleanToken(input.metric, 40).toLowerCase();
    if (!ALLOWED_METRICS.has(metric)) return null;
    const value = Number(input.value);
    if (!Number.isFinite(value) || value < 0 || value > (metric === "cls" ? 20 : 300000)) return null;
    const metadata = input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
        ? Object.fromEntries(Object.entries(input.metadata).slice(0, 12).map(([key, item]) => [cleanToken(key, 40), cleanToken(item, 160)]))
        : {};
    return {
        sessionId: cleanToken(input.session_id || input.sessionId, 80),
        route: cleanToken(input.route, 160),
        metric,
        value,
        rating: cleanToken(input.rating, 20),
        navigationType: cleanToken(input.navigation_type || input.navigationType, 40),
        metadata
    };
}

function createReaderRumService(options = {}) {
    const query = options.query;
    const retentionDays = Math.max(7, Math.min(365, Number(options.retentionDays || process.env.PO18_READER_RUM_RETENTION_DAYS || 30)));
    let lastCleanupAt = 0;

    async function recordEvents(userId, rawEvents = []) {
        const events = (Array.isArray(rawEvents) ? rawEvents : [rawEvents]).slice(0, 30).map(cleanEvent).filter(Boolean);
        if (!events.length) return { accepted: 0 };
        const params = [];
        const values = events.map((event) => {
            const offset = params.length;
            params.push(userId || null, event.sessionId, event.route, event.metric, event.value, event.rating, event.navigationType, JSON.stringify(event.metadata));
            return `($${offset + 1},$${offset + 2},$${offset + 3},$${offset + 4},$${offset + 5},$${offset + 6},$${offset + 7},$${offset + 8}::jsonb)`;
        });
        await query(
            `INSERT INTO reader_performance_events
             (user_id, session_id, route, metric, value, rating, navigation_type, metadata_json)
             VALUES ${values.join(",")}`,
            params
        );
        if (Date.now() - lastCleanupAt > 6 * 60 * 60 * 1000) {
            lastCleanupAt = Date.now();
            query(`DELETE FROM reader_performance_events WHERE created_at < CURRENT_TIMESTAMP - ($1::text || ' days')::interval`, [retentionDays]).catch(() => {});
        }
        return { accepted: events.length };
    }

    async function summary({ days = 7 } = {}) {
        const safeDays = Math.max(1, Math.min(90, Number(days || 7)));
        const [metrics, routes, totals] = await Promise.all([
            query(
                `SELECT metric,
                        COUNT(*)::int samples,
                        ROUND(AVG(value)::numeric, 2)::float avg,
                        ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY value)::numeric, 2)::float p50,
                        ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY value)::numeric, 2)::float p95,
                        ROUND(MAX(value)::numeric, 2)::float max,
                        COUNT(*) FILTER (WHERE rating='poor')::int poor
                 FROM reader_performance_events
                 WHERE created_at >= CURRENT_TIMESTAMP - ($1::text || ' days')::interval
                 GROUP BY metric
                 ORDER BY metric`,
                [safeDays]
            ),
            query(
                `SELECT route,
                        COUNT(*)::int samples,
                        ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY value)::numeric, 2)::float p95
                 FROM reader_performance_events
                 WHERE metric='route' AND created_at >= CURRENT_TIMESTAMP - ($1::text || ' days')::interval
                 GROUP BY route
                 ORDER BY samples DESC, p95 DESC
                 LIMIT 20`,
                [safeDays]
            ),
            query(
                `SELECT COUNT(*)::int samples,
                        COUNT(DISTINCT session_id)::int sessions,
                        COUNT(DISTINCT user_id)::int users,
                        MIN(created_at) first_at,
                        MAX(created_at) last_at
                 FROM reader_performance_events
                 WHERE created_at >= CURRENT_TIMESTAMP - ($1::text || ' days')::interval`,
                [safeDays]
            )
        ]);
        return { days: safeDays, metrics: metrics.rows || [], routes: routes.rows || [], ...(totals.rows[0] || {}) };
    }

    return { recordEvents, summary };
}

module.exports = { ALLOWED_METRICS, cleanEvent, createReaderRumService };
