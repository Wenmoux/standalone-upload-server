<template>
  <section>
    <div class="view-head">
      <div class="view-title">
        <h2>TG Bot</h2>
        <p class="sub">频道推送、管理员日报、网页登录和导出扣费配置。</p>
      </div>
      <button class="secondary" type="button" @click="loadAll">刷新</button>
    </div>

    <section class="panel">
      <div class="section">
        <div class="section-head">
          <div><p class="section-title">Bot 运行概览</p><p class="section-desc">在线状态、后台任务队列、限流、PikPak 和最近失败原因。</p></div>
          <button class="secondary" type="button" @click="loadBotOverview">刷新运行状态</button>
        </div>
        <div class="dashboard">
          <StatCard label="Bot 状态" :value="botOverview.online ? '在线' : botStatusLabel">{{ botOverview.health?.detail || botOverview.health?.error || '-' }}</StatCard>
          <StatCard label="队列" :value="`${number(botOverview.queue?.running || 0)} / ${number(botOverview.queue?.queued || 0)}`">运行 / 排队；并发 {{ number(botOverview.queue?.concurrency || 0) }}</StatCard>
          <StatCard label="限流键" :value="number(botOverview.rate_limits?.keys || 0)">上限 {{ number(botOverview.rate_limits?.maxKeys || 0) }}</StatCard>
          <StatCard label="Telegram 延迟" :value="botOverview.telegram_api?.latency_ms ? `${botOverview.telegram_api.latency_ms}ms` : '-'">{{ botOverview.telegram_api?.detail || '-' }}</StatCard>
          <StatCard label="Bot 用户" :value="number(botOverview.activity?.users || 0)">未封禁 {{ number(botOverview.activity?.active_users || 0) }}</StatCard>
          <StatCard label="今日签到" :value="number(botOverview.activity?.signed_today || 0)">7 日登录 {{ number(botOverview.activity?.login_7d || 0) }}</StatCard>
          <StatCard label="导出授权" :value="number(botOverview.activity?.export_unlocked || 0)">近 7 日导出记录见下方</StatCard>
          <StatCard label="PikPak" :value="botOverview.pikpak?.configured ? '已配置' : '未完整配置'">{{ botOverview.pikpak?.root || '/' }}</StatCard>
        </div>
        <div class="split bot-ops-grid" style="margin-top: 16px">
          <div>
            <h3 class="mini-title">近 7 日流水类型</h3>
            <div v-if="!(botOverview.transactions_7d || []).length" class="empty-block">暂无流水</div>
            <ul v-else class="mini-list">
              <li v-for="item in botOverview.transactions_7d" :key="item.type"><span>{{ item.type }}</span><strong>{{ number(item.count) }}</strong></li>
            </ul>
          </div>
          <div>
            <h3 class="mini-title">近 7 日导出</h3>
            <div v-if="!(botOverview.exports_7d || []).length" class="empty-block">暂无导出记录</div>
            <ul v-else class="mini-list">
              <li v-for="item in botOverview.exports_7d" :key="item.format"><span>{{ item.format || 'unknown' }}</span><strong>{{ number(item.count) }}</strong></li>
            </ul>
          </div>
        </div>
        <div class="split bot-ops-grid" style="margin-top: 16px">
          <div>
            <h3 class="mini-title">失败原因 Top</h3>
            <div v-if="!(botOverview.failure_reasons || []).length" class="empty-block">暂无失败日志</div>
            <ul v-else class="mini-list">
              <li v-for="item in botOverview.failure_reasons" :key="item.reason"><span>{{ item.reason }}</span><strong>{{ number(item.count) }}</strong></li>
            </ul>
          </div>
          <div>
            <h3 class="mini-title">最近 Bot 任务</h3>
            <pre class="mini-log">{{ (botOverview.recent_tasks || []).join("\n") || "暂无任务日志" }}</pre>
          </div>
        </div>
        <div class="split bot-ops-grid" style="margin-top: 16px">
          <div>
            <h3 class="mini-title">审计命令 Top</h3>
            <div v-if="!(botOverview.audit?.summary?.commands || []).length" class="empty-block">
              {{ botOverview.audit?.available === false ? "审计表未就绪，等待迁移完成" : "暂无审计记录" }}
            </div>
            <ul v-else class="mini-list">
              <li v-for="item in botOverview.audit.summary.commands" :key="`${item.command}-${item.action}`">
                <span>{{ item.command || item.action || "-" }}</span>
                <strong>{{ number(item.count) }}</strong>
              </li>
            </ul>
          </div>
          <div>
            <h3 class="mini-title">最近审计</h3>
            <pre class="mini-log">{{ auditLines.join("\n") || botOverview.audit?.error || "暂无审计记录" }}</pre>
          </div>
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="section">
        <div class="section-head"><div><p class="section-title">Telegram 推送</p><p class="section-desc">选择推送到指定频道或群组的更新内容。</p></div></div>
        <label class="check-row"><input v-model="form.enabled" type="checkbox" /><span>启用频道推送</span></label>
        <div class="tag-row" style="margin: 10px 0">
          <label class="check-row"><input v-model="form.pushMetadata" type="checkbox" /><span>元信息</span></label>
          <label class="check-row"><input v-model="form.pushChapter" type="checkbox" /><span>章节更新</span></label>
          <label class="check-row"><input v-model="form.pushDaily" type="checkbox" /><span>日报</span></label>
        </div>
        <div class="split">
          <label class="field"><span>Bot Token</span><input v-model.trim="form.botToken" placeholder="123456:ABC..." /></label>
          <label class="field"><span>Chat ID / Channel ID</span><input v-model.trim="form.chatId" placeholder="-100xxxxxxxxxx 或 @channel" /></label>
        </div>
        <div class="button-row" style="margin-top: 14px">
          <button type="button" @click="saveTelegram">保存</button>
          <button class="secondary" type="button" @click="testTelegram">测试</button>
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="section">
        <div class="section-head"><div><p class="section-title">管理员日报</p><p class="section-desc">每日按北京时间推送新增书籍、章节、活跃人数等数据。</p></div></div>
        <label class="check-row"><input v-model="form.dailyReportEnabled" type="checkbox" /><span>启用日报</span></label>
        <div class="split" style="margin-top: 12px">
          <label class="field"><span>推送时间</span><input v-model.trim="form.dailyReportTime" placeholder="22:00" /></label>
          <label class="field"><span>管理员 Chat ID</span><input v-model.trim="form.dailyReportAdminIds" placeholder="留空则发送给绑定 TG 的管理员，多个用逗号分隔" /></label>
        </div>
        <div class="dashboard" style="margin-top: 16px">
          <StatCard label="收件人" :value="number(status.dailyReportRecipients)"> {{ form.dailyReportAdminIds ? "来自手动配置" : "绑定 TG 的管理员" }} </StatCard>
          <StatCard label="上次日报" :value="status.dailyReportLastDate || '-'">每日只自动发送一次</StatCard>
          <StatCard label="状态" :value="status.dailyReportEnabled === false ? '已关闭' : '已开启'">独立于章节推送</StatCard>
        </div>
        <div class="button-row" style="margin-top: 14px">
          <button type="button" @click="saveTelegram">保存</button>
          <button class="secondary" type="button" @click="testDailyReport">发送日报测试</button>
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="section">
        <div class="section-head"><div><p class="section-title">TG 网页登录</p><p class="section-desc">Cirno 登录页的 TG 图标复用上面的 Bot Token。</p></div></div>
        <div class="dashboard">
          <StatCard label="网页登录" :value="status.loginEnabled ? '可用' : '未配置'">{{ status.loginEnabled ? "TG 图标可发起登录" : "请先保存 Bot Token" }}</StatCard>
          <StatCard label="Bot ID" :value="status.loginBotId || '-'">{{ tokenSourceText }}</StatCard>
          <StatCard label="有效期" :value="`${Math.round((status.loginMaxAgeSeconds || 86400) / 3600)} 小时`">超过后需重新授权</StatCard>
        </div>
        <label class="field" style="margin-top: 14px"><span>BotFather 绑定域名</span><input :value="origin" readonly /></label>
        <div class="button-row" style="margin-top: 14px">
          <button class="secondary" type="button" @click="copyDomain">复制域名</button>
          <button class="secondary" type="button" @click="loadTelegram">刷新状态</button>
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="section">
        <div class="section-head"><div><p class="section-title">导出扣费</p><p class="section-desc">配置免费额度用完后的导出授权和章节扣费。</p></div></div>
        <div class="split">
          <label class="field"><span>导出授权价（银币）</span><input v-model.number="pricing.unlockCost" type="number" min="0" step="1" /></label>
          <label class="field"><span>免费书导出（铜币/次）</span><input v-model.number="pricing.freeCopperCost" type="number" min="0" step="1" /></label>
          <label class="field"><span>收费章节导出（银币/章）</span><input v-model.number="pricing.paidChapterSilverCost" type="number" min="0" step="1" /></label>
        </div>
        <div class="button-row" style="margin-top: 14px">
          <button type="button" @click="savePricing">保存导出价格</button>
          <button class="secondary" type="button" @click="loadPricing">刷新</button>
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="section">
        <div class="section-head">
          <div>
            <p class="section-title">Bot 命令管理</p>
            <p class="section-desc">开关命令、调整帮助文案。保存后 Bot 会读取同一份配置，禁用命令会直接拒绝执行。</p>
          </div>
          <div class="row-actions">
            <button class="secondary" type="button" @click="loadBotCommands">刷新命令</button>
            <button type="button" :disabled="commandSaving" @click="saveBotCommands">{{ commandSaving ? "保存中..." : "保存命令配置" }}</button>
          </div>
        </div>
        <div v-if="!botCommands.length" class="empty-block">暂无命令配置，刷新后会从 Bot 命令目录读取。</div>
        <div v-else class="command-admin-grid">
          <div class="command-groups">
            <article v-for="group in commandGroups" :key="group.name" class="command-group">
              <h3 class="mini-title">{{ group.name }} <span>{{ group.rows.length }}</span></h3>
              <div class="command-row" v-for="cmd in group.rows" :key="cmd.command">
                <label class="check-row command-switch">
                  <input v-model="cmd.enabled" type="checkbox" />
                  <span><code>{{ cmd.command }}</code></span>
                </label>
                <div class="command-fields">
                  <input v-model.trim="cmd.description" :placeholder="cmd.defaultDescription || '命令说明'" />
                  <input v-model.trim="cmd.disabledMessage" placeholder="禁用时回复，可留空使用默认提示" />
                  <small>
                    {{ cmd.help || cmd.command }}
                    <template v-if="cmd.aliases?.length"> · aliases: {{ cmd.aliases.join(", ") }}</template>
                    <template v-if="cmd.adminOnly"> · admin</template>
                  </small>
                </div>
              </div>
            </article>
          </div>
          <div class="command-preview">
            <h3 class="mini-title">帮助预览</h3>
            <pre class="mini-log">{{ commandHelpPreview.join("\n") || "暂无启用命令" }}</pre>
          </div>
        </div>
      </div>
    </section>
  </section>
