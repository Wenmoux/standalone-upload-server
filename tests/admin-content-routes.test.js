/**
 * [INPUT]: 依赖 node:test、assert、相关生产模块及受控替身/夹具
 * [OUTPUT]: 提供管理端书籍、章节与 Reader/Bot 用户授权路由契约的自动化回归断言
 * [POS]: tests 的管理端内容与用户授权路由守卫，防止 owner 边界、审计原因和写入契约静默退化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const http = require("http");
const test = require("node:test");
const express = require("express");
const { createAdminContentRoutes } = require("../routes/admin-content");

async function withApp(router, fn, options = {}) {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        req.session = { adminUser: options.adminUser || { id: 1, username: "admin", role: "owner" } };
        next();
    });
    app.use(router);
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    try {
        await fn(`http://127.0.0.1:${port}`);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

function adminOnly(req, res, next) {
    if (req.get("X-Test-Admin") !== "1") return res.status(401).json({ error: "admin required" });
    next();
}

function baseDeps(overrides = {}) {
    return {
        requireAdmin: adminOnly,
        query: async () => ({ rows: [] }),
        pool: { connect: async () => ({ query: async () => ({ rows: [], rowCount: 0 }), release: () => {} }) },
        adminStatsCache: { at: 0, payload: null },
        ADMIN_STATS_CACHE_MS: 0,
        STARTED_AT: Date.now(),
        getFreshCache: () => null,
        setFreshCache: (cache, payload) => payload,
        normalizeCorrectionText: (value = "") => String(value),
        correctionCharLength: (value = "") => Array.from(String(value)).length,
        textFromHtml: (value = "") => String(value).replace(/<[^>]+>/g, ""),
        replaceTextAtCharOffset: () => ({ changed: false, value: "" }),
        replaceFirstText: () => ({ changed: false, value: "" }),
        cleanPgText: (value) => value,
        normalizeTelegramId: (value) => String(value || ""),
        botUserSelect: () => "id, username",
        publicAdminReaderUser: (user) => (user ? { id: user.id, username: user.username } : null),
        todayDateKey: () => "2026-06-05",
        listTransactions: async () => ({ total: 1, rows: [{ id: 1 }], limit: 20, offset: 0 }),
        crowdLeaderboard: async () => ({ rows: [{ book_id: "b1" }], total_books: 1, total_votes: 2, total_silver: 3 }),
        hashPassword: () => ({ salt: "salt", hash: "hash" }),
        nonNegativeInt: (value, fallback = 0) => Math.max(0, Number(value ?? fallback) || 0),
        recordTransaction: async () => null,
        addMembershipPatch: () => ({ permanent: true, expiresAt: null }),
        cdkDuration: () => ({ type: "7d", days: 7 }),
        csvCell: (value) => JSON.stringify(value ?? ""),
        generateCdkCode: () => "CDK-TEST",
        isCacheCountSort: () => false,
        bookOrder: () => "m.id DESC",
        logSlowSearch: () => {},
        slowSearchContext: () => ({}),
        upsertBook: async () => {},
        cleanPatch: () => ({ title: "Next" }),
        bookColumns: [],
        numericBookFields: new Set(),
        updateSql: () => ({ sql: "UPDATE book_metadata SET title=$1 WHERE id=$2 RETURNING *", params: ["Next", 1] }),
        recordEvent: async () => null,
        safeTxtFilename: (value) => String(value || "book"),
        buildBookTxt: () => "book text",
        chapterListOrderSql: () => "id ASC",
        chapterColumns: [],
        numericChapterFields: new Set(),
        saveChapter: async () => {},
        sendDirectMessage: async () => {},
        readerPublicUrl: "https://reader.example",
        ...overrides
    };
}

test("reader bot admin grants are owner-only, explicit and reasoned", async () => {
    const calls = [];
    let isAdmin = false;
    const router = createAdminContentRoutes(
        baseDeps({
            publicAdminReaderUser: (user) => user,
            query: async (sql, params = []) => {
                calls.push({ sql, params });
                if (/UPDATE reader_users SET is_admin=\$1/.test(sql)) {
                    isAdmin = params[0];
                    return { rows: [{ id: params[1], username: "reader", is_admin: isAdmin }] };
                }
                if (/SELECT id, telegram_id, copper_coins/.test(sql)) {
                    return { rows: [{ id: 42, telegram_id: "100", copper_coins: 0, silver_coins: 0, scholar_exp: 0 }] };
                }
                throw new Error(`unexpected SQL: ${sql}`);
            }
        })
    );

    await withApp(router, async (base) => {
        const missingReason = await fetch(`${base}/admin-api/users/42/admin`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", "X-Test-Admin": "1" },
            body: JSON.stringify({ is_admin: true })
        });
        assert.equal(missingReason.status, 400);

        const invalidFlag = await fetch(`${base}/admin-api/users/42/admin`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", "X-Test-Admin": "1" },
            body: JSON.stringify({ is_admin: 1, reason: "业务授权" })
        });
        assert.equal(invalidFlag.status, 400);

        const granted = await fetch(`${base}/admin-api/users/42/admin`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", "X-Test-Admin": "1" },
            body: JSON.stringify({ is_admin: true, reason: "负责 Bot 运营" })
        });
        assert.equal(granted.status, 200);
        assert.equal((await granted.json()).user.is_admin, true);

        const revoked = await fetch(`${base}/admin-api/users/42/admin`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", "X-Test-Admin": "1" },
            body: JSON.stringify({ is_admin: false, reason: "结束 Bot 运营" })
        });
        assert.equal(revoked.status, 200);
        assert.equal((await revoked.json()).user.is_admin, false);

        const piggyback = await fetch(`${base}/admin-api/users/42`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", "X-Test-Admin": "1" },
            body: JSON.stringify({ nickname: "reader", is_admin: true })
        });
        assert.equal(piggyback.status, 400);
        assert.match((await piggyback.json()).error, /专用授权接口/);
    });

    await withApp(
        router,
        async (base) => {
            const denied = await fetch(`${base}/admin-api/users/42/admin`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json", "X-Test-Admin": "1" },
                body: JSON.stringify({ is_admin: true, reason: "越权尝试" })
            });
            assert.equal(denied.status, 403);
            assert.match((await denied.json()).error, /owner/);
        },
        { adminUser: { id: 2, username: "operator", role: "operator" } }
    );

    assert.deepEqual(
        calls.filter((item) => /UPDATE reader_users SET is_admin/.test(item.sql)).map((item) => item.params),
        [
            [true, 42],
            [false, 42]
        ]
    );
});

test("admin content routes protect and expose cdks, transactions and crowd data", async () => {
    const router = createAdminContentRoutes(
        baseDeps({
            query: async (sql) => {
                if (/FROM reader_cdks/.test(sql)) return { rows: [{ id: 1, code: "A" }] };
                if (/FROM reader_search_requests/.test(sql) && /GROUP BY r\.query/.test(sql))
                    return { rows: [{ query: "missing", submit_count: 2, user_count: 1 }] };
                if (/FROM reader_search_requests/.test(sql) && /COUNT\(\*\)::int total/.test(sql))
                    return { rows: [{ total: 2, keywords: 1, users: 1, recent7d: 2, recent24h: 1 }] };
                return { rows: [] };
            }
        })
    );

    await withApp(router, async (base) => {
        const blocked = await fetch(`${base}/admin-api/cdks`);
        assert.equal(blocked.status, 401);

        const cdks = await fetch(`${base}/admin-api/cdks`, { headers: { "X-Test-Admin": "1" } });
        assert.deepEqual((await cdks.json()).rows, [{ id: 1, code: "A" }]);

        const tx = await fetch(`${base}/admin-api/transactions?page=2&limit=20`, { headers: { "X-Test-Admin": "1" } });
        assert.equal((await tx.json()).page, 2);

        const crowd = await fetch(`${base}/admin-api/book-crowd`, { headers: { "X-Test-Admin": "1" } });
        assert.equal((await crowd.json()).total_silver, 3);

        const requests = await fetch(`${base}/admin-api/search-requests`, { headers: { "X-Test-Admin": "1" } });
        const requestsBody = await requests.json();
        assert.equal(requestsBody.rows[0].query, "missing");
        assert.equal(requestsBody.summary.total, 2);
    });
});

test("admin search request workflow marks cached requests and notifies telegram users once", async () => {
    const sent = [];
    const updates = [];
    const router = createAdminContentRoutes(
        baseDeps({
            query: async (sql, params = []) => {
                updates.push({ sql, params });
                if (/RETURNING id, telegram_id/.test(sql)) {
                    return {
                        rows: [
                            { id: 1, telegram_id: "42", telegram_username: "reader", nickname: "读者", notified_at: null },
                            { id: 2, telegram_id: "42", telegram_username: "reader", nickname: "读者", notified_at: null }
                        ]
                    };
                }
                return { rows: [] };
            },
            sendDirectMessage: async (chatId, text, options) => sent.push({ chatId, text, options })
        })
    );

    await withApp(router, async (base) => {
        const response = await fetch(`${base}/admin-api/search-requests/resolve`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Test-Admin": "1" },
            body: JSON.stringify({
                query: "缺少的书",
                platform: "qidian",
                search_type: "search",
                status: "cached",
                book_id: "123",
                note: "已经缓存完成",
                notify: true
            })
        });
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.updated, 2);
        assert.equal(body.notification.sent, 1);
        assert.equal(sent.length, 1);
        assert.equal(sent[0].chatId, "42");
        assert.match(sent[0].text, /缺少的书/);
        assert.equal(sent[0].options.replyMarkup.inline_keyboard[0][0].url, "https://reader.example/#/detail?bid=123");
        assert.ok(updates.some((item) => /notified_at=CURRENT_TIMESTAMP/.test(item.sql)));
    });
});

test("admin content routes build stats, book list and stale cleanup preview", async () => {
    const calls = [];
    const router = createAdminContentRoutes(
        baseDeps({
            query: async (sql, params = []) => {
                calls.push({ sql, params });
                if (sql.includes("COUNT(*)::int metadata,") && sql.includes("COUNT(DISTINCT book_id)::int books"))
                    return {
                        rows: [{ metadata: 9, books: 4, metadata7d: 1, metadataUploaders: 2, platformsCount: 3, lastMetadataAt: "now" }]
                    };
                if (sql.includes("FROM book_stats") && sql.includes("SUM(cache_count)"))
                    return {
                        rows: [
                            {
                                chapters: 20,
                                cachedBooks: 3,
                                feedbackLikes: 1,
                                feedbackDislikes: 0,
                                crowdVotes: 2,
                                crowdBooks: 1,
                                crowdSilver: 100,
                                lastChapterAt: "now"
                            }
                        ]
                    };
                if (sql.includes("expected_chapters") && sql.includes('"completeBooks"')) return { rows: [{ completeBooks: 2 }] };
                if (/FROM chapter_cache\s*\) c/.test(sql))
                    return { rows: [{ chapters7d: 2, chapters24h: 1, chaptersToday: 1, uploaders: 3 }] };
                if (sql.includes("FROM upload_events") && sql.includes("COUNT(*)::int events"))
                    return { rows: [{ events: 5, events7d: 4, events24h: 1 }] };
                if (sql.includes("FROM reader_book_feedback") && sql.includes("COUNT(DISTINCT user_id)::int users"))
                    return { rows: [{ users: 1 }] };
                if (sql.includes("FROM reader_book_crowd_votes") && sql.includes("COUNT(DISTINCT user_id)::int users"))
                    return { rows: [{ users: 1 }] };
                if (sql.includes("FROM reader_corrections") && sql.includes("COUNT(*)::int total"))
                    return { rows: [{ total: 3, pending: 1, approved: 1, rejected: 1, users: 2 }] };
                if (/FROM reader_users/.test(sql) && /bot_users/.test(sql))
                    return {
                        rows: [
                            {
                                bot_users: 7,
                                bot_active_users: 6,
                                bot_signed_today: 2,
                                bot_signed_7d: 4,
                                bot_export_unlocked: 1,
                                bot_copper_total: 10,
                                bot_silver_total: 20
                            }
                        ]
                    };
                if (/FROM reader_transactions/.test(sql) && /botTransactions/.test(sql))
                    return { rows: [{ botTransactions: 8, botTransactions24h: 2, botTxUsers7d: 3 }] };
                if (/FROM reader_export_usage/.test(sql) && /botFreeExportUsersToday/.test(sql))
                    return { rows: [{ botFreeExportUsersToday: 2, botFreeExportBooksToday: 3 }] };
                if (/SELECT platform, COUNT/.test(sql)) return { rows: [{ platform: "po18", count: 4 }] };
                if (/WITH category_options/.test(sql))
                    return {
                        rows: [
                            { category: "言情", count: 70 },
                            { category: "无CP", count: 62 },
                            { category: "都市", count: 57 }
                        ]
                    };
                if (sql.includes("SELECT COUNT(*)::int count FROM book_metadata")) return { rows: [{ count: 2 }] };
                if (/WITH page_books/.test(sql)) return { rows: [{ id: 1, book_id: "b1" }] };
                if (/metadata_count/.test(sql)) return { rows: [{ metadata_count: 2, book_count: 1, chapter_count: 3 }] };
                if (/metadata_chapter_count/.test(sql)) return { rows: [{ id: 1, book_id: "b1" }] };
                return { rows: [] };
            }
        })
    );

    await withApp(router, async (base) => {
        const stats = await fetch(`${base}/admin-api/stats`, { headers: { "X-Test-Admin": "1" } });
        const statsBody = await stats.json();
        assert.equal(statsBody.books, 4);
        assert.equal(statsBody.cachedBooks, 3);
        assert.equal(statsBody.completeBooks, 2);
        assert.equal(statsBody.avgChaptersPerBook, 6.7);
        assert.equal(statsBody.botUsers, 7);

        const books = await fetch(`${base}/admin-api/books?q=a&category=%E7%8E%84%E5%B9%BB`, { headers: { "X-Test-Admin": "1" } });
        assert.equal((await books.json()).total, 2);

        const categories = await fetch(`${base}/admin-api/books/categories`, { headers: { "X-Test-Admin": "1" } });
        const categoriesBody = await categories.json();
        assert.deepEqual(
            categoriesBody.rows.map((row) => row.category),
            ["言情", "无CP", "都市"]
        );
        assert.equal(categoriesBody.categories.length, 22);

        const cleanup = await fetch(`${base}/admin-api/books/cleanup-stale/preview`, { headers: { "X-Test-Admin": "1" } });
        const cleanupBody = await cleanup.json();
        assert.equal(cleanupBody.metadataCount, 2);
        assert.equal(cleanupBody.sample[0].book_id, "b1");
    });

    const bookSearch = calls.find(
        (call) => /SELECT COUNT\(\*\)::int count FROM book_metadata/.test(call.sql) && /m\.category ILIKE/.test(call.sql)
    );
    assert.ok(bookSearch);
    assert.match(bookSearch.sql, /m\.tags ILIKE \$1 OR m\.category ILIKE \$1/);
    assert.match(bookSearch.sql, /regexp_split_to_table\(COALESCE\(m\.category, ''\), '\[,，、\/\|·\]\+'\)/);
    assert.match(bookSearch.sql, /LOWER\(BTRIM\(category_token\)\) = LOWER\(\$2\)/);
    assert.deepEqual(bookSearch.params, ["%a%", "玄幻"]);
    const categoryCall = calls.find((call) => /WITH category_options/.test(call.sql));
    assert.ok(categoryCall);
    assert.equal(categoryCall.params[0].length, 22);
    assert.deepEqual(categoryCall.params[0].slice(0, 3), ["言情", "无CP", "都市"]);
    assert.ok(calls.length >= 14);
});

test("admin stale cleanup writes through tracked system job when available", async () => {
    const tracked = [];
    const client = {
        query: async (sql) => {
            if (sql === "BEGIN" || sql === "COMMIT") return { rows: [], rowCount: 0 };
            if (sql.includes("FROM book_metadata") && sql.includes("ORDER BY") && sql.includes("metadata_chapter_count")) {
                return { rows: [{ id: 1, book_id: "b1", title: "Book", platform: "po18" }] };
            }
            if (sql.includes("DELETE FROM chapter_cache")) return { rows: [], rowCount: 3 };
            if (sql.includes("DELETE FROM book_metadata")) return { rows: [], rowCount: 1 };
            return { rows: [], rowCount: 0 };
        },
        release: () => {}
    };
    const router = createAdminContentRoutes(
        baseDeps({
            pool: { connect: async () => client },
            runTrackedJob: async (req, type, input, worker) => {
                tracked.push({ type, input });
                const payload = await worker();
                return { ...payload, job: { id: 5, type } };
            }
        })
    );

    await withApp(router, async (base) => {
        const response = await fetch(`${base}/admin-api/books/cleanup-stale`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Test-Admin": "1" },
            body: JSON.stringify({ confirm: true })
        });
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.deletedMetadata, 1);
        assert.equal(body.deletedChapters, 3);
        assert.equal(body.job.id, 5);
    });

    assert.deepEqual(tracked, [
        {
            type: "books_cleanup_stale",
            input: { platform: "po18", cutoff: "2025-01-01", maxChapterCount: 10 }
        }
    ]);
});

test("admin chapter bulk delete is scoped to the current book", async () => {
    const calls = [];
    const events = [];
    const router = createAdminContentRoutes(
        baseDeps({
            latestBookMetadata: async (bookId) => ({ book_id: bookId, title: "Book", platform: "po18" }),
            recordEvent: async (event) => events.push(event),
            query: async (sql, params = []) => {
                calls.push({ sql, params });
                if (/SELECT id, book_id, chapter_id/.test(sql)) {
                    return {
                        rows: [
                            { id: 1, book_id: "b1", chapter_id: "c1", title: "C1", platform: "po18" },
                            { id: 2, book_id: "b1", chapter_id: "c2", title: "C2", platform: "po18" }
                        ]
                    };
                }
                if (/DELETE FROM chapter_cache/.test(sql)) return { rows: [], rowCount: 2 };
                return { rows: [] };
            }
        })
    );

    await withApp(router, async (base) => {
        const blocked = await fetch(`${base}/admin-api/books/b1/chapters/bulk`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: [1] })
        });
        assert.equal(blocked.status, 401);

        const response = await fetch(`${base}/admin-api/books/b1/chapters/bulk`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json", "X-Test-Admin": "1" },
            body: JSON.stringify({ ids: [1, "2", "bad"], chapter_ids: ["c3", ""] })
        });
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.deleted, 2);
        assert.deepEqual(body.deletedIds, [1, 2]);
    });

    const selectCall = calls.find((call) => /SELECT id, book_id, chapter_id/.test(call.sql));
    assert.ok(selectCall);
    assert.match(selectCall.sql, /book_id = \$1 AND/);
    assert.deepEqual(selectCall.params, ["b1", [1, 2], ["c3"]]);
    assert.equal(events[0].action, "admin_delete_bulk");
    assert.equal(events[0].bookId, "b1");
    assert.equal(events[0].details.deleted, 2);
});

test("admin chapter structure routes merge duplicate volumes into order repair jobs", async () => {
    const tracked = [];
    const router = createAdminContentRoutes(
        baseDeps({
            previewChapterStructureRepairs: async () => ({
                rows: [{ book_id: "b1", affected_chapters: 2 }],
                orderRows: [{ book_id: "b1", affected_chapters: 2 }],
                duplicateVolumeRows: [{ book_id: "b1", duplicate_volumes: 1, duplicate_titles: ["正文卷"] }],
                duplicateVolumes: 1
            }),
            repairChapterStructure: async (input) => ({
                success: true,
                updatedChapters: 3,
                removedVolumes: 1,
                changedBooks: [{ book_id: "b1", removed_volumes: 1, updated_chapters: 1 }],
                input
            }),
            runTrackedJob: async (req, type, input, worker) => {
                tracked.push({ type, input });
                const payload = await worker();
                return { ...payload, job: { id: 6, type } };
            }
        })
    );

    await withApp(router, async (base) => {
        const preview = await fetch(`${base}/admin-api/chapters/repair-order/preview`, { headers: { "X-Test-Admin": "1" } });
        const previewBody = await preview.json();
        assert.equal(previewBody.rows[0].book_id, "b1");
        assert.equal(previewBody.duplicateVolumeRows[0].duplicate_titles[0], "正文卷");

        const missingConfirm = await fetch(`${base}/admin-api/chapters/repair-order`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Test-Admin": "1" },
            body: JSON.stringify({})
        });
        assert.equal(missingConfirm.status, 400);

        const repaired = await fetch(`${base}/admin-api/chapters/repair-order`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Test-Admin": "1" },
            body: JSON.stringify({ confirm: true, limit: 7 })
        });
        const body = await repaired.json();
        assert.equal(body.updatedChapters, 3);
        assert.equal(body.removedVolumes, 1);
        assert.equal(body.changedBooks[0].book_id, "b1");
        assert.equal(body.job.id, 6);
    });

    assert.deepEqual(tracked, [{ type: "chapters_repair_order", input: { limit: 7 } }]);
});

test("admin duplicate volume cleanup previews and returns changed books", async () => {
    const tracked = [];
    const router = createAdminContentRoutes(
        baseDeps({
            previewDuplicateVolumeCleanup: async () => ({
                rows: [{ book_id: "b1", duplicate_volumes: 1, duplicate_titles: ["正文卷"] }]
            }),
            cleanupDuplicateVolumes: async (input) => ({
                success: true,
                changedBookCount: 1,
                removedVolumes: 1,
                changedBooks: [{ book_id: "b1", title: "Book", removed_volumes: 1, removed_titles: ["正文卷"] }],
                input
            }),
            runTrackedJob: async (req, type, input, worker) => {
                tracked.push({ type, input });
                return { ...(await worker()), job: { id: 8, type } };
            }
        })
    );

    await withApp(router, async (base) => {
        const preview = await fetch(`${base}/admin-api/chapters/cleanup-duplicate-volumes/preview`, {
            headers: { "X-Test-Admin": "1" }
        });
        assert.equal((await preview.json()).rows[0].duplicate_titles[0], "正文卷");

        const missingConfirm = await fetch(`${base}/admin-api/chapters/cleanup-duplicate-volumes`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Test-Admin": "1" },
            body: JSON.stringify({})
        });
        assert.equal(missingConfirm.status, 400);

        const cleaned = await fetch(`${base}/admin-api/chapters/cleanup-duplicate-volumes`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Test-Admin": "1" },
            body: JSON.stringify({ confirm: true, limit: 9 })
        });
        const body = await cleaned.json();
        assert.equal(body.removedVolumes, 1);
        assert.equal(body.changedBooks[0].book_id, "b1");
        assert.equal(body.job.id, 8);
    });

    assert.deepEqual(tracked, [{ type: "chapters_cleanup_duplicate_volumes", input: { limit: 9 } }]);
});
