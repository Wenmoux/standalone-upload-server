/**
 * [INPUT]: 依赖已构建镜像元数据、唯一发布标签、Docker CLI 与 registry 凭据环境
 * [OUTPUT]: 只推送配置的 v2.0 移动标签，并暴露可诊断的 registry 失败摘要
 * [POS]: scripts 的 registry 写入边界，把本地候选标签与 Docker Hub 唯一公开标签严格隔离
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
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
    const publishedTag = String(envImage || metadata.movableTag || metadata.imageTag || DEFAULT_IMAGE).trim();
    return [publishedTag || DEFAULT_IMAGE];
}

function githubCommandEscape(value) {
    return String(value || "")
        .replace(/%/g, "%25")
        .replace(/\r/g, "%0D")
        .replace(/\n/g, "%0A");
}

function pushFailureSummary(stdout = "", stderr = "") {
    const lines = `${stdout || ""}\n${stderr || ""}`
        .replace(/\u001b\[[0-9;]*m/g, "")
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter(Boolean);
    return lines.slice(-60).join("\n").slice(-9000) || "docker push failed without diagnostic output";
}

function push(tag, spawn = spawnSync, env = process.env) {
    console.log(`[docker-push] pushing ${tag}`);
    const captureForActions = String(env.GITHUB_ACTIONS || "").toLowerCase() === "true";
    const result = spawn(
        "docker",
        ["push", tag],
        captureForActions ? { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] } : { stdio: "inherit" }
    );
    if (captureForActions) {
        if (result.stdout) process.stdout.write(result.stdout);
        if (result.stderr) process.stderr.write(result.stderr);
    }
    const status = result.status === null ? 1 : result.status || 0;
    if (status !== 0) {
        const detail = captureForActions ? pushFailureSummary(result.stdout, result.stderr) : "";
        throw new Error(`docker push failed for ${tag}${detail ? `\n${detail}` : ""}`);
    }
}

function runPush(options = {}) {
    const env = options.env || process.env;
    const metadata = options.metadata || readBuildMetadata(options.metadataFile);
    const tags = selectPushTags(metadata, options.envImage ?? env.PO18_IMAGE_TAG);
    console.log(`[docker-push] tags=${tags.join(", ")}`);
    for (const tag of tags) push(tag, options.spawnSyncImpl || spawnSync, env);
    return tags;
}

function main() {
    try {
        runPush();
    } catch (error) {
        const message = error.message || String(error);
        console.error(`[docker-push] ${message}`);
        if (String(process.env.GITHUB_ACTIONS || "").toLowerCase() === "true") {
            console.error(`::error title=Docker image push failed::${githubCommandEscape(message)}`);
        }
        process.exitCode = 1;
    }
}

if (require.main === module) main();

module.exports = {
    DEFAULT_IMAGE,
    githubCommandEscape,
    push,
    pushFailureSummary,
    readBuildMetadata,
    runPush,
    selectPushTags
};
