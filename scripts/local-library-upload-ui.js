#!/usr/bin/env node

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
            const metadataKeys = ["bookId", "title", "author", "category", "tags", "description", "descriptionHtml", "wordCount", "chapterCount", "status", "detailUrl", "platform", "uploader", "uploaderId"];
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
        res.type("html").send(pageHtmlPro(defaults));
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

// Legacy fallback kept temporarily for CLI rollback compatibility.
// eslint-disable-next-line no-unused-vars
function pageHtml(defaults = {}) {
    const state = {
        root: defaults.root || DEFAULT_ROOT,
        baseUrl: defaults.baseUrl || DEFAULT_BASE_URL,
        token: defaults.token || ""
    };
    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>本地书库上传</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #eef3f8;
      --surface: #ffffff;
      --surface-soft: #f8fbff;
      --line: #d7e2ee;
      --text: #101828;
      --muted: #667085;
      --primary: #0f766e;
      --primary-dark: #0b5f59;
      --danger: #be123c;
      --shadow: 0 18px 44px rgba(15, 23, 42, 0.11);
      --radius: 8px;
    }
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, "Microsoft YaHei", sans-serif;
      letter-spacing: 0;
    }
    button, input, textarea, select { font: inherit; }
    button {
      min-height: 38px;
      border: 0;
      border-radius: var(--radius);
      padding: 0 14px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      color: #fff;
      background: var(--primary);
      font-weight: 760;
      cursor: pointer;
      box-shadow: 0 8px 18px rgba(15, 118, 110, 0.22);
    }
    button:hover { background: var(--primary-dark); }
    button:disabled { opacity: .55; cursor: not-allowed; }
    button.secondary {
      border: 1px solid #cbd8e6;
      background: #fff;
      color: #315071;
      box-shadow: none;
    }
    input, textarea {
      width: 100%;
      min-height: 40px;
      border: 1px solid #cbd8e6;
      border-radius: var(--radius);
      padding: 9px 11px;
      background: var(--surface-soft);
      color: var(--text);
      outline: none;
    }
    input:focus, textarea:focus {
      border-color: var(--primary);
      background: #fff;
      box-shadow: 0 0 0 4px rgba(15, 118, 110, 0.12);
    }
    .app {
      width: min(1240px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 24px 0 56px;
      display: grid;
      gap: 16px;
    }
    .topbar, .panel {
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: rgba(255, 255, 255, .96);
      box-shadow: var(--shadow);
    }
    .topbar {
      min-height: 72px;
      padding: 16px 18px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      backdrop-filter: saturate(140%) blur(14px);
    }
    .brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .mark {
      width: 40px;
      height: 40px;
      border-radius: 8px;
      display: grid;
      place-items: center;
      background: #102a2a;
      color: #d6fff7;
      font-weight: 850;
    }
    h1, h2, h3, p { margin: 0; }
    .brand h1 { font-size: 18px; line-height: 1.2; }
    .sub { color: var(--muted); line-height: 1.55; font-size: 13px; }
    .actions, .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .panel { padding: 18px; }
    .section-head {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: flex-start;
      margin-bottom: 14px;
    }
    .section-title { font-size: 16px; font-weight: 850; }
    .settings {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }
    .pref, .switch-row {
      min-height: 64px;
      display: grid;
      align-content: center;
      gap: 6px;
      padding: 10px 12px;
      border: 1px solid #dce6f0;
      border-radius: var(--radius);
      background: #fbfdff;
    }
    .pref.wide, .switch-row.wide { grid-column: 1 / -1; }
    .pref span, .confirm span {
      color: var(--muted);
      font-size: 12px;
      font-weight: 760;
    }
    .switch-row {
      grid-template-columns: auto auto 1fr;
      align-items: center;
      gap: 10px;
    }
    .switch-row input {
      position: absolute;
      width: 0;
      height: 0;
      opacity: 0;
    }
    .switch-row i {
      width: 44px;
      height: 26px;
      border-radius: 999px;
      background: #d0d5dd;
      position: relative;
      transition: background .18s ease;
    }
    .switch-row i::after {
      content: "";
      position: absolute;
      top: 3px;
      left: 3px;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: #fff;
      box-shadow: 0 2px 5px rgba(15, 23, 42, .22);
      transition: transform .18s ease;
    }
    .switch-row input:checked + i { background: #111827; }
    .switch-row input:checked + i::after { transform: translateX(18px); }
    .segmented {
      display: inline-grid;
      grid-template-columns: repeat(2, minmax(76px, 1fr));
      gap: 4px;
      padding: 4px;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: #f8fafc;
    }
    .segmented button {
      min-height: 32px;
      border-radius: 6px;
      background: transparent;
      color: #52637a;
      box-shadow: none;
    }
    .segmented button.active { background: #101828; color: #fff; }
    .stats {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
    }
    .stat {
      min-height: 96px;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: #fbfdff;
      padding: 13px 14px;
      display: grid;
      align-content: center;
      gap: 6px;
    }
    .stat span { color: var(--muted); font-size: 12px; font-weight: 760; }
    .stat strong { font-size: 27px; }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .chip {
      min-height: 26px;
      display: inline-flex;
      align-items: center;
      padding: 3px 8px;
      border-radius: 6px;
      background: #eef2ff;
      color: #344054;
      font-size: 12px;
      font-weight: 720;
    }
    .table-wrap {
      max-height: 560px;
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: var(--radius);
    }
    table { width: 100%; border-collapse: collapse; background: #fff; }
    th, td {
      padding: 10px 12px;
      border-bottom: 1px solid #e6edf5;
      text-align: left;
      vertical-align: top;
      font-size: 13px;
    }
    th {
      position: sticky;
      top: 0;
      z-index: 1;
      background: #eef5f8;
      font-weight: 830;
    }
    td:first-child { min-width: 260px; }
    td strong, td small { display: block; }
    td small { margin-top: 3px; color: var(--muted); font-size: 11px; }
    .modal {
      position: fixed;
      inset: 0;
      z-index: 30;
      display: grid;
      place-items: center;
      padding: 18px;
      background: rgba(15, 23, 42, .38);
    }
    .modal-card {
      width: min(520px, 100%);
      border-radius: var(--radius);
      border: 1px solid var(--line);
      background: #fff;
      box-shadow: var(--shadow);
      padding: 18px;
      display: grid;
      gap: 14px;
    }
    .confirm { display: grid; gap: 6px; }
    .result-line { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .result-line span {
      min-height: 40px;
      display: grid;
      place-items: center;
      border-radius: var(--radius);
      background: #f2f4f7;
      color: #344054;
      font-weight: 760;
    }
    .toast {
      position: fixed;
      right: 18px;
      bottom: 18px;
      max-width: min(420px, calc(100vw - 36px));
      padding: 12px 14px;
      border-radius: var(--radius);
      background: rgba(17, 24, 39, .9);
      color: #fff;
      box-shadow: var(--shadow);
      display: none;
    }
    .toast.show { display: block; }
    @media (max-width: 900px) {
      .settings, .stats { grid-template-columns: 1fr; }
      .topbar, .section-head { align-items: stretch; flex-direction: column; }
    }
  </style>
</head>
<body>
  <main class="app">
    <header class="topbar">
      <div class="brand">
        <div class="mark">U</div>
        <div>
          <h1>本地书库上传</h1>
          <p class="sub">独立扫描、预览、确认、上传</p>
        </div>
      </div>
      <div class="actions">
        <button class="secondary" id="scanBtn">扫描</button>
        <button id="confirmBtn" disabled>确认上传</button>
      </div>
    </header>

    <section class="panel">
      <div class="section-head">
        <div>
          <p class="section-title">导入设置</p>
          <p class="sub">字段与现有上传接口保持一致，默认标签包含成人。</p>
        </div>
        <div class="segmented">
          <button id="splitOn" class="active" type="button">拆章</button>
          <button id="splitOff" type="button">原文件</button>
        </div>
      </div>
      <div class="settings">
        <label class="pref wide"><span>书库目录</span><input id="root" /></label>
        <label class="pref"><span>上传服务</span><input id="baseUrl" /></label>
        <label class="pref"><span>上传 token</span><input id="token" type="password" autocomplete="off" /></label>
        <label class="pref"><span>平台字段</span><input id="platform" value="alice" /></label>
        <label class="pref"><span>ID 前缀</span><input id="idPrefix" value="alice" /></label>
        <label class="pref"><span>默认分类</span><input id="defaultCategory" value="成人" /></label>
        <label class="pref"><span>默认标签</span><input id="defaultTags" value="成人" /></label>
        <label class="pref"><span>状态</span><input id="status" value="已完结" /></label>
        <label class="pref"><span>调试上限</span><input id="limit" type="number" min="0" step="1" value="0" /></label>
        <label class="switch-row wide"><input id="skipCached" type="checkbox" /><i></i><strong>上传时跳过已有章节</strong></label>
        <label class="switch-row wide"><input id="skipUploaded" type="checkbox" checked /><i></i><strong>扫描时跳过已上传 OK 小说</strong></label>
        <label class="switch-row wide"><input id="markUploaded" type="checkbox" checked /><i></i><strong>上传成功后标记为 OK</strong></label>
      </div>
    </section>

    <section class="panel" id="summaryPanel" hidden>
      <div class="section-head">
        <div>
          <p class="section-title">扫描结果</p>
          <p class="sub" id="manifestPath"></p>
        </div>
        <button class="secondary" id="csvBtn" type="button">CSV</button>
      </div>
      <div class="stats">
        <article class="stat"><span>书籍</span><strong id="bookCount">0</strong></article>
        <article class="stat"><span>章节</span><strong id="chapterCount">0</strong></article>
        <article class="stat"><span>字数</span><strong id="wordCount">0</strong></article>
        <article class="stat"><span>提示</span><strong id="warningCount">0</strong></article>
      </div>
      <div class="chips" id="categoryChips"></div>
    </section>

    <section class="panel" id="booksPanel" hidden>
      <div class="section-head">
        <div>
          <p class="section-title">书籍预览</p>
          <p class="sub" id="csvPath"></p>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>选</th><th>书号 / 书名</th><th>作者</th><th>分类</th><th>标签</th><th>章节</th><th>字数</th><th>目录</th><th>提示</th>
            </tr>
          </thead>
          <tbody id="bookRows"></tbody>
        </table>
      </div>
    </section>

    <section class="panel" id="chapterPanel" hidden>
      <div class="section-head">
        <div>
          <p class="section-title" id="chapterTitle">章节目录</p>
          <p class="sub">可修改章节 ID、排序和标题；正文按钮可打开原文编辑。</p>
        </div>
        <button class="secondary" id="closeChapters" type="button">收起</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>选</th><th>章节 ID</th><th>排序</th><th>标题</th><th>字数</th><th>正文</th></tr>
          </thead>
          <tbody id="chapterRows"></tbody>
        </table>
      </div>
    </section>
  </main>

  <div class="modal" id="modal" hidden>
    <section class="modal-card">
      <div>
        <h3>确认上传</h3>
        <p class="sub" id="uploadSummary"></p>
      </div>
      <label class="confirm"><span>确认词</span><input id="confirmText" placeholder="UPLOAD" /></label>
      <div class="result-line" id="uploadResult" hidden><span id="metaOk">元信息 0</span><span id="chapterOk">章节 0</span><span id="failCount">失败 0</span></div>
      <div class="row" style="justify-content:flex-end">
        <button class="secondary" id="cancelUpload" type="button">取消</button>
        <button id="uploadBtn" type="button" disabled>上传</button>
      </div>
    </section>
  </div>
  <div class="modal" id="bodyModal" hidden>
    <section class="modal-card" style="width:min(920px,100%)">
      <div>
        <h3 id="bodyTitle">正文编辑</h3>
        <p class="sub">保存后仅写入本次上传清单，不改源文件。</p>
      </div>
      <textarea id="bodyText" style="min-height:420px;line-height:1.6"></textarea>
      <div class="row" style="justify-content:flex-end">
        <button class="secondary" id="cancelBody" type="button">取消</button>
        <button id="saveBody" type="button">保存正文</button>
      </div>
    </section>
  </div>
  <div class="toast" id="toast"></div>

  <script>
    const defaults = ${JSON.stringify(state)};
    const $ = (id) => document.getElementById(id);
    let splitSingleFile = true;
    let current = null;
    let activeBookIndex = -1;
    let activeBodyRef = null;
    $("root").value = defaults.root;
    $("baseUrl").value = defaults.baseUrl;
    $("token").value = defaults.token;

    function showToast(message) {
      const node = $("toast");
      node.textContent = message || "";
      node.classList.toggle("show", !!message);
      clearTimeout(showToast.timer);
      if (message) showToast.timer = setTimeout(() => node.classList.remove("show"), 3200);
    }
    function number(value) { return Number(value || 0).toLocaleString("zh-CN"); }
    function text(value) { return String(value ?? ""); }
    function modeLabel(value) {
      return { "chapter-files": "章节文件", "single-file": "单文件", "single-file-split": "单文件拆章" }[value] || value || "-";
    }
    function escapeHtml(value) {
      return text(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
    }
    function payload() {
      return {
        root: $("root").value,
        platform: $("platform").value,
        idPrefix: $("idPrefix").value || $("platform").value,
        defaultCategory: $("defaultCategory").value,
        defaultTags: $("defaultTags").value,
        status: $("status").value,
        limit: Number($("limit").value || 0),
        splitSingleFile,
        skipCached: $("skipCached").checked,
        skipUploaded: $("skipUploaded").checked
      };
    }
    async function request(url, body) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "请求失败");
      return data;
    }
    function render(data) {
      current = data;
      activeBookIndex = -1;
      current.books = (current.books || []).map((book, index) => ({
        ...book,
        index,
        selected: book.selected !== false,
        chapters: (book.chapters || []).map((chapter, chapterIndex) => ({
          ...chapter,
          index: chapterIndex,
          selected: chapter.selected !== false
        }))
      }));
      $("summaryPanel").hidden = false;
      $("booksPanel").hidden = false;
      $("chapterPanel").hidden = true;
      $("confirmBtn").disabled = !data.manifestPath;
      $("manifestPath").textContent = data.manifestPath || "";
      $("csvPath").textContent = data.csvPath || "";
      $("bookCount").textContent = number(data.summary?.books);
      $("chapterCount").textContent = number(data.summary?.chapters);
      $("wordCount").textContent = number(data.summary?.words);
      $("warningCount").textContent = number(data.summary?.warnings);
      $("categoryChips").innerHTML = Object.entries(data.summary?.categories || {}).map(([name, count]) => '<span class="chip">' + escapeHtml(name || "未分类") + " " + number(count) + "</span>").join("");
      renderBooks();
    }
    function renderBooks() {
      $("bookRows").innerHTML = (current?.books || []).map((book, index) => {
        const m = book.metadata || {};
        return "<tr>" +
          '<td><input type="checkbox" data-book="' + index + '" data-field="selected" ' + (book.selected ? "checked" : "") + "></td>" +
          '<td><input data-book="' + index + '" data-meta="bookId" value="' + escapeHtml(m.bookId) + '"><input style="margin-top:6px" data-book="' + index + '" data-meta="title" value="' + escapeHtml(m.title) + '"><textarea style="margin-top:6px;min-height:64px" data-book="' + index + '" data-meta="description">' + escapeHtml(m.description || "") + '</textarea></td>' +
          '<td><input data-book="' + index + '" data-meta="author" value="' + escapeHtml(m.author) + '"></td>' +
          '<td><input data-book="' + index + '" data-meta="category" value="' + escapeHtml(m.category) + '"></td>' +
          '<td><input data-book="' + index + '" data-meta="tags" value="' + escapeHtml(m.tags) + '"></td>' +
          "<td>" + number(m.chapterCount) + "</td>" +
          "<td>" + number(m.wordCount) + "</td>" +
          '<td><button class="secondary" type="button" data-open-chapters="' + index + '">' + escapeHtml(modeLabel(book.mode)) + '</button></td>' +
          "<td>" + escapeHtml((book.warnings || []).join("；") || "-") + "</td>" +
          "</tr>";
      }).join("");
    }
    function renderChapters(bookIndex) {
      const book = current?.books?.[bookIndex];
      if (!book) return;
      activeBookIndex = bookIndex;
      $("chapterPanel").hidden = false;
      $("chapterTitle").textContent = "章节目录 · " + (book.metadata?.title || book.metadata?.bookId || "");
      $("chapterRows").innerHTML = (book.chapters || []).map((chapter, index) => {
        return "<tr>" +
          '<td><input type="checkbox" data-chapter="' + index + '" data-field="selected" ' + (chapter.selected ? "checked" : "") + "></td>" +
          '<td><input data-chapter="' + index + '" data-field="chapterId" value="' + escapeHtml(chapter.chapterId) + '"></td>' +
          '<td><input type="number" min="1" step="1" data-chapter="' + index + '" data-field="chapterOrder" value="' + escapeHtml(chapter.chapterOrder || index + 1) + '"></td>' +
          '<td><input data-chapter="' + index + '" data-field="title" value="' + escapeHtml(chapter.title) + '"></td>' +
          "<td>" + number(chapter.wordCount) + (chapter.bodyOverride !== undefined ? " *" : "") + "</td>" +
          '<td><button class="secondary" type="button" data-edit-body="' + index + '">正文</button></td>' +
          "</tr>";
      }).join("");
      $("chapterPanel").scrollIntoView({ behavior: "smooth", block: "start" });
    }
    function buildPatch() {
      return {
        books: (current?.books || []).map((book, index) => ({
          index,
          selected: book.selected !== false,
          metadata: book.metadata || {},
          chapters: (book.chapters || []).map((chapter, chapterIndex) => ({
            index: chapterIndex,
            selected: chapter.selected !== false,
            chapterId: chapter.chapterId,
            chapterOrder: chapter.chapterOrder,
            title: chapter.title,
            ...(chapter.bodyOverride !== undefined ? { bodyOverride: chapter.bodyOverride } : {})
          }))
        }))
      };
    }
    $("splitOn").onclick = () => {
      splitSingleFile = true;
      $("splitOn").classList.add("active");
      $("splitOff").classList.remove("active");
    };
    $("splitOff").onclick = () => {
      splitSingleFile = false;
      $("splitOff").classList.add("active");
      $("splitOn").classList.remove("active");
    };
    $("bookRows").addEventListener("input", (event) => {
      const target = event.target;
      const index = Number(target.dataset.book);
      const meta = target.dataset.meta;
      if (!current?.books?.[index] || !meta) return;
      current.books[index].metadata[meta] = target.value;
    });
    $("bookRows").addEventListener("change", (event) => {
      const target = event.target;
      const index = Number(target.dataset.book);
      if (!current?.books?.[index] || target.dataset.field !== "selected") return;
      current.books[index].selected = target.checked;
    });
    $("bookRows").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-open-chapters]");
      if (!button) return;
      renderChapters(Number(button.dataset.openChapters));
    });
    $("chapterRows").addEventListener("input", (event) => {
      const target = event.target;
      const chapterIndex = Number(target.dataset.chapter);
      const field = target.dataset.field;
      const chapter = current?.books?.[activeBookIndex]?.chapters?.[chapterIndex];
      if (!chapter || !field || field === "selected") return;
      chapter[field] = field === "chapterOrder" ? Number(target.value || chapterIndex + 1) : target.value;
    });
    $("chapterRows").addEventListener("change", (event) => {
      const target = event.target;
      const chapterIndex = Number(target.dataset.chapter);
      const chapter = current?.books?.[activeBookIndex]?.chapters?.[chapterIndex];
      if (!chapter || target.dataset.field !== "selected") return;
      chapter.selected = target.checked;
    });
    $("chapterRows").addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-edit-body]");
      if (!button || !current?.manifestPath) return;
      const chapterIndex = Number(button.dataset.editBody);
      const book = current.books[activeBookIndex];
      const chapter = book?.chapters?.[chapterIndex];
      if (!book || !chapter) return;
      activeBodyRef = { bookIndex: activeBookIndex, chapterIndex };
      $("bodyTitle").textContent = "正文编辑 · " + (chapter.title || chapter.chapterId || "");
      $("bodyText").value = chapter.bodyOverride !== undefined ? chapter.bodyOverride : "读取中...";
      $("bodyModal").hidden = false;
      if (chapter.bodyOverride === undefined) {
        try {
          const data = await request("/api/chapter-body", {
            manifestPath: current.manifestPath,
            bookIndex: activeBookIndex,
            chapterIndex
          });
          $("bodyText").value = data.text || "";
        } catch (err) {
          showToast(err.message || String(err));
          $("bodyModal").hidden = true;
        }
      }
    });
    $("closeChapters").onclick = () => { $("chapterPanel").hidden = true; activeBookIndex = -1; };
    $("cancelBody").onclick = () => { $("bodyModal").hidden = true; activeBodyRef = null; };
    $("saveBody").onclick = () => {
      const ref = activeBodyRef;
      const chapter = current?.books?.[ref?.bookIndex]?.chapters?.[ref?.chapterIndex];
      if (!chapter) return;
      chapter.bodyOverride = $("bodyText").value;
      chapter.wordCount = Array.from(chapter.bodyOverride.replace(/\s+/g, "")).length;
      $("bodyModal").hidden = true;
      renderChapters(ref.bookIndex);
      showToast("正文已保存到本次上传清单");
    };
    $("scanBtn").onclick = async () => {
      $("scanBtn").disabled = true;
      $("scanBtn").textContent = "扫描中...";
      try {
        const data = await request("/api/scan", payload());
        render(data);
        showToast("扫描完成：" + number(data.summary?.books) + " 本");
      } catch (err) {
        showToast(err.message || String(err));
      } finally {
        $("scanBtn").disabled = false;
        $("scanBtn").textContent = "扫描";
      }
    };
    $("csvBtn").onclick = () => {
      if (current?.csvPath) window.open("/api/download?path=" + encodeURIComponent(current.csvPath), "_blank");
    };
    $("confirmBtn").onclick = () => {
      if (!current?.manifestPath) return;
      $("uploadSummary").textContent = number(current.summary?.books) + " 本 / " + number(current.summary?.chapters) + " 章";
      $("confirmText").value = "";
      $("uploadResult").hidden = true;
      $("uploadBtn").disabled = true;
      $("modal").hidden = false;
      $("confirmText").focus();
    };
    $("cancelUpload").onclick = () => { $("modal").hidden = true; };
    $("confirmText").oninput = () => { $("uploadBtn").disabled = $("confirmText").value.trim() !== "UPLOAD"; };
    $("uploadBtn").onclick = async () => {
      if (!current?.manifestPath || $("confirmText").value.trim() !== "UPLOAD") return;
      $("uploadBtn").disabled = true;
      $("uploadBtn").textContent = "上传中...";
      try {
        const data = await request("/api/upload", {
          manifestPath: current.manifestPath,
          baseUrl: $("baseUrl").value,
          token: $("token").value,
          confirm: $("confirmText").value.trim(),
          skipCached: $("skipCached").checked,
          markUploaded: $("markUploaded").checked,
          patch: buildPatch()
        });
        const stats = data.stats || {};
        $("uploadResult").hidden = false;
        $("metaOk").textContent = "元信息 " + number(stats.metadataSuccess);
        $("chapterOk").textContent = "章节 " + number(stats.chaptersUploaded);
        $("failCount").textContent = "失败 " + number((stats.metadataFailed || 0) + (stats.chapterFailed || 0));
        showToast("上传完成，标记 OK " + number(data.markedUploaded || 0) + " 本");
      } catch (err) {
        showToast(err.message || String(err));
      } finally {
        $("uploadBtn").disabled = $("confirmText").value.trim() !== "UPLOAD";
        $("uploadBtn").textContent = "上传";
      }
    };
  </script>
