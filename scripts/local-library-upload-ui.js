#!/usr/bin/env node

/**
 * [INPUT]: 依赖本地书库扫描器、Upload API 参数、HTTP 服务与拆分后的页面/样式/客户端资源
 * [OUTPUT]: 提供浏览器选择/扫描/上传本地小说目录的独立工具 API、静态资源路由、参数解析和启动入口
 * [POS]: scripts 的人机上传服务边界，复用 upload-local-library 能力并把浏览器展示与交互委托给独立资源
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

const express = require("express");
const fs = require("fs");
const path = require("path");
const {
    loadManifest,
    readChapterEditableText,
    scanLibrary,
    summarizeBooks,
    uploadManifest,
    writeManifest
} = require("./upload-local-library");

const DEFAULT_ROOT = "F:\\wenmoux\\novel\\alice\\alicesw-20260426\\alicesw";
const DEFAULT_PORT = 3199;
const DEFAULT_BASE_URL = `http://127.0.0.1:${process.env.PO18_UPLOAD_PORT || "3100"}`;
const DEFAULT_TAG = "成人";
const UPLOAD_STATE_PATH = path.resolve("tmp", "local-library-upload-state.json");
const UI_SHELL_CSS_PATH = path.join(__dirname, "local-library-upload-shell.css");
const UI_WORKSPACE_CSS_PATH = path.join(__dirname, "local-library-upload-workspace.css");
const UI_CLIENT_PATH = path.join(__dirname, "local-library-upload-client.js");

function parseArgs(argv = process.argv.slice(2)) {
    const options = {
        host: "127.0.0.1",
        port: DEFAULT_PORT,
        root: DEFAULT_ROOT,
        baseUrl: process.env.PO18_UPLOAD_BASE_URL || DEFAULT_BASE_URL,
        token: process.env.PO18_UPLOAD_API_TOKEN || ""
    };
    for (let i = 0; i < argv.length; i++) {
        const raw = argv[i];
        if (!raw.startsWith("--")) throw new Error(`Unexpected argument: ${raw}`);
        const key = raw.slice(2).split("=")[0];
        const eq = raw.indexOf("=");
        const value = eq >= 0 ? raw.slice(eq + 1) : argv[++i];
        if (key === "host") options.host = value || options.host;
        else if (key === "port") options.port = Number(value || DEFAULT_PORT);
        else if (key === "root") options.root = value || options.root;
        else if (key === "base-url") options.baseUrl = value || options.baseUrl;
        else if (key === "token") options.token = value || "";
        else if (key === "help") options.help = true;
        else throw new Error(`Unknown option: --${key}`);
    }
    return options;
}

function usage() {
    return `Usage:
  node scripts/local-library-upload-ui.js
  node scripts/local-library-upload-ui.js --port 3199 --base-url http://127.0.0.1:3100

Open:
  http://127.0.0.1:3199`;
}

function listValue(value, fallback = []) {
    const values = Array.isArray(value) ? value : String(value || "").split(/[,，、\n\r|/]+/);
    return values
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .concat(fallback)
        .filter((item, index, array) => array.findIndex((next) => next.toLowerCase() === item.toLowerCase()) === index);
}

function boolValue(value, fallback = false) {
    if (value === undefined || value === null || value === "") return fallback;
    return value === true || value === "true" || value === 1 || value === "1";
}

function intValue(value, fallback = 0, max = 100000) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) return fallback;
    return Math.min(max, Math.floor(number));
}

function scanOptions(body = {}, defaults = {}) {
    const platform = String(body.platform || "alice").trim() || "alice";
    return {
        root: String(body.root || defaults.root || DEFAULT_ROOT).trim() || DEFAULT_ROOT,
        out: String(body.out || "").trim(),
        platform,
        uploader: String(body.uploader || "local_library").trim() || "local_library",
        uploaderId: String(body.uploaderId || body.uploader_id || "local_library").trim() || "local_library",
        idPrefix: String(body.idPrefix || body.id_prefix || platform).trim() || platform,
        defaultTags: listValue(body.defaultTags ?? body.defaultTag, [DEFAULT_TAG]),
        defaultCategory: String(body.defaultCategory || DEFAULT_TAG).trim() || DEFAULT_TAG,
        status: String(body.status || "已完结").trim() || "unknown",
        overrides: String(body.overrides || body.overridesPath || "").trim(),
        limit: intValue(body.limit, 0, 100000),
        skipCached: boolValue(body.skipCached, false),
        splitSingleFile: boolValue(body.splitSingleFile, true),
        metadataBatchSize: intValue(body.metadataBatchSize, 50, 1000) || 50
    };
}

function publicBook(book) {
    return {
        index: book.index,
        selected: book.selected !== false,
        sourceName: book.sourceName,
        sourcePath: book.sourcePath,
        mode: book.mode,
        fileCount: book.fileCount,
        warnings: book.warnings || [],
        metadata: book.metadata,
        chapters: (book.chapters || []).map((chapter) => ({
            index: chapter.index,
            selected: chapter.selected !== false,
            chapterId: chapter.chapterId,
            chapterOrder: chapter.chapterOrder,
            title: chapter.title,
            wordCount: chapter.wordCount,
            sourcePath: chapter.sourcePath
        }))
    };
}

function normalizeManifestIndexes(manifest) {
    for (let i = 0; i < (manifest.books || []).length; i++) {
        const book = manifest.books[i];
        book.index = i;
        book.selected = book.selected !== false;
        for (let j = 0; j < (book.chapters || []).length; j++) {
            book.chapters[j].index = j;
            book.chapters[j].selected = book.chapters[j].selected !== false;
        }
    }
    manifest.summary = summarizeBooks(manifest.books || []);
    return manifest;
}

function loadUploadState() {
    try {
        return JSON.parse(fs.readFileSync(UPLOAD_STATE_PATH, "utf8"));
    } catch {
        return { uploadedBooks: {} };
    }
}

function saveUploadState(state) {
    fs.mkdirSync(path.dirname(UPLOAD_STATE_PATH), { recursive: true });
    fs.writeFileSync(UPLOAD_STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function filterUploadedBooks(manifest, enabled) {
    if (!enabled) return 0;
    const state = loadUploadState();
    const uploaded = state.uploadedBooks || {};
    const before = manifest.books.length;
    manifest.books = manifest.books.filter((book) => !uploaded[book.metadata?.bookId]);
    manifest.summary = summarizeBooks(manifest.books);
    return before - manifest.books.length;
}

function applyClientPatch(manifest, patch = {}) {
    const books = Array.isArray(patch.books) ? patch.books : [];
    const bookByIndex = new Map(books.map((book) => [Number(book.index), book]));
    for (let i = 0; i < manifest.books.length; i++) {
        const book = manifest.books[i];
        const nextBook = bookByIndex.get(i);
        if (!nextBook) continue;
        book.selected = nextBook.selected !== false;
        if (nextBook.metadata && typeof nextBook.metadata === "object") {
            const metadataKeys = [
                "bookId",
                "title",
                "author",
                "category",
                "tags",
                "description",
                "descriptionHtml",
                "wordCount",
                "chapterCount",
                "status",
                "detailUrl",
                "platform",
                "uploader",
                "uploaderId"
            ];
            for (const key of metadataKeys) {
                if (nextBook.metadata[key] !== undefined) book.metadata[key] = nextBook.metadata[key];
            }
        }
        const chapters = Array.isArray(nextBook.chapters) ? nextBook.chapters : [];
        const chapterByIndex = new Map(chapters.map((chapter) => [Number(chapter.index), chapter]));
        for (let j = 0; j < book.chapters.length; j++) {
            const chapter = book.chapters[j];
            const nextChapter = chapterByIndex.get(j);
            if (!nextChapter) continue;
            chapter.selected = nextChapter.selected !== false;
            if (nextChapter.chapterId !== undefined) chapter.chapterId = String(nextChapter.chapterId || "").trim() || String(j + 1);
            if (nextChapter.chapterOrder !== undefined) chapter.chapterOrder = Number(nextChapter.chapterOrder || j + 1);
            if (nextChapter.title !== undefined) chapter.title = String(nextChapter.title || "").trim() || `第${j + 1}章`;
            if (nextChapter.bodyOverride !== undefined) {
                chapter.bodyOverride = String(nextChapter.bodyOverride || "");
                chapter.wordCount = chapter.bodyOverride.length ? chapter.bodyOverride.length : chapter.wordCount;
            }
        }
        book.chapters = book.chapters.filter((chapter) => chapter.selected !== false);
        book.metadata.chapterCount = book.chapters.length;
        book.metadata.totalChapters = book.chapters.length;
        book.metadata.subscribedChapters = book.chapters.length;
        book.metadata.freeChapters = book.chapters.length;
    }
    manifest.books = manifest.books.filter((book) => book.selected !== false && book.chapters.length > 0);
    manifest.summary = summarizeBooks(manifest.books);
    return normalizeManifestIndexes(manifest);
}

function markUploadedBooks(manifest, enabled) {
    if (!enabled) return 0;
    const state = loadUploadState();
    state.uploadedBooks = state.uploadedBooks || {};
    const uploadedAt = new Date().toISOString();
    for (const book of manifest.books || []) {
        state.uploadedBooks[book.metadata.bookId] = {
            title: book.metadata.title,
            author: book.metadata.author,
            uploadedAt
        };
    }
    saveUploadState(state);
    return manifest.books.length;
}

function safeManifestPath(rawPath = "") {
    const resolved = path.resolve(String(rawPath || ""));
    const tmpRoot = path.resolve("tmp");
    if (!resolved.startsWith(`${tmpRoot}${path.sep}`)) throw new Error("Only tmp manifest files can be used by the standalone UI");
    return resolved;
}

function createApp(defaults = {}) {
    const app = express();
    app.use(express.json({ limit: "5mb" }));

    app.get("/", (req, res) => {
        res.type("html").send(pageHtml(defaults));
    });

    app.get("/assets/local-library-upload-shell.css", (req, res) => {
        res.type("text/css").sendFile(UI_SHELL_CSS_PATH);
    });

    app.get("/assets/local-library-upload-workspace.css", (req, res) => {
        res.type("text/css").sendFile(UI_WORKSPACE_CSS_PATH);
    });

    app.get("/assets/local-library-upload-client.js", (req, res) => {
        res.type("application/javascript").sendFile(UI_CLIENT_PATH);
    });

    app.get("/favicon.ico", (req, res) => {
        res.status(204).end();
    });

    app.get("/api/defaults", (req, res) => {
        res.json({
            root: defaults.root || DEFAULT_ROOT,
            baseUrl: defaults.baseUrl || DEFAULT_BASE_URL,
            token: defaults.token ? "configured" : ""
        });
    });

    app.post("/api/scan", async (req, res, next) => {
        try {
            const options = scanOptions(req.body || {}, defaults);
            const manifest = normalizeManifestIndexes(await scanLibrary(options));
            const skippedUploaded = filterUploadedBooks(manifest, boolValue(req.body?.skipUploaded, false));
            normalizeManifestIndexes(manifest);
            const written = await writeManifest(manifest, options);
            res.json({
                generatedAt: manifest.generatedAt,
                root: manifest.root,
                summary: manifest.summary,
                manifestPath: written.outPath,
                csvPath: written.csvPath,
                skippedUploaded,
                total: manifest.books.length,
                books: manifest.books.map(publicBook)
            });
        } catch (err) {
            next(err);
        }
    });

    app.post("/api/chapter-body", async (req, res, next) => {
        try {
            const manifestPath = safeManifestPath(req.body?.manifestPath);
            const bookIndex = Number(req.body?.bookIndex || 0);
            const chapterIndex = Number(req.body?.chapterIndex || 0);
            const manifest = normalizeManifestIndexes(await loadManifest(manifestPath));
            const book = manifest.books[bookIndex];
            const chapter = book?.chapters?.[chapterIndex];
            if (!book || !chapter) return res.status(404).json({ error: "章节不存在" });
            const text = await readChapterEditableText(book, chapter);
            res.json({ text, wordCount: text.length });
        } catch (err) {
            next(err);
        }
    });

    app.post("/api/upload", async (req, res, next) => {
        try {
            const confirm = String(req.body?.confirm || "").trim();
            if (confirm !== "UPLOAD") return res.status(400).json({ error: "确认词不正确", expectedConfirm: "UPLOAD" });
            const manifestPath = safeManifestPath(req.body?.manifestPath);
            const baseUrl = String(req.body?.baseUrl || defaults.baseUrl || DEFAULT_BASE_URL).trim();
            const token = String(req.body?.token || defaults.token || "").trim();
            const manifest = applyClientPatch(normalizeManifestIndexes(await loadManifest(manifestPath)), req.body?.patch || {});
            const stats = await uploadManifest(manifest, {
                baseUrl,
                token,
                skipCached: boolValue(req.body?.skipCached, false),
                metadataBatchSize: intValue(req.body?.metadataBatchSize, 50, 1000) || 50
            });
            const failed = Number(stats.chapterFailed || 0) + Number(stats.metadataFailed || 0);
            const markedUploaded = failed ? 0 : markUploadedBooks(manifest, boolValue(req.body?.markUploaded, true));
            res.json({ success: failed === 0, stats, markedUploaded });
        } catch (err) {
            next(err);
        }
    });

    app.get("/api/download", (req, res, next) => {
        try {
            const filePath = safeManifestPath(req.query.path);
            if (!fs.existsSync(filePath)) return res.status(404).json({ error: "文件不存在" });
            res.download(filePath);
        } catch (err) {
            next(err);
        }
    });

    app.use((err, req, res, next) => {
        if (res.headersSent) return next(err);
        res.status(500).json({ error: err.message || String(err) });
    });

    return app;
}

function pageHtml(defaults = {}) {
    const state = {
        root: defaults.root || DEFAULT_ROOT,
        baseUrl: defaults.baseUrl || DEFAULT_BASE_URL,
        token: defaults.token || ""
    };
    const serializedState = JSON.stringify(state).replace(/</g, "\\u003c");
    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>本地书库上传工作台</title>
  <link rel="stylesheet" href="/assets/local-library-upload-shell.css" />
  <link rel="stylesheet" href="/assets/local-library-upload-workspace.css" />
</head>
<body>
  <a class="skip-link" href="#settingsPanel">跳到设置</a>
  <main class="app">
    <header class="topbar">
      <div class="brand">
        <div class="mark" aria-hidden="true">UL</div>
        <div>
          <p class="eyebrow">Standalone Upload Console</p>
          <h1>本地书库上传工作台</h1>
          <p class="sub">独立扫描、校对、确认上传；默认标签包含成人，上传字段沿用现有接口。</p>
        </div>
      </div>
      <div class="actions">
        <button class="secondary" id="scanBtn" type="button">开始扫描</button>
        <button id="confirmBtn" type="button" disabled>确认上传</button>
      </div>
    </header>

    <nav class="steps" aria-label="上传流程">
      <div class="step active" data-step="settings"><span>1</span><strong>设置扫描</strong></div>
      <div class="step" data-step="scan"><span>2</span><strong>读取书库</strong></div>
      <div class="step" data-step="edit"><span>3</span><strong>校对清单</strong></div>
      <div class="step" data-step="done"><span>4</span><strong>确认上传</strong></div>
    </nav>

    <section class="layout-grid" id="settingsPanel">
      <section class="panel">
        <div class="panel-body">
          <div class="section-head">
            <div>
              <p class="section-title">导入设置</p>
              <p class="sub">路径、默认元信息与扫描策略。</p>
            </div>
          </div>
          <div class="settings">
            <label class="field wide"><span>书库目录</span><input id="root" autocomplete="off" /></label>
            <label class="field half"><span>上传服务</span><input id="baseUrl" autocomplete="off" /></label>
            <label class="field"><span>上传 token</span><input id="token" type="password" autocomplete="off" /></label>
            <label class="field"><span>平台字段</span><input id="platform" value="alice" autocomplete="off" /></label>
            <label class="field"><span>ID 前缀</span><input id="idPrefix" value="alice" autocomplete="off" /></label>
            <label class="field"><span>默认分类</span><input id="defaultCategory" value="成人" autocomplete="off" /></label>
            <label class="field"><span>默认标签</span><input id="defaultTags" value="成人" autocomplete="off" /></label>
            <label class="field"><span>默认状态</span><input id="status" value="已完结" autocomplete="off" /></label>
            <label class="field"><span>调试上限</span><input id="limit" type="number" min="0" step="1" value="0" /></label>
          </div>
        </div>
      </section>

      <aside class="panel">
        <div class="panel-body split-card">
          <div>
            <p class="section-title">扫描策略</p>
            <p class="sub">单文件小说可按章节标题拆分。</p>
          </div>
          <div class="toggle-group" role="group" aria-label="单文件处理">
            <button id="splitOn" class="active" type="button" aria-pressed="true">自动拆章</button>
            <button id="splitOff" type="button" aria-pressed="false">保留原文</button>
          </div>
          <div class="switch-stack">
            <label class="switch-line">
              <input id="skipCached" type="checkbox" />
              <span class="switch-track" aria-hidden="true"></span>
              <span class="switch-copy"><strong>上传跳过已有章节</strong><small>目标库已有章节时不重复写入。</small></span>
            </label>
            <label class="switch-line">
              <input id="skipUploaded" type="checkbox" checked />
              <span class="switch-track" aria-hidden="true"></span>
              <span class="switch-copy"><strong>扫描跳过已上传 OK</strong><small>基于本地上传记录过滤。</small></span>
            </label>
            <label class="switch-line">
              <input id="markUploaded" type="checkbox" checked />
              <span class="switch-track" aria-hidden="true"></span>
              <span class="switch-copy"><strong>成功后标记 OK</strong><small>下次扫描可自动跳过。</small></span>
            </label>
          </div>
        </div>
      </aside>
    </section>

    <section class="summary-panel panel" id="summaryPanel" hidden>
      <div class="summary-header">
        <div>
          <p class="section-title">扫描结果</p>
          <p class="sub" id="scanMeta">等待扫描</p>
        </div>
        <button class="secondary" id="csvBtn" type="button">下载 CSV</button>
      </div>
      <div class="metrics">
        <article class="metric"><span>已选书籍</span><strong id="bookCount">0</strong></article>
        <article class="metric"><span>已选章节</span><strong id="chapterCount">0</strong></article>
        <article class="metric"><span>预计字数</span><strong id="wordCount">0</strong></article>
        <article class="metric"><span>提示</span><strong id="warningCount">0</strong></article>
      </div>
      <div class="status-strip">
        <div class="path-line"><span>Manifest</span><strong id="manifestPath">-</strong></div>
        <div class="path-line"><span>CSV</span><strong id="csvPath">-</strong></div>
      </div>
      <div class="chips" id="categoryChips"></div>
    </section>

    <section class="workbench" id="booksPanel" hidden>
      <div class="workbench-head">
        <div>
          <p class="section-title">上传清单</p>
          <p class="sub">左侧选择书籍，右侧编辑元信息、章节目录和正文。</p>
        </div>
        <div class="toolbar">
          <input id="bookSearch" type="search" placeholder="搜索书名、作者、ID" aria-label="搜索书籍" />
          <button class="secondary" id="selectAllBooks" type="button">全选</button>
          <button class="secondary" id="clearBooks" type="button">清空</button>
        </div>
      </div>
      <div class="workspace">
        <aside class="queue-pane" aria-label="书籍队列">
          <div class="queue-summary"><span id="queueCount">0 本</span><span id="selectedCount">0 已选</span></div>
          <div class="book-list" id="bookRows"></div>
        </aside>
        <section class="editor-pane">
          <div class="empty-state" id="emptyEditor">扫描后选择一本书进行编辑。</div>
          <div class="editor-shell" id="bookEditor" hidden>
            <div class="editor-titlebar">
              <div>
                <h2 id="activeBookTitle">-</h2>
                <p class="sub" id="activeBookMeta">-</p>
              </div>
              <label class="select-banner">
                <input id="activeBookSelected" type="checkbox" />
                <span>纳入上传</span>
              </label>
            </div>
            <div class="metadata-grid" id="metadataFields"></div>
            <section class="chapter-block" id="chapterPanel">
              <div class="chapter-toolbar">
                <div>
                  <p class="section-title" id="chapterTitle">章节目录</p>
                  <p class="sub" id="chapterSubtitle">-</p>
                </div>
                <div class="toolbar">
                  <button class="secondary" id="selectAllChapters" type="button">全选章节</button>
                  <button class="secondary" id="clearChapters" type="button">清空章节</button>
                  <button class="ghost" id="closeChapters" type="button">收起目录</button>
                </div>
              </div>
              <div class="chapter-list">
                <div class="chapter-grid-head" aria-hidden="true">
                  <span>选</span><span>章节 ID</span><span>排序</span><span>标题</span><span>字数</span><span>正文</span>
                </div>
                <div id="chapterRows"></div>
              </div>
            </section>
          </div>
        </section>
      </div>
    </section>
  </main>

  <div class="modal" id="modal" role="dialog" aria-modal="true" aria-labelledby="uploadDialogTitle" hidden>
    <section class="modal-card">
      <div>
        <h3 id="uploadDialogTitle">确认上传</h3>
        <p class="sub" id="uploadSummary"></p>
      </div>
      <label class="confirm"><span>确认词</span><input id="confirmText" placeholder="UPLOAD" autocomplete="off" /></label>
      <div class="result-line" id="uploadResult" hidden><span id="metaOk">元信息 0</span><span id="chapterOk">章节 0</span><span id="failCount">失败 0</span></div>
      <div class="row">
        <button class="secondary" id="cancelUpload" type="button">取消</button>
        <button id="uploadBtn" type="button" disabled>上传</button>
      </div>
    </section>
  </div>

  <div class="modal" id="bodyModal" role="dialog" aria-modal="true" aria-labelledby="bodyTitle" hidden>
    <section class="modal-card wide">
      <div>
        <h3 id="bodyTitle">正文编辑</h3>
        <p class="sub" id="bodyMeta">保存后仅写入本次上传清单，不修改源文件。</p>
      </div>
      <textarea id="bodyText"></textarea>
      <div class="row">
        <button class="secondary" id="cancelBody" type="button">取消</button>
        <button id="saveBody" type="button">保存正文</button>
      </div>
    </section>
  </div>

  <div class="toast" id="toast" role="status" aria-live="polite"></div>

  <script>window.__LOCAL_LIBRARY_DEFAULTS__ = ${serializedState};</script>
  <script src="/assets/local-library-upload-client.js" defer></script>
</body>
</html>`;
}

async function main() {
    const options = parseArgs();
    if (options.help) {
        console.log(usage());
        return;
    }
    const app = createApp(options);
    app.listen(options.port, options.host, () => {
        console.log(`Local library upload UI: http://${options.host}:${options.port}`);
    });
}

if (require.main === module) {
    main().catch((err) => {
        console.error(err.stack || err.message || err);
        process.exitCode = 1;
    });
}

module.exports = { createApp, parseArgs, scanOptions };
