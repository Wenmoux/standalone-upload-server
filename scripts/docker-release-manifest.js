const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const projectRoot = path.join(__dirname, "..");

function imageRepository(reference) {
    const withoutDigest = String(reference || "").split("@")[0];
    const slash = withoutDigest.lastIndexOf("/");
    const colon = withoutDigest.lastIndexOf(":");
    return colon > slash ? withoutDigest.slice(0, colon) : withoutDigest;
}

function parseManifestDigest(raw) {
    const text = String(raw || "").trim();
    try {
        const parsed = JSON.parse(text);
        const digest = parsed.digest || parsed.Digest || parsed.descriptor?.digest;
        if (/^sha256:[a-f0-9]{64}$/i.test(String(digest || ""))) return String(digest);
    } catch {}
    const match = text.match(/sha256:[a-f0-9]{64}/i);
    if (!match) throw new Error("remote image manifest did not expose a sha256 digest");
    return match[0];
}

function inspectRemoteDigest(tag, spawn = spawnSync) {
    const result = spawn("docker", ["buildx", "imagetools", "inspect", tag, "--format", "{{json .Manifest}}"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
    });
    if ((result.status || 0) !== 0) {
        throw new Error(String(result.stderr || result.stdout || `unable to inspect ${tag}`).trim());
    }
    return parseManifestDigest(result.stdout);
}

function createImageManifest(metadata, digest, options = {}) {
    if (!metadata || metadata.dirty === true) throw new Error("image manifest requires clean build metadata");
    if (options.requireRelease === true && metadata.release !== true) {
        throw new Error("release manifest requires formal-release build metadata");
    }
    const tag = metadata.immutableTag;
    const repository = imageRepository(tag);
    if (!repository || !/^sha256:[a-f0-9]{64}$/i.test(String(digest || ""))) {
        throw new Error("release manifest requires an immutable tag and sha256 digest");
    }
    return {
        formal_release: metadata.release === true,
        version: metadata.appVersion,
        package_version: metadata.packageVersion,
        git_revision: metadata.gitRevision,
        source_hash: metadata.sourceHash,
        build_date: metadata.buildDate,
        immutable_tag: tag,
        tags: metadata.tags,
        digest,
        digest_reference: `${repository}@${digest}`
    };
}

function createReleaseManifest(metadata, digest) {
    return createImageManifest(metadata, digest, { requireRelease: true });
}

function appendGithubOutputs(manifest, env = process.env) {
    if (!env.GITHUB_OUTPUT) return;
    fs.appendFileSync(
        env.GITHUB_OUTPUT,
        [
            `digest=${manifest.digest}`,
            `digest_reference=${manifest.digest_reference}`,
            `release_manifest=${path.join(projectRoot, "release-manifest.json")}`
        ].join("\n") + "\n"
    );
}

function run(options = {}) {
    const root = options.root || projectRoot;
    const metadataFile = options.metadataFile || path.join(root, ".docker-build.json");
    const outputFile = options.outputFile || path.join(root, "release-manifest.json");
    const metadata = options.metadata || JSON.parse(fs.readFileSync(metadataFile, "utf8"));
    const digest = options.digest || inspectRemoteDigest(metadata.immutableTag, options.spawnSyncImpl || spawnSync);
    const manifest = metadata.release === true ? createReleaseManifest(metadata, digest) : createImageManifest(metadata, digest);
    fs.writeFileSync(outputFile, JSON.stringify(manifest, null, 2) + "\n");
    appendGithubOutputs(manifest, options.env || process.env);
    console.log(`[docker-release] digest_reference=${manifest.digest_reference}`);
    console.log(`[docker-release] manifest=${outputFile}`);
    return manifest;
}

function main() {
    try {
        run();
    } catch (error) {
        console.error(`[docker-release] ${error.message || String(error)}`);
        process.exitCode = 1;
    }
}

if (require.main === module) main();

module.exports = {
    appendGithubOutputs,
    createImageManifest,
    createReleaseManifest,
    imageRepository,
    inspectRemoteDigest,
    parseManifestDigest,
    run
};
