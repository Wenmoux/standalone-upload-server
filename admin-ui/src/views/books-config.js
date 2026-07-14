/**
 * [INPUT]: 依赖 BooksView 的书籍/章节展示与编辑字段契约
 * [OUTPUT]: 对外提供默认平台、表格列、表单字段和数值字段清单
 * [POS]: admin-ui/src/views 的书库声明配置，隔离稳定结构与 BooksView 的运行时 API 编排
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export const defaultPlatformOptions = [
    { value: "po18", label: "PO18" },
    { value: "popo", label: "POPO" },
    { value: "fanqie", label: "番茄小说" },
    { value: "haitang", label: "海棠/龙马" }
];

export const bookColumns = [
    { key: "select", label: "选" },
    { key: "title", label: "书名", sort: "title_asc" },
    { key: "meta", label: "作者/站别/标签" },
    { key: "counts", label: "章节/缓存", sort: "chapters_desc" },
    { key: "heat", label: "人气/反馈", sort: "popularity_desc" },
    { key: "updated_at", label: "更新时间", sort: "updated_desc" },
    { key: "actions", label: "操作" }
];

export const chapterColumns = [
    { key: "select", label: "选" },
    { key: "chapter_id", label: "章节ID" },
    { key: "title", label: "标题" },
    { key: "platform", label: "站别/来源" },
    { key: "uploader", label: "上传者" },
    { key: "updated_at", label: "上传/更新时间" },
    { key: "text", label: "内容" },
    { key: "actions", label: "操作" }
];

export const bookFields = [
    { key: "book_id", label: "书籍ID" },
    { key: "title", label: "书名" },
    { key: "author", label: "作者" },
    { key: "platform", label: "站别" },
    { key: "cover", label: "封面" },
    { key: "category", label: "分类" },
    { key: "tags", label: "标签" },
    { key: "word_count", label: "字数", type: "number" },
    { key: "chapter_count", label: "章节数", type: "number" },
    { key: "total_chapters", label: "总章节", type: "number" },
    { key: "subscribed_chapters", label: "订阅章节", type: "number" },
    { key: "free_chapters", label: "免费章节", type: "number" },
    { key: "paid_chapters", label: "付费章节", type: "number" },
    { key: "status", label: "状态" },
    { key: "favorites_count", label: "收藏数", type: "number" },
    { key: "comments_count", label: "评论数", type: "number" },
    { key: "readers_count", label: "读者数", type: "number" },
    { key: "purchase_count", label: "购买数", type: "number" },
    { key: "daily_popularity", label: "日人气", type: "number" },
    { key: "weekly_popularity", label: "周人气", type: "number" },
    { key: "monthly_popularity", label: "月人气", type: "number" },
    { key: "total_popularity", label: "总人气", type: "number" },
    { key: "uploader", label: "上传者（非作者）" },
    { key: "uploaderId", label: "上传者ID（非作者ID）" },
    { key: "detail_url", label: "来源URL" },
    { key: "latest_chapter_name", label: "最新章节" },
    { key: "latest_chapter_date", label: "最新章节日期" },
    { key: "created_at", label: "创建时间（只读）", disabled: true },
    { key: "updated_at", label: "更新时间（保存时自动刷新）", disabled: true }
];

export const bookNumericFields = [
    "word_count",
    "chapter_count",
    "total_chapters",
    "subscribed_chapters",
    "free_chapters",
    "paid_chapters",
    "favorites_count",
    "comments_count",
    "monthly_popularity",
    "total_popularity",
    "weekly_popularity",
    "readers_count",
    "daily_popularity",
    "purchase_count"
];

export const bookTextareaFields = [
    { key: "description", label: "简介文本", rows: 7 },
    { key: "description_html", label: "简介 HTML", rows: 7 }
];

export const chapterFields = [
    { key: "book_id", label: "书籍ID" },
    { key: "chapter_id", label: "章节ID" },
    { key: "title", label: "标题" },
    { key: "chapter_order", label: "排序", type: "number" },
    { key: "platform", label: "站别" },
    { key: "uploader", label: "上传者（非作者）" },
    { key: "uploaderId", label: "上传者ID（非作者ID）" }
];

export const chapterTextareaFields = [
    { key: "text", label: "纯文本", rows: 10 },
    { key: "html", label: "HTML", rows: 10 }
];