</template>

<script setup>
import { computed, inject, onMounted, reactive, ref } from "vue";
import StatCard from "../components/StatCard.vue";
import { api } from "../services/api";
import { number } from "../utils/format";

const toast = inject("toast", () => {});
const origin = window.location.origin;
const status = ref({});
const botOverview = ref({});
const botCommands = ref([]);
const commandSaving = ref(false);
const form = reactive({
  enabled: false,
  pushMetadata: false,
  pushChapter: false,
  pushDaily: false,
  botToken: "",
  chatId: "",
  dailyReportEnabled: true,
  dailyReportTime: "22:00",
  dailyReportAdminIds: ""
});
const pricing = reactive({ unlockCost: 100, freeCopperCost: 100, paidChapterSilverCost: 10 });
const tokenSourceText = computed(() => {
  if (status.value.loginTokenSource === "env") return "来自环境变量";
  if (status.value.loginTokenSource === "admin_config") return "来自后台保存";
  return "等待配置";
});
const botStatusLabel = computed(() => {
  if (botOverview.value.health?.skipped) return "未启用";
  if (botOverview.value.health?.ok === false) return "异常";
  return "未知";
});
const auditLines = computed(() => (botOverview.value.audit?.recent || []).map((row) => {
  const time = String(row.created_at || "").slice(0, 19).replace("T", " ");
  const user = row.telegram_username ? `@${row.telegram_username}` : row.telegram_id || "-";
  const status = row.status || "-";
  const command = row.command || row.action || "-";
  const cost = row.duration_ms ? `${row.duration_ms}ms` : "-";
  const reason = row.status === "failed" ? ` ${row.error_code || row.error || "failed"}` : "";
  return `${time} ${status} ${command} ${user} ${cost}${reason}`;
}));
const commandGroups = computed(() => {
  const groups = new Map();
  for (const row of botCommands.value || []) {
    const group = row.group || "其它";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(row);
  }
  return [...groups.entries()].map(([name, rows]) => ({ name, rows }));
});
const commandHelpPreview = computed(() => {
  const rows = [];
  for (const group of commandGroups.value) {
    const enabledRows = group.rows.filter((row) => row.enabled !== false);
    if (!enabledRows.length) continue;
    rows.push(`[${group.name}]`);
    enabledRows.forEach((row) => rows.push(`${row.command} - ${row.description || row.defaultDescription || ""}`));
  }
  return rows;
});

