<template>
  <section>
    <div class="view-head">
      <div class="view-title">
        <h2>纠错审核</h2>
        <p class="sub">通过后自动应用到章节缓存，并奖励提交用户。</p>
      </div>
      <div class="row-actions">
        <label class="field" style="min-width: 150px">
          <span>状态</span>
          <select v-model="status" @change="load">
            <option value="pending">待审核</option>
            <option value="approved">已通过</option>
            <option value="rejected">已驳回</option>
            <option value="all">全部</option>
          </select>
        </label>
        <button class="secondary" type="button" @click="load">刷新</button>
      </div>
    </div>

    <section class="panel">
      <div class="section">
        <div class="tag-row">
          <span class="tag">待审核 {{ number(counts.pending) }}</span>
          <span class="tag success">已通过 {{ number(counts.approved) }}</span>
          <span class="tag danger">已驳回 {{ number(counts.rejected) }}</span>
          <span class="tag">总计 {{ number(counts.total) }}</span>
        </div>
        <div v-if="loading" class="empty-block">加载中...</div>
        <div v-else-if="!rows.length" class="empty-block">暂无纠错记录</div>
        <div v-else class="correction-list">
          <article v-for="row in rows" :key="row.id" class="correction-card">
            <div class="section-head">
              <div>
                <p class="section-title">{{ row.book_title || row.book_id }} · {{ row.chapter_title || row.chapter_id }}</p>
                <p class="section-desc">书号 {{ row.book_id }} / 章节 {{ row.chapter_id }} / 提交 {{ time(row.created_at) }}</p>
                <p class="section-desc">用户：{{ correctionUser(row) }}<span v-if="row.telegram_id"> / TG {{ row.telegram_id }}</span></p>
              </div>
              <span class="tag" :class="statusTone(row.status)">{{ statusLabel(row.status) }}</span>
            </div>
            <div class="correction-text-grid">
              <div class="correction-text">
                <h4>原文 · {{ number(row.original_length) }} 字</h4>
                <span v-for="(part, index) in diffParts(row, 'original')" :key="`o-${index}`" :class="{ 'diff-removed': part.changed }">{{ part.text }}</span>
              </div>
              <div class="correction-text">
                <h4>修正 · {{ number(row.corrected_length) }} 字</h4>
                <span v-for="(part, index) in diffParts(row, 'corrected')" :key="`c-${index}`" :class="{ 'diff-added': part.changed }">{{ part.text }}</span>
              </div>
            </div>
            <div class="section-head" style="margin-top: 12px">
              <span class="metric like"><strong>通过奖励：+200 铜币 / +100 银币</strong></span>
              <div v-if="String(row.status || 'pending') === 'pending'" class="row-actions">
                <button class="secondary" type="button" @click="quickApprove(row)">快速通过</button>
                <button class="danger secondary" type="button" @click="quickReject(row)">快速驳回</button>
                <button type="button" @click="approve(row)">通过并奖励</button>
                <button class="danger secondary" type="button" @click="reject(row)">驳回</button>
              </div>
              <p v-else class="sub">审核：{{ row.reviewed_by || "-" }} · {{ time(row.reviewed_at) }}<br />{{ row.review_note || "" }}</p>
            </div>
          </article>
        </div>
      </div>
    </section>
  </section>
</template>

<script setup>
import { inject, onMounted, ref } from "vue";
import { api } from "../services/api";
import { number, time } from "../utils/format";

const toast = inject("toast", () => {});
const rows = ref([]);
const counts = ref({});
const status = ref("pending");
const loading = ref(false);

function statusLabel(value) {
  return { pending: "待审核", approved: "已通过", rejected: "已驳回" }[value] || value || "-";
}

function statusTone(value) {
  if (value === "approved") return "success";
  if (value === "rejected") return "danger";
  return "warn";
}

function correctionUser(row) {
  return row.nickname || row.username || row.telegram_username || row.telegram_id || `用户 ${row.user_id || "-"}`;
}

function diffParts(row, type) {
  const original = String(row.original_text || "");
  const corrected = String(row.corrected_text || "");
  const source = type === "original" ? original : corrected;
  if (original === corrected) return [{ text: source, changed: false }];
  let start = 0;
  while (start < original.length && start < corrected.length && original[start] === corrected[start]) start += 1;
  let endOriginal = original.length - 1;
  let endCorrected = corrected.length - 1;
  while (endOriginal >= start && endCorrected >= start && original[endOriginal] === corrected[endCorrected]) {
    endOriginal -= 1;
    endCorrected -= 1;
  }
  const end = type === "original" ? endOriginal : endCorrected;
  return [
    { text: source.slice(0, start), changed: false },
    { text: source.slice(start, end + 1), changed: true },
    { text: source.slice(end + 1), changed: false }
  ].filter((part) => part.text);
}

async function load() {
  loading.value = true;
  try {
    const queryStatus = status.value === "all" ? "" : status.value;
    const data = await api(`/admin-api/corrections?status=${encodeURIComponent(queryStatus)}&limit=120`);
    rows.value = data.rows || [];
    counts.value = data.counts || {};
  } catch (err) {
    toast(err.message || String(err));
  } finally {
    loading.value = false;
  }
}

async function quickApprove(row) {
  await api(`/admin-api/corrections/${row.id}/approve`, { method: "POST", body: JSON.stringify({ note: "快速通过" }) });
  await load();
  toast("已快速通过纠错");
}

async function quickReject(row) {
  if (!window.confirm("确认快速驳回该纠错？")) return;
  await api(`/admin-api/corrections/${row.id}/reject`, { method: "POST", body: JSON.stringify({ note: "快速驳回" }) });
  await load();
  toast("已快速驳回纠错");
}

async function approve(row) {
  const note = window.prompt("通过备注，可留空", "");
  if (note === null) return;
  await api(`/admin-api/corrections/${row.id}/approve`, { method: "POST", body: JSON.stringify({ note }) });
  await load();
  toast("已通过纠错并发放奖励");
}

async function reject(row) {
  const note = window.prompt("驳回原因，可留空", "");
  if (note === null) return;
  await api(`/admin-api/corrections/${row.id}/reject`, { method: "POST", body: JSON.stringify({ note }) });
  await load();
  toast("已驳回纠错");
}

onMounted(load);
</script>
