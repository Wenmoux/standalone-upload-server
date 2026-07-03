const { execFileSync, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function readPackageVersion() {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
        return String(pkg.version || "0.0.0");
    } catch {
        return "0.0.0";
    }
}

function gitValue(args, fallback = "") {
    try {
        return execFileSync("git", args, { cwd: path.join(__dirname, ".."), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
        return fallback;
    }
}

function compactBuildDate(date = new Date()) {
    return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

const imageTag = process.env.PO18_IMAGE_TAG || "wenmoux/reader:v1.0";
const packageVersion = readPackageVersion();
const buildDate = process.env.PO18_BUILD_DATE || new Date().toISOString();
const buildStamp = process.env.PO18_BUILD_STAMP || compactBuildDate(new Date(buildDate)).replace(/Z$/, "");
const revision = process.env.PO18_BUILD_REVISION || gitValue(["rev-parse", "--short=12", "HEAD"], "unknown");
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

const result = spawnSync("docker", args, {
    cwd: path.join(__dirname, ".."),
    stdio: "inherit"
});

if ((result.status || 0) === 0) {
    const metadataPath = path.join(__dirname, "..", ".docker-build.json");
    fs.writeFileSync(metadataPath, JSON.stringify({
        imageTag,
        tags: [imageTag],
        appVersion,
        buildDate,
        buildStamp,
        revision
    }, null, 2));
    console.log(`[docker-build] metadata=${metadataPath}`);
}

process.exit(result.status || 0);
