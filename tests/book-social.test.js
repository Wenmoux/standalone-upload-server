const assert = require("assert/strict");
const test = require("node:test");
const { createBookSocialService } = require("../services/book-social");

test("book social service normalizes feedback and reads counters", async () => {
    const calls = [];
    const service = createBookSocialService({
        normalizeTelegramId: (value) => String(value || "").trim(),
        query: async (sql, params = []) => {
            calls.push({ sql, params });
            if (/reader_book_feedback/.test(sql)) return { rows: [{ like_count: 2, dislike_count: 1, feedback_users: 3 }] };
            return { rows: [] };
        }
    });

    assert.equal(service.normalizeFeedback("LIKE"), "like");
    assert.equal(service.normalizeFeedback("\u4e0d\u559c\u6b22"), "dislike");
    assert.equal(service.normalizeFeedback("other"), "");

    const counts = await service.bookFeedbackCounts("b1");
    assert.deepEqual(counts, { like_count: 2, dislike_count: 1, feedback_users: 3 });
    assert.equal(calls[0].params[0], "b1");
});

test("book social service builds crowd summary and leaderboard", async () => {
    const calls = [];
    const service = createBookSocialService({
        normalizeTelegramId: (value) => String(value || "").trim(),
        query: async (sql, params = []) => {
            calls.push({ sql, params });
            if (/WHERE m\.book_id = \$1/.test(sql)) {
                return { rows: [{ book_id: params[0], supporter_count: 4, supported_by_me: true }] };
            }
            if (/COUNT\(DISTINCT book_id\)::int book_count/.test(sql)) {
                return { rows: [{ book_count: 2, vote_count: 5, total_silver: "99" }] };
            }
            return { rows: [{ book_id: "b2", rank: 1, supporter_count: 4 }] };
        }
    });

    const summary = await service.bookCrowdSummary("b1", " 100 ");
    assert.equal(summary.book_id, "b1");
    assert.equal(calls[0].params[1], "100");

    const leaderboard = await service.crowdLeaderboard(500, " 100 ");
    assert.equal(calls[1].params[0], 50);
    assert.equal(calls[1].params[1], "100");
    assert.equal(leaderboard.rows[0].book_id, "b2");
    assert.equal(leaderboard.total_books, 2);
    assert.equal(leaderboard.total_votes, 5);
    assert.equal(leaderboard.total_silver, 99);
});

