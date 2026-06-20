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

class PgBotClient {
    constructor(options = {}) {
        this.baseUrl = String(options.baseUrl || process.env.PO18_SERVER_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
        this.shareBaseUrl = String(options.shareBaseUrl || process.env.PO18_SHARE_API_URL || this.baseUrl).replace(/\/+$/, "");
        this.botToken = options.botToken || process.env.PO18_BOT_API_TOKEN || "";
        this.requestTimeoutMs = positiveInt(options.requestTimeoutMs ?? process.env.PO18_BOT_API_TIMEOUT_MS, 30000);
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
            timeout_ms: this.requestTimeoutMs
        };
    }

    async request(path, options = {}) {
        const { baseUrl, ...fetchOptions } = options;
        delete fetchOptions.headers;
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
            const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
            try {
                const response = await fetch(url, { ...fetchOptions, headers, signal: controller.signal });
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
                if (err.name === "AbortError") throw new Error(`Bot API timeout after ${this.requestTimeoutMs}ms: ${path}`);
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

    async getSystemJob(id) {
        const data = await this.request(`/bot-api/jobs/${encodeURIComponent(id)}`);
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

    async addCurrency(telegramId, currency, delta, type = "", detail = "") {
        return this.request(`/bot-api/users/${encodeURIComponent(telegramId)}/currency`, {
            method: "PATCH",
            body: JSON.stringify({ currency, delta, type, detail })
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

    async claimFreeExport(telegramId, bookId, format = "") {
        return this.request(`/bot-api/users/${encodeURIComponent(telegramId)}/export-free-claim`, {
            method: "POST",
            body: JSON.stringify({ book_id: bookId, format })
        });
    }

    async spendCurrency(telegramId, currency, amount, type = "spend", detail = "", source = "telegram_bot") {
        return this.request(`/bot-api/users/${encodeURIComponent(telegramId)}/spend`, {
            method: "POST",
            body: JSON.stringify({ currency, amount, type, detail, source })
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

    async getChapters(bookId, includeContent = false) {
        const suffix = includeContent ? "?includeContent=1" : "";
        return this.request(`/reader-api/books/${encodeURIComponent(bookId)}/chapters${suffix}`);
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
        return this.request(`/bot-api/users/${encodeURIComponent(telegramId)}/po18`);
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
