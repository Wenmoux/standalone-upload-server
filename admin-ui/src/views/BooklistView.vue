<template>
  <section>
    <div class="view-head">
      <div class="view-title">
        <h2>动态榜单</h2>
        <p class="sub">管理 /rank 公共榜单缓存，支持按综合热度、更新、缓存、字数和章节排序。</p>
      </div>
      <div class="row-actions">
        <button class="secondary" type="button" @click="load">刷新状态</button>
        <button :disabled="refreshing" type="button" @click="refresh">{{ refreshing ? "刷新中..." : "立即刷新缓存" }}</button>
        <button class="secondary" type="button" @click="openPage">打开 /rank</button>
      </div>
    </div>

    <section class="panel">
      <div class="section">
        <div class="toolbar compact">
          <label class="field">
            <span>缓存源数量</span>
            <input v-model.number="sourceLimit" type="number" min="1" max="20000" />
          </label>
          <button :disabled="refreshing" type="button" @click="refresh">重建榜单缓存</button>
          <p class="sub">只重建后端内存缓存，不再写入静态 HTML；公共入口固定为 /rank。</p>
        </div>

        <div class="dashboard" style="margin-top: 16px">
          <StatCard label="榜单状态" :value="status.ready ? '已就绪' : status.loading ? '生成中' : '未生成'">
            {{ status.error ? `最近错误：${status.error}` : "公共入口 /rank 会读取这份缓存" }}
          </StatCard>
          <StatCard label="更新时间" :value="status.generatedAt ? time(status.generatedAt) : '-'">
            缓存年龄：{{ status.cacheAgeMs == null ? "-" : duration(status.cacheAgeMs) }}
          </StatCard>
          <StatCard label="数据规模" :value="`${number(status.returned || 0)} / ${number(status.total || 0)}`">
            {{ status.truncated ? `已按源数量截取前 ${number(status.sourceLimit)} 本` : "未截断" }}
          </StatCard>
          <StatCard label="自动刷新" :value="duration(status.refreshIntervalMs)">
            TTL：{{ duration(status.cacheTtlMs) }}
          </StatCard>
        </div>
      </div>
    </section>

    <section class="rank-admin-grid">
      <div class="panel">
        <div class="section">
          <div class="section-head">
            <div>
              <p class="section-title">热门站点</p>
              <p class="section-desc">按收录数量和热度排序。</p>
            </div>
          </div>
          <div class="rank-chip-list">
            <span v-for="site in status.sites || []" :key="site.key" class="rank-chip">
              <strong>{{ site.label }}</strong>
              <small>{{ number(site.count) }} 本 · 缓存 {{ number(site.cache_count) }}</small>
            </span>
            <p v-if="!(status.sites || []).length" class="sub">暂无站点数据。</p>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="section">
          <div class="section-head">
            <div>
              <p class="section-title">热门分类</p>
              <p class="section-desc">用于 /rank 分类筛选。</p>
            </div>
          </div>
          <div class="rank-chip-list">
            <span v-for="category in status.categories || []" :key="category.key" class="rank-chip">
              <strong>{{ category.label }}</strong>
              <small>{{ number(category.count) }} 本 · 热度 {{ number(category.heat) }}</small>
            </span>
            <p v-if="!(status.categories || []).length" class="sub">暂无分类数据。</p>
          </div>
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="section">
        <div class="section-head">
          <div>
            <p class="section-title">榜单预览</p>
            <p class="section-desc">每类榜单取缓存 Top 5，完整列表在 /rank 查看。</p>
          </div>
        </div>
        <div class="rank-preview-grid">
          <div v-for="item in leaderGroups" :key="item.key" class="rank-preview">
            <h3>{{ item.label }}</h3>
            <ol>
              <li v-for="book in item.rows" :key="`${item.key}-${book.book_id}`">
                <span>{{ book.title || book.book_id }}</span>
                <small>{{ book.platform_label }} · 热度 {{ number(book.heat) }}</small>
              </li>
            </ol>
            <p v-if="!item.rows.length" class="sub">暂无数据。</p>
          </div>
        </div>
      </div>
    </section>
  </section>
</template>

<script setup>
import { computed, inject, onMounted, ref } from "vue";
import StatCard from "../components/StatCard.vue";
import { api } from "../services/api";
import { number, time } from "../utils/format";

const toast = inject("toast", () => {});
const status = ref({});
const sourceLimit = ref(5000);
const refreshing = ref(false);

const leaderGroups = computed(() => {
  const sorts = status.value.sorts || {};
  const leaders = status.value.leaders || {};
  return Object.keys(sorts).map((key) => ({
    key,
    label: sorts[key]?.label || key,
    rows: leaders[key] || []
  }));
});

function duration(ms) {
  const seconds = Math.round(Number(ms || 0) / 1000);
  if (!seconds) return "-";
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.round(minutes / 60);
  return `${hours} 小时`;
}

async function load() {
  try {
    const data = await api(`/admin-api/rank/status?limit=${encodeURIComponent(sourceLimit.value || 5000)}`);
    status.value = data;
    sourceLimit.value = Number(data.sourceLimit || sourceLimit.value || 5000);
  } catch (err) {
    toast(err.message || String(err));
  }
}

async function refresh() {
  refreshing.value = true;
  try {
    const data = await api("/admin-api/rank/refresh", {
      method: "POST",
      body: JSON.stringify({ limit: Number(sourceLimit.value || 5000) })
    });
    status.value = data;
    toast(`榜单缓存已刷新：${number(data.returned)} / ${number(data.total)} 本`);
  } catch (err) {
    toast(err.message || String(err));
  } finally {
    refreshing.value = false;
  }
}

function openPage() {
  window.open("/rank", "_blank");
}

onMounted(load);
</script>
