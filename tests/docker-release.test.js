const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");

const {
    createBuildIdentity,
    dockerFailureSummary,
    dockerBuildArgs,
    githubCommandEscape,
    sourceContentHash
} = require("../scripts/docker-build");
const { pushFailureSummary, selectPushTags } = require("../scripts/docker-push");
const {
    createImageManifest,
    createReleaseManifest,
    inspectRemoteDigest,
    parseManifestDigest
} = require("../scripts/docker-release-manifest");
const { REQUIRED_CONTEXT_FILES, ignored, walk } = require("../scripts/check-build-context");
const { pgFailureSummary } = require("../scripts/run-pg-integration");
const { smokeApplicationEnvironment, smokeFailureSummary } = require("../scripts/docker-smoke");

const HASH = "a".repeat(64);

test("formal builds emit immutable semver and revision/source tags", () => {
    const identity = createBuildIdentity({
        packageVersion: "2.0.0",
        imageTag: "example/reader:v2.0",
        sourceHash: HASH,
        release: true,
        dirty: false,
        gitAvailable: true,
        gitRevision: "1234567890abcdef",
        buildDate: "2026-07-11T00:00:00.000Z"
    });
    assert.deepEqual(identity.tags, ["example/reader:v2.0.0", "example/reader:sha-1234567890ab-aaaaaaaaaaaa", "example/reader:v2.0"]);
    assert.match(identity.appVersion, /^2\.0\.0\+20260711T000000\./);
    const args = dockerBuildArgs(identity);
    assert.ok(args.includes("PO18_SOURCE_HASH=" + HASH));
    assert.equal(args.filter((value) => value === "-t").length, 3);
});

test("development builds never claim the immutable semver tag", () => {
    const identity = createBuildIdentity({
        packageVersion: "2.0.0",
        imageTag: "example/reader:v2.0",
        sourceHash: HASH,
        release: false,
        dirty: true,
        gitAvailable: true,
        gitRevision: "1234567890abcdef",
        buildDate: "2026-07-11T00:00:00.000Z"
    });
    assert.equal(identity.tags.includes("example/reader:v2.0.0"), false);
    assert.match(identity.immutableTag, /dirty\.aaaaaaaa/);
    assert.match(identity.revision, /dirty\.aaaaaaaa/);
});

test("formal builds reject dirty or unverifiable Git state", () => {
    const base = {
        packageVersion: "2.0.0",
        imageTag: "example/reader:v2.0",
        sourceHash: HASH,
        release: true,
        gitRevision: "1234567890abcdef",
        buildDate: "2026-07-11T00:00:00.000Z"
    };
    assert.throws(() => createBuildIdentity({ ...base, dirty: true, gitAvailable: true }), /worktree is dirty/);
    assert.throws(() => createBuildIdentity({ ...base, dirty: false, gitAvailable: false }), /verification are required/);
});

test("main branch builds can require a clean Git worktree with actionable paths", () => {
    const base = {
        packageVersion: "2.0.0",
        imageTag: "example/reader:v2.0",
        sourceHash: HASH,
        release: false,
        dirty: true,
        dirtyFiles: ["generated.json"],
        gitAvailable: true,
        gitRevision: "1234567890abcdef",
        buildDate: "2026-07-11T00:00:00.000Z"
    };
    assert.throws(() => createBuildIdentity({ ...base, requireClean: true }), /generated\.json/);
});

test("GitHub Docker failures expose a bounded escaped diagnostic annotation", () => {
    const lines = Array.from({ length: 60 }, (_, index) => `build line ${index + 1}`);
    const summary = dockerFailureSummary(lines.slice(0, 30).join("\n"), lines.slice(30).join("\n"));
    assert.doesNotMatch(summary, /build line 1(?:\D|$)/);
    assert.match(summary, /build line 60/);
    assert.ok(summary.split("\n").length <= 40);
    assert.equal(githubCommandEscape("one%\ntwo\r"), "one%25%0Atwo%0D");
});

test("Docker context keeps every runtime build input required by PWA and shared UI", () => {
    const contextFiles = new Set(walk(path.join(__dirname, "..")).map((file) => file.path));
    for (const required of REQUIRED_CONTEXT_FILES) assert.equal(contextFiles.has(required), true, required);
    assert.equal(ignored("cirno-src/scripts/reader-pwa-plugin.mjs"), false);
});

test("PostgreSQL CI failures keep the actionable tail and remove terminal colors", () => {
    const input = Array.from({ length: 80 }, (_, index) => `\u001b[31mpg line ${index + 1}\u001b[0m`).join("\n");
    const summary = pgFailureSummary(input);
    assert.doesNotMatch(summary, /\u001b/);
    assert.doesNotMatch(summary, /pg line 1(?:\D|$)/);
    assert.match(summary, /pg line 80/);
    assert.ok(summary.split("\n").length <= 60);
});

test("Docker smoke supplies every production security setting and exposes diagnostics", () => {
    const environment = smokeApplicationEnvironment();
    assert.ok(environment.includes("PO18_METRICS_TOKEN=smoke-metrics-token"));
    assert.ok(environment.some((value) => value.startsWith("PO18_UPLOAD_SESSION_SECRET=")));
    assert.ok(environment.some((value) => value.startsWith("PO18_UPLOAD_ADMIN_PASSWORD=")));
    const summary = smokeFailureSummary(Array.from({ length: 80 }, (_, index) => `smoke line ${index + 1}`).join("\n"));
    assert.doesNotMatch(summary, /smoke line 1(?:\D|$)/);
    assert.match(summary, /smoke line 80/);
    assert.ok(summary.split("\n").length <= 60);
});

