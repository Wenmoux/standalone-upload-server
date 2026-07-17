<template>
    <section>
        <div class="view-head">
            <div class="view-title">
                <h2>数据质量</h2>
                <p class="sub">检查重复书籍、缺章节、缺封面、平台异常和大体积章节。</p>
            </div>
            <div class="row-actions">
                <button class="secondary" type="button" @click="load">刷新</button>
                <button type="button" :disabled="repairingOrder" @click="repairChapterOrder">
                    {{ repairingOrder ? "整理中..." : "整理章节结构" }}
                </button>
            </div>
        </div>

        <div v-if="error" class="error-block">{{ error }}</div>
        <div v-else-if="loading" class="panel"><div class="section">加载中...</div></div>
        <template v-else>
            <section class="panel">
                <div class="section">
                    <div class="section-head">
                        <div>
                            <p class="section-title">质量摘要</p>
                            <p class="section-desc">
                                阈值：长期未更新 {{ thresholds.stale_days }} 天；大章节 {{ bytes(thresholds.large_chapter_bytes) }} 以上。
                            </p>
                        </div>
                    </div>
                    <div class="dashboard">
                        <StatCard label="去重书籍" :value="number(summary.books)">按 book_id 取最新记录</StatCard>
                        <StatCard label="缓存覆盖率" :value="`${number(summary.coverage_percent)}%`">按总章节/订阅章节估算</StatCard>
                        <StatCard label="缺章节书籍" :value="number(summary.missing_chapter_books)">缓存章节少于元信息预期</StatCard>
                        <StatCard label="重复书籍" :value="number(summary.duplicate_books)">book_metadata 中同 book_id 多条</StatCard>
                        <StatCard label="无封面" :value="number(summary.no_cover)">cover 为空</StatCard>
                        <StatCard label="无简介" :value="number(summary.no_description)">description 为空</StatCard>
                        <StatCard label="平台异常" :value="number(summary.platform_abnormal)">platform 为空或过长</StatCard>
                        <StatCard label="大章节" :value="number(summary.large_chapters)">HTML/TXT 体积异常</StatCard>
                    </div>
                </div>
            </section>

            <QualityPanel
                v-if="changedVolumeBooks.length"
                title="本次章节结构整理结果"
                :rows="changedVolumeBooks"
                :columns="volumeResultColumns"
                :on-open="openBook"
            >
                <template #cell-removed_titles="{ value }">{{ Array.isArray(value) ? value.join("、") : value || "-" }}</template>
            </QualityPanel>

            <section class="quality-grid">
                <QualityPanel title="缺章节 / 覆盖率低" :rows="samples.missing_chapters" :columns="missingColumns" :on-open="openBook">
                    <template #cell-coverage_percent="{ value }">{{ number(value) }}%</template>
                </QualityPanel>
                <QualityPanel title="重复书籍" :rows="samples.duplicate_books" :columns="duplicateColumns" :on-open="openBook" />
                <QualityPanel title="无封面" :rows="samples.no_cover" :columns="bookColumns" :on-open="openBook" />
                <QualityPanel title="无简介" :rows="samples.no_description" :columns="bookColumns" :on-open="openBook" />
                <QualityPanel title="平台字段异常" :rows="samples.platform_abnormal" :columns="bookColumns" :on-open="openBook" />
                <QualityPanel title="章节顺序重复" :rows="samples.duplicate_orders" :columns="orderColumns" :on-open="openBook" />
                <QualityPanel title="长期未更新" :rows="samples.stale_books" :columns="bookColumns" :on-open="openBook">
                    <template #cell-updated_at="{ value }">{{ time(value) }}</template>
                </QualityPanel>
                <QualityPanel title="大体积异常章节" :rows="samples.large_chapters" :columns="largeColumns" :on-open="openBook">
                    <template #cell-bytes="{ value }">{{ bytes(value) }}</template>
                    <template #cell-updated_at="{ value }">{{ time(value) }}</template>
                </QualityPanel>
            </section>
        </template>
    </section>
</template>

