/**
 * [INPUT]: 依赖页面注入的 LOCAL_LIBRARY_DEFAULTS、工作台 DOM 与同源扫描/正文/上传 API
 * [OUTPUT]: 对外提供本地书库上传工作台的步骤、编辑、确认、请求和反馈交互
 * [POS]: scripts 本地上传 UI 的浏览器控制器，不访问本地文件系统或直接复刻服务端扫描逻辑
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* global window, document */
"use strict";

const defaults = window.__LOCAL_LIBRARY_DEFAULTS__ || {};
const $ = (id) => document.getElementById(id);
let splitSingleFile = true;
let current = null;
let activeBookIndex = -1;
let activeBodyRef = null;

$("root").value = defaults.root;
$("baseUrl").value = defaults.baseUrl;
$("token").value = defaults.token;

function text(value) {
    return String(value ?? "");
}
function number(value) {
    return Number(value || 0).toLocaleString("zh-CN");
}
function escapeHtml(value) {
    return text(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
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
    const chips = Object.entries(summary.categories).map(
        ([name, count]) => '<span class="chip">' + escapeHtml(name) + " " + number(count) + "</span>"
    );
    if (current.skippedUploaded) chips.unshift('<span class="chip neutral">已跳过 OK ' + number(current.skippedUploaded) + "</span>");
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
    $("scanMeta").textContent =
        "生成时间 " + (data.generatedAt ? new Date(data.generatedAt).toLocaleString("zh-CN") : "-") + "；来源 " + (data.root || "-");
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
            '<article class="book-item' +
                (index === activeBookIndex ? " active" : "") +
                (book.selected === false ? " muted" : "") +
                '">' +
                '<label class="check-cell"><input type="checkbox" data-book="' +
                index +
                '" data-field="selected" ' +
                (book.selected !== false ? "checked" : "") +
                ' aria-label="选择 ' +
                escapeHtml(m.title || m.bookId || "书籍") +
                '"></label>' +
                '<button class="book-pick" type="button" data-open-book="' +
                index +
                '">' +
                '<span class="book-title">' +
                escapeHtml(m.title || "未命名书籍") +
                "</span>" +
                '<span class="book-line">' +
                escapeHtml(m.author || "未知作者") +
                '<span class="pill">' +
                escapeHtml(m.category || "未分类") +
                "</span></span>" +
                '<span class="book-line"><span class="pill good">' +
                number(chapterSelected) +
                "/" +
                number((book.chapters || []).length) +
                " 章</span><span>" +
                number(m.wordCount) +
                " 字</span><span>" +
                escapeHtml(modeLabel(book.mode)) +
                "</span></span>" +
                '<span class="book-line"><span>' +
                escapeHtml(m.bookId || "-") +
                "</span>" +
                (warnings ? '<span class="pill warn">提示 ' + number(warnings) + "</span>" : "") +
                "</span>" +
                "</button>" +
                "</article>"
        );
    }
    $("bookRows").innerHTML = rows.length ? rows.join("") : '<div class="empty-state">没有匹配的书籍。</div>';
}
function metadataField(meta, label, key, options = {}) {
    const value = meta?.[key] ?? "";
    const cls = "field" + (options.wide ? " wide" : "") + (options.double ? " double" : "");
    if (options.textarea) {
        return (
            '<label class="' +
            cls +
            '"><span>' +
            label +
            '</span><textarea data-meta="' +
            key +
            '" rows="' +
            (options.rows || 4) +
            '">' +
            escapeHtml(value) +
            "</textarea></label>"
        );
    }
    return (
        '<label class="' +
        cls +
        '"><span>' +
        label +
        '</span><input data-meta="' +
        key +
        '" type="' +
        (options.type || "text") +
        '" value="' +
        escapeHtml(value) +
        '" autocomplete="off"></label>'
    );
}
function renderBookEditor() {
    const book = current?.books?.[activeBookIndex];
    $("emptyEditor").hidden = !!book;
    $("bookEditor").hidden = !book;
    if (!book) return;
    const m = book.metadata || {};
    $("activeBookTitle").textContent = m.title || m.bookId || "未命名书籍";
    $("activeBookMeta").textContent =
        (m.author || "未知作者") + " · " + (m.category || "未分类") + " · " + number((book.chapters || []).length) + " 章";
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
    $("chapterRows").innerHTML =
        chapters
            .map((chapter, index) => {
                return (
                    '<div class="chapter-row' +
                    (chapter.selected === false ? " muted" : "") +
                    '">' +
                    '<label class="check-cell"><input type="checkbox" data-chapter="' +
                    index +
                    '" data-field="selected" ' +
                    (chapter.selected !== false ? "checked" : "") +
                    ' aria-label="选择章节 ' +
                    escapeHtml(chapter.title || chapter.chapterId || index + 1) +
                    '"></label>' +
                    '<input data-chapter="' +
                    index +
                    '" data-field="chapterId" value="' +
                    escapeHtml(chapter.chapterId) +
                    '" autocomplete="off">' +
                    '<input data-chapter="' +
                    index +
                    '" data-field="chapterOrder" type="number" min="1" step="1" value="' +
                    escapeHtml(chapter.chapterOrder || index + 1) +
                    '">' +
                    '<input data-chapter="' +
                    index +
                    '" data-field="title" value="' +
                    escapeHtml(chapter.title) +
                    '" autocomplete="off">' +
                    '<span class="word-cell' +
                    (chapter.bodyOverride !== undefined ? " edited" : "") +
                    '">' +
                    number(chapter.wordCount) +
                    "</span>" +
                    '<button class="secondary" type="button" data-edit-body="' +
                    index +
                    '">编辑正文</button>' +
                    "</div>"
                );
            })
            .join("") || '<div class="empty-state">这本书没有可上传章节。</div>';
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
    (current?.books || []).forEach((book) => {
        book.selected = true;
    });
    refreshSummary();
    renderBooks();
    renderBookEditor();
};
$("clearBooks").onclick = () => {
    (current?.books || []).forEach((book) => {
        book.selected = false;
    });
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
    (book.chapters || []).forEach((chapter) => {
        chapter.selected = true;
    });
    renderChapters(activeBookIndex, { scroll: false });
    refreshSummary();
    renderBooks();
};
$("clearChapters").onclick = () => {
    const book = current?.books?.[activeBookIndex];
    if (!book) return;
    (book.chapters || []).forEach((chapter) => {
        chapter.selected = false;
    });
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
$("closeChapters").onclick = () => {
    $("chapterPanel").hidden = true;
};
$("cancelBody").onclick = () => {
    $("bodyModal").hidden = true;
    activeBodyRef = null;
};
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
    $("uploadSummary").textContent =
        number(summary.books) + " 本 / " + number(summary.chapters) + " 章，将提交到 " + ($("baseUrl").value || "-");
    $("confirmText").value = "";
    $("uploadResult").hidden = true;
    $("uploadBtn").disabled = true;
    $("modal").hidden = false;
    $("confirmText").focus();
    setStep("done");
};
$("cancelUpload").onclick = () => {
    $("modal").hidden = true;
    setStep(current ? "edit" : "settings");
};
$("confirmText").oninput = () => {
    $("uploadBtn").disabled = $("confirmText").value.trim() !== "UPLOAD";
};
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
    if (!$("bodyModal").hidden) {
        $("bodyModal").hidden = true;
        activeBodyRef = null;
        return;
    }
    if (!$("modal").hidden) {
        $("modal").hidden = true;
        setStep(current ? "edit" : "settings");
    }
});
