/**
 * [INPUT]: 依赖 node:test、assert 与 Admin Vue/CSS 源码文件
 * [OUTPUT]: 提供后台导航、会话恢复、表格/弹窗无障碍和工作区分层的静态契约回归
 * [POS]: tests 的 Admin UI 结构守卫，在无需浏览器的快速测试中阻止关键交互退回阻塞或不可访问实现
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const test = require("node:test");

const adminRoot = path.join(__dirname, "..", "admin-ui", "src");

function source(relativePath) {
    return fs.readFileSync(path.join(adminRoot, relativePath), "utf8");
}

function adminSources() {
    const files = [];
    function visit(directory) {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const target = path.join(directory, entry.name);
            if (entry.isDirectory()) visit(target);
            else if (/\.(?:js|vue)$/.test(entry.name)) files.push(fs.readFileSync(target, "utf8"));
        }
    }
    visit(adminRoot);
    return files.join("\n");
}

test("admin navigation is grouped and mobile shell exposes current page semantics", () => {
    const router = source("router.js");
    const app = source("App.vue");
    const styles = source("styles/responsive.css");
    assert.match(router, /export const adminNavGroups/);
    assert.match(router, /group:\s*"content"/);
    assert.match(app, /aria-current="activeView === item\.key \? 'page'/);
    assert.match(app, /mobile-nav-backdrop/);
    assert.match(styles, /\.admin-sidebar\.open/);
});

test("admin tables and dialogs preserve keyboard and screen-reader contracts", () => {
    const table = source("components/DataTable.vue");
    const formModal = source("components/FormModal.vue");
    assert.match(formModal, /:min="field\.min"/);
    assert.match(formModal, /:max="field\.max"/);
    const confirmDialog = source("components/ConfirmDialog.vue");
    const focus = source("utils/dialogFocus.js");
    assert.match(table, /scope="col"/);
    assert.match(table, /:aria-sort=/);
    assert.match(table, /class="table-sort-button"/);
    assert.match(formModal, /role="dialog"/);
    assert.match(confirmDialog, /role="alertdialog"/);
    assert.match(focus, /event\.key !== "Tab"/);
    assert.match(focus, /restoreFocus/);
});

test("admin uses non-blocking input and grouped high-density workspaces", () => {
    const allSources = adminSources();
    assert.doesNotMatch(allSources, /window\.(?:prompt|confirm|alert)\s*\(/);
    assert.match(source("App.vue"), /provide\("inputAction", inputAction\)/);
    assert.match(`${source("views/SystemView.vue")}\n${source("views/system-config.js")}`, /权限与 Token/);
    assert.match(source("views/TelegramView.vue"), /消息推送/);
    assert.match(source("views/FeedbackView.vue"), /待审举报/);
    assert.match(source("views/Po18CrawlerView.vue"), /config-disclosure/);
});

test("admin session expiry and queued feedback remain application-level services", () => {
    const app = source("App.vue");
    const api = source("services/api.js");
    const toast = source("components/ToastHost.vue");
    assert.match(api, /ADMIN_AUTH_EXPIRED_EVENT/);
    assert.match(app, /addEventListener\(ADMIN_AUTH_EXPIRED_EVENT/);
    assert.match(app, /toastItems\.value = \[\.\.\.toastItems\.value\.slice\(-3\)/);
    assert.match(toast, /aria-live="polite"/);
    assert.match(toast, /v-for="item in items"/);
});

test("admin global styles and oversized views stay within the documented module budget", () => {
    const styleRoot = source("styles.css");
    const styleFiles = ["foundation.css", "workflow.css", "content.css", "operations.css", "responsive.css"];
    for (const file of styleFiles) {
        assert.match(styleRoot, new RegExp(`@import "\\./styles/${file.replace(".", "\\.")}"`));
        assert.ok(source(`styles/${file}`).split(/\r?\n/).length <= 800, `${file} exceeds 800 lines`);
    }
    assert.ok(source("views/BooksView.vue").split(/\r?\n/).length <= 800, "BooksView exceeds 800 lines");
    assert.ok(source("views/SystemView.vue").split(/\r?\n/).length <= 800, "SystemView exceeds 800 lines");
});

test("admin high-density workspaces lazy load and quality samples deep-link to books", () => {
    const system = source("views/SystemView.vue");
    const telegram = source("views/TelegramView.vue");
    const quality = source("views/QualityView.vue");
    const books = source("views/BooksView.vue");
    assert.match(system, /useLazyWorkspace\("runtime"/);
    assert.match(telegram, /useLazyWorkspace\("runtime"/);
    assert.match(system, /onMounted\(loadActiveTab\)/);
    assert.match(telegram, /onMounted\(\(\) => loadActiveTab\(\)/);
    assert.match(quality, /navigate\("books", \{ query: \{ q: bookId \} \}\)/);
    assert.match(quality, /查看书籍/);
    assert.match(quality, /duplicateVolumeRows/);
    assert.match(quality, /整理章节结构/);
    assert.doesNotMatch(quality, /cleanup-duplicate-volumes\/preview|清理重复分卷/);
    assert.match(quality, /changedStructureBooks\.value = result\.changedBooks/);
    assert.match(quality, /repair-order\/preview"\)/);
    assert.doesNotMatch(quality, /repair-order\/preview\?limit=/);
    assert.match(quality, /数据库共发现.*本需要整理的书，本次会全部处理/);
    assert.match(quality, /重复分卷完整明细.*以下为全部/);
    assert.doesNotMatch(quality, /slice\(0, 5\)|最多展示 5 本|不代表执行范围/);
    assert.match(quality, /scrollIntoView/);
    assert.doesNotMatch(books, /清理旧 PO18|cleanupStaleBooks/);
});