<script setup>
/**
 * [INPUT]: 依赖 Vue、DataTable/StatCard、数据质量 Admin API、格式化工具和全局导航/确认服务
 * [OUTPUT]: 提供质量异常统计、书籍深链及合并同名分卷去重与连续顺序重排的章节结构整理页面
 * [POS]: admin-ui/src/views 的数据质量控制台，以一次预览确认完成章节结构维护并保留本次改动书籍清单
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { defineComponent, h, inject, onMounted, ref } from "vue";
import DataTable from "../components/DataTable.vue";
import StatCard from "../components/StatCard.vue";
import { api } from "../services/api";
import { bytes, number, time } from "../utils/format";

const toast = inject("toast", () => {});
const confirmAction = inject("confirmAction", async () => ({ confirmed: false, reason: "" }));
const navigate = inject("navigate", () => {});
const QualityPanel = defineComponent({
    name: "QualityPanel",
    props: {
        title: { type: String, required: true },
        rows: { type: Array, default: () => [] },
        columns: { type: Array, required: true },
        onOpen: { type: Function, required: true }
    },
    setup(props, { slots }) {
        return () =>
            h("section", { class: "panel quality-panel" }, [
                h("div", { class: "section" }, [
                    h("div", { class: "section-head" }, [
                        h("div", null, [
                            h("p", { class: "section-title" }, props.title),
                            h("p", { class: "section-desc" }, props.rows.length ? `显示 ${props.rows.length} 条样例` : "暂无异常样例")
                        ])
                    ]),
                    h(
                        DataTable,
                        {
                            columns: [...props.columns, { key: "actions", label: "定位" }],
                            rows: props.rows,
                            rowKey: "book_id",
                            emptyText: "暂无异常"
                        },
                        {
                            ...slots,
                            "cell-actions": ({ row }) =>
                                h("button", { class: "secondary", type: "button", onClick: () => props.onOpen(row) }, "查看书籍")
                        }
                    )
                ])
            ]);
    }
});

const loading = ref(true);
const error = ref("");
const summary = ref({});
const samples = ref({});
const thresholds = ref({});
const repairingOrder = ref(false);
const changedVolumeBooks = ref([]);

const bookColumns = [
    { key: "book_id", label: "书号" },
    { key: "title", label: "书名" },
    { key: "platform", label: "站点" },
    { key: "updated_at", label: "更新时间" }
];
const duplicateColumns = [
    { key: "book_id", label: "书号" },
    { key: "title", label: "书名" },
    { key: "duplicates", label: "重复数" }
];
const missingColumns = [
    { key: "book_id", label: "书号" },
    { key: "title", label: "书名" },
    { key: "expected_chapters", label: "预期" },
    { key: "cached_chapters", label: "缓存" },
    { key: "missing_chapters", label: "缺口" },
    { key: "coverage_percent", label: "覆盖率" }
];
const orderColumns = [
    { key: "book_id", label: "书号" },
    { key: "chapter_order", label: "顺序号" },
    { key: "duplicates", label: "重复数" }
];
const volumeResultColumns = [
    { key: "book_id", label: "书号" },
    { key: "title", label: "书名" },
    { key: "platform", label: "站点" },
    { key: "removed_volumes", label: "移除数" },
    { key: "removed_titles", label: "同名分卷" },
    { key: "updated_chapters", label: "重排章节" }
];
const largeColumns = [
    { key: "book_id", label: "书号" },
    { key: "chapter_id", label: "章节" },
    { key: "title", label: "标题" },
    { key: "bytes", label: "体积" },
    { key: "updated_at", label: "更新时间" }
];

function openBook(row) {
    const bookId = String(row?.book_id || "").trim();
    if (bookId) navigate("books", { query: { q: bookId } });
}

async function load() {
    loading.value = true;
    error.value = "";
    try {
        const data = await api("/admin-api/data-quality");
        summary.value = data.summary || {};
        samples.value = data.samples || {};
        thresholds.value = data.thresholds || {};
    } catch (err) {
        error.value = err.message || String(err);
    } finally {
        loading.value = false;
    }
}

async function repairChapterOrder() {
    repairingOrder.value = true;
    try {
        const preview = await api("/admin-api/chapters/repair-order/preview?limit=50");
        const orderRows = preview.orderRows || preview.rows || [];
        const volumeRows = preview.duplicateVolumeRows || [];
        if (!orderRows.length && !volumeRows.length) {
            changedVolumeBooks.value = [];
            return toast("没有需要整理的章节结构");
        }
        const affectedChapters = Number(
            preview.affectedChapters || orderRows.reduce((total, row) => total + Number(row.affected_chapters || 0), 0)
        );
        const duplicateVolumes = Number(
            preview.duplicateVolumes || volumeRows.reduce((total, row) => total + Number(row.duplicate_volumes || 0), 0)
        );
        const orderSample = orderRows
            .slice(0, 6)
            .map((row) => `- ${row.title || row.book_id} / ${row.book_id} / ${row.platform || "-"} / ${number(row.affected_chapters)} 章`)
            .join("\n");
        const volumeSample = volumeRows
            .slice(0, 6)
            .map(
                (row) =>
                    `- ${row.title || row.book_id} / ${row.book_id} / ${(row.duplicate_titles || []).join("、") || "-"} / ${number(row.duplicate_volumes)} 个`
            )
            .join("\n");
        const confirmation = await confirmAction({
            title: "整理章节结构",
            message: [
                `将处理 ${number(preview.affectedBooks || orderRows.length + volumeRows.length)} 本书。`,
                `同名分卷：移除约 ${number(duplicateVolumes)} 个后出现的重复项，不同卷名保留。`,
                `章节顺序：整理 ${number(orderRows.length)} 本书、约 ${number(affectedChapters)} 章。`,
                "执行时先清理同名分卷，再把受影响书籍连续重排。",
                "",
                "同名分卷样例：",
                volumeSample || "-",
                "",
                "顺序异常样例：",
                orderSample || "-",
                "",
                "执行后可在任务中心查看记录。"
            ].join("\n"),
            confirmLabel: "执行整理"
        });
        if (!confirmation.confirmed) return;
        const result = await api("/admin-api/chapters/repair-order", {
            method: "POST",
            body: JSON.stringify({ confirm: true, limit: 50, reason: confirmation.reason })
        });
        changedVolumeBooks.value = result.changedBooks || [];
        toast(
            `章节结构已整理：移除 ${number(result.removedVolumes || 0)} 个重复分卷，重排 ${number(result.updatedChapters || 0)} 章`
        );
        await load();
    } catch (err) {
        toast(err.message || String(err));
    } finally {
        repairingOrder.value = false;
    }
}

onMounted(load);
</script>
