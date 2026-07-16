#!/usr/bin/env node

/**
 * [INPUT]: 依赖本地书库解析核心、manifest/上传服务、命令行参数与交互确认
 * [OUTPUT]: 提供兼容的本地书库导入 CLI，并统一转发扫描、manifest 与上传公共能力
 * [POS]: scripts 的本地书库导入组合根，保持既有命令和 require 接口稳定，不承载解析或传输细节
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

const path = require("path");
const readline = require("readline");
const core = require("./local-library-core");
const uploadService = require("./local-library-upload-service");

const { DEFAULT_PLATFORM, DEFAULT_TAG, DEFAULT_UPLOADER, scanLibrary, summarizeBooks, uniqueTokens } = core;
const { loadManifest, uploadManifest, writeManifest } = uploadService;
const DEFAULT_ROOT = "F:\\wenmoux\\novel\\alice\\alicesw-20260426\\alicesw";

function usage() {
    return `Usage:
  node scripts/upload-local-library.js --root "F:\\wenmoux\\novel\\alice\\alicesw-20260426\\alicesw"
  node scripts/upload-local-library.js --manifest tmp\\local-library-upload-*.json --upload

Options:
  --root <dir>                 要扫描的书库根目录，默认使用 alice 书库路径
  --manifest <file>            使用已有 manifest 上传，不重新扫描
  --out <file>                 manifest 输出路径，默认写入 tmp/
  --upload                     读取/扫描后上传；仍会要求输入 UPLOAD 确认
  --yes                        跳过交互确认，适合已经人工确认过 manifest 的自动化
  --base-url <url>             上传服务地址，默认 http://127.0.0.1:${process.env.PO18_UPLOAD_PORT || "3100"}
  --token <token>              上传 token，默认读取 PO18_UPLOAD_API_TOKEN
  --platform <name>            写入平台字段，默认 alice
  --uploader <name>            写入 uploader 字段，默认 local_library
  --uploader-id <id>           写入 uploaderId 字段，默认 local_library
  --id-prefix <prefix>         生成书籍 ID 前缀，默认等于 platform
  --default-tag <tag>          每本书默认标签，可重复，默认 成人
  --default-category <name>    无法推断分类时使用，默认 成人
  --status <status>            元信息状态，默认 已完结
  --overrides <json>           元信息覆盖表，key 可用 bookId / 书名 / 源目录名
  --limit <n>                  只处理前 n 本，调试用
  --skip-cached                上传章节前检查缓存，已存在的 chapterId 跳过
  --no-split                   单文件全本不按章节标题拆分
  --help                       显示帮助`;
}

function parseArgs(argv = process.argv.slice(2)) {
    const options = {
        root: DEFAULT_ROOT,
        manifest: "",
        out: "",
        upload: false,
        yes: false,
        baseUrl: process.env.PO18_UPLOAD_BASE_URL || `http://127.0.0.1:${process.env.PO18_UPLOAD_PORT || "3100"}`,
        token: process.env.PO18_UPLOAD_API_TOKEN || "",
        platform: DEFAULT_PLATFORM,
        uploader: DEFAULT_UPLOADER,
        uploaderId: DEFAULT_UPLOADER,
        idPrefix: "",
        defaultTags: [DEFAULT_TAG],
        defaultCategory: DEFAULT_TAG,
        status: "已完结",
        overrides: "",
        limit: 0,
        skipCached: false,
        splitSingleFile: true,
        metadataBatchSize: 50,
        help: false
    };

    const boolFlags = new Set(["upload", "yes", "skip-cached", "no-split", "help"]);
    const readValue = (index, raw) => {
        const eq = raw.indexOf("=");
        if (eq !== -1) return { value: raw.slice(eq + 1), next: index };
        if (index + 1 >= argv.length) throw new Error(`Missing value for ${raw}`);
        return { value: argv[index + 1], next: index + 1 };
    };

    for (let i = 0; i < argv.length; i++) {
        const raw = argv[i];
        if (!raw.startsWith("--")) throw new Error(`Unexpected argument: ${raw}`);
        const key = raw.slice(2).split("=")[0];
        if (boolFlags.has(key)) {
            if (key === "upload") options.upload = true;
            if (key === "yes") options.yes = true;
            if (key === "skip-cached") options.skipCached = true;
            if (key === "no-split") options.splitSingleFile = false;
            if (key === "help") options.help = true;
            continue;
        }

        const { value, next } = readValue(i, raw);
        i = next;
        if (key === "root") options.root = value;
        else if (key === "manifest") options.manifest = value;
        else if (key === "out") options.out = value;
        else if (key === "base-url") options.baseUrl = value;
        else if (key === "token") options.token = value;
        else if (key === "platform") options.platform = value || DEFAULT_PLATFORM;
        else if (key === "uploader") options.uploader = value || DEFAULT_UPLOADER;
        else if (key === "uploader-id") options.uploaderId = value || DEFAULT_UPLOADER;
        else if (key === "id-prefix") options.idPrefix = value;
        else if (key === "default-tag") options.defaultTags.push(value);
        else if (key === "default-category") options.defaultCategory = value || DEFAULT_TAG;
        else if (key === "status") options.status = value || "unknown";
        else if (key === "overrides") options.overrides = value;
        else if (key === "limit") options.limit = Number(value || 0);
        else if (key === "metadata-batch-size") options.metadataBatchSize = Math.max(1, Number(value || 50));
        else throw new Error(`Unknown option: --${key}`);
    }

    options.defaultTags = uniqueTokens(options.defaultTags);
    options.idPrefix = options.idPrefix || options.platform || DEFAULT_PLATFORM;
    return options;
}

async function confirmUpload(manifest, options) {
    if (options.yes) return true;
    if (!process.stdin.isTTY) throw new Error("Upload confirmation requires a TTY, or pass --yes after reviewing the manifest");
    console.log(`准备上传到 ${options.baseUrl}`);
    printSummary(manifest);
    const answer = await new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question("确认上传请准确输入 UPLOAD：", (value) => {
            rl.close();
            resolve(value.trim());
        });
    });
    return answer === "UPLOAD";
}

function printSummary(manifest) {
    const summary = manifest.summary || summarizeBooks(manifest.books || []);
    console.log(`书籍：${summary.books} 本；章节：${summary.chapters} 章；字数：${summary.words}`);
    console.log(
        `模式：${
            Object.entries(summary.modes || {})
                .map(([key, count]) => `${key}=${count}`)
                .join("，") || "-"
        }`
    );
    console.log(
        `分类：${
            Object.entries(summary.categories || {})
                .map(([key, count]) => `${key || "未分类"}=${count}`)
                .join("，") || "-"
        }`
    );
    if (summary.warnings) console.log(`提示：${summary.warnings} 条需要复核`);
}

async function main() {
    const options = parseArgs();
    if (options.help) {
        console.log(usage());
        return;
    }

    let manifest;
    let manifestPath = options.manifest ? path.resolve(options.manifest) : "";
    if (manifestPath) {
        manifest = await loadManifest(manifestPath);
        console.log(`已读取 manifest：${manifestPath}`);
    } else {
        manifest = await scanLibrary(options);
        const written = await writeManifest(manifest, options);
        manifestPath = written.outPath;
        console.log(`已生成 manifest：${written.outPath}`);
        console.log(`已生成 CSV：${written.csvPath}`);
    }

    printSummary(manifest);
    if (!options.upload) {
        console.log(`未上传。确认 CSV/JSON 后执行：node scripts/upload-local-library.js --manifest "${manifestPath}" --upload`);
        return;
    }

    const confirmed = await confirmUpload(manifest, options);
    if (!confirmed) {
        console.log("已取消上传。");
        return;
    }
    const stats = await uploadManifest(manifest, options);
    console.log(
        `上传完成：metadata ${stats.metadataSuccess} 成功 / ${stats.metadataFailed} 失败；章节 ${stats.chaptersUploaded} 上传，${stats.chaptersSkipped} 跳过，${stats.chapterFailed} 失败。`
    );
    if (stats.errors.length) {
        console.log("错误：");
        stats.errors.slice(0, 30).forEach((error) => console.log(`- ${error}`));
        if (stats.errors.length > 30) console.log(`... 还有 ${stats.errors.length - 30} 条`);
        process.exitCode = 1;
    }
}

if (require.main === module) {
    main().catch((err) => {
        console.error(err.stack || err.message || err);
        process.exitCode = 1;
    });
}

module.exports = {
    buildChapterPayload: uploadService.buildChapterPayload,
    decodeBuffer: core.decodeBuffer,
    inferCategory: core.inferCategory,
    parseArgs,
    readChapterEditableText: core.readChapterEditableText,
    scanLibrary,
    splitNovelText: core.splitNovelText,
    splitTitleAuthor: core.splitTitleAuthor,
    summarizeBooks,
    textToHtml: core.textToHtml,
    loadManifest,
    uploadManifest,
    uploadManifestDirect: uploadService.uploadManifestDirect,
    writeManifest,
    wordCount: core.wordCount
};
