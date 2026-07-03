const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function readBuildMetadata() {
    try {
        return JSON.parse(fs.readFileSync(path.join(__dirname, "..", ".docker-build.json"), "utf8"));
    } catch {
        return {};
    }
}

function push(tag) {
    console.log(`[docker-push] pushing ${tag}`);
    const result = spawnSync("docker", ["push", tag], {
        stdio: "inherit"
    });
    if ((result.status || 0) !== 0) {
        process.exit(result.status || 1);
    }
}

const metadata = readBuildMetadata();
const defaultImage = "wenmoux/reader:v1.0";
const envImage = process.env.PO18_IMAGE_TAG;
const tags = envImage
    ? [envImage]
    : (Array.isArray(metadata.tags) && metadata.tags.length ? metadata.tags : [metadata.imageTag || defaultImage]);
const uniqueTags = Array.from(new Set(tags));

console.log(`[docker-push] tags=${uniqueTags.join(", ")}`);
for (const tag of uniqueTags) {
    push(tag);
}
