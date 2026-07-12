const crypto = require("crypto");

const MANIFEST_FORMAT = "po18-reader-book";
const MANIFEST_VERSION = 1;
const BOOK_FIELDS = [
    "book_id", "title", "author", "cover", "description", "tags", "category", "word_count",
    "chapter_count", "status", "detail_url", "total_chapters", "subscribed_chapters", "free_chapters",
    "paid_chapters", "latest_chapter_name", "latest_chapter_date", "platform", "favorites_count",
    "comments_count", "monthly_popularity", "total_popularity", "uploader", "uploaderId",
    "description_html", "weekly_popularity", "readers_count", "daily_popularity", "purchase_count",
    "source_updated_at", "catalog_updated_at", "metadata_cached_at"
];
const CHAPTER_FIELDS = [
    "chapter_id", "title", "html", "text", "chapter_order", "uploader", "uploaderId", "platform", "is_volume"
];
const INTEGER_BOOK_FIELDS = new Set([
    "word_count", "chapter_count", "total_chapters", "subscribed_chapters", "free_chapters", "paid_chapters",
    "favorites_count", "comments_count", "monthly_popularity", "total_popularity", "weekly_popularity",
    "readers_count", "daily_popularity", "purchase_count"
]);

function manifestError(status, code, message, details) {
    return Object.assign(new Error(message), { status, code, details });
}

function stableValue(value) {
    if (value === null || value === undefined) return value === undefined ? null : value;
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(stableValue);
    if (typeof value === "object") {
        const result = {};
        for (const key of Object.keys(value).sort()) {
            if (value[key] !== undefined) result[key] = stableValue(value[key]);
        }
        return result;
    }
    return value;
}

function canonicalStringify(value) {
    return JSON.stringify(stableValue(value));
}

function checksum(value) {
    return crypto.createHash("sha256").update(canonicalStringify(value)).digest("hex");
}

function withoutChecksum(value = {}) {
    const copy = { ...value };
    delete copy.checksum;
    return copy;
}

function normalizedInteger(value, field) {
    if (value === null || value === undefined || value === "") return 0;
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) {
        throw manifestError(400, "MANIFEST_FIELD_INVALID", `${field} must be a non-negative integer`);
    }
    return number;
}

function positiveLimit(value, fallback) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function normalizedTimestamp(value, field) {
    if (value === null || value === undefined || value === "") return null;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) {
        throw manifestError(400, "MANIFEST_FIELD_INVALID", `${field} must be a valid timestamp`);
    }
    return date.toISOString();
}

function normalizedBoolean(value, field) {
    if (value === true || value === false) return value;
    if (value === 1 || value === "1" || String(value).toLowerCase() === "true") return true;
    if (value === 0 || value === "0" || value === "" || value == null || String(value).toLowerCase() === "false") return false;
    throw manifestError(400, "MANIFEST_FIELD_INVALID", `${field} must be a boolean`);
}

function normalizeBook(input = {}) {
    const result = {};
    for (const field of BOOK_FIELDS) {
        const value = input[field];
        if (INTEGER_BOOK_FIELDS.has(field)) result[field] = normalizedInteger(value, `book.${field}`);
        else result[field] = value == null ? "" : String(value);
    }
    result.book_id = String(input.book_id || input.bookId || "").trim();
    result.platform = String(input.platform || "").trim().toLowerCase();
    for (const field of ["latest_chapter_date", "source_updated_at", "catalog_updated_at", "metadata_cached_at"]) {
        result[field] = normalizedTimestamp(input[field], `book.${field}`);
    }
    return result;
}

function normalizeChapter(input = {}, platform = "") {
    const result = {};
    for (const field of CHAPTER_FIELDS) result[field] = input[field];
    result.chapter_id = String(input.chapter_id || input.chapterId || "").trim();
    result.title = String(input.title || result.chapter_id);
    result.html = String(input.html || "");
    result.text = String(input.text || "");
    result.chapter_order = normalizedInteger(input.chapter_order ?? input.chapterOrder, `chapter.${result.chapter_id || "unknown"}.chapter_order`);
    result.uploader = String(input.uploader || "");
    result.uploaderId = String(input.uploaderId || input.uploader_id || "");
    result.platform = String(input.platform || platform || "").trim().toLowerCase();
    result.is_volume = normalizedBoolean(input.is_volume ?? input.isVolume, `chapter.${result.chapter_id || "unknown"}.is_volume`);
    return result;
}

function signChapter(chapter) {
    const normalized = normalizeChapter(chapter, chapter.platform);
    return { ...normalized, checksum: { algorithm: "sha256", value: checksum(normalized) } };
}