test("book social service creates reviews and settles vote rewards", async () => {
    const users = new Map([
        [1, { id: 1, telegram_id: "100", username: "tg_100", nickname: "Author", telegram_username: "author", copper_coins: 200, silver_coins: 0, scholar_exp: 0, is_banned: false }],
        [2, { id: 2, telegram_id: "200", username: "tg_200", nickname: "Voter", telegram_username: "voter", copper_coins: 50, silver_coins: 0, scholar_exp: 0, is_banned: false }]
    ]);
    const reviews = [];
    const votes = new Map();
    const calls = [];
    const db = {
        async query(sql, params = []) {
            calls.push({ sql, params });
            if (/BEGIN|COMMIT|ROLLBACK/.test(sql)) return { rows: [] };
            if (/FROM reader_users WHERE telegram_id = \$1 FOR UPDATE/.test(sql)) {
                return { rows: [[...users.values()].find((user) => user.telegram_id === params[0]) ? [{ ...[...users.values()].find((user) => user.telegram_id === params[0]) }] : []].flat() };
            }
            if (/FROM reader_users WHERE id = \$1 FOR UPDATE/.test(sql)) {
                const user = users.get(Number(params[0]));
                return { rows: user ? [{ ...user }] : [] };
            }
            if (/FROM book_metadata/.test(sql) && !/reader_book_reviews/.test(sql)) {
                return { rows: [{ book_id: "b1", title: "Book One", author: "A", platform: "po18", detail_url: "" }] };
            }
            if (/UPDATE reader_users\s+SET copper_coins = COALESCE\(copper_coins, 0\) -/.test(sql)) {
                const cost = Number(params[0]);
                const user = users.get(Number(params[1]));
                user.copper_coins -= cost;
                return { rows: [{ ...user }] };
            }
            if (/UPDATE reader_users\s+SET copper_coins = GREATEST/.test(sql)) {
                const delta = Number(params[0]);
                const user = users.get(Number(params[1]));
                user.copper_coins = Math.max(0, user.copper_coins + delta);
                return { rows: [{ ...user }] };
            }
            if (/INSERT INTO reader_book_reviews/.test(sql)) {
                const review = {
                    id: reviews.length + 1,
                    user_id: params[0],
                    telegram_id: params[1],
                    telegram_username: params[2],
                    nickname: params[3],
                    book_id: params[4],
                    content: params[5],
                    publish_cost: params[6],
                    status: "published",
                    source: params[7],
                    created_at: "2026-06-20T00:00:00.000Z",
                    updated_at: "2026-06-20T00:00:00.000Z"
                };
                reviews.push(review);
                return { rows: [{ ...review }] };
            }
            if (/SELECT r\.\*\s+FROM reader_book_reviews r/.test(sql)) {
                const review = reviews.find((item) => item.id === Number(params[0]) && item.status === "published");
                return { rows: review ? [{ ...review }] : [] };
            }
            if (/FROM reader_book_reviews r/.test(sql) && /WHERE r\.id = \$1/.test(sql)) {
                const review = reviews.find((item) => item.id === Number(params[0]));
                if (!review) return { rows: [] };
                const author = users.get(Number(review.user_id)) || {};
                const reviewVotes = [...votes.values()].filter((vote) => vote.review_id === review.id);
                const myVote = reviewVotes.find((vote) => vote.user_id === Number(params[1]))?.vote || "";
                return {
                    rows: [{
                        ...review,
                        author_username: author.username,
                        author_nickname: author.nickname,
                        author_telegram_username: author.telegram_username,
                        like_count: reviewVotes.filter((vote) => vote.vote === "like").length,
                        dislike_count: reviewVotes.filter((vote) => vote.vote === "dislike").length,
                        my_vote: myVote,
                        book_title: "Book One",
                        book_author: "A",
                        book_platform: "po18"
                    }]
                };
            }
            if (/COUNT\(\*\)::int count\s+FROM reader_book_reviews/.test(sql)) {
                return { rows: [{ count: reviews.filter((review) => review.book_id === params[0]).length }] };
            }
            if (/WITH page AS/.test(sql) && /FROM reader_book_reviews/.test(sql)) {
                const rows = reviews
                    .filter((review) => review.book_id === params[0] && review.status === "published")
                    .map((review) => {
                        const author = users.get(Number(review.user_id)) || {};
                        const reviewVotes = [...votes.values()].filter((vote) => vote.review_id === review.id);
                        return {
                            ...review,
                            author_username: author.username,
                            author_nickname: author.nickname,
                            author_telegram_username: author.telegram_username,
                            like_count: reviewVotes.filter((vote) => vote.vote === "like").length,
                            dislike_count: reviewVotes.filter((vote) => vote.vote === "dislike").length,
                            my_vote: reviewVotes.find((vote) => vote.user_id === Number(params[3]))?.vote || "",
                            book_title: "Book One",
                            book_author: "A",
                            book_platform: "po18"
                        };
                    });
                return { rows };
            }
            if (/FROM reader_book_review_votes\s+WHERE review_id = \$1 AND user_id = \$2/.test(sql)) {
                const key = `${params[0]}:${params[1]}`;
                return { rows: votes.has(key) ? [{ ...votes.get(key) }] : [] };
            }
            if (/INSERT INTO reader_book_review_votes/.test(sql)) {
                const vote = { id: votes.size + 1, review_id: Number(params[0]), user_id: Number(params[1]), telegram_id: params[2], vote: params[3], reward_delta: Number(params[4]) };
                votes.set(`${params[0]}:${params[1]}`, vote);
                return { rows: [{ ...vote }] };
            }
            if (/UPDATE reader_book_review_votes/.test(sql)) {
                const vote = [...votes.values()].find((item) => item.id === Number(params[4]));
                vote.vote = params[0];
                vote.reward_delta = Number(params[1]);
                return { rows: [{ ...vote }] };
            }
            if (/INSERT INTO reader_transactions/.test(sql)) {
                return { rows: [{ id: calls.length, type: params[2], amount: params[3], balance: params[4] }] };
            }
            return { rows: [] };
        },
        release() {}
    };
    const service = createBookSocialService({
        query: db.query.bind(db),
        pool: { connect: async () => db },
        normalizeTelegramId: (value) => String(value || "").trim(),
        botUserSelect: () => "id, telegram_id, username, nickname, telegram_username, copper_coins, silver_coins, scholar_exp, is_banned",
        scholarProfile: () => ({ level: 2, name: "L2" }),
        reviewPublishCost: 100
    });

    const created = await service.createBookReview({ telegramId: "100", bookId: "b1", content: "这本书节奏很好，角色也站得住。" });
    assert.equal(created.review.book_id, "b1");
    assert.equal(users.get(1).copper_coins, 100);
    assert.equal(created.transaction.amount, -100);

    const liked = await service.voteBookReview({ telegramId: "200", reviewId: created.review.id, vote: "like" });
    assert.equal(liked.reward_delta, 100);
    assert.equal(liked.review.like_count, 1);
    assert.equal(users.get(1).copper_coins, 200);

    const repeated = await service.voteBookReview({ telegramId: "200", reviewId: created.review.id, vote: "like" });
    assert.equal(repeated.already_exists, true);
    assert.equal(repeated.reward_delta, 0);
    assert.equal(users.get(1).copper_coins, 200);

    const disliked = await service.voteBookReview({ telegramId: "200", reviewId: created.review.id, vote: "dislike" });
    assert.equal(disliked.reward_delta, -101);
    assert.equal(disliked.review.like_count, 0);
    assert.equal(disliked.review.dislike_count, 1);
    assert.equal(users.get(1).copper_coins, 99);

    const list = await service.listBookReviews("b1", { viewerUserId: 2 });
    assert.equal(list.total, 1);
    assert.equal(list.book.title, "Book One");
    assert.equal(list.book.author, "A");
    assert.equal(list.rows[0].my_vote, "dislike");
});
