const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { Pool } = require("pg");

const PG_URL =
    process.env.PO18_PG_URL ||
    "postgres://po18:po18-change-me@127.0.0.1:5432/po18";

const pool = new Pool({
    connectionString: PG_URL,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
});

const MIGRATIONS_DIR = path.join(__dirname, "db", "migrations");
const ROLLBACKS_DIR = path.join(__dirname, "db", "rollbacks");
const MIGRATION_LOCK_KEY = 182018;

const bookColumns = [
    "id",
    "book_id",
    "title",
    "author",
    "cover",
    "description",
    "tags",
    "category",
    "word_count",
    "chapter_count",
    "status",
    "detail_url",
    "created_at",
    "updated_at",
    "total_chapters",
    "subscribed_chapters",
    "free_chapters",
    "paid_chapters",
    "latest_chapter_name",
    "latest_chapter_date",
    "platform",
    "favorites_count",
    "comments_count",
    "monthly_popularity",
    "total_popularity",
    "uploader",
    "uploaderId",
    "description_html",
    "weekly_popularity",
    "readers_count",
    "daily_popularity",
    "purchase_count"
];

const chapterColumns = [
    "id",
    "book_id",
    "chapter_id",
    "title",
    "html",
    "text",
    "created_at",
    "updated_at",
    "chapter_order",
    "uploader",
    "uploaderId",
    "platform",
    "is_volume"
];

function placeholders(values, start = 1) {
    return values.map((_, index) => `$${start + index}`).join(", ");
}

function pick(data, columns) {
    const out = {};
    for (const key of columns) {
        if (data[key] !== undefined) out[key] = data[key];
    }
    return out;
}

async function query(sql, params = []) {
    return pool.query(sql, params);
}

async function listMigrationFiles() {
    let entries = [];
    try {
        entries = await fs.readdir(MIGRATIONS_DIR, { withFileTypes: true });
    } catch (err) {
        if (err.code === "ENOENT") return [];
        throw err;
    }
    return entries
        .filter((entry) => entry.isFile() && /^\d+_.+\.sql$/i.test(entry.name))
        .map((entry) => ({
            file: entry.name,
            version: entry.name.replace(/\.sql$/i, ""),
            name: entry.name.replace(/^\d+_/, "").replace(/\.sql$/i, ""),
            path: path.join(MIGRATIONS_DIR, entry.name)
        }))
        .sort((a, b) => a.version.localeCompare(b.version, "en"));
}

async function listRollbackFiles() {
    let entries = [];
    try {
        entries = await fs.readdir(ROLLBACKS_DIR, { withFileTypes: true });
    } catch (err) {
        if (err.code === "ENOENT") return [];
        throw err;
    }
    return entries
        .filter((entry) => entry.isFile() && /^\d+_.+\.down\.sql$/i.test(entry.name))
        .map((entry) => ({
            file: entry.name,
            version: entry.name.replace(/\.down\.sql$/i, ""),
            name: entry.name.replace(/^\d+_/, "").replace(/\.down\.sql$/i, ""),
            path: path.join(ROLLBACKS_DIR, entry.name)
        }))
        .sort((a, b) => a.version.localeCompare(b.version, "en"));
}

function checksumSql(sql) {
    return crypto.createHash("sha256").update(sql).digest("hex");
}

