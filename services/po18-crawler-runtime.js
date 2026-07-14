/**
 * [INPUT]: 依赖注入的默认配置、logger 与可选来源健康快照，持有单进程爬虫的可变运行状态
 * [OUTPUT]: 对外提供停止错误、可中断等待、统计初值以及日志/进度/暂停恢复/任务生命周期/快照状态机
 * [POS]: services 的 PO18 爬虫运行时边界，把控制面状态转换与抓取编排分离，确保管理路由观察到一致快照
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const MAX_LOGS = 120;

class CrawlerStoppedError extends Error {
    constructor(message = "crawler stopped") {
        super(message);
        this.name = "CrawlerStoppedError";
        this.code = "PO18_CRAWLER_STOPPED";
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))));
}

function freshCrawlerStats() {
    return {
        pagesScanned: 0,
        booksFound: 0,
        booksProcessed: 0,
        booksSkippedFiltered: 0,
        booksSkippedComplete: 0,
        metadataUploaded: 0,
        chaptersFound: 0,
        chaptersUploaded: 0,
        chaptersSkippedCached: 0,
        chaptersSkippedPaid: 0,
        chaptersFailed: 0,
        errors: 0,
        activeBooks: 0,
        activeChapters: 0,
        chapterCandidates: 0,
        requestRetries: 0,
        cookieRefreshes: 0,
        currentPage: 0,
        currentBookId: "",
        currentBookTitle: "",
        currentChapterId: "",
        currentChapterTitle: "",
        lastMessage: ""
    };
}

function createCrawlerRuntime(options = {}) {
    const defaultConfig = options.defaultConfig || {};
    const logger = options.logger || console;
    const maxLogs = Math.max(1, Number(options.maxLogs || MAX_LOGS));
    const state = {
        config: { ...defaultConfig },
        loaded: false,
        running: false,
        paused: false,
        pauseReason: "",
        stopRequested: false,
        activeJobId: null,
        startedAt: null,
        finishedAt: null,
        nextRunAt: null,
        lastRunAt: null,
        lastResult: null,
        lastError: "",
        findBooksToken: "",
        logs: [],
        stats: freshCrawlerStats(),
        timer: null
    };

    function log(level, message, extra = {}) {
        const item = { at: new Date().toISOString(), level, message: String(message || ""), ...extra };
        state.logs.push(item);
        if (state.logs.length > maxLogs) state.logs.splice(0, state.logs.length - maxLogs);
        state.stats.lastMessage = item.message;
        if (level === "error") logger.warn?.(`[po18-crawler] ${item.message}`);
        else logger.log?.(`[po18-crawler] ${item.message}`);
    }

    function checkStopped() {
        if (state.stopRequested) throw new CrawlerStoppedError();
    }

    async function waitWhilePaused() {
        while (state.paused) {
            checkStopped();
            await sleep(1000);
        }
    }

    function currentProgress() {
        const totalPages = Math.max(1, Number(state.config.endPage || 0) - Number(state.config.startPage || 0) + 1);
        const pageProgress = Math.max(0, Math.min(totalPages, state.stats.pagesScanned));
        return Math.max(1, Math.min(95, Math.floor((pageProgress / totalPages) * 90) + 5));
    }

    function beginJob(jobId) {
        state.running = true;
        state.paused = false;
        state.pauseReason = "";
        state.stopRequested = false;
        state.activeJobId = jobId;
        state.startedAt = new Date().toISOString();
        state.finishedAt = null;
        state.lastError = "";
        state.stats = freshCrawlerStats();
    }

    function releaseJob() {
        state.running = false;
        state.paused = false;
        state.pauseReason = "";
        state.stopRequested = false;
        state.activeJobId = null;
    }

    function pause(reason = "paused by admin") {
        if (!state.running) return false;
        state.paused = true;
        state.pauseReason = String(reason || "paused by admin").slice(0, 500);
        log("warn", state.pauseReason);
        return true;
    }

    function resume() {
        if (!state.running) return false;
        state.paused = false;
        state.pauseReason = "";
        log("info", "crawler resumed");
        return true;
    }

    function stop() {
        if (!state.running) return false;
        state.stopRequested = true;
        state.paused = false;
        state.pauseReason = "";
        log("warn", "crawler stop requested");
        return true;
    }

    function snapshot(sourceHealth = {}) {
        return {
            running: state.running,
            paused: state.paused,
            pauseReason: state.pauseReason,
            activeJobId: state.activeJobId,
            startedAt: state.startedAt,
            finishedAt: state.finishedAt,
            nextRunAt: state.nextRunAt,
            lastRunAt: state.lastRunAt,
            lastError: state.lastError,
            lastResult: state.lastResult,
            sourceHealth,
            stats: state.stats,
            logs: state.logs.slice(-maxLogs)
        };
    }

    return {
        beginJob,
        checkStopped,
        currentProgress,
        log,
        pause,
        releaseJob,
        resume,
        snapshot,
        state,
        stop,
        waitWhilePaused
    };
}

module.exports = {
    CrawlerStoppedError,
    MAX_LOGS,
    createCrawlerRuntime,
    freshCrawlerStats,
    sleep
};
