const { execFileSync, spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const projectRoot = path.join(__dirname, "..");
const DEFAULT_IMAGE_TAG = "wenmoux/reader:v2.0";
const SOURCE_HASH_EXCLUDES = new Set([
    ".docker-build.json",
    ".po18-build.json",
    "release-manifest.json",
    "sbom.spdx.json"
]);

function readPackageVersion(root = projectRoot) {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
        return String(pkg.version || "0.0.0");
    } catch {
        return "0.0.0";
    }
}

function parseBoolean(value) {
    return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

function gitCandidates(env = process.env, platform = process.platform) {
    const candidates = [env.PO18_GIT_BINARY, "git"];
    if (platform === "win32") {
        candidates.push(
            "C:\\Program Files\\Git\\cmd\\git.exe",
            "C:\\Program Files\\Git\\bin\\git.exe",
            path.join(env.LOCALAPPDATA || "", "Programs", "Git", "cmd", "git.exe")
        );
    }
    return Array.from(new Set(candidates.filter(Boolean)));
}

function resolveGitCommand(options = {}) {
    const exec = options.execFileSyncImpl || execFileSync;
    for (const candidate of gitCandidates(options.env, options.platform)) {
        if (path.isAbsolute(candidate) && !fs.existsSync(candidate)) continue;
        try {
            exec(candidate, ["--version"], { cwd: options.root || projectRoot, stdio: "ignore" });
            return candidate;
        } catch {}
    }
    return "";
}

function gitValue(command, args, root = projectRoot, fallback = "", exec = execFileSync) {
    if (!command) return fallback;
    try {
        return exec(command, args, {
            cwd: root,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"]
        }).trim();
    } catch {
        return fallback;
    }
}

function compactBuildDate(date) {
    return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function resolveBuildDate(env = process.env, now = new Date()) {
    if (env.PO18_BUILD_DATE) {
        const explicit = new Date(env.PO18_BUILD_DATE);
        if (Number.isNaN(explicit.getTime())) throw new Error("PO18_BUILD_DATE must be an ISO-8601 timestamp");
        return explicit.toISOString();
    }
    if (env.SOURCE_DATE_EPOCH) {
        const epoch = Number(env.SOURCE_DATE_EPOCH);
        if (!Number.isInteger(epoch) || epoch < 0) throw new Error("SOURCE_DATE_EPOCH must be a non-negative integer");
        return new Date(epoch * 1000).toISOString();
    }
    return now.toISOString();
}

function sourceContentHash(root, files, excludedFiles = SOURCE_HASH_EXCLUDES) {
    const hash = crypto.createHash("sha256");
    for (const relativePath of [...files].filter(Boolean).sort()) {
        const normalizedPath = relativePath.replace(/\\/g, "/");
        if (excludedFiles.has(normalizedPath)) continue;
        const absolutePath = path.join(root, relativePath);
        let stat;
        try {
            stat = fs.statSync(absolutePath);
        } catch {
            continue;
        }
        if (!stat.isFile()) continue;
        hash.update(normalizedPath);
        hash.update("\0");
        hash.update(fs.readFileSync(absolutePath));
        hash.update("\0");
    }
    return hash.digest("hex");
}

function imageRepository(reference) {
    const withoutDigest = String(reference || "").split("@")[0];
    const lastSlash = withoutDigest.lastIndexOf("/");
    const lastColon = withoutDigest.lastIndexOf(":");
    return lastColon > lastSlash ? withoutDigest.slice(0, lastColon) : withoutDigest;
}

function safeTagPart(value, fallback = "unknown") {
    const safe = String(value || "")
        .replace(/[^0-9A-Za-z_.-]+/g, "-")
        .replace(/^[.-]+|[.-]+$/g, "");
    return safe || fallback;
}

function createBuildIdentity(options) {
    const packageVersion = String(options.packageVersion || "0.0.0");
    const imageTag = String(options.imageTag || DEFAULT_IMAGE_TAG);
    const sourceHash = String(options.sourceHash || "");
    const release = options.release === true;
    const dirty = options.dirty === true;
    const gitRevision = String(options.gitRevision || "unknown");

    if (!/^[a-f0-9]{64}$/i.test(sourceHash)) throw new Error("source hash must be a SHA-256 hex digest");
    if (release && dirty) throw new Error("formal release refused: Git worktree is dirty");
    if (release && (!options.gitAvailable || gitRevision === "unknown")) {
        throw new Error("formal release refused: Git revision and clean-worktree verification are required");
    }

    const baseRevision = String(options.revisionOverride || gitRevision || "unknown");
    const revision = dirty && !/\.dirty\./.test(baseRevision)
        ? `${baseRevision}.dirty.${sourceHash.slice(0, 8)}`
        : baseRevision;
    const buildDate = String(options.buildDate);
    const buildStamp = String(options.buildStamp || compactBuildDate(new Date(buildDate)).replace(/Z$/, ""));
    const versionRevision = safeTagPart(revision);
    const appVersion = String(options.appVersionOverride || `${packageVersion}+${buildStamp}.${versionRevision}`);
    const repository = imageRepository(imageTag);
    if (!repository) throw new Error(`invalid image tag: ${imageTag}`);

    const semverTag = `${repository}:v${safeTagPart(packageVersion)}`;
    const baseRevisionForTag = safeTagPart(baseRevision).slice(0, 12);
    const dirtyTagPart = dirty ? `.dirty.${sourceHash.slice(0, 8)}` : "";
    const revisionSourceTag = `${repository}:sha-${baseRevisionForTag}${dirtyTagPart}-${sourceHash.slice(0, 12)}`;
    const immutableTags = Array.from(new Set(release ? [semverTag, revisionSourceTag] : [revisionSourceTag]));
    const tags = Array.from(new Set([...immutableTags, imageTag]));

    return {
        imageTag,
        movableTag: imageTag,
        immutableTag: revisionSourceTag,
        immutableTags,
        semverTag,
        revisionSourceTag,
        tags,
        appVersion,
        packageVersion,
        buildDate,
        buildStamp,
        revision,
        gitRevision,
        sourceHash,
        dirty,
        release
    };
}

function dockerBuildArgs(identity) {
    const args = [
        "build",
        "--provenance=false",
        "--target",
        "app",
        "--build-arg",
        `PO18_IMAGE_TAG=${identity.imageTag}`,
        "--build-arg",
        `PO18_IMMUTABLE_IMAGE_TAG=${identity.immutableTag}`,
        "--build-arg",
        `PO18_IMAGE_TAGS=${identity.tags.join(",")}`,
        "--build-arg",
        `PO18_APP_VERSION=${identity.appVersion}`,
        "--build-arg",
        `PO18_BUILD_DATE=${identity.buildDate}`,
        "--build-arg",
        `PO18_BUILD_REVISION=${identity.revision}`,
        "--build-arg",
        `PO18_SOURCE_HASH=${identity.sourceHash}`,
        "--build-arg",
        `PO18_BUILD_DIRTY=${identity.dirty ? "true" : "false"}`
    ];
    for (const tag of identity.tags) args.push("-t", tag);
    args.push(".");
    return args;
}

function appendGithubOutputs(identity, env = process.env) {
    if (!env.GITHUB_OUTPUT) return;
    const lines = [
        `movable_tag=${identity.movableTag}`,
        `semver_tag=${identity.semverTag}`,
        `immutable_tag=${identity.immutableTag}`,
        `source_hash=${identity.sourceHash}`,
        `revision=${identity.revision}`
    ];
    fs.appendFileSync(env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
}

function collectBuildIdentity(options = {}) {
    const root = options.root || projectRoot;
    const env = options.env || process.env;
    const exec = options.execFileSyncImpl || execFileSync;
    const gitCommand = resolveGitCommand({ root, env, platform: options.platform, execFileSyncImpl: exec });
    const trackedFiles = gitValue(gitCommand, ["ls-files", "--cached", "--others", "--exclude-standard"], root, "", exec)
        .split(/\r?\n/)
        .filter(Boolean);
    const sourceHash = sourceContentHash(root, trackedFiles);
    const gitRevision = gitValue(gitCommand, ["rev-parse", "HEAD"], root, "unknown", exec);
    const dirty = Boolean(gitValue(gitCommand, ["status", "--porcelain", "--untracked-files=all"], root, "", exec));
    const buildDate = resolveBuildDate(env, options.now || new Date());

    return createBuildIdentity({
        imageTag: env.PO18_IMAGE_TAG || DEFAULT_IMAGE_TAG,
        packageVersion: readPackageVersion(root),
        buildDate,
        buildStamp: env.PO18_BUILD_STAMP,
        gitRevision,
        gitAvailable: Boolean(gitCommand),
        dirty,
        sourceHash,
        release: parseBoolean(env.PO18_RELEASE || env.PO18_FORMAL_RELEASE),
        revisionOverride: env.PO18_BUILD_REVISION,
        appVersionOverride: env.PO18_APP_VERSION
    });
}

function runBuild(options = {}) {
    const root = options.root || projectRoot;
    const env = options.env || process.env;
    const spawn = options.spawnSyncImpl || spawnSync;
    const identity = collectBuildIdentity({ ...options, root, env });

    console.log(`[docker-build] movable_tag=${identity.movableTag}`);
    console.log(`[docker-build] immutable_tags=${identity.immutableTags.join(", ")}`);
    console.log(`[docker-build] version=${identity.appVersion}`);
    console.log(`[docker-build] build_date=${identity.buildDate}`);
    console.log(`[docker-build] revision=${identity.revision}`);
    console.log(`[docker-build] source_hash=${identity.sourceHash}`);
    console.log(`[docker-build] dirty=${identity.dirty}`);
    console.log(`[docker-build] formal_release=${identity.release}`);

    const result = spawn("docker", dockerBuildArgs(identity), { cwd: root, stdio: "inherit" });
    const status = result.status === null ? 1 : (result.status || 0);
    if (status !== 0) return status;

    const metadataPath = path.join(root, ".docker-build.json");
    fs.writeFileSync(metadataPath, JSON.stringify(identity, null, 2));
    appendGithubOutputs(identity, env);
    console.log(`[docker-build] metadata=${metadataPath}`);
    return 0;
}

function main() {
    try {
        process.exitCode = runBuild();
    } catch (error) {
        console.error(`[docker-build] ${error.message || String(error)}`);
        process.exitCode = 1;
    }
}

if (require.main === module) main();

module.exports = {
    DEFAULT_IMAGE_TAG,
    SOURCE_HASH_EXCLUDES,
    appendGithubOutputs,
    collectBuildIdentity,
    compactBuildDate,
    createBuildIdentity,
    dockerBuildArgs,
    gitCandidates,
    imageRepository,
    parseBoolean,
    readPackageVersion,
    resolveBuildDate,
    resolveGitCommand,
    runBuild,
    safeTagPart,
    sourceContentHash
};