async function ensureSchemaMigrations(client) {
    await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version TEXT PRIMARY KEY,
            name TEXT NOT NULL DEFAULT '',
            checksum TEXT NOT NULL DEFAULT '',
            applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            duration_ms INTEGER NOT NULL DEFAULT 0
        )
    `);
}

async function runMigrations() {
    const client = await pool.connect();
    try {
        await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
        await ensureSchemaMigrations(client);
        const files = await listMigrationFiles();
        const appliedResult = await client.query("SELECT version, checksum FROM schema_migrations");
        const applied = new Map(appliedResult.rows.map((row) => [row.version, row.checksum]));
        const executed = [];

        for (const migration of files) {
            const sql = await fs.readFile(migration.path, "utf8");
            const checksum = checksumSql(sql);
            if (applied.has(migration.version)) {
                const existingChecksum = applied.get(migration.version);
                if (existingChecksum && existingChecksum !== checksum) {
                    console.warn(`[pg-migrate] checksum changed for ${migration.version}; keeping existing applied record`);
                }
                continue;
            }

            const started = Date.now();
            await client.query("BEGIN");
            try {
                await client.query(sql);
                await client.query(
                    `INSERT INTO schema_migrations(version, name, checksum, duration_ms)
                     VALUES ($1, $2, $3, $4)`,
                    [migration.version, migration.name, checksum, Date.now() - started]
                );
                await client.query("COMMIT");
                executed.push(migration.version);
                console.log(`[pg-migrate] applied ${migration.version}`);
            } catch (err) {
                await client.query("ROLLBACK");
                throw err;
            }
        }

        return {
            ok: true,
            executed,
            latest: files[files.length - 1]?.version || "",
            total: files.length
        };
    } finally {
        await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]).catch(() => {});
        client.release();
    }
}

async function runMigrationRollback({ steps = 1, toVersion = "", confirm = "" } = {}) {
    if (process.env.PO18_ALLOW_SCHEMA_ROLLBACK !== "1") {
        throw new Error("schema rollback is disabled; set PO18_ALLOW_SCHEMA_ROLLBACK=1 to continue");
    }
    if (String(confirm || "") !== "ROLLBACK") {
        throw new Error("schema rollback requires confirm=ROLLBACK");
    }

    const safeSteps = Math.max(1, Math.min(50, Number(steps || 1)));
    const targetVersion = String(toVersion || "").trim();
    const client = await pool.connect();
    try {
        await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
        await ensureSchemaMigrations(client);
        const appliedResult = await client.query("SELECT version, name FROM schema_migrations ORDER BY version DESC");
        const rollbackFiles = await listRollbackFiles();
        const rollbackByVersion = new Map(rollbackFiles.map((file) => [file.version, file]));
        const targets = [];

        for (const row of appliedResult.rows || []) {
            if (targetVersion && row.version <= targetVersion) break;
            if (!targetVersion && targets.length >= safeSteps) break;
            targets.push(row);
        }

        if (!targets.length) return [];

        const rolledBack = [];
        for (const row of targets) {
            const rollback = rollbackByVersion.get(row.version);
            if (!rollback) throw new Error(`missing rollback file for ${row.version}`);
            const sql = await fs.readFile(rollback.path, "utf8");
            const started = Date.now();
            await client.query("BEGIN");
            try {
                await client.query(sql);
                await client.query("DELETE FROM schema_migrations WHERE version = $1", [row.version]);
                await client.query("COMMIT");
                rolledBack.push({
                    version: row.version,
                    name: row.name || rollback.name,
                    file: rollback.file,
                    durationMs: Date.now() - started
                });
                console.log(`[pg-migrate] rolled back ${row.version}`);
            } catch (err) {
                await client.query("ROLLBACK").catch(() => {});
                throw err;
            }
        }

        return rolledBack;
    } finally {
        await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]).catch(() => {});
        client.release();
    }
}

async function initPg() {
    await query(`
        CREATE EXTENSION IF NOT EXISTS pg_trgm;

        CREATE TABLE IF NOT EXISTS book_metadata (
            id BIGSERIAL PRIMARY KEY,
            book_id TEXT NOT NULL,
            title TEXT NOT NULL DEFAULT '',
            author TEXT DEFAULT '',
            cover TEXT DEFAULT '',
            description TEXT DEFAULT '',
            tags TEXT DEFAULT '',
            category TEXT DEFAULT '',
            word_count INTEGER DEFAULT 0,
            chapter_count INTEGER DEFAULT 0,
            status TEXT DEFAULT 'unknown',
            detail_url TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            total_chapters INTEGER DEFAULT 0,
            subscribed_chapters INTEGER DEFAULT 0,
            free_chapters INTEGER DEFAULT 0,
            paid_chapters INTEGER DEFAULT 0,
            latest_chapter_name TEXT,
            latest_chapter_date TEXT,
            platform TEXT DEFAULT 'po18',
            favorites_count INTEGER DEFAULT 0,
            comments_count INTEGER DEFAULT 0,
            monthly_popularity INTEGER DEFAULT 0,
            total_popularity INTEGER DEFAULT 0,
            uploader TEXT DEFAULT 'unknown_user',
            "uploaderId" TEXT DEFAULT 'unknown',
            description_html TEXT,
            weekly_popularity INTEGER DEFAULT 0,
            readers_count INTEGER DEFAULT 0,
            daily_popularity INTEGER DEFAULT 0,
            purchase_count INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS chapter_cache (
            id BIGSERIAL PRIMARY KEY,
            book_id TEXT NOT NULL,
            chapter_id TEXT NOT NULL,
            title TEXT,
            html TEXT,
            text TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            chapter_order INTEGER DEFAULT 0,
            uploader TEXT DEFAULT 'unknown_user',
            "uploaderId" TEXT DEFAULT 'unknown',
            platform TEXT DEFAULT 'po18',
            is_volume BOOLEAN DEFAULT FALSE,
            UNIQUE(book_id, chapter_id)
        );

        CREATE TABLE IF NOT EXISTS admin_users (
            id BIGSERIAL PRIMARY KEY,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            salt TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_login_at TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS admin_config (
            key TEXT PRIMARY KEY,
            value TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS upload_events (
            id BIGSERIAL PRIMARY KEY,
            event_type TEXT NOT NULL,
            action TEXT NOT NULL,
            book_id TEXT,
            chapter_id TEXT,
            title TEXT,
            platform TEXT,
            source TEXT,
            uploader TEXT,
            uploader_id TEXT,
            details JSONB DEFAULT '{}'::jsonb,
            telegram_status TEXT DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS reader_users (
            id BIGSERIAL PRIMARY KEY,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            salt TEXT NOT NULL,
            nickname TEXT DEFAULT '',
            avatar_url TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_login_at TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS reader_bookshelf (
            id BIGSERIAL PRIMARY KEY,
            user_id BIGINT NOT NULL REFERENCES reader_users(id) ON DELETE CASCADE,
            book_id TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, book_id)
        );

        CREATE TABLE IF NOT EXISTS reader_history (
            id BIGSERIAL PRIMARY KEY,
            user_id BIGINT NOT NULL REFERENCES reader_users(id) ON DELETE CASCADE,
            book_id TEXT NOT NULL,
            chapter_id TEXT NOT NULL,
            progress NUMERIC DEFAULT 0,
            reading_seconds INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, book_id)
        );

        CREATE TABLE IF NOT EXISTS reader_book_feedback (
            id BIGSERIAL PRIMARY KEY,
            user_id BIGINT NOT NULL REFERENCES reader_users(id) ON DELETE CASCADE,
            telegram_id TEXT DEFAULT '',
            book_id TEXT NOT NULL,
            feedback TEXT NOT NULL,
            source TEXT DEFAULT 'info',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, book_id, feedback)
        );

        CREATE TABLE IF NOT EXISTS reader_search_requests (
            id BIGSERIAL PRIMARY KEY,
            user_id BIGINT REFERENCES reader_users(id) ON DELETE SET NULL,
            telegram_id TEXT DEFAULT '',
            telegram_username TEXT DEFAULT '',
            nickname TEXT DEFAULT '',
            query TEXT NOT NULL,
            clean_query TEXT DEFAULT '',
            search_type TEXT DEFAULT 'search',
            platform TEXT DEFAULT '',
            result_count INTEGER DEFAULT 0,
            source TEXT DEFAULT 'telegram_bot',
            status TEXT DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, query, platform, search_type)
        );

        CREATE TABLE IF NOT EXISTS reader_book_crowd_votes (
            id BIGSERIAL PRIMARY KEY,
            user_id BIGINT NOT NULL REFERENCES reader_users(id) ON DELETE CASCADE,
            telegram_id TEXT DEFAULT '',
            book_id TEXT NOT NULL,
            vote_cost INTEGER NOT NULL DEFAULT 100,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS reader_book_reviews (
            id BIGSERIAL PRIMARY KEY,
            user_id BIGINT REFERENCES reader_users(id) ON DELETE SET NULL,
            telegram_id TEXT DEFAULT '',
            telegram_username TEXT DEFAULT '',
            nickname TEXT DEFAULT '',
            book_id TEXT NOT NULL,
            content TEXT NOT NULL,
            publish_cost INTEGER NOT NULL DEFAULT 100,
            status TEXT NOT NULL DEFAULT 'published',
            source TEXT DEFAULT 'telegram_bot',
            channel_chat_id TEXT DEFAULT '',
            channel_message_id TEXT DEFAULT '',
            channel_status TEXT DEFAULT 'pending',
            channel_error TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS reader_book_review_votes (
            id BIGSERIAL PRIMARY KEY,
            review_id BIGINT NOT NULL REFERENCES reader_book_reviews(id) ON DELETE CASCADE,
            user_id BIGINT REFERENCES reader_users(id) ON DELETE SET NULL,
            telegram_id TEXT DEFAULT '',
            vote TEXT NOT NULL,
            reward_delta INTEGER NOT NULL DEFAULT 0,
            source TEXT DEFAULT 'telegram_bot',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(review_id, user_id)
        );

        CREATE TABLE IF NOT EXISTS reader_corrections (
            id BIGSERIAL PRIMARY KEY,
            user_id BIGINT REFERENCES reader_users(id) ON DELETE SET NULL,
            book_id TEXT NOT NULL,
            chapter_id TEXT NOT NULL,
            book_title TEXT DEFAULT '',
            chapter_title TEXT DEFAULT '',
            original_text TEXT NOT NULL,
            corrected_text TEXT NOT NULL,
            original_length INTEGER NOT NULL DEFAULT 0,
            corrected_length INTEGER NOT NULL DEFAULT 0,
            start_offset INTEGER,
            end_offset INTEGER,
            status TEXT NOT NULL DEFAULT 'pending',
            review_note TEXT DEFAULT '',
            reviewed_by TEXT DEFAULT '',
            reviewed_at TIMESTAMP,
            applied_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS reader_transactions (
            id BIGSERIAL PRIMARY KEY,
            user_id BIGINT REFERENCES reader_users(id) ON DELETE SET NULL,
            telegram_id TEXT DEFAULT '',
            type TEXT NOT NULL DEFAULT '',
            currency TEXT NOT NULL DEFAULT 'copper',
            amount INTEGER NOT NULL DEFAULT 0,
            balance INTEGER NOT NULL DEFAULT 0,
            detail TEXT DEFAULT '',
            source TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS reader_export_usage (
            id BIGSERIAL PRIMARY KEY,
            user_id BIGINT NOT NULL REFERENCES reader_users(id) ON DELETE CASCADE,
            telegram_id TEXT DEFAULT '',
            book_id TEXT NOT NULL,
            format TEXT DEFAULT '',
            charge_type TEXT NOT NULL DEFAULT 'free_quota',
            export_date DATE NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, export_date, book_id, charge_type)
        );

        CREATE TABLE IF NOT EXISTS reader_red_packets (
            id BIGSERIAL PRIMARY KEY,
            sender_user_id BIGINT NOT NULL REFERENCES reader_users(id) ON DELETE CASCADE,
            sender_telegram_id TEXT DEFAULT '',
            target_telegram_id TEXT DEFAULT '',
            chat_id TEXT NOT NULL DEFAULT '',
            currency TEXT NOT NULL DEFAULT 'copper',
            total_amount INTEGER NOT NULL,
            total_count INTEGER NOT NULL DEFAULT 1,
            claimed_count INTEGER NOT NULL DEFAULT 0,
            claimed_amount INTEGER NOT NULL DEFAULT 0,
            remaining_count INTEGER NOT NULL,
            remaining_amount INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'open',
            note TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            expired_at TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS reader_red_packet_claims (
            id BIGSERIAL PRIMARY KEY,
            packet_id BIGINT NOT NULL REFERENCES reader_red_packets(id) ON DELETE CASCADE,
            user_id BIGINT NOT NULL REFERENCES reader_users(id) ON DELETE CASCADE,
            telegram_id TEXT DEFAULT '',
            amount INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(packet_id, user_id)
        );

        CREATE TABLE IF NOT EXISTS reader_po18_accounts (
            user_id BIGINT PRIMARY KEY REFERENCES reader_users(id) ON DELETE CASCADE,
            telegram_id TEXT DEFAULT '',
            account TEXT DEFAULT '',
            password TEXT DEFAULT '',
            cookies_json JSONB DEFAULT '[]'::jsonb,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_login_at TIMESTAMP,
            last_status TEXT DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS reader_cdks (
            id BIGSERIAL PRIMARY KEY,
            code TEXT NOT NULL UNIQUE,
            duration_type TEXT NOT NULL,
            duration_days INTEGER DEFAULT 0,
            used_by BIGINT REFERENCES reader_users(id) ON DELETE SET NULL,
            used_at TIMESTAMP,
            created_by TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        ALTER TABLE reader_users ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT '';
        ALTER TABLE reader_users ADD COLUMN IF NOT EXISTS membership_expires_at TIMESTAMP;
        ALTER TABLE reader_users ADD COLUMN IF NOT EXISTS membership_permanent BOOLEAN DEFAULT FALSE;
        ALTER TABLE reader_users ADD COLUMN IF NOT EXISTS library_access BOOLEAN DEFAULT TRUE;
        ALTER TABLE reader_users ADD COLUMN IF NOT EXISTS copper_coins INTEGER DEFAULT 0;
        ALTER TABLE reader_users ADD COLUMN IF NOT EXISTS silver_coins INTEGER DEFAULT 0;
        ALTER TABLE reader_users ADD COLUMN IF NOT EXISTS sign_cycle_day INTEGER DEFAULT 0;
        ALTER TABLE reader_users ADD COLUMN IF NOT EXISTS last_sign_date DATE;
        ALTER TABLE reader_users ADD COLUMN IF NOT EXISTS telegram_id TEXT;
        ALTER TABLE reader_users ADD COLUMN IF NOT EXISTS telegram_username TEXT DEFAULT '';
        ALTER TABLE reader_users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;
        ALTER TABLE reader_users ADD COLUMN IF NOT EXISTS is_banned BOOLEAN DEFAULT FALSE;
        ALTER TABLE reader_users ADD COLUMN IF NOT EXISTS invite_count INTEGER DEFAULT 0;
        ALTER TABLE reader_users ADD COLUMN IF NOT EXISTS inviter_telegram_id TEXT DEFAULT '';
        ALTER TABLE reader_users ADD COLUMN IF NOT EXISTS export_unlocked_at TIMESTAMP;
        ALTER TABLE reader_users ADD COLUMN IF NOT EXISTS scholar_exp INTEGER DEFAULT 0;
        ALTER TABLE chapter_cache ADD COLUMN IF NOT EXISTS is_volume BOOLEAN DEFAULT FALSE;
        UPDATE chapter_cache SET is_volume = FALSE WHERE is_volume IS NULL;
        ALTER TABLE reader_history ADD COLUMN IF NOT EXISTS reading_seconds INTEGER DEFAULT 0;
        ALTER TABLE reader_book_crowd_votes ADD COLUMN IF NOT EXISTS telegram_id TEXT DEFAULT '';
        ALTER TABLE reader_book_crowd_votes ADD COLUMN IF NOT EXISTS vote_cost INTEGER DEFAULT 100;
        ALTER TABLE reader_book_reviews ADD COLUMN IF NOT EXISTS telegram_id TEXT DEFAULT '';
        ALTER TABLE reader_book_reviews ADD COLUMN IF NOT EXISTS telegram_username TEXT DEFAULT '';
        ALTER TABLE reader_book_reviews ADD COLUMN IF NOT EXISTS nickname TEXT DEFAULT '';
        ALTER TABLE reader_book_reviews ADD COLUMN IF NOT EXISTS publish_cost INTEGER DEFAULT 100;
        ALTER TABLE reader_book_reviews ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'published';
        ALTER TABLE reader_book_reviews ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'telegram_bot';
        ALTER TABLE reader_book_reviews ADD COLUMN IF NOT EXISTS channel_chat_id TEXT DEFAULT '';
        ALTER TABLE reader_book_reviews ADD COLUMN IF NOT EXISTS channel_message_id TEXT DEFAULT '';
        ALTER TABLE reader_book_reviews ADD COLUMN IF NOT EXISTS channel_status TEXT DEFAULT 'pending';
        ALTER TABLE reader_book_reviews ADD COLUMN IF NOT EXISTS channel_error TEXT DEFAULT '';
        ALTER TABLE reader_book_reviews ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
        ALTER TABLE reader_book_review_votes ADD COLUMN IF NOT EXISTS telegram_id TEXT DEFAULT '';
        ALTER TABLE reader_book_review_votes ADD COLUMN IF NOT EXISTS reward_delta INTEGER DEFAULT 0;
        ALTER TABLE reader_book_review_votes ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'telegram_bot';
        ALTER TABLE reader_book_review_votes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
        ALTER TABLE reader_search_requests ADD COLUMN IF NOT EXISTS clean_query TEXT DEFAULT '';
        ALTER TABLE reader_search_requests ADD COLUMN IF NOT EXISTS search_type TEXT DEFAULT 'search';
        ALTER TABLE reader_search_requests ADD COLUMN IF NOT EXISTS platform TEXT DEFAULT '';
        ALTER TABLE reader_search_requests ADD COLUMN IF NOT EXISTS result_count INTEGER DEFAULT 0;
        ALTER TABLE reader_search_requests ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'telegram_bot';
        ALTER TABLE reader_search_requests ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
        ALTER TABLE reader_corrections ADD COLUMN IF NOT EXISTS start_offset INTEGER;
        ALTER TABLE reader_corrections ADD COLUMN IF NOT EXISTS end_offset INTEGER;

        ALTER TABLE book_metadata DROP CONSTRAINT IF EXISTS book_metadata_book_id_subscribed_chapters_key;
        DROP INDEX IF EXISTS idx_pg_book_metadata_platform_book_id;

        WITH ranked AS (
            SELECT
                id,
                FIRST_VALUE(id) OVER (
                    PARTITION BY platform, book_id
                    ORDER BY
                        GREATEST(
                            COALESCE(total_chapters, 0),
                            COALESCE(subscribed_chapters, 0),
                            COALESCE(chapter_count, 0)
                        ) DESC,
                        COALESCE(updated_at, created_at) DESC,
                        id DESC
                ) AS keep_id
            FROM book_metadata
        ),
        merged AS (
            SELECT
                r.keep_id,
                MAX(NULLIF(m.title, '')) AS title,
                MAX(NULLIF(m.author, '')) AS author,
                MAX(NULLIF(m.cover, '')) AS cover,
                MAX(NULLIF(m.description, '')) AS description,
                MAX(NULLIF(m.tags, '')) AS tags,
                MAX(NULLIF(m.category, '')) AS category,
                MAX(COALESCE(m.word_count, 0)) AS word_count,
                MAX(COALESCE(m.chapter_count, 0)) AS chapter_count,
                MAX(NULLIF(m.status, 'unknown')) AS status,
                MAX(NULLIF(m.detail_url, '')) AS detail_url,
                MIN(m.created_at) AS created_at,
                MAX(m.updated_at) AS updated_at,
                MAX(COALESCE(m.total_chapters, 0)) AS total_chapters,
                MAX(COALESCE(m.subscribed_chapters, 0)) AS subscribed_chapters,
                MAX(COALESCE(m.free_chapters, 0)) AS free_chapters,
                MAX(COALESCE(m.paid_chapters, 0)) AS paid_chapters,
                MAX(NULLIF(m.latest_chapter_name, '')) AS latest_chapter_name,
                MAX(NULLIF(m.latest_chapter_date, '')) AS latest_chapter_date,
                MAX(COALESCE(m.favorites_count, 0)) AS favorites_count,
                MAX(COALESCE(m.comments_count, 0)) AS comments_count,
                MAX(COALESCE(m.monthly_popularity, 0)) AS monthly_popularity,
                MAX(COALESCE(m.total_popularity, 0)) AS total_popularity,
                MAX(NULLIF(m.uploader, 'unknown_user')) AS uploader,
                MAX(NULLIF(m."uploaderId", 'unknown')) AS "uploaderId",
                MAX(NULLIF(m.description_html, '')) AS description_html,
                MAX(COALESCE(m.weekly_popularity, 0)) AS weekly_popularity,
                MAX(COALESCE(m.readers_count, 0)) AS readers_count,
                MAX(COALESCE(m.daily_popularity, 0)) AS daily_popularity,
                MAX(COALESCE(m.purchase_count, 0)) AS purchase_count
            FROM ranked r
            JOIN book_metadata m ON m.id = r.id
            GROUP BY r.keep_id
        )
        UPDATE book_metadata b
        SET
            title = COALESCE(merged.title, b.title, ''),
            author = COALESCE(merged.author, b.author, ''),
            cover = COALESCE(merged.cover, b.cover, ''),
            description = COALESCE(merged.description, b.description, ''),
            tags = COALESCE(merged.tags, b.tags, ''),
            category = COALESCE(merged.category, b.category, ''),
            word_count = merged.word_count,
            chapter_count = merged.chapter_count,
            status = COALESCE(merged.status, b.status, 'unknown'),
            detail_url = COALESCE(merged.detail_url, b.detail_url),
            created_at = merged.created_at,
            updated_at = merged.updated_at,
            total_chapters = merged.total_chapters,
            subscribed_chapters = merged.subscribed_chapters,
            free_chapters = merged.free_chapters,
            paid_chapters = merged.paid_chapters,
            latest_chapter_name = COALESCE(merged.latest_chapter_name, b.latest_chapter_name),
            latest_chapter_date = COALESCE(merged.latest_chapter_date, b.latest_chapter_date),
            favorites_count = merged.favorites_count,
            comments_count = merged.comments_count,
            monthly_popularity = merged.monthly_popularity,
            total_popularity = merged.total_popularity,
            uploader = COALESCE(merged.uploader, b.uploader, 'unknown_user'),
            "uploaderId" = COALESCE(merged."uploaderId", b."uploaderId", 'unknown'),
            description_html = COALESCE(merged.description_html, b.description_html),
            weekly_popularity = merged.weekly_popularity,
            readers_count = merged.readers_count,
            daily_popularity = merged.daily_popularity,
            purchase_count = merged.purchase_count
        FROM merged
        WHERE b.id = merged.keep_id;

        WITH ranked AS (
            SELECT
                id,
                FIRST_VALUE(id) OVER (
                    PARTITION BY platform, book_id
                    ORDER BY
                        GREATEST(
                            COALESCE(total_chapters, 0),
                            COALESCE(subscribed_chapters, 0),
                            COALESCE(chapter_count, 0)
                        ) DESC,
                        COALESCE(updated_at, created_at) DESC,
                        id DESC
                ) AS keep_id
            FROM book_metadata
        )
        DELETE FROM book_metadata b
        USING ranked r
        WHERE b.id = r.id AND r.id <> r.keep_id;

        CREATE INDEX IF NOT EXISTS idx_reader_cdks_code ON reader_cdks(code);
        CREATE INDEX IF NOT EXISTS idx_reader_cdks_used_by ON reader_cdks(used_by);

        CREATE INDEX IF NOT EXISTS idx_reader_bookshelf_user ON reader_bookshelf(user_id, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_reader_history_user ON reader_history(user_id, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_reader_book_feedback_book ON reader_book_feedback(book_id, feedback);
        CREATE INDEX IF NOT EXISTS idx_reader_book_feedback_user ON reader_book_feedback(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_reader_book_feedback_telegram ON reader_book_feedback(telegram_id, created_at DESC);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_reader_book_crowd_votes_user_book ON reader_book_crowd_votes(user_id, book_id);
        CREATE INDEX IF NOT EXISTS idx_reader_book_crowd_votes_book ON reader_book_crowd_votes(book_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_reader_book_crowd_votes_user ON reader_book_crowd_votes(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_reader_book_crowd_votes_telegram ON reader_book_crowd_votes(telegram_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_reader_book_reviews_book ON reader_book_reviews(book_id, status, created_at DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_reader_book_reviews_user ON reader_book_reviews(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_reader_book_reviews_telegram ON reader_book_reviews(telegram_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_reader_book_review_votes_review ON reader_book_review_votes(review_id, vote);
        CREATE INDEX IF NOT EXISTS idx_reader_book_review_votes_user ON reader_book_review_votes(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_reader_search_requests_query ON reader_search_requests(query, platform, search_type);
        CREATE INDEX IF NOT EXISTS idx_reader_search_requests_status ON reader_search_requests(status, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_reader_search_requests_user ON reader_search_requests(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_reader_search_requests_telegram ON reader_search_requests(telegram_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_reader_corrections_status ON reader_corrections(status, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_reader_corrections_book_chapter ON reader_corrections(book_id, chapter_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_reader_corrections_user ON reader_corrections(user_id, created_at DESC);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_reader_users_telegram_id ON reader_users(telegram_id);
        CREATE INDEX IF NOT EXISTS idx_reader_users_telegram_username ON reader_users(telegram_username);
        CREATE INDEX IF NOT EXISTS idx_reader_transactions_user ON reader_transactions(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_reader_transactions_telegram ON reader_transactions(telegram_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_reader_transactions_created ON reader_transactions(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_reader_transactions_type ON reader_transactions(type);
        CREATE INDEX IF NOT EXISTS idx_reader_export_usage_user_date ON reader_export_usage(user_id, export_date DESC);
        CREATE INDEX IF NOT EXISTS idx_reader_export_usage_telegram_date ON reader_export_usage(telegram_id, export_date DESC);
        CREATE INDEX IF NOT EXISTS idx_reader_red_packets_chat ON reader_red_packets(chat_id, status, id);
        CREATE INDEX IF NOT EXISTS idx_reader_red_packets_sender ON reader_red_packets(sender_user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_reader_red_packet_claims_packet ON reader_red_packet_claims(packet_id);
        CREATE INDEX IF NOT EXISTS idx_reader_red_packet_claims_user ON reader_red_packet_claims(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_reader_po18_accounts_telegram ON reader_po18_accounts(telegram_id);

        CREATE INDEX IF NOT EXISTS idx_pg_book_metadata_book_id ON book_metadata(book_id);
        CREATE INDEX IF NOT EXISTS idx_pg_book_metadata_platform ON book_metadata(platform);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_pg_book_metadata_platform_book_id ON book_metadata(platform, book_id);
        CREATE INDEX IF NOT EXISTS idx_pg_book_metadata_updated ON book_metadata(updated_at);
        CREATE INDEX IF NOT EXISTS idx_pg_book_metadata_effective_updated ON book_metadata((COALESCE(updated_at, created_at)));
        CREATE INDEX IF NOT EXISTS idx_pg_book_metadata_uploader_identity ON book_metadata((COALESCE(NULLIF("uploaderId", ''), uploader)));
        CREATE INDEX IF NOT EXISTS idx_pg_book_metadata_popularity ON book_metadata(total_popularity);
        CREATE INDEX IF NOT EXISTS idx_pg_book_metadata_book_id_trgm ON book_metadata USING GIN (book_id gin_trgm_ops);
        CREATE INDEX IF NOT EXISTS idx_pg_book_metadata_title_trgm ON book_metadata USING GIN (title gin_trgm_ops);
        CREATE INDEX IF NOT EXISTS idx_pg_book_metadata_author_trgm ON book_metadata USING GIN (author gin_trgm_ops);
        CREATE INDEX IF NOT EXISTS idx_pg_book_metadata_tags_trgm ON book_metadata USING GIN (tags gin_trgm_ops);
        CREATE INDEX IF NOT EXISTS idx_pg_chapter_cache_book_id ON chapter_cache(book_id);
        CREATE INDEX IF NOT EXISTS idx_pg_chapter_cache_chapter_id ON chapter_cache(chapter_id);
        CREATE INDEX IF NOT EXISTS idx_pg_chapter_cache_updated ON chapter_cache(updated_at);
        CREATE INDEX IF NOT EXISTS idx_pg_chapter_cache_effective_updated ON chapter_cache((COALESCE(updated_at, created_at)));
        CREATE INDEX IF NOT EXISTS idx_pg_chapter_cache_uploader_identity ON chapter_cache((COALESCE(NULLIF("uploaderId", ''), uploader)));
        CREATE UNIQUE INDEX IF NOT EXISTS idx_pg_chapter_cache_book_order_unique
            ON chapter_cache(book_id, chapter_order)
            WHERE chapter_order > 0
              AND LOWER(TRIM(COALESCE(platform, ''))) NOT IN ('qidian', 'qd', 'fanqie', 'fq', 'tomato');
        CREATE INDEX IF NOT EXISTS idx_pg_events_created ON upload_events(created_at);
    `);
    await runMigrations();
}

module.exports = {
    pool,
    query,
    initPg,
    runMigrations,
    runMigrationRollback,
    listMigrationFiles,
    listRollbackFiles,
    bookColumns,
    chapterColumns,
    pick,
    placeholders
};
