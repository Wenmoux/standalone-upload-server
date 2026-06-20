<template>
  <section>
    <div class="view-head">
      <div class="view-title">
        <h2>总览</h2>
        <p class="sub">书库、章节、用户、反馈和 Bot 关键指标。</p>
      </div>
      <button class="secondary" type="button" @click="load">刷新</button>
    </div>

    <div v-if="error" class="error-block">{{ error }}</div>
    <div v-else-if="loading" class="panel"><div class="section">加载中...</div></div>
    <div v-else class="dashboard">
      <section v-for="section in sections" :key="section.title" class="stat-section" :class="{ wide: section.wide }">
        <div class="stat-head">
          <h3>{{ section.title }}</h3>
          <small>{{ section.note }}</small>
        </div>
        <div class="stat-grid" :class="{ four: section.four, five: section.five, six: section.six }">
          <StatCard v-for="item in section.items" :key="item.label" :label="item.label" :value="item.value">
            <template v-if="item.action">
              <button class="secondary" type="button" @click="navigate(item.action)">{{ item.hint }}</button>
            </template>
            <template v-else>{{ item.hint }}</template>
          </StatCard>
        </div>
      </section>
    </div>
  </section>
</template>

<script setup>
import { computed, inject, onMounted, ref } from "vue";
import StatCard from "../components/StatCard.vue";
import { api } from "../services/api";
import { bytes, number, percent, platformSummary, time, uptime } from "../utils/format";

const navigate = inject("navigate", () => {});
const loading = ref(true);
const error = ref("");
const stats = ref({});

const sections = computed(() => {
  const s = stats.value || {};
  return [
    {
      title: "核心数据",
      note: "当前库",
      wide: true,
      six: true,
      items: [
        { label: "元信息记录", value: number(s.metadata), hint: "book_metadata 总记录" },
        { label: "去重书籍", value: number(s.books), hint: "按 book_id 去重" },
        { label: "有缓存书籍", value: number(s.cachedBooks), hint: "cache_count > 0 的 book_id" },
        { label: "完整度", value: number(s.completeBooks), hint: "缓存章节 > 总章节 80%" },
        { label: "章节缓存", value: number(s.chapters), hint: "chapter_cache 总记录" },
        { label: "章节/书", value: number(s.avgChaptersPerBook), hint: "按有缓存书籍计算" }
      ]
    },
    {
      title: "近期增长",
      note: "按本机时间",
      wide: true,
      four: true,
      items: [
        { label: "今日章节", value: number(s.chaptersToday), hint: "今天新增或更新" },
        { label: "24h 章节", value: number(s.chapters24h), hint: "最近一天" },
        { label: "7日章节", value: number(s.chapters7d), hint: "最近七天" },
        { label: "7日元信息", value: number(s.metadata7d), hint: "最近七天" }
      ]
    },
    {
      title: "共享与来源",
      note: "上传维度",
      items: [
        { label: "章节共享人数", value: number(s.uploaders), hint: "按上传者ID/名称去重" },
        { label: "元信息上传人数", value: number(s.metadataUploaders), hint: "按上传者ID/名称去重" },
        { label: "站别数量", value: number(s.platformsCount), hint: platformSummary(s.platforms) },
        { label: "更新记录", value: number(s.events), hint: `24h ${number(s.events24h)} / 7日 ${number(s.events7d)}` }
      ]
    },
    {
      title: "读者反馈",
      note: "Bot 喜欢/不喜欢",
      items: [
        { label: "反馈总数", value: number(s.feedback), hint: `${number(s.feedbackUsers)} 位用户` },
        { label: "喜欢", value: number(s.feedbackLikes), hint: "详情页 Like" },
        { label: "不喜欢", value: number(s.feedbackDislikes), hint: "详情页 Dislike" },
        { label: "喜欢率", value: percent(s.feedbackLikes, s.feedback), hint: "查看热词与反馈", action: "feedback" }
      ]
    },
    {
      title: "众筹投票",
      note: "Bot 书籍支持榜",
      items: [
        { label: "支持次数", value: number(s.crowdVotes), hint: `${number(s.crowdUsers)} 位用户` },
        { label: "上榜书籍", value: number(s.crowdBooks), hint: "按 book_id 去重" },
        { label: "银币消耗", value: number(s.crowdSilver), hint: "每票 100 银币" },
        { label: "查看榜单", value: number(s.crowdVotes), hint: "查看众筹榜", action: "feedback" }
      ]
    },
    {
      title: "纠错审核",
      note: "阅读器文本修正",
      items: [
        { label: "待审核", value: number(s.correctionsPending), hint: "去审核", action: "corrections" },
        { label: "已通过", value: number(s.correctionsApproved), hint: "每条奖励 200 铜币 + 100 银币" },
        { label: "已驳回", value: number(s.correctionsRejected), hint: "未发奖励" },
        { label: "提交用户", value: number(s.correctionUsers), hint: `总计 ${number(s.corrections)} 条` }
      ]
    },
    {
      title: "Bot 运营",
      note: "Telegram 用户与活跃",
      items: [
        { label: "Bot 用户", value: number(s.botUsers), hint: `未封禁 ${number(s.botActiveUsers)}` },
        { label: "今日签到", value: number(s.botSignedToday), hint: `7日签到 ${number(s.botSigned7d)}` },
        { label: "7日流水用户", value: number(s.botTxUsers7d), hint: `24h 流水 ${number(s.botTransactions24h)}` },
        { label: "导出授权", value: number(s.botExportUnlocked), hint: `今日免费 ${number(s.botFreeExportBooksToday)} 本 / ${number(s.botFreeExportUsersToday)} 人` }
      ]
    },
    {
      title: "运行与存储",
      note: "旁路服务",
      items: [
        { label: "主库大小", value: bytes(s.mainDbSize), hint: "当前上传库" },
        { label: "管理库大小", value: bytes(s.sidecarDbSize), hint: "登录/记录/TG配置" },
        { label: "运行时长", value: uptime(s.uptimeSeconds), hint: `启动 ${time(s.startedAt)}` },
        { label: "最近章节", value: time(s.lastChapterAt), hint: "chapter_cache 最新时间" }
      ]
    }
  ];
});

async function load() {
  loading.value = true;
  error.value = "";
  try {
    stats.value = await api("/admin-api/stats");
  } catch (err) {
    error.value = err.message || String(err);
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>