function signManifest(manifest) {
    const unsigned = withoutChecksum(manifest);
    return { ...unsigned, checksum: { algorithm: "sha256", value: checksum(unsigned) } };
}

function validateBookManifest(manifest, options = {}) {
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
        throw manifestError(400, "MANIFEST_INVALID", "manifest must be a JSON object");
    }
    if (manifest.format !== MANIFEST_FORMAT || Number(manifest.version) !== MANIFEST_VERSION) {
        throw manifestError(400, "MANIFEST_VERSION_UNSUPPORTED", "unsupported book manifest format or version");
    }
    if (!normalizedTimestamp(manifest.generated_at, "generated_at")) {
        throw manifestError(400, "MANIFEST_GENERATED_AT_REQUIRED", "manifest generated_at is required");
    }
    const book = normalizeBook(manifest.book || {});
    if (!book.book_id || !book.platform) throw manifestError(400, "MANIFEST_IDENTITY_REQUIRED", "manifest book_id and platform are required");
    if (!manifest.source || typeof manifest.source !== "object" || Array.isArray(manifest.source)) {
        throw manifestError(400, "MANIFEST_SOURCE_REQUIRED", "manifest source metadata is required");
    }
    const sourceBookId = String(manifest.source.book_id || "").trim();
    const sourcePlatform = String(manifest.source.platform || "").trim().toLowerCase();
    if (sourceBookId !== book.book_id || sourcePlatform !== book.platform) {
        throw manifestError(409, "MANIFEST_SOURCE_MISMATCH", "manifest source identity differs from book identity");
    }
    if (String(manifest.source.identity_model || "") !== "legacy-platform-external-id") {
        throw manifestError(400, "MANIFEST_IDENTITY_MODEL_UNSUPPORTED", "unsupported manifest identity model");
    }
    if (!String(manifest.source.app_version || "").trim()) {
        throw manifestError(400, "MANIFEST_SOURCE_VERSION_REQUIRED", "manifest source app_version is required");
    }
    const maxChapters = positiveLimit(options.maxChapters || process.env.PO18_MANIFEST_MAX_CHAPTERS, 20000);
    if (!Array.isArray(manifest.chapters)) throw manifestError(400, "MANIFEST_CHAPTERS_REQUIRED", "manifest chapters must be an array");
    const chapters = manifest.chapters;
    if (chapters.length > maxChapters) throw manifestError(413, "MANIFEST_TOO_LARGE", `manifest has more than ${maxChapters} chapters`);
    const ids = new Set();
    const normalizedChapters = chapters.map((raw, index) => {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
            throw manifestError(400, "MANIFEST_CHAPTER_INVALID", `chapter ${index} must be an object`);
        }
        const chapter = normalizeChapter(raw, book.platform);
        if (!chapter.chapter_id) throw manifestError(400, "MANIFEST_CHAPTER_INVALID", `chapter ${index} has no chapter_id`);
        if (ids.has(chapter.chapter_id)) throw manifestError(400, "MANIFEST_CHAPTER_DUPLICATE", `duplicate chapter_id ${chapter.chapter_id}`);
        ids.add(chapter.chapter_id);
        if (chapter.platform && chapter.platform !== book.platform) {
            throw manifestError(409, "MANIFEST_PLATFORM_MISMATCH", `chapter ${chapter.chapter_id} platform differs from book platform`);
        }
        const bytes = Buffer.byteLength(chapter.html) + Buffer.byteLength(chapter.text);
        if (bytes > positiveLimit(options.maxChapterBytes || process.env.PO18_MANIFEST_MAX_CHAPTER_BYTES, 4 * 1024 * 1024)) {
            throw manifestError(413, "MANIFEST_CHAPTER_TOO_LARGE", `chapter ${chapter.chapter_id} exceeds the content limit`);
        }
        if (raw.checksum?.algorithm !== "sha256" || raw.checksum?.value !== checksum(chapter)) {
            throw manifestError(422, "MANIFEST_CHAPTER_CHECKSUM_MISMATCH", `chapter ${chapter.chapter_id} checksum mismatch`);
        }
        return { ...chapter, checksum: raw.checksum };
    });
    if (manifest.summary && Number(manifest.summary.chapters) !== normalizedChapters.length) {
        throw manifestError(422, "MANIFEST_SUMMARY_MISMATCH", "manifest chapter summary does not match chapter data");
    }
    if (manifest.summary && typeof manifest.summary.content_included !== "boolean") {
        throw manifestError(400, "MANIFEST_SUMMARY_INVALID", "manifest content_included summary must be a boolean");
    }
    if (manifest.checksum?.algorithm !== "sha256" || manifest.checksum?.value !== checksum(withoutChecksum(manifest))) {
        throw manifestError(422, "MANIFEST_CHECKSUM_MISMATCH", "manifest checksum mismatch");
    }
    return { book, chapters: normalizedChapters, checksum: manifest.checksum.value };
}