</body>
</html>`;
}

function pageHtmlPro(defaults = {}) {
    const state = {
        root: defaults.root || DEFAULT_ROOT,
        baseUrl: defaults.baseUrl || DEFAULT_BASE_URL,
        token: defaults.token || ""
    };
    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>本地书库上传工作台</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f4f7fb;
      --surface: #ffffff;
      --surface-soft: #f8fafc;
      --surface-tint: #edf7f5;
      --line: #d7e1ea;
      --line-strong: #b8c7d6;
      --text: #172033;
      --muted: #64748b;
      --muted-strong: #475569;
      --primary: #0f766e;
      --primary-strong: #0b615b;
      --primary-soft: #d9f4ef;
      --accent: #2563eb;
      --accent-soft: #dbeafe;
      --success: #15803d;
      --warning: #b45309;
      --danger: #be123c;
      --focus: rgba(37, 99, 235, .22);
      --shadow: 0 18px 38px rgba(15, 23, 42, .09);
      --shadow-soft: 0 8px 20px rgba(15, 23, 42, .06);
      --radius: 8px;
      --radius-sm: 6px;
      --max: 1440px;
      --z-modal: 40;
      --z-toast: 50;
    }
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    html { min-height: 100%; scroll-behavior: smooth; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, "Segoe UI", -apple-system, BlinkMacSystemFont, "Microsoft YaHei", Arial, sans-serif;
      font-size: 16px;
      line-height: 1.5;
      letter-spacing: 0;
    }
    body, button, input, textarea { -webkit-font-smoothing: antialiased; }
    h1, h2, h3, p { margin: 0; }
    button, input, textarea, select { font: inherit; }
    button {
      min-height: 44px;
      border: 1px solid transparent;
      border-radius: var(--radius);
      padding: 0 16px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      color: #ffffff;
      background: var(--primary);
      font-weight: 760;
      cursor: pointer;
      touch-action: manipulation;
      box-shadow: 0 10px 18px rgba(15, 118, 110, .18);
      transition: background .18s ease, border-color .18s ease, box-shadow .18s ease, opacity .18s ease;
    }
    button:hover { background: var(--primary-strong); }
    button:active { box-shadow: 0 5px 12px rgba(15, 118, 110, .16); }
    button:disabled { opacity: .46; cursor: not-allowed; box-shadow: none; }
    button.secondary {
      color: var(--muted-strong);
      background: #ffffff;
      border-color: var(--line);
      box-shadow: none;
    }
    button.secondary:hover { color: var(--text); background: #f8fafc; border-color: var(--line-strong); }
    button.ghost {
      color: var(--muted-strong);
      background: transparent;
      border-color: transparent;
      box-shadow: none;
    }
    button.ghost:hover { color: var(--text); background: #eef3f8; }
    button.is-loading::before {
      content: "";
      width: 14px;
      height: 14px;
      border: 2px solid currentColor;
      border-right-color: transparent;
      border-radius: 999px;
      animation: spin .75s linear infinite;
    }
    input, textarea {
      width: 100%;
      min-height: 44px;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 10px 12px;
      background: var(--surface-soft);
      color: var(--text);
      outline: none;
      transition: background .18s ease, border-color .18s ease, box-shadow .18s ease;
    }
    textarea { resize: vertical; }
    input[type="checkbox"] {
      width: 18px;
      height: 18px;
      min-height: 18px;
      accent-color: var(--primary);
      flex: 0 0 auto;
    }
    input:focus-visible, textarea:focus-visible, button:focus-visible {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 0 4px var(--focus);
    }
    .skip-link {
      position: fixed;
      left: -999px;
      top: 12px;
      z-index: var(--z-toast);
      padding: 8px 12px;
      border-radius: var(--radius-sm);
      background: var(--text);
      color: #fff;
      text-decoration: none;
      transition: left .18s ease;
    }
    .skip-link:focus { left: 16px; }
    .app {
      width: min(var(--max), calc(100vw - 32px));
      margin: 0 auto;
      padding: 24px 0 56px;
      display: grid;
      gap: 16px;
    }
    .topbar {
      min-height: 96px;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 16px;
      align-items: center;
      padding: 20px;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--surface);
      box-shadow: var(--shadow);
    }
    .brand {
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .mark {
      width: 48px;
      height: 48px;
      border-radius: var(--radius);
      display: grid;
      place-items: center;
      flex: 0 0 auto;
      background: #123c3a;
      color: #d9fffa;
      font-size: 15px;
      font-weight: 850;
    }
    .eyebrow {
      color: var(--primary);
      font-size: 12px;
      font-weight: 820;
      text-transform: uppercase;
      letter-spacing: .08em;
    }
    h1 {
      margin-top: 2px;
      font-size: clamp(24px, 3vw, 34px);
      line-height: 1.16;
      letter-spacing: 0;
    }
    .sub {
      color: var(--muted);
      font-size: 13px;
      line-height: 1.55;
    }
    .topbar .sub { margin-top: 6px; max-width: 760px; }
    .actions, .row {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      flex-wrap: wrap;
    }
    .steps {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
    }
    .step {
      min-height: 56px;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--surface);
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      color: var(--muted-strong);
      box-shadow: var(--shadow-soft);
    }
    .step span {
      width: 28px;
      height: 28px;
      border-radius: 999px;
      display: grid;
      place-items: center;
      flex: 0 0 auto;
      background: #e8eef5;
      color: var(--muted-strong);
      font-size: 13px;
      font-weight: 820;
    }
    .step strong { font-size: 13px; }
    .step.active { border-color: rgba(15, 118, 110, .42); background: var(--surface-tint); color: var(--text); }
    .step.active span { background: var(--primary); color: #fff; }
    .layout-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.35fr) minmax(320px, .65fr);
      gap: 16px;
      align-items: start;
    }
    .panel {
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--surface);
      box-shadow: var(--shadow-soft);
    }
    .panel-body { padding: 18px; }
    .section-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 16px;
    }
    .section-title {
      font-size: 16px;
      font-weight: 850;
      line-height: 1.25;
    }
    .settings {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }
    .field {
      display: grid;
      gap: 6px;
      min-width: 0;
    }
    .field.wide { grid-column: 1 / -1; }
    .field.half { grid-column: span 2; }
    .field span, .field-label, .confirm span {
      color: var(--muted-strong);
      font-size: 12px;
      font-weight: 780;
    }
    .split-card {
      display: grid;
      gap: 14px;
    }
    .toggle-group {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 4px;
      padding: 4px;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--surface-soft);
    }
    .toggle-group button {
      min-height: 40px;
      color: var(--muted-strong);
      background: transparent;
      border: 0;
      box-shadow: none;
      padding: 0 10px;
    }
    .toggle-group button.active {
      color: #fff;
      background: #172033;
    }
    .switch-stack { display: grid; gap: 10px; }
    .switch-line {
      min-height: 56px;
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 12px;
      align-items: center;
      padding: 10px 12px;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--surface-soft);
      cursor: pointer;
    }
    .switch-line input {
      position: absolute;
      width: 1px;
      height: 1px;
      opacity: 0;
      pointer-events: none;
    }
    .switch-track {
      width: 46px;
      height: 28px;
      border-radius: 999px;
      background: #cbd5e1;
      position: relative;
      transition: background .18s ease, box-shadow .18s ease;
    }
    .switch-track::after {
      content: "";
      position: absolute;
      top: 4px;
      left: 4px;
      width: 20px;
      height: 20px;
      border-radius: 999px;
      background: #fff;
      box-shadow: 0 2px 5px rgba(15, 23, 42, .22);
      transition: transform .18s ease;
    }
    .switch-line input:checked + .switch-track { background: var(--primary); }
    .switch-line input:checked + .switch-track::after { transform: translateX(18px); }
    .switch-line input:focus-visible + .switch-track { box-shadow: 0 0 0 4px var(--focus); }
    .switch-copy { display: grid; gap: 2px; min-width: 0; }
    .switch-copy strong { font-size: 14px; line-height: 1.3; }
    .switch-copy small { color: var(--muted); font-size: 12px; line-height: 1.35; }
    .summary-panel { overflow: hidden; }
    .summary-header {
      padding: 18px;
      border-bottom: 1px solid var(--line);
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }
    .metrics {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      padding: 14px 18px 18px;
    }
    .metric {
      min-height: 92px;
      display: grid;
      align-content: center;
      gap: 4px;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--surface-soft);
    }
    .metric span {
      color: var(--muted);
      font-size: 12px;
      font-weight: 760;
    }
    .metric strong {
      font-size: 28px;
      line-height: 1;
      font-variant-numeric: tabular-nums;
    }
    .status-strip {
      display: grid;
      gap: 8px;
      padding: 0 18px 18px;
      color: var(--muted);
      font-size: 12px;
    }
    .path-line {
      display: grid;
      grid-template-columns: 92px minmax(0, 1fr);
      gap: 8px;
      align-items: start;
    }
    .path-line strong {
      color: var(--muted-strong);
      overflow-wrap: anywhere;
      font-weight: 680;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 0 18px 18px;
    }
    .chip {
      min-height: 30px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 9px;
      border-radius: var(--radius-sm);
      background: var(--accent-soft);
      color: #1e3a8a;
      font-size: 12px;
      font-weight: 760;
    }
    .chip.neutral { background: #eef2f7; color: var(--muted-strong); }
    .workbench {
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--surface);
      box-shadow: var(--shadow);
      overflow: hidden;
    }
    .workbench-head {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 12px;
      align-items: center;
      padding: 18px;
      border-bottom: 1px solid var(--line);
      background: #fbfdff;
    }
    .toolbar {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      flex-wrap: wrap;
    }
    .toolbar input[type="search"] {
      width: min(320px, 100%);
      background: #fff;
    }
    .workspace {
      display: grid;
      grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
      min-height: 620px;
    }
    .queue-pane {
      border-right: 1px solid var(--line);
      background: #f8fbff;
      min-width: 0;
    }
    .queue-summary {
      min-height: 48px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--line);
      color: var(--muted);
      font-size: 12px;
      font-weight: 760;
    }
    .book-list {
      max-height: 690px;
      overflow: auto;
      padding: 10px;
      display: grid;
      gap: 8px;
    }
    .book-item {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 8px;
      align-items: start;
      padding: 10px;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: #fff;
      transition: border-color .18s ease, background .18s ease, box-shadow .18s ease;
    }
    .book-item.active {
      border-color: rgba(15, 118, 110, .52);
      background: var(--surface-tint);
      box-shadow: 0 0 0 3px rgba(15, 118, 110, .08);
    }
    .book-item.muted { opacity: .64; }
    .check-cell {
      width: 44px;
      min-height: 44px;
      display: grid;
      place-items: center;
    }
    .book-pick {
      width: 100%;
      min-height: 44px;
      display: grid;
      justify-items: stretch;
      align-items: start;
      gap: 5px;
      padding: 0;
      border: 0;
      border-radius: 0;
      background: transparent;
      color: var(--text);
      text-align: left;
      box-shadow: none;
    }
    .book-pick:hover { background: transparent; color: var(--text); }
    .book-title {
      font-size: 14px;
      font-weight: 820;
      line-height: 1.35;
      overflow-wrap: anywhere;
    }
    .book-line {
      display: flex;
      align-items: center;
      gap: 7px;
      flex-wrap: wrap;
      color: var(--muted);
      font-size: 12px;
    }
    .pill {
      min-height: 24px;
      display: inline-flex;
      align-items: center;
      padding: 2px 7px;
      border-radius: var(--radius-sm);
      background: #eef2f7;
      color: var(--muted-strong);
      font-size: 12px;
      font-weight: 760;
    }
    .pill.good { background: var(--primary-soft); color: #0f5f58; }
    .pill.warn { background: #fff7ed; color: var(--warning); }
    .editor-pane {
      min-width: 0;
      padding: 18px;
      background: #ffffff;
    }
    .empty-state {
      min-height: 240px;
      display: grid;
      place-items: center;
      text-align: center;
      color: var(--muted);
      border: 1px dashed var(--line-strong);
      border-radius: var(--radius);
      background: var(--surface-soft);
      padding: 24px;
    }
    .editor-shell {
      display: grid;
      gap: 16px;
    }
    .editor-titlebar {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 12px;
      align-items: start;
      padding-bottom: 14px;
      border-bottom: 1px solid var(--line);
    }
    .editor-titlebar h2 {
      font-size: 20px;
      line-height: 1.25;
      overflow-wrap: anywhere;
    }
    .select-banner {
      min-height: 44px;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      border-radius: var(--radius);
      background: var(--surface-tint);
      color: var(--muted-strong);
      font-size: 13px;
      font-weight: 760;
      cursor: pointer;
    }
    .metadata-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }
    .metadata-grid .wide { grid-column: 1 / -1; }
    .metadata-grid .double { grid-column: span 2; }
    .metadata-grid textarea { min-height: 112px; line-height: 1.6; }
    .chapter-block {
      border: 1px solid var(--line);
      border-radius: var(--radius);
      overflow: hidden;
      background: #fff;
    }
    .chapter-toolbar {
      min-height: 58px;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 12px;
      align-items: center;
      padding: 12px;
      border-bottom: 1px solid var(--line);
      background: #fbfdff;
    }
    .chapter-list {
      max-height: 560px;
      overflow: auto;
    }
    .chapter-grid-head,
    .chapter-row {
      display: grid;
      grid-template-columns: 56px minmax(96px, .8fr) 94px minmax(180px, 1.7fr) 92px 116px;
      gap: 8px;
      align-items: center;
      padding: 9px 12px;
    }
    .chapter-grid-head {
      position: sticky;
      top: 0;
      z-index: 1;
      min-height: 44px;
      background: #eef5f8;
      color: var(--muted-strong);
      font-size: 12px;
      font-weight: 820;
      border-bottom: 1px solid var(--line);
    }
    .chapter-row {
      border-bottom: 1px solid #e8eef5;
      background: #fff;
    }
    .chapter-row:hover { background: #fbfdff; }
    .chapter-row.muted { opacity: .6; }
    .chapter-row input { min-height: 38px; padding: 7px 9px; }
    .word-cell {
      color: var(--muted-strong);
      font-size: 13px;
      font-variant-numeric: tabular-nums;
    }
    .word-cell.edited::after {
      content: "已改";
      margin-left: 6px;
      color: var(--success);
      font-size: 11px;
      font-weight: 820;
    }
    .modal {
      position: fixed;
      inset: 0;
      z-index: var(--z-modal);
      display: grid;
      place-items: center;
      padding: 18px;
      background: rgba(15, 23, 42, .5);
    }
    .modal-card {
      width: min(560px, 100%);
      max-height: min(90vh, 900px);
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: #fff;
      box-shadow: var(--shadow);
      padding: 18px;
      display: grid;
      gap: 14px;
    }
    .modal-card.wide { width: min(980px, 100%); }
    .confirm { display: grid; gap: 6px; }
    .result-line {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
    }
    .result-line span {
      min-height: 44px;
      display: grid;
      place-items: center;
      border-radius: var(--radius);
      background: #f2f6fa;
      color: var(--muted-strong);
      font-weight: 760;
      font-variant-numeric: tabular-nums;
    }
    #bodyText {
      min-height: min(56vh, 520px);
      line-height: 1.72;
      font-family: "Microsoft YaHei", "Segoe UI", Arial, sans-serif;
    }
    .toast {
      position: fixed;
      right: 18px;
      bottom: 18px;
      z-index: var(--z-toast);
      max-width: min(460px, calc(100vw - 36px));
      padding: 12px 14px;
      border-radius: var(--radius);
      background: rgba(23, 32, 51, .95);
      color: #fff;
      box-shadow: var(--shadow);
      display: none;
    }
    .toast.show { display: block; }
    .toast.error { background: rgba(159, 18, 57, .96); }
    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) {
      html { scroll-behavior: auto; }
      *, *::before, *::after {
        animation-duration: .01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: .01ms !important;
      }
    }
    @media (prefers-color-scheme: dark) {
      :root {
        color-scheme: dark;
        --bg: #101418;
        --surface: #171d23;
        --surface-soft: #1f2730;
        --surface-tint: #12302d;
        --line: #2a3540;
        --line-strong: #41505f;
        --text: #eef4f8;
        --muted: #9ba9b7;
        --muted-strong: #c2ccd6;
        --primary-soft: #143d38;
        --accent-soft: #172b4f;
        --shadow: 0 18px 38px rgba(0, 0, 0, .28);
        --shadow-soft: 0 8px 20px rgba(0, 0, 0, .22);
      }
      input, textarea, .panel, .topbar, .workbench, .modal-card, .book-item, .chapter-row { background: var(--surface); }
      .summary-header, .workbench-head, .chapter-toolbar, .queue-pane, .chapter-grid-head { background: #151b21; }
      button.secondary { background: var(--surface-soft); color: var(--muted-strong); }
      .mark { background: #0f2d2b; }
      .chip { color: #cfe3ff; }
      .pill { background: #25303a; }
    }
    @media (max-width: 1180px) {
      .layout-grid { grid-template-columns: 1fr; }
      .settings { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .metadata-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 1020px) {
      .topbar, .workbench-head, .editor-titlebar, .chapter-toolbar {
        grid-template-columns: 1fr;
      }
      .actions, .toolbar { justify-content: flex-start; }
      .workspace { grid-template-columns: 1fr; }
      .queue-pane { border-right: 0; border-bottom: 1px solid var(--line); }
      .book-list { max-height: 360px; }
      .chapter-grid-head { display: none; }
      .chapter-row {
        grid-template-columns: 44px 1fr 96px;
        grid-template-areas:
          "check id order"
          "check title title"
          "check words action";
        align-items: start;
        padding: 12px;
      }
      .chapter-row > .check-cell { grid-area: check; }
      .chapter-row > [data-field="chapterId"] { grid-area: id; }
      .chapter-row > [data-field="chapterOrder"] { grid-area: order; }
      .chapter-row > [data-field="title"] { grid-area: title; }
      .chapter-row > .word-cell { grid-area: words; min-height: 38px; display: flex; align-items: center; }
      .chapter-row > button { grid-area: action; }
    }
    @media (max-width: 720px) {
      .app { width: min(100vw - 20px, var(--max)); padding-top: 10px; }
      .steps, .settings, .metrics, .metadata-grid, .result-line { grid-template-columns: 1fr; }
      .field.half, .metadata-grid .double { grid-column: 1 / -1; }
      .topbar, .panel-body, .editor-pane, .summary-header, .workbench-head { padding: 14px; }
      .summary-header { flex-direction: column; align-items: stretch; }
      .summary-header button { width: 100%; }
      .brand { align-items: flex-start; }
      .mark { width: 42px; height: 42px; }
      button { width: 100%; }
      .actions button, .toolbar button, .row button { width: auto; }
      .toolbar input[type="search"] { width: 100%; }
      .chapter-row {
        grid-template-columns: 44px minmax(0, 1fr);
        grid-template-areas:
          "check id"
          "check order"
          "check title"
          "check words"
          "check action";
      }
      .chapter-row > button { width: 100%; }
      .path-line { grid-template-columns: 1fr; }
    }
  </style>
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

  <script>
    const defaults = ${JSON.stringify(state)};
    const $ = (id) => document.getElementById(id);
    let splitSingleFile = true;
    let current = null;
    let activeBookIndex = -1;
    let activeBodyRef = null;

    $("root").value = defaults.root;
    $("baseUrl").value = defaults.baseUrl;
    $("token").value = defaults.token;

    function text(value) { return String(value ?? ""); }
    function number(value) { return Number(value || 0).toLocaleString("zh-CN"); }
    function escapeHtml(value) {
      return text(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
    }
    function modeLabel(value) {
      return { "chapter-files": "章节文件", "single-file": "单文件", "single-file-split": "单文件拆章" }[value] || value || "-";
    }
    function showToast(message, tone) {
      const node = $("toast");
      node.textContent = message || "";
      node.classList.toggle("show", !!message);
      node.classList.toggle("error", tone === "error");
      clearTimeout(showToast.timer);
      if (message) showToast.timer = setTimeout(() => node.classList.remove("show", "error"), 3600);
    }
    function setStep(name) {
      document.querySelectorAll(".step").forEach((step) => step.classList.toggle("active", step.dataset.step === name));
    }
    function setBusy(button, busy, label) {
      if (!button.dataset.idleText) button.dataset.idleText = button.textContent;
      button.classList.toggle("is-loading", busy);
      button.disabled = busy;
      button.textContent = busy ? label : button.dataset.idleText;
    }
    function payload() {
      return {
        root: $("root").value,
        platform: $("platform").value,
        idPrefix: $("idPrefix").value || $("platform").value,
        defaultCategory: $("defaultCategory").value,
        defaultTags: $("defaultTags").value,
        status: $("status").value,
        limit: Number($("limit").value || 0),
        splitSingleFile,
        skipCached: $("skipCached").checked,
        skipUploaded: $("skipUploaded").checked
      };
    }
    async function request(url, body) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "请求失败");
      return data;
    }
    function selectedChapters(book) {
      return (book?.chapters || []).filter((chapter) => chapter.selected !== false);
    }
    function computeSummary() {
      const books = current?.books || [];
      const summary = { totalBooks: books.length, selectedRaw: 0, books: 0, chapters: 0, words: 0, warnings: 0, categories: {} };
      for (const book of books) {
        if (book.selected === false) continue;
        summary.selectedRaw++;
        const chapters = selectedChapters(book);
        if (!chapters.length) continue;
        summary.books++;
        summary.chapters += chapters.length;
        summary.words += chapters.reduce((sum, chapter) => sum + Number(chapter.wordCount || 0), 0);
        summary.warnings += (book.warnings || []).length;
        const category = book.metadata?.category || "未分类";
        summary.categories[category] = (summary.categories[category] || 0) + 1;
      }
      return summary;
    }
    function refreshSummary() {
      if (!current) return;
      const summary = computeSummary();
      $("bookCount").textContent = number(summary.books);
      $("chapterCount").textContent = number(summary.chapters);
      $("wordCount").textContent = number(summary.words);
      $("warningCount").textContent = number(summary.warnings);
      $("queueCount").textContent = number(summary.totalBooks) + " 本";
      $("selectedCount").textContent = number(summary.selectedRaw) + " 已选";
      $("confirmBtn").disabled = !(current.manifestPath && summary.books > 0 && summary.chapters > 0);
      const chips = Object.entries(summary.categories).map(([name, count]) => '<span class="chip">' + escapeHtml(name) + " " + number(count) + "</span>");
      if (current.skippedUploaded) chips.unshift('<span class="chip neutral">已跳过 OK ' + number(current.skippedUploaded) + '</span>');
      $("categoryChips").innerHTML = chips.length ? chips.join("") : '<span class="chip neutral">暂无已选分类</span>';
    }
    function render(data) {
      current = data;
      current.books = (current.books || []).map((book, index) => ({
        ...book,
        index,
        selected: book.selected !== false,
        chapters: (book.chapters || []).map((chapter, chapterIndex) => ({
          ...chapter,
          index: chapterIndex,
          selected: chapter.selected !== false
        }))
      }));
      activeBookIndex = current.books.length ? 0 : -1;
      $("summaryPanel").hidden = false;
      $("booksPanel").hidden = false;
      $("manifestPath").textContent = data.manifestPath || "-";
      $("csvPath").textContent = data.csvPath || "-";
      $("scanMeta").textContent = "生成时间 " + (data.generatedAt ? new Date(data.generatedAt).toLocaleString("zh-CN") : "-") + "；来源 " + (data.root || "-");
      $("bookSearch").value = "";
      refreshSummary();
      renderBooks();
      renderBookEditor();
      setStep("edit");
    }
    function renderBooks() {
      const books = current?.books || [];
      const query = $("bookSearch").value.trim().toLowerCase();
      const rows = [];
      for (const book of books) {
        const index = book.index;
        const m = book.metadata || {};
        const haystack = [m.bookId, m.title, m.author, m.category, m.tags].join(" ").toLowerCase();
        if (query && !haystack.includes(query)) continue;
        const chapterSelected = selectedChapters(book).length;
        const warnings = (book.warnings || []).length;
        rows.push(
          '<article class="book-item' + (index === activeBookIndex ? " active" : "") + (book.selected === false ? " muted" : "") + '">' +
            '<label class="check-cell"><input type="checkbox" data-book="' + index + '" data-field="selected" ' + (book.selected !== false ? "checked" : "") + ' aria-label="选择 ' + escapeHtml(m.title || m.bookId || "书籍") + '"></label>' +
            '<button class="book-pick" type="button" data-open-book="' + index + '">' +
              '<span class="book-title">' + escapeHtml(m.title || "未命名书籍") + '</span>' +
              '<span class="book-line">' + escapeHtml(m.author || "未知作者") + '<span class="pill">' + escapeHtml(m.category || "未分类") + '</span></span>' +
              '<span class="book-line"><span class="pill good">' + number(chapterSelected) + "/" + number((book.chapters || []).length) + " 章</span><span>" + number(m.wordCount) + ' 字</span><span>' + escapeHtml(modeLabel(book.mode)) + '</span></span>' +
              '<span class="book-line"><span>' + escapeHtml(m.bookId || "-") + '</span>' + (warnings ? '<span class="pill warn">提示 ' + number(warnings) + '</span>' : '') + '</span>' +
            '</button>' +
          '</article>'
        );
      }
      $("bookRows").innerHTML = rows.length ? rows.join("") : '<div class="empty-state">没有匹配的书籍。</div>';
    }
    function metadataField(meta, label, key, options = {}) {
      const value = meta?.[key] ?? "";
      const cls = "field" + (options.wide ? " wide" : "") + (options.double ? " double" : "");
      if (options.textarea) {
        return '<label class="' + cls + '"><span>' + label + '</span><textarea data-meta="' + key + '" rows="' + (options.rows || 4) + '">' + escapeHtml(value) + '</textarea></label>';
      }
      return '<label class="' + cls + '"><span>' + label + '</span><input data-meta="' + key + '" type="' + (options.type || "text") + '" value="' + escapeHtml(value) + '" autocomplete="off"></label>';
    }
    function renderBookEditor() {
      const book = current?.books?.[activeBookIndex];
      $("emptyEditor").hidden = !!book;
      $("bookEditor").hidden = !book;
      if (!book) return;
      const m = book.metadata || {};
      $("activeBookTitle").textContent = m.title || m.bookId || "未命名书籍";
      $("activeBookMeta").textContent = (m.author || "未知作者") + " · " + (m.category || "未分类") + " · " + number((book.chapters || []).length) + " 章";
      $("activeBookSelected").checked = book.selected !== false;
      $("metadataFields").innerHTML = [
        metadataField(m, "书籍 ID", "bookId"),
        metadataField(m, "书名", "title", { double: true }),
        metadataField(m, "作者", "author"),
        metadataField(m, "分类", "category"),
        metadataField(m, "标签", "tags"),
        metadataField(m, "字数", "wordCount", { type: "number" }),
        metadataField(m, "状态", "status"),
        metadataField(m, "平台", "platform"),
        metadataField(m, "上传者", "uploader"),
        metadataField(m, "上传者 ID", "uploaderId"),
        metadataField(m, "详情 URL", "detailUrl", { double: true }),
        metadataField(m, "简介", "description", { textarea: true, wide: true, rows: 4 }),
        metadataField(m, "简介 HTML", "descriptionHtml", { textarea: true, wide: true, rows: 4 })
      ].join("");
      renderChapters(activeBookIndex, { scroll: false });
    }
    function renderChapters(bookIndex, options = {}) {
      const book = current?.books?.[bookIndex];
      if (!book) return;
      activeBookIndex = bookIndex;
      $("chapterPanel").hidden = false;
      const chapters = book.chapters || [];
      $("chapterTitle").textContent = "章节目录";
      $("chapterSubtitle").textContent = number(selectedChapters(book).length) + " / " + number(chapters.length) + " 章已选";
      $("chapterRows").innerHTML = chapters.map((chapter, index) => {
        return '<div class="chapter-row' + (chapter.selected === false ? " muted" : "") + '">' +
          '<label class="check-cell"><input type="checkbox" data-chapter="' + index + '" data-field="selected" ' + (chapter.selected !== false ? "checked" : "") + ' aria-label="选择章节 ' + escapeHtml(chapter.title || chapter.chapterId || index + 1) + '"></label>' +
          '<input data-chapter="' + index + '" data-field="chapterId" value="' + escapeHtml(chapter.chapterId) + '" autocomplete="off">' +
          '<input data-chapter="' + index + '" data-field="chapterOrder" type="number" min="1" step="1" value="' + escapeHtml(chapter.chapterOrder || index + 1) + '">' +
          '<input data-chapter="' + index + '" data-field="title" value="' + escapeHtml(chapter.title) + '" autocomplete="off">' +
          '<span class="word-cell' + (chapter.bodyOverride !== undefined ? " edited" : "") + '">' + number(chapter.wordCount) + '</span>' +
          '<button class="secondary" type="button" data-edit-body="' + index + '">编辑正文</button>' +
        '</div>';
      }).join("") || '<div class="empty-state">这本书没有可上传章节。</div>';
      if (options.scroll !== false) $("chapterPanel").scrollIntoView({ behavior: "smooth", block: "start" });
    }
    function buildPatch() {
      return {
        books: (current?.books || []).map((book, index) => ({
          index,
          selected: book.selected !== false,
          metadata: book.metadata || {},
          chapters: (book.chapters || []).map((chapter, chapterIndex) => ({
            index: chapterIndex,
            selected: chapter.selected !== false,
            chapterId: chapter.chapterId,
            chapterOrder: chapter.chapterOrder,
            title: chapter.title,
            ...(chapter.bodyOverride !== undefined ? { bodyOverride: chapter.bodyOverride } : {})
          }))
        }))
      };
    }
    function updateSplit(on) {
      splitSingleFile = on;
      $("splitOn").classList.toggle("active", on);
      $("splitOff").classList.toggle("active", !on);
      $("splitOn").setAttribute("aria-pressed", on ? "true" : "false");
      $("splitOff").setAttribute("aria-pressed", on ? "false" : "true");
    }

    $("splitOn").onclick = () => updateSplit(true);
    $("splitOff").onclick = () => updateSplit(false);
    $("bookSearch").addEventListener("input", renderBooks);
    $("selectAllBooks").onclick = () => {
      (current?.books || []).forEach((book) => { book.selected = true; });
      refreshSummary();
      renderBooks();
      renderBookEditor();
    };
    $("clearBooks").onclick = () => {
      (current?.books || []).forEach((book) => { book.selected = false; });
      refreshSummary();
      renderBooks();
      renderBookEditor();
    };
    $("bookRows").addEventListener("change", (event) => {
      const target = event.target;
      const index = Number(target.dataset.book);
      if (!current?.books?.[index] || target.dataset.field !== "selected") return;
      current.books[index].selected = target.checked;
      if (index === activeBookIndex) $("activeBookSelected").checked = target.checked;
      refreshSummary();
      renderBooks();
    });
    $("bookRows").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-open-book]");
      if (!button) return;
      activeBookIndex = Number(button.dataset.openBook);
      renderBooks();
      renderBookEditor();
      if (window.matchMedia("(max-width: 1020px)").matches) $("bookEditor").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    $("activeBookSelected").addEventListener("change", (event) => {
      const book = current?.books?.[activeBookIndex];
      if (!book) return;
      book.selected = event.target.checked;
      refreshSummary();
      renderBooks();
    });
    $("metadataFields").addEventListener("input", (event) => {
      const target = event.target;
      const meta = target.dataset.meta;
      const book = current?.books?.[activeBookIndex];
      if (!book || !meta) return;
      book.metadata = book.metadata || {};
      book.metadata[meta] = meta === "wordCount" ? Number(target.value || 0) : target.value;
      if (meta === "title" || meta === "author" || meta === "category" || meta === "bookId" || meta === "tags" || meta === "wordCount") {
        if (meta === "title") $("activeBookTitle").textContent = target.value || book.metadata.bookId || "未命名书籍";
        refreshSummary();
        renderBooks();
      }
    });
    $("selectAllChapters").onclick = () => {
      const book = current?.books?.[activeBookIndex];
      if (!book) return;
      (book.chapters || []).forEach((chapter) => { chapter.selected = true; });
      renderChapters(activeBookIndex, { scroll: false });
      refreshSummary();
      renderBooks();
    };
    $("clearChapters").onclick = () => {
      const book = current?.books?.[activeBookIndex];
      if (!book) return;
      (book.chapters || []).forEach((chapter) => { chapter.selected = false; });
      renderChapters(activeBookIndex, { scroll: false });
      refreshSummary();
      renderBooks();
    };
    $("chapterRows").addEventListener("input", (event) => {
      const target = event.target;
      const chapterIndex = Number(target.dataset.chapter);
      const field = target.dataset.field;
      const chapter = current?.books?.[activeBookIndex]?.chapters?.[chapterIndex];
      if (!chapter || !field || field === "selected") return;
      chapter[field] = field === "chapterOrder" ? Number(target.value || chapterIndex + 1) : target.value;
    });
    $("chapterRows").addEventListener("change", (event) => {
      const target = event.target;
      const chapterIndex = Number(target.dataset.chapter);
      const chapter = current?.books?.[activeBookIndex]?.chapters?.[chapterIndex];
      if (!chapter || target.dataset.field !== "selected") return;
      chapter.selected = target.checked;
      renderChapters(activeBookIndex, { scroll: false });
      refreshSummary();
      renderBooks();
    });
    $("chapterRows").addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-edit-body]");
      if (!button || !current?.manifestPath) return;
      const chapterIndex = Number(button.dataset.editBody);
      const book = current.books[activeBookIndex];
      const chapter = book?.chapters?.[chapterIndex];
      if (!book || !chapter) return;
      activeBodyRef = { bookIndex: activeBookIndex, chapterIndex };
      $("bodyTitle").textContent = "正文编辑 · " + (chapter.title || chapter.chapterId || "");
      $("bodyMeta").textContent = (book.metadata?.title || book.metadata?.bookId || "") + " · " + number(chapter.wordCount) + " 字";
      $("bodyText").value = chapter.bodyOverride !== undefined ? chapter.bodyOverride : "读取中...";
      $("bodyModal").hidden = false;
      $("bodyText").focus();
      if (chapter.bodyOverride === undefined) {
        try {
          const data = await request("/api/chapter-body", {
            manifestPath: current.manifestPath,
            bookIndex: activeBookIndex,
            chapterIndex
          });
          $("bodyText").value = data.text || "";
        } catch (err) {
          showToast(err.message || String(err), "error");
          $("bodyModal").hidden = true;
        }
      }
    });
    $("closeChapters").onclick = () => { $("chapterPanel").hidden = true; };
    $("cancelBody").onclick = () => { $("bodyModal").hidden = true; activeBodyRef = null; };
    $("saveBody").onclick = () => {
      const ref = activeBodyRef;
      const chapter = current?.books?.[ref?.bookIndex]?.chapters?.[ref?.chapterIndex];
      if (!chapter) return;
      chapter.bodyOverride = $("bodyText").value;
      chapter.wordCount = Array.from(chapter.bodyOverride.replace(/\\s+/g, "")).length;
      $("bodyModal").hidden = true;
      renderChapters(ref.bookIndex, { scroll: false });
      refreshSummary();
      renderBooks();
      showToast("正文已保存到本次上传清单");
    };
    $("scanBtn").onclick = async () => {
      setStep("scan");
      setBusy($("scanBtn"), true, "扫描中");
      try {
        const data = await request("/api/scan", payload());
        render(data);
        showToast("扫描完成：" + number(data.summary?.books) + " 本");
      } catch (err) {
        setStep("settings");
        showToast(err.message || String(err), "error");
      } finally {
        setBusy($("scanBtn"), false);
      }
    };
    $("csvBtn").onclick = () => {
      if (current?.csvPath) window.open("/api/download?path=" + encodeURIComponent(current.csvPath), "_blank");
    };
    $("confirmBtn").onclick = () => {
      if (!current?.manifestPath) return;
      const summary = computeSummary();
      $("uploadSummary").textContent = number(summary.books) + " 本 / " + number(summary.chapters) + " 章，将提交到 " + ($("baseUrl").value || "-");
      $("confirmText").value = "";
      $("uploadResult").hidden = true;
      $("uploadBtn").disabled = true;
      $("modal").hidden = false;
      $("confirmText").focus();
      setStep("done");
    };
    $("cancelUpload").onclick = () => { $("modal").hidden = true; setStep(current ? "edit" : "settings"); };
    $("confirmText").oninput = () => { $("uploadBtn").disabled = $("confirmText").value.trim() !== "UPLOAD"; };
    $("uploadBtn").onclick = async () => {
      if (!current?.manifestPath || $("confirmText").value.trim() !== "UPLOAD") return;
      setBusy($("uploadBtn"), true, "上传中");
      try {
        const data = await request("/api/upload", {
          manifestPath: current.manifestPath,
          baseUrl: $("baseUrl").value,
          token: $("token").value,
          confirm: $("confirmText").value.trim(),
          skipCached: $("skipCached").checked,
          markUploaded: $("markUploaded").checked,
          patch: buildPatch()
        });
        const stats = data.stats || {};
        $("uploadResult").hidden = false;
        $("metaOk").textContent = "元信息 " + number(stats.metadataSuccess);
        $("chapterOk").textContent = "章节 " + number(stats.chaptersUploaded);
        $("failCount").textContent = "失败 " + number((stats.metadataFailed || 0) + (stats.chapterFailed || 0));
        showToast("上传完成，标记 OK " + number(data.markedUploaded || 0) + " 本");
      } catch (err) {
        showToast(err.message || String(err), "error");
      } finally {
        setBusy($("uploadBtn"), false);
        $("uploadBtn").disabled = $("confirmText").value.trim() !== "UPLOAD";
      }
    };
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (!$("bodyModal").hidden) { $("bodyModal").hidden = true; activeBodyRef = null; return; }
      if (!$("modal").hidden) { $("modal").hidden = true; setStep(current ? "edit" : "settings"); }
    });
  </script>
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