async function loadBotOverview() {
  botOverview.value = await api("/admin-api/bot/overview");
}

async function loadBotCommands() {
  const data = await api("/admin-api/bot/commands");
  botCommands.value = (data.commands || []).map((row) => ({ ...row, enabled: row.enabled !== false }));
}

async function saveBotCommands() {
  commandSaving.value = true;
  try {
    const data = await api("/admin-api/bot/commands", {
      method: "PUT",
      body: JSON.stringify({
        commands: botCommands.value.map((row) => ({
          command: row.command,
          enabled: row.enabled !== false,
          description: row.description || "",
          disabledMessage: row.disabledMessage || ""
        }))
      })
    });
    botCommands.value = (data.commands || []).map((row) => ({ ...row, enabled: row.enabled !== false }));
    toast("Bot 命令配置已保存");
  } catch (err) {
    toast(err.message || String(err));
  } finally {
    commandSaving.value = false;
  }
}

async function loadTelegram() {
  const data = await api("/admin-api/config/telegram");
  const pushTypes = Array.isArray(data.pushTypes) ? data.pushTypes : data.enabled ? ["chapter"] : [];
  status.value = data;
  form.enabled = !!data.enabled;
  form.pushMetadata = pushTypes.includes("metadata");
  form.pushChapter = pushTypes.includes("chapter");
  form.pushDaily = pushTypes.includes("daily");
  form.botToken = data.botToken || "";
  form.chatId = data.chatId || "";
  form.dailyReportEnabled = data.dailyReportEnabled !== false;
  form.dailyReportTime = data.dailyReportTime || "22:00";
  form.dailyReportAdminIds = data.dailyReportAdminIds || "";
}

