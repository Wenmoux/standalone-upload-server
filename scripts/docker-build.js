const { execFileSync, spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const projectRoot = path.join(__dirname, "..");

function readPackageVersion() {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
        return String(pkg.version || "0.0.0");
    } catch {
        return "0.0.0";
    }
}

function gitValue(args, fallback = "") {
    try {
        return execFileSync("git", args, { cwd: projectRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
        return fallback;
    }
}

function compactBuildDate(date = new Date()) {
    return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function sourceContentHash() {
    const files = gitValue(["ls-files", "-co", "--exclude-standard"], "")
        .split(/\r?\n/)
        .filter(Boolean)
        .sort();
    const hash = crypto.createHash("sha256");
    for (const relativePath of files) {
        const absolutePath = path.join(projectRoot, relativePath);
        let stat;
        try {
            stat = fs.statSync(absolutePath);
        } catch {
            continue;
        }
        if (!stat.isFile()) continue;
        hash.update(relativePath.replace(/\\/g, "/"));
        hash.update("\0");
        hash.update(fs.readFileSync(absolutePath));
        hash.update("\0");
    }
    return hash.digest("hex");
}

const imageTag = process.env.PO18_IMAGE_TAG || "wenmoux/reader:v2.0";
const packageVersion = readPackageVersion();
const buildDate = process.env.PO18_BUILD_DATE || new Date().toISOString();
const buildStamp = process.env.PO18_BUILD_STAMP || compactBuildDate(new Date(buildDate)).replace(/Z$/, "");
const gitRevision = gitValue(["rev-parse", "--short=12", "HEAD"], "unknown");
const dirty = Boolean(gitValue(["status", "--porcelain", "--untracked-files=all"], ""));
const sourceHash = sourceContentHash();
const revision = process.env.PO18_BUILD_REVISION
    || `${gitRevision}${dirty ? `.dirty.${sourceHash.slice(0, 8)}` : ""}`;
const appVersion = process.env.PO18_APP_VERSION || `${packageVersion}+${buildStamp}${revision && revision !== "unknown" ? `.${revision}` : ""}`;

const args = [
    "build",
    "--provenance=false",
    "--target",
    "app",
    "--build-arg",
    `PO18_IMAGE_TAG=${imageTag}`,
    "--build-arg",
    `PO18_APP_VERSION=${appVersion}`,
    "--build-arg",
    `PO18_BUILD_DATE=${buildDate}`,
    "--build-arg",
    `PO18_BUILD_REVISION=${revision}`,
    "-t",
    imageTag,
    "."
];

console.log(`[docker-build] image=${imageTag}`);
console.log(`[docker-build] version=${appVersion}`);
console.log(`[docker-build] build_date=${buildDate}`);
console.log(`[docker-build] revision=${revision}`);
console.log(`[docker-build] source_hash=${sourceHash}`);
console.log(`[docker-build] dirty=${dirty}`);

const result = spawnSync("docker", args, {
    cwd: projectRoot,
    stdio: "inherit"
});

if ((result.status || 0) === 0) {
    const metadataPath = path.join(projectRoot, ".docker-build.json");
    fs.writeFileSync(metadataPath, JSON.stringify({
        imageTag,
        tags: [imageTag],
        appVersion,
        buildDate,
        buildStamp,
        revision,
        sourceHash,
        dirty
    }, null, 2));
    console.log(`[docker-build] metadata=${metadataPath}`);
}

process.exit(result.status || 0);