test("source hash excludes generated release metadata", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "po18-source-hash-"));
    try {
        fs.writeFileSync(path.join(root, "app.js"), "one");
        fs.writeFileSync(path.join(root, ".docker-build.json"), "first");
        const first = sourceContentHash(root, ["app.js", ".docker-build.json"]);
        fs.writeFileSync(path.join(root, ".docker-build.json"), "second");
        assert.equal(sourceContentHash(root, ["app.js", ".docker-build.json"]), first);
        fs.writeFileSync(path.join(root, "app.js"), "two");
        assert.notEqual(sourceContentHash(root, ["app.js", ".docker-build.json"]), first);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test("push selection retains every build tag when a movable tag is provided", () => {
    assert.deepEqual(
        selectPushTags({ tags: ["example/reader:v2.0.0", "example/reader:sha-abc-source", "example/reader:v2.0"] }, "example/reader:v2.0"),
        ["example/reader:v2.0.0", "example/reader:sha-abc-source", "example/reader:v2.0"]
    );
});

test("Docker push failures expose the registry response without terminal colors", () => {
    const input = Array.from({ length: 80 }, (_, index) => `\u001b[31mpush line ${index + 1}\u001b[0m`).join("\n");
    const summary = pushFailureSummary(input, "denied: requested access to the resource is denied");
    assert.doesNotMatch(summary, /\u001b/);
    assert.doesNotMatch(summary, /push line 1(?:\D|$)/);
    assert.match(summary, /push line 80/);
    assert.match(summary, /requested access/);
    assert.ok(summary.split("\n").length <= 60);
});

test("release manifest binds source identity to a registry digest", () => {
    const digest = "sha256:" + "b".repeat(64);
    const manifest = createReleaseManifest(
        {
            release: true,
            dirty: false,
            appVersion: "2.0.0+release",
            packageVersion: "2.0.0",
            gitRevision: "abc",
            sourceHash: HASH,
            buildDate: "2026-07-11T00:00:00.000Z",
            immutableTag: "example/reader:sha-abc-source",
            tags: ["example/reader:v2.0.0", "example/reader:sha-abc-source"]
        },
        digest
    );
    assert.equal(manifest.digest_reference, `example/reader@${digest}`);
    assert.equal(parseManifestDigest(JSON.stringify({ digest })), digest);
});

test("registry digest inspection retries propagation and parses the top-level descriptor", () => {
    const digest = "sha256:" + "d".repeat(64);
    let calls = 0;
    const waits = [];
    const resolved = inspectRemoteDigest(
        "example/reader:sha-source",
        (_command, args) => {
            calls += 1;
            assert.deepEqual(args.slice(-2), ["--format", "{{.Manifest}}"]);
            if (calls < 3) return { status: 1, stdout: "", stderr: "manifest unknown" };
            return { status: 0, stdout: `Name: example/reader:sha-source\nDigest: ${digest}\n`, stderr: "" };
        },
        { attempts: 3, delayMs: 5, sleepImpl: (milliseconds) => waits.push(milliseconds) }
    );
    assert.equal(resolved, digest);
    assert.equal(calls, 3);
    assert.deepEqual(waits, [5, 5]);
});

test("main branch publish manifest binds a clean development build without claiming semver", () => {
    const digest = "sha256:" + "c".repeat(64);
    const manifest = createImageManifest(
        {
            release: false,
            dirty: false,
            appVersion: "2.0.0+main",
            packageVersion: "2.0.0",
            gitRevision: "def",
            sourceHash: HASH,
            buildDate: "2026-07-12T00:00:00.000Z",
            immutableTag: "example/reader:sha-def-source",
            tags: ["example/reader:sha-def-source", "example/reader:v2.0"]
        },
        digest
    );
    assert.equal(manifest.formal_release, false);
    assert.equal(manifest.digest_reference, `example/reader@${digest}`);
    assert.equal(manifest.tags.includes("example/reader:v2.0.0"), false);
});

test("GitHub workflow publishes main pushes and keeps tag releases conditional", () => {
    const workflow = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "release.yml"), "utf8");
    assert.match(workflow, /branches:\s*\n\s*- main/);
    assert.match(workflow, /workflow_dispatch:/);
    assert.match(workflow, /PO18_RELEASE: \$\{\{ github\.ref_type == 'tag'/);
    assert.match(workflow, /PO18_REQUIRE_CLEAN: "1"/);
    assert.match(workflow, /Push source tag and moving channel tag/);
    assert.match(workflow, /if: github\.ref_type == 'tag'/);
    assert.match(workflow, /actions\/checkout@v7/);
    assert.match(workflow, /actions\/setup-node@v6/);
    assert.match(workflow, /docker\/setup-buildx-action@v4/);
    assert.match(workflow, /docker\/login-action@v4/);
    assert.match(workflow, /Repository secret DOCKERHUB_TOKEN is required/);
    assert.doesNotMatch(workflow, /npm run admin:build/);
    assert.match(workflow, /PO18_TEST_APP_IMAGE: \$\{\{ steps\.build\.outputs\.immutable_tag \}\}/);
    assert.ok(
        workflow.indexOf("Build clean source-identified image") < workflow.indexOf("PostgreSQL integration and search plan benchmark")
    );
});
