/**
 * [INPUT]: 依赖 Fetch/URLSearchParams、server-pg 的 Bot/Reader/Upload HTTP 契约和环境中的服务地址与 Bot Token
 * [OUTPUT]: 对外提供 PgBotClient 统一 HTTP 客户端、管理员广播任务/收件人分页，以及 Telegram 用户显示名和邀请参数解析工具
 * [POS]: bot 到 server-pg 的唯一业务数据访问层，封装鉴权、超时、缓存、幂等键与分页聚合，禁止直连 PostgreSQL
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const { URLSearchParams } = require("url");

const DEFAULT_BASE_URL = "http://127.0.0.1:3100";

function positiveInt(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : fallback;
}

function cloneData(data) {
    if (!data || typeof data !== "object") return data;
    return JSON.parse(JSON.stringify(data));
}

function idempotencyPayload(options = {}) {
    if (!options || typeof options !== "object") return {};
    const key = String(options.idempotencyKey || options.idempotency_key || "").trim().slice(0, 240);
    const scope = String(options.idempotencyScope || options.idempotency_scope || "").trim().slice(0, 120);
    return {
        ...(key ? { idempotency_key: key } : {}),
        ...(scope ? { idempotency_scope: scope } : {})
    };
}

class PgBotClient {
    constructor(options = {}) {
        this.baseUrl = String(options.baseUrl || process.env.PO18_SERVER_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
        this.shareBaseUrl = String(options.shareBaseUrl || process.env.PO18_SHARE_API_URL || this.baseUrl).replace(/\/+$/, "");
        this.botToken = options.botToken || process.env.PO18_BOT_API_TOKEN || "";
        this.fetchImpl = options.fetchImpl || globalThis.fetch;
        this.requestTimeoutMs = positiveInt(options.requestTimeoutMs ?? process.env.PO18_BOT_API_TIMEOUT_MS, 30000);
        this.exportPageSize = Math.max(20, Math.min(500, positiveInt(options.exportPageSize ?? process.env.PO18_BOT_EXPORT_PAGE_SIZE, 100)));
        this.cacheTtlMs = positiveInt(options.cacheTtlMs ?? process.env.PO18_BOT_CACHE_TTL_MS, 10000);
        this.cacheMax = Math.max(20, positiveInt(options.cacheMax ?? process.env.PO18_BOT_CACHE_MAX, 300));
        this.cache = new Map();
        this.inflight = new Map();
        this.metrics = { requests: 0, errors: 0, cache_hits: 0, inflight_hits: 0 };
    }

    cacheKey(path, url, options = {}) {
        const method = String(options.method || "GET").toUpperCase();
        if (!this.cacheTtlMs || method !== "GET") return "";
        if (String(path).includes("includeContent=1")) return "";
        if (/^\/reader-api\/search\?/i.test(path)) return url;
        if (/^\/reader-api\/books\/[^/?]+(?:$|\?)/i.test(path)) return url;
        if (/^\/reader-api\/books\/[^/?]+\/chapters(?:$|\?)/i.test(path)) return url;
        if (/^\/bot-api\/hot-keywords\?/i.test(path)) return url;
        if (/^\/bot-api\/word-cloud\?/i.test(path)) return url;
        if (/^\/bot-api\/top\?/i.test(path)) return url;
        return "";
    }

    readCache(key) {
        const row = this.cache.get(key);
        if (!row) return null;
        if (row.expiresAt <= Date.now()) {
            this.cache.delete(key);
            return null;
        }
        this.metrics.cache_hits += 1;
        return cloneData(row.data);
    }

    writeCache(key, data) {
        if (!key) return;
        this.cache.set(key, { data: cloneData(data), expiresAt: Date.now() + this.cacheTtlMs });
        while (this.cache.size > this.cacheMax) {
            const first = this.cache.keys().next().value;
            this.cache.delete(first);
        }
    }

    stats() {
        return {
            ...this.metrics,
            cache_keys: this.cache.size,
            inflight: this.inflight.size,
            cache_ttl_ms: this.cacheTtlMs,
            timeout_ms: this.requestTimeoutMs,
            export_page_size: this.exportPageSize
        };
    }

    async request(path, options = {}) {
        const { baseUrl, ...fetchOptions } = options;
        delete fetchOptions.headers;
        const requestTimeoutMs = positiveInt(fetchOptions.timeoutMs ?? this.requestTimeoutMs, this.requestTimeoutMs);
        delete fetchOptions.timeoutMs;
        const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
        if (this.botToken) headers["X-Bot-Token"] = this.botToken;
        const url = `${baseUrl || this.baseUrl}${path}`;
        const cacheKey = this.cacheKey(path, url, fetchOptions);
        if (cacheKey) {
            const cached = this.readCache(cacheKey);
            if (cached) return cached;
            if (this.inflight.has(cacheKey)) {
                this.metrics.inflight_hits += 1;
                return cloneData(await this.inflight.get(cacheKey));
            }
        }

        const run = async () => {
            this.metrics.requests += 1;
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
            try {
                const response = await this.fetchImpl(url, { ...fetchOptions, headers, signal: controller.signal });
                const data = await response.json().catch(() => ({}));
                if (!response.ok) {
                    const error = new Error(data.error || `HTTP ${response.status}`);
                    error.status = response.status;
                    error.data = data;
                    throw error;
                }
                if (cacheKey) this.writeCache(cacheKey, data);
                return data;
            } catch (err) {
                this.metrics.errors += 1;
                if (err.name === "AbortError") throw new Error(`Bot API timeout after ${requestTimeoutMs}ms: ${path}`);
                throw err;
            } finally {
                clearTimeout(timer);
            }
        };

        if (!cacheKey) return run();
        const promise = run().finally(() => this.inflight.delete(cacheKey));
        this.inflight.set(cacheKey, promise);
        return cloneData(await promise);
    }

    async health() {
        return this.request("/bot-api/health");
    }

    async createBroadcast(telegramId, message, chatId = "") {
        return this.request("/bot-api/broadcasts", {
            method: "POST",
            body: JSON.stringify({ telegram_id: String(telegramId || ""), chat_id: String(chatId || ""), message: String(message || "") })
        });
    }

    async broadcastRecipients(afterId = 0, limit = 100) {
        const query = new URLSearchParams({ after_id: String(afterId || 0), limit: String(limit || 100) });
        return this.request(`/bot-api/broadcasts/recipients?${query}`);
    }

    async commandSettings() {
        return this.request("/bot-api/commands");
    }

    async createSystemJob(payload = {}) {
        const data = await this.request("/bot-api/jobs", {
            method: "POST",
            body: JSON.stringify(payload)
        });
        return data.job || null;
    }

    async updateSystemJob(id, payload = {}) {
        const data = await this.request(`/bot-api/jobs/${encodeURIComponent(id)}`, {
            method: "PATCH",
            body: JSON.stringify(payload)
        });
        return data.job || null;
    }

    async claimSystemJobs(payload = {}) {
        const data = await this.request("/bot-api/jobs/claim", {
            method: "POST",
            body: JSON.stringify(payload)
        });
        return data.jobs || [];
    }

    async claimSystemJob(id, payload = {}) {
        const data = await this.request(`/bot-api/jobs/${encodeURIComponent(id)}/claim`, {
            method: "POST",
            body: JSON.stringify(payload)
        });
        return data.job || null;
    }

    async heartbeatSystemJob(id, payload = {}) {
        const data = await this.request(`/bot-api/jobs/${encodeURIComponent(id)}/heartbeat`, {
            method: "POST",
            body: JSON.stringify(payload)
        });
        return data.job || null;
    }

    async getSystemJob(id) {
        const data = await this.request(`/bot-api/jobs/${encodeURIComponent(id)}`);
        return data.job || null;
    }

    async listSystemJobs(telegramId, { limit = 8, status = "" } = {}) {
        const query = new URLSearchParams({ telegram_id: String(telegramId || ""), limit: String(limit) });
        if (status) query.set("status", status);
        return this.request(`/bot-api/jobs?${query.toString()}`);
    }

    async cancelSystemJob(id, telegramId) {
        const data = await this.request(`/bot-api/jobs/${encodeURIComponent(id)}/cancel`, {
            method: "POST",
            body: JSON.stringify({ telegram_id: String(telegramId || "") })
        });
        return data.job || null;
    }

    async recordAudit(payload = {}) {
        return this.request("/bot-api/audit", {
            method: "POST",
            body: JSON.stringify(payload)
        });
    }

    async getUser(telegramId) {
        const data = await this.request(`/bot-api/users/${encodeURIComponent(telegramId)}`);
        return data.user || null;
    }

    async registerUser(profile, inviteCode = "") {
        return this.request("/bot-api/users/register", {
            method: "POST",
            body: JSON.stringify({
                telegram_id: profile.id,
                telegram_username: profile.username || "",
                nickname: displayName(profile),
                inviter_telegram_id: parseInvite(inviteCode)
            })
        });
    }

    async sign(telegramId) {
        return this.request(`/bot-api/users/${encodeURIComponent(telegramId)}/sign`, { method: "POST", body: "{}" });
    }

    async addCurrency(telegramId, currency, delta, type = "", detail = "", options = {}) {
        return this.request(`/bot-api/users/${encodeURIComponent(telegramId)}/currency`, {
            method: "PATCH",
            body: JSON.stringify({ currency, delta, type, detail, ...idempotencyPayload(options) })
        });
    }

    async recordUserEvent(telegramId, type, detail = "") {
        return this.request(`/bot-api/users/${encodeURIComponent(telegramId)}/transactions`, {
            method: "POST",
            body: JSON.stringify({ currency: "copper", amount: 0, type, detail, source: "telegram_bot" })
        });
    }

    async exportPermission(telegramId, bookId = "") {
        const qs = new URLSearchParams();
        if (bookId) qs.set("book_id", String(bookId));
        const suffix = qs.toString() ? `?${qs}` : "";
        return this.request(`/bot-api/users/${encodeURIComponent(telegramId)}/export-permission${suffix}`);
    }

    async exportPricing() {
        return this.request("/bot-api/export-pricing");
    }

    async unlockExport(telegramId) {
        return this.request(`/bot-api/users/${encodeURIComponent(telegramId)}/export-unlock`, {
            method: "POST",
            body: "{}"
        });
    }

    async claimFreeExport(telegramId, bookId, format = "", options = {}) {
        return this.request(`/bot-api/users/${encodeURIComponent(telegramId)}/export-free-claim`, {
            method: "POST",
            body: JSON.stringify({ book_id: bookId, format, ...idempotencyPayload(options) })
        });
    }

    async claimExtraExport(telegramId, bookId, format = "", options = {}) {
        return this.request(`/bot-api/users/${encodeURIComponent(telegramId)}/export-extra-claim`, {
            method: "POST",
            body: JSON.stringify({ book_id: bookId, format, ...idempotencyPayload(options) })
        });
    }

    async redeemCdk(telegramId, code = "") {
        return this.request(`/bot-api/users/${encodeURIComponent(telegramId)}/redeem-cdk`, {
            method: "POST",
            body: JSON.stringify({ code })
        });
    }

    async spendCurrency(telegramId, currency, amount, type = "spend", detail = "", source = "telegram_bot", options = {}) {
        return this.request(`/bot-api/users/${encodeURIComponent(telegramId)}/spend`, {
            method: "POST",
            body: JSON.stringify({ currency, amount, type, detail, source, ...idempotencyPayload(options), ...(options.bookId ? { book_id: options.bookId } : {}) })
        });
    }

    async searchBooks(params = {}) {
        const qs = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
            if (value !== undefined && value !== null && value !== "") qs.set(key, String(value));
        }
        return this.request(`/reader-api/search?${qs}`);
    }

    async getBook(bookId) {
        return this.request(`/reader-api/books/${encodeURIComponent(bookId)}`);
    }

    async getChapters(bookId, includeContent = false, options = {}) {
        const encodedBookId = encodeURIComponent(bookId);
        if (!includeContent) return this.request(`/reader-api/books/${encodedBookId}/chapters`);

        const maxRows = Math.max(1, positiveInt(options.maxRows, 5000));
        const rows = [];
        let offset = 0;
        while (rows.length < maxRows) {
            const limit = Math.min(this.exportPageSize, maxRows - rows.length);
            const query = new URLSearchParams({ includeContent: "1", limit: String(limit), offset: String(offset) });
            const page = await this.request(`/reader-api/books/${encodedBookId}/chapters?${query.toString()}`);
            const pageRows = Array.isArray(page.rows) ? page.rows : [];
            rows.push(...pageRows.slice(0, limit));
            if (!pageRows.length || !page.has_more || pageRows.length < limit) break;
            const nextOffset = Number(page.next_offset);
            offset = Number.isFinite(nextOffset) && nextOffset > offset ? nextOffset : offset + pageRows.length;
        }
        return { rows, total: rows.length };
    }

    async addBookshelf(telegramId, bookId) {
        return this.request(`/bot-api/bookshelf/${encodeURIComponent(telegramId)}/${encodeURIComponent(bookId)}`, {
            method: "POST",
            body: "{}"
        });
    }

    async removeBookshelf(telegramId, bookId) {
        return this.request(`/bot-api/bookshelf/${encodeURIComponent(telegramId)}/${encodeURIComponent(bookId)}`, {
            method: "DELETE"
        });
    }

    async listBookshelf(telegramId) {
        return this.request(`/bot-api/bookshelf/${encodeURIComponent(telegramId)}`);
    }

    async feedback(telegramId, bookId, feedback, source = "info") {
        return this.request(`/bot-api/books/${encodeURIComponent(bookId)}/feedback`, {
            method: "POST",
            body: JSON.stringify({ telegram_id: telegramId, feedback, source })
        });
    }

    async crowdBook(bookId, telegramId = "", limit = 10) {
        const qs = new URLSearchParams();
        if (telegramId) qs.set("telegram_id", telegramId);
        if (limit) qs.set("limit", String(limit));
        const suffix = qs.toString() ? `?${qs}` : "";
        return this.request(`/bot-api/books/${encodeURIComponent(bookId)}/crowd${suffix}`);
    }

    async crowdLeaderboard(telegramId = "", limit = 10) {
        const qs = new URLSearchParams();
        if (telegramId) qs.set("telegram_id", telegramId);
        if (limit) qs.set("limit", String(limit));
        const suffix = qs.toString() ? `?${qs}` : "";
        return this.request(`/bot-api/book-crowd${suffix}`);
    }

    async crowdVote(bookId, telegramId, voteCost = 100) {
        return this.request(`/bot-api/books/${encodeURIComponent(bookId)}/crowd`, {
            method: "POST",
            body: JSON.stringify({ telegram_id: telegramId, vote_cost: voteCost })
        });
    }

    async listBookReviews(bookId, telegramId = "", limit = 5, offset = 0) {
        const qs = new URLSearchParams();
        if (telegramId) qs.set("telegram_id", String(telegramId));
        if (limit) qs.set("limit", String(limit));
        if (offset) qs.set("offset", String(offset));
        const suffix = qs.toString() ? `?${qs}` : "";
        return this.request(`/bot-api/books/${encodeURIComponent(bookId)}/reviews${suffix}`);
    }

    async publishBookReview(bookId, telegramId, content) {
        return this.request(`/bot-api/books/${encodeURIComponent(bookId)}/reviews`, {
            method: "POST",
            body: JSON.stringify({ telegram_id: telegramId, content, source: "telegram_bot" })
        });
    }

    async voteBookReview(reviewId, telegramId, vote) {
        return this.request(`/bot-api/book-reviews/${encodeURIComponent(reviewId)}/vote`, {
            method: "POST",
            body: JSON.stringify({ telegram_id: telegramId, vote, source: "telegram_bot" })
        });
    }

    async reportBookReview(reviewId, telegramId, reason, details = "") {
        return this.request(`/bot-api/book-reviews/${encodeURIComponent(reviewId)}/report`, {
            method: "POST",
            body: JSON.stringify({ telegram_id: telegramId, reason, details })
        });
    }

    async appealBookReview(reviewId, telegramId, content) {
        return this.request(`/bot-api/book-reviews/${encodeURIComponent(reviewId)}/appeals`, {
            method: "POST",
            body: JSON.stringify({ telegram_id: telegramId, content })
        });
    }

    async recordSearch(keyword, type, resultCount) {
        return this.request("/bot-api/hot-keywords", {
            method: "POST",
            body: JSON.stringify({ keyword, type, result_count: resultCount })
        });
    }

    async submitSearchRequest(telegramId, payload = {}) {
        return this.request("/bot-api/search-requests", {
            method: "POST",
            body: JSON.stringify({
                telegram_id: telegramId,
                ...payload
            })
        });
    }

    async hotKeywords(limit = 10) {
        return this.request(`/bot-api/hot-keywords?limit=${encodeURIComponent(limit)}`);
    }

    async wordCloud(options = {}) {
        const qs = new URLSearchParams();
        if (options.limit) qs.set("limit", String(options.limit));
        if (options.hotLimit) qs.set("hotLimit", String(options.hotLimit));
        if (options.sourceLimit) qs.set("sourceLimit", String(options.sourceLimit));
        if (options.platform) qs.set("platform", String(options.platform));
        const suffix = qs.toString() ? `?${qs}` : "?limit=60";
        const timeoutMs = positiveInt(options.timeoutMs ?? process.env.PO18_WORD_CLOUD_TIMEOUT_MS, 60000);
        return this.request(`/bot-api/word-cloud${suffix}`, { timeoutMs });
    }

    async top(currency = "copper", limit = 10) {
        return this.request(`/bot-api/top?currency=${encodeURIComponent(currency)}&limit=${encodeURIComponent(limit)}`);
    }

    async transactions(telegramId, limit = 10) {
        return this.request(`/bot-api/users/${encodeURIComponent(telegramId)}/transactions?limit=${encodeURIComponent(limit)}`);
    }

    async me(telegramId) {
        return this.request(`/bot-api/users/${encodeURIComponent(telegramId)}/me`);
    }

    async getUserByTelegramUsername(username) {
        const data = await this.request(`/bot-api/users/by-telegram-username/${encodeURIComponent(String(username || "").replace(/^@/, ""))}`);
        return data.user || null;
    }

    async createRedPacket(payload = {}) {
        return this.request("/bot-api/red-packets", {
            method: "POST",
            body: JSON.stringify(payload)
        });
    }

    async claimRedPacket(payload = {}) {
        return this.request("/bot-api/red-packets/claim", {
            method: "POST",
            body: JSON.stringify(payload)
        });
    }

    async savePo18Account(telegramId, payload = {}) {
        return this.request(`/bot-api/users/${encodeURIComponent(telegramId)}/po18`, {
            method: "PUT",
            body: JSON.stringify(payload)
        });
    }

    async po18Account(telegramId) {
        return this.request(`/bot-api/users/${encodeURIComponent(telegramId)}/po18/credentials`);
    }

    async clearPo18Account(telegramId) {
        return this.request(`/bot-api/users/${encodeURIComponent(telegramId)}/po18`, { method: "DELETE" });
    }

    async shareMetadata(books = []) {
        return this.request("/api/metadata/batch", {
            baseUrl: this.shareBaseUrl,
            method: "POST",
            body: JSON.stringify({ books })
        });
    }

    async checkSharedCache(bookId) {
        return this.request("/api/parse/check-cache", {
            baseUrl: this.shareBaseUrl,
            method: "POST",
            body: JSON.stringify({ bookId: String(bookId || "") })
        });
    }

    async shareChapter(payload = {}) {
        return this.request("/api/parse/chapter-content", {
            baseUrl: this.shareBaseUrl,
            method: "POST",
            body: JSON.stringify(payload)
        });
    }

    async shareBook(bookId, profile = {}) {
        return this.request(`/bot-api/books/${encodeURIComponent(bookId)}/share`, {
            method: "POST",
            body: JSON.stringify({
                telegram_id: profile.id || profile.telegram_id || "",
                telegram_username: profile.username || profile.telegram_username || ""
            })
        });
    }
}

function displayName(user = {}) {
    return [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username || `tg_${user.id}`;
}

function parseInvite(value = "") {
    const match = String(value || "").match(/invite_(-?\d+)/i);
    return match ? match[1] : "";
}

module.exports = { PgBotClient, displayName, parseInvite };
