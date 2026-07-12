const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const DEFAULT_IMAGE = "wenmoux/reader:v2.0";

function readBuildMetadata(file = path.join(__dirname, "..", ".docker-build.json")) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        return {};
    }
}

function selectPushTags(metadata = {}, envImage = "") {
    const metadataTags = Array.isArray(metadata.tags) ? metadata.tags.filter(Boolean) : [];
    const fallback = metadata.imageTag || envImage || DEFAULT_IMAGE;
    return Array.from(new Set([...metadataTags, envImage || fallback].filter(Boolean)));
}

function push(tag, spawn = spawnSync) {
    console.log(`[docker-push] pushing ${tag}`);
    const result = spawn("docker", ["push", tag], { stdio: "inherit" });
    if ((result.status || 0) !== 0) throw new Error(`docker push failed for ${tag}`);
}

function runPush(options = {}) {
    const metadata = options.metadata || readBuildMetadata(options.metadataFile);
    const tags = selectPushTags(metadata, options.envImage ?? process.env.PO18_IMAGE_TAG);
    console.log(`[docker-push] tags=${tags.join(", ")}`);
    for (const tag of tags) push(tag, options.spawnSyncImpl || spawnSync);
    return tags;
}

function main() {
    try {
        runPush();
    } catch (error) {
        console.error(`[docker-push] ${error.message || String(error)}`);
        process.exitCode = 1;
    }
}

if (require.main === module) main();

module.exports = {
    DEFAULT_IMAGE,
    push,
    readBuildMetadata,
    runPush,
    selectPushTags
};
