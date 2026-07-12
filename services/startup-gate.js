/**
 * [INPUT]: 依赖 Express 请求/响应生命周期与应用启动阶段写入的状态
 * [OUTPUT]: 对外提供启动状态快照、状态迁移函数和数据库初始化完成前的 HTTP 503 闸门
 * [POS]: services 的应用生命周期边界，阻止业务流量越过尚未提交的数据库迁移，同时保留健康检查可观测性
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const DEFAULT_RETRY_AFTER_SECONDS = 5;

function createStartupGate(options = {}) {
    const retryAfterSeconds = Math.max(1, Math.trunc(Number(options.retryAfterSeconds || DEFAULT_RETRY_AFTER_SECONDS)));
    let state = {
        ready: false,
        phase: "database_initializing",
        detail: "Database migrations and startup initialization are in progress"
    };

    function snapshot() {
        return { ...state };
    }

    function markWaiting(detail = state.detail) {
        state = {
            ready: false,
            phase: "database_initializing",
            detail: String(detail || "Database initialization is in progress")
        };
    }

    function markFailed(detail) {
        state = {
            ready: false,
            phase: "startup_failed",
            detail: String(detail || "Application startup failed")
        };
    }

    function markReady() {
        state = {
            ready: true,
            phase: "ready",
            detail: "Database migrations and startup initialization completed"
        };
    }

    function middleware(req, res, next) {
        if (state.ready || req.path === "/favicon.ico" || req.path.startsWith("/health/")) {
            next();
            return;
        }
        res.setHeader("Retry-After", String(retryAfterSeconds));
        res.status(503).json({
            success: false,
            error: "Service initialization is in progress, please retry later",
            code: "SERVICE_STARTING",
            phase: state.phase,
            retry_after: retryAfterSeconds
        });
    }

    return { markFailed, markReady, markWaiting, middleware, snapshot };
}

module.exports = { DEFAULT_RETRY_AFTER_SECONDS, createStartupGate };