function sqlColumn(field) {
    return field === "uploaderId" ? '"uploaderId"' : field;
}

function createBookManifestService(options = {}) {
    const query = options.query;
    const pool = options.pool;
    const appVersion = options.appVersion || (() => process.env.PO18_APP_VERSION || "2.0.0");

    async function assertNoLegacyCollision(db, bookId, platform, metadataId = null) {
        const metadata = await db.query(
            `SELECT id, platform FROM book_metadata WHERE book_id=$1 ${metadataId ? "AND id<>$2" : ""}`,
            metadataId ? [bookId, metadataId] : [bookId]
        );
        const conflictingMetadata = metadata.rows.filter((row) => String(row.platform || "").toLowerCase() !== platform);
        const chapters = await db.query(
            `SELECT DISTINCT COALESCE(NULLIF(lower(platform), ''), $2) platform
             FROM chapter_cache WHERE book_id=$1`,
            [bookId, platform]
        );
        const conflictingChapters = chapters.rows.filter((row) => String(row.platform || "").toLowerCase() !== platform);
        if (conflictingMetadata.length || conflictingChapters.length) {
            throw manifestError(
                409,
                "BOOK_ID_COLLISION_REQUIRES_BOOK_KEY",
                "legacy book_id collision detected; manifest operation is refused until book_key migration",
                { book_id: bookId, platform }
            );
        }
    }

    async function exportManifest(metadataId, exportOptions = {}) {
        const found = await query(`SELECT ${BOOK_FIELDS.map(sqlColumn).join(", ")} FROM book_metadata WHERE id=$1`, [metadataId]);
        if (!found.rows[0]) throw manifestError(404, "BOOK_NOT_FOUND", "book metadata not found");
        const book = normalizeBook(found.rows[0]);
        await assertNoLegacyCollision({ query }, book.book_id, book.platform, metadataId);
        const result = await query(
            `SELECT ${CHAPTER_FIELDS.map(sqlColumn).join(", ")}
             FROM chapter_cache WHERE book_id=$1 ORDER BY chapter_order ASC, id ASC`,
            [book.book_id]
        );
        const chapters = exportOptions.includeContent === false
            ? result.rows.map((row) => signChapter(normalizeChapter({ ...row, html: "", text: "" }, book.platform)))
            : result.rows.map((row) => signChapter(normalizeChapter(row, book.platform)));
        return signManifest({
            format: MANIFEST_FORMAT,
            version: MANIFEST_VERSION,
            generated_at: new Date().toISOString(),
            source: {
                app_version: String(appVersion() || ""),
                identity_model: "legacy-platform-external-id",
                platform: book.platform,
                book_id: book.book_id
            },
            book,
            chapters,
            summary: { chapters: chapters.length, content_included: exportOptions.includeContent !== false }
        });
    }

    async function importManifest(manifest, importOptions = {}) {
        if (manifest?.summary?.content_included === false) {
            throw manifestError(400, "MANIFEST_CONTENT_REQUIRED", "metadata-only manifests cannot restore chapter content");
        }
        const validated = validateBookManifest(manifest, importOptions);
        const db = await pool.connect();
        try {
            await db.query("BEGIN");
            await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`book-manifest:${validated.book.book_id}`]);
            await assertNoLegacyCollision(db, validated.book.book_id, validated.book.platform);
            const existingBook = await db.query(
                "SELECT id, manifest_checksum FROM book_metadata WHERE book_id=$1 AND platform=$2 FOR UPDATE",
                [validated.book.book_id, validated.book.platform]
            );
            const bookValues = BOOK_FIELDS.map((field) => (
                field === "metadata_cached_at" && !validated.book[field]
                    ? (manifest.generated_at || new Date().toISOString())
                    : validated.book[field]
            ));
            const bookColumns = [...BOOK_FIELDS.map(sqlColumn), "manifest_checksum"];
            const bookParams = [...bookValues, validated.checksum];
            const updates = BOOK_FIELDS
                .filter((field) => !["book_id", "platform"].includes(field))
                .map((field) => `${sqlColumn(field)}=EXCLUDED.${sqlColumn(field)}`)
                .concat(["manifest_checksum=EXCLUDED.manifest_checksum", "updated_at=CURRENT_TIMESTAMP"]);
            await db.query(
                `INSERT INTO book_metadata(${bookColumns.join(",")})
                 VALUES (${bookParams.map((_, index) => `$${index + 1}`).join(",")})
                 ON CONFLICT (book_id, platform) DO UPDATE SET ${updates.join(",")}
                 WHERE book_metadata.manifest_checksum IS DISTINCT FROM EXCLUDED.manifest_checksum`,
                bookParams
            );

            const ids = validated.chapters.map((chapter) => chapter.chapter_id);
            const existing = ids.length
                ? await db.query(
                    "SELECT chapter_id, manifest_checksum FROM chapter_cache WHERE book_id=$1 AND chapter_id=ANY($2::text[])",
                    [validated.book.book_id, ids]
                )
                : { rows: [] };
            const existingById = new Map(existing.rows.map((row) => [String(row.chapter_id), String(row.manifest_checksum || "")]));
            const changed = validated.chapters.filter((chapter) => existingById.get(chapter.chapter_id) !== chapter.checksum.value);
            const changedExistingIds = changed.filter((chapter) => existingById.has(chapter.chapter_id)).map((chapter) => chapter.chapter_id);
            const targetOrders = [...new Set(changed.map((chapter) => chapter.chapter_order).filter((order) => order > 0))];
            if (targetOrders.length) {
                const conflicts = await db.query(
                    `SELECT chapter_id, chapter_order
                     FROM chapter_cache
                     WHERE book_id=$1
                       AND chapter_order=ANY($2::int[])
                       AND NOT (chapter_id=ANY($3::text[]))
                     LIMIT 20`,
                    [validated.book.book_id, targetOrders, changed.map((chapter) => chapter.chapter_id)]
                );
                if (conflicts.rows.length) {
                    throw manifestError(
                        409,
                        "MANIFEST_ORDER_CONFLICT",
                        "manifest chapter order conflicts with chapters not included in this update",
                        { chapters: conflicts.rows }
                    );
                }
            }
            if (changedExistingIds.length) {
                await db.query(
                    `UPDATE chapter_cache
                     SET chapter_order = -(chapter_order + 1)
                     WHERE book_id=$1 AND chapter_id=ANY($2::text[]) AND chapter_order > 0`,
                    [validated.book.book_id, changedExistingIds]
                );
            }
            const batchSize = Math.max(1, Math.min(500, Number(importOptions.batchSize || 200)));
            for (let offset = 0; offset < changed.length; offset += batchSize) {
                const batch = changed.slice(offset, offset + batchSize);
                const values = [];
                const params = [];
                for (const chapter of batch) {
                    const base = params.length;
                    values.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11})`);
                    params.push(
                        validated.book.book_id,
                        chapter.chapter_id,
                        chapter.title,
                        chapter.html,
                        chapter.text,
                        chapter.chapter_order,
                        chapter.uploader,
                        chapter.uploaderId,
                        validated.book.platform,
                        chapter.is_volume,
                        chapter.checksum.value
                    );
                }
                await db.query(
                    `INSERT INTO chapter_cache(book_id,chapter_id,title,html,text,chapter_order,uploader,"uploaderId",platform,is_volume,manifest_checksum)
                     VALUES ${values.join(",")}
                     ON CONFLICT (book_id, chapter_id) DO UPDATE SET
                        title=EXCLUDED.title, html=EXCLUDED.html, text=EXCLUDED.text,
                        chapter_order=EXCLUDED.chapter_order, uploader=EXCLUDED.uploader,
                        "uploaderId"=EXCLUDED."uploaderId", platform=EXCLUDED.platform,
                        is_volume=EXCLUDED.is_volume, manifest_checksum=EXCLUDED.manifest_checksum,
                        updated_at=CURRENT_TIMESTAMP
                     WHERE chapter_cache.manifest_checksum IS DISTINCT FROM EXCLUDED.manifest_checksum`,
                    params
                );
            }
            await db.query("COMMIT");
            const inserted = changed.filter((chapter) => !existingById.has(chapter.chapter_id)).length;
            return {
                success: true,
                book_id: validated.book.book_id,
                platform: validated.book.platform,
                metadata: existingBook.rows[0]?.manifest_checksum === validated.checksum ? "unchanged" : existingBook.rows.length ? "updated" : "inserted",
                chapters: {
                    total: validated.chapters.length,
                    inserted,
                    updated: changed.length - inserted,
                    unchanged: validated.chapters.length - changed.length
                },
                checksum: validated.checksum
            };
        } catch (error) {
            await db.query("ROLLBACK").catch(() => {});
            throw error;
        } finally {
            db.release();
        }
    }

    return { exportManifest, importManifest, validateManifest: validateBookManifest };
}

module.exports = {
    BOOK_FIELDS,
    CHAPTER_FIELDS,
    MANIFEST_FORMAT,
    MANIFEST_VERSION,
    canonicalStringify,
    checksum,
    createBookManifestService,
    normalizeBook,
    normalizeChapter,
    signChapter,
    signManifest,
    validateBookManifest
};