async function saveTelegram() {
  const pushTypes = [
    ["metadata", form.pushMetadata],
    ["chapter", form.pushChapter],
    ["daily", form.pushDaily]
  ]
    .filter(([, enabled]) => enabled)
    .map(([type]) => type);
  await api("/admin-api/config/telegram", {
    method: "PUT",
    body: JSON.stringify({
      enabled: form.enabled,
      pushTypes,
      botToken: form.botToken,
      chatId: form.chatId,
      dailyReportEnabled: form.dailyReportEnabled,
      dailyReportTime: form.dailyReportTime || "22:00",
      dailyReportAdminIds: form.dailyReportAdminIds
    })
  });
  await loadTelegram();
  toast("Telegram 配置已保存");
}

async function loadPricing() {
  const data = await api("/admin-api/config/export");
  pricing.unlockCost = data.unlockCost ?? 100;
  pricing.freeCopperCost = data.freeCopperCost ?? 100;
  pricing.paidChapterSilverCost = data.paidChapterSilverCost ?? 10;
}

async function savePricing() {
  await api("/admin-api/config/export", {
    method: "PUT",
    body: JSON.stringify({
      unlockCost: Number(pricing.unlockCost || 0),
      freeCopperCost: Number(pricing.freeCopperCost || 0),
      paidChapterSilverCost: Number(pricing.paidChapterSilverCost || 0)
    })
  });
  await loadPricing();
  toast("导出价格已保存");
}

async function testTelegram() {
  await api("/admin-api/config/telegram/test", { method: "POST" });
  toast("测试消息已发送");
}

async function testDailyReport() {
  const data = await api("/admin-api/config/telegram/daily-report/test", { method: "POST" });
  toast(`日报已发送：${number(data.sent || 0)}/${number(data.recipients || 0)}`);
  await loadTelegram();
}

async function copyDomain() {
  try {
    await navigator.clipboard.writeText(origin);
    toast("已复制域名");
  } catch {
    window.prompt("复制这个域名到 BotFather", origin);
  }
}

function loadAll() {
  loadBotOverview().catch((err) => toast(err.message || String(err)));
  loadBotCommands().catch((err) => toast(err.message || String(err)));
  loadTelegram().catch((err) => toast(err.message || String(err)));
  loadPricing().catch((err) => toast(err.message || String(err)));
}

onMounted(loadAll);
</script>
