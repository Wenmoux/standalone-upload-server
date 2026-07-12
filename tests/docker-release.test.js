const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");

const { createBuildIdentity, dockerBuildArgs, sourceContentHash } = require("../scripts/docker-build");
const { selectPushTags } = require("../scripts/docker-push");
const { createImageManifest, createReleaseManifest, parseManifestDigest } = require("../scripts/docker-release-manifest");

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
