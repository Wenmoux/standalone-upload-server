const assert = require("assert/strict");
const test = require("node:test");
const {
    REQUEST_SCHEMA_POLICIES,
    compactAjvErrors,
    compileRequestSchemas,
    createRequestSchemaValidation
} = require("../services/schema-validation");

function invoke({ method = "POST", path, body }) {
    let output = null;
    let nextCalled = false;
    const middleware = createRequestSchemaValidation();
    const res = {
        statusCode: 200,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            output = { status: this.statusCode, payload };
            return this;
        }
    };
    middleware({ method, path, body }, res, () => {
        nextCalled = true;
    });
    return { output, nextCalled };
}

test("request schema registry compiles every high-cost route policy", () => {
    const compiled = compileRequestSchemas();
    assert.equal(compiled.length, REQUEST_SCHEMA_POLICIES.length);
    assert.ok(compiled.every((item) => typeof item.validate === "function"));
});

test("request schema middleware rejects malformed upload payloads with details", () => {
    const invalid = invoke({ path: "/api/metadata/batch", body: { books: [{ title: "missing id" }] } });
    assert.equal(invalid.nextCalled, false);
    assert.equal(invalid.output.status, 400);
    assert.equal(invalid.output.payload.code, "VALIDATION_ERROR");
    assert.equal(invalid.output.payload.schema, "metadata-batch");
    assert.ok(invalid.output.payload.details.length);

    const valid = invoke({ path: "/api/metadata/batch", body: { books: [{ bookId: "b1", title: "Book" }] } });
    assert.equal(valid.nextCalled, true);
});

test("request schemas bound identifiers and TTS proxy headers", () => {
    assert.equal(invoke({ path: "/api/parse/check-cache", body: { bookId: "b1" } }).nextCalled, true);
    assert.equal(invoke({ path: "/api/parse/check-cache", body: { bookId: "" } }).output.status, 400);
    const tooManyHeaders = Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`x-${index}`, "ok"]));
    assert.equal(
        invoke({ path: "/reader-api/tts/proxy", body: { url: "https://example.com", headers: tooManyHeaders } }).output.status,
        400
    );
    assert.deepEqual(compactAjvErrors([]), []);
});

test("manifest endpoints require a bounded versioned manifest envelope", () => {
    const invalid = invoke({ path: "/admin-api/books/manifests/import", body: { manifest: { format: "unknown" } } });
    assert.equal(invalid.output.status, 400);
    assert.equal(invalid.output.payload.schema, "book-manifest");

    const checksum = { algorithm: "sha256", value: "a".repeat(64) };
    const manifest = {
        format: "po18-reader-book",
        version: 1,
        generated_at: "2026-07-12T00:00:00.000Z",
        source: {
            app_version: "2.0.0-test",
            identity_model: "legacy-platform-external-id",
            platform: "po18",
            book_id: "book-1"
        },
        book: { book_id: "book-1", platform: "po18", title: "Book" },
        chapters: [{ chapter_id: "chapter-1", title: "One", text: "one", checksum }],
        summary: { chapters: 1, content_included: true },
        checksum
    };
    assert.equal(invoke({ path: "/admin-api/books/manifests/validate", body: manifest }).nextCalled, true);
    assert.equal(
        invoke({ path: "/admin-api/books/manifests/import", body: { manifest, confirmation: "IMPORT po18:book-1" } }).nextCalled,
        true
    );
});
