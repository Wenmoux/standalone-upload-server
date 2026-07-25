<template>
  <section>
    <div class="view-head">
      <div class="view-title">
        <h2>QQ Bot</h2>
        <p class="sub">书库搜索、TXT/EPUB 下载与可见内容范围。</p>
      </div>
      <button class="secondary" type="button" :disabled="loading" @click="load">刷新</button>
    </div>

    <section class="panel">
      <div class="section">
        <div class="section-head">
          <div>
            <p class="section-title">连接配置</p>
            <p class="section-desc">保存后 QQ Bot 进程自动重连，AppSecret 不会在后台回显。</p>
          </div>
        </div>
        <label class="check-row"><input v-model="form.enabled" type="checkbox" /><span>启用 QQ Bot</span></label>
        <div class="split" style="margin-top: 14px">
          <label class="field">
            <span>AppID</span>
            <input v-model.trim="form.appId" autocomplete="off" placeholder="QQ 开放平台 AppID" />
          </label>
          <label class="field">
            <span>AppSecret</span>
            <input
              v-model.trim="form.appSecret"
              type="password"
              autocomplete="new-password"
              :placeholder="status.appSecretConfigured ? '已配置，留空保持不变' : '输入重置后的 AppSecret'"
            />
            <small v-if="status.appSecretConfigured">已配置；来源：{{ secretSourceLabel }}</small>
          </label>
        </div>
        <div class="button-row" style="margin-top: 14px">
          <button type="button" :disabled="saving || !loaded" @click="save">{{ saving ? "保存中…" : "保存" }}</button>
          <button class="secondary" type="button" :disabled="testing || !status.appSecretConfigured" @click="testConnection">
            {{ testing ? "测试中…" : "测试连接" }}
          </button>
          <button
            v-if="status.appSecretSource === 'admin_config'"
            class="danger ghost"
            type="button"
            :disabled="clearing"
            @click="clearSecret"
          >
            {{ clearing ? "清除中…" : "清除 AppSecret" }}
          </button>
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="section">
        <div class="section-head">
          <div>
            <p class="section-title">搜索范围</p>
            <p class="section-desc">同一规则同时约束搜索结果、书籍详情和最终下载。</p>
          </div>
        </div>
        <div class="split bot-scope-grid">
          <div>
            <p class="mini-title">仅允许的平台</p>
            <p class="section-desc">不勾选表示允许全部平台。</p>
            <div class="platform-chip-grid compact-platform-grid">
              <label v-for="platform in platforms" :key="`allow-${platform.value}`" class="platform-chip check-row">
                <input v-model="form.allowedPlatforms" type="checkbox" :value="platform.value" />
                <span>{{ platform.label || platform.value }}</span>
                <em>{{ number(platform.count) }}</em>
              </label>
            </div>
          </div>
          <div>
            <p class="mini-title">屏蔽的平台</p>
            <p class="section-desc">屏蔽优先级高于允许列表。</p>
            <div class="platform-chip-grid compact-platform-grid">
              <label v-for="platform in platforms" :key="`block-${platform.value}`" class="platform-chip check-row">
                <input v-model="form.blockedPlatforms" type="checkbox" :value="platform.value" />
                <span>{{ platform.label || platform.value }}</span>
                <em>{{ number(platform.count) }}</em>
              </label>
            </div>
          </div>
        </div>
        <label class="field" style="margin-top: 18px">
          <span>屏蔽标签</span>
          <textarea v-model="blockedTagsText" rows="6" placeholder="每行一个标签，例如：&#10;限制级&#10;不公开"></textarea>
          <small>按完整标签精确匹配，支持换行、逗号或顿号分隔。</small>
        </label>
      </div>
    </section>

    <section class="panel">
      <div class="section">
        <div class="section-head">
          <div>
            <p class="section-title">下载体验</p>
            <p class="section-desc">EPUB 样式与 Telegram Bot 使用同一生成器和模板资源。</p>
          </div>
        </div>
        <label class="field qq-style-field">
          <span>默认 EPUB 样式</span>
          <select v-model="form.defaultEpubStyle">
            <option v-for="style in epubStyles" :key="style.id" :value="style.id">{{ style.label || style.id }}</option>
          </select>
        </label>
        <div class="button-row" style="margin-top: 14px">
          <button type="button" :disabled="saving || !loaded" @click="save">保存全部配置</button>
        </div>
      </div>
    </section>
  </section>
</template>

<script setup>
/**
 * [INPUT]: 依赖 Vue、Admin API、全局提示/确认服务及平台/EPUB 配置投影
 * [OUTPUT]: 提供 QQ Bot 凭据、启停、平台白黑名单、标签黑名单和默认 EPUB 样式管理页
 * [POS]: admin-ui/src/views 的 QQ Bot 独立工作台，敏感凭据只写不读且范围配置显式可扫描
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { computed, inject, onMounted, reactive, ref } from "vue";
import { api } from "../services/api";
import { number } from "../utils/format";

const toast = inject("toast", () => {});
const confirmAction = inject("confirmAction", async () => ({ confirmed: false }));
const loading = ref(false);
const loaded = ref(false);
const saving = ref(false);
const testing = ref(false);
const clearing = ref(false);
const status = ref({});
const platforms = ref([]);
const epubStyles = ref([]);
const blockedTagsText = ref("");
const form = reactive({
  enabled: false,
  appId: "",
  appSecret: "",
  allowedPlatforms: [],
  blockedPlatforms: [],
  defaultEpubStyle: "style1"
});

const secretSourceLabel = computed(() => (status.value.appSecretSource === "env" ? "环境变量" : "后台加密配置"));

function tagRows() {
  return blockedTagsText.value
    .split(/[,，、|;；\n\r]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function load() {
  loading.value = true;
  try {
    const data = await api("/admin-api/config/qq-bot");
    status.value = data;
    platforms.value = data.platforms || [];
    epubStyles.value = data.epubStyles || [];
    form.enabled = !!data.enabled;
    form.appId = data.appId || "";
    form.appSecret = "";
    form.allowedPlatforms = [...(data.allowedPlatforms || [])];
    form.blockedPlatforms = [...(data.blockedPlatforms || [])];
    form.defaultEpubStyle = data.defaultEpubStyle || data.epubStyles?.[0]?.id || "style1";
    blockedTagsText.value = (data.blockedTags || []).join("\n");
    loaded.value = true;
  } catch (err) {
    toast(err.message || String(err), "error");
  } finally {
    loading.value = false;
  }
}

async function save(extra = {}) {
  if (!loaded.value || saving.value) return;
  saving.value = true;
  try {
    const payload = {
      enabled: form.enabled,
      appId: form.appId,
      allowedPlatforms: form.allowedPlatforms,
      blockedPlatforms: form.blockedPlatforms,
      blockedTags: tagRows(),
      defaultEpubStyle: form.defaultEpubStyle,
      ...extra
    };
    if (form.appSecret) payload.appSecret = form.appSecret;
    await api("/admin-api/config/qq-bot", { method: "PUT", body: JSON.stringify(payload) });
    await load();
    toast("QQ Bot 配置已保存");
  } catch (err) {
    toast(err.message || String(err), "error");
  } finally {
    saving.value = false;
  }
}

async function testConnection() {
  testing.value = true;
  try {
    const data = await api("/admin-api/config/qq-bot/test", { method: "POST", body: "{}" });
    toast(`QQ 凭据有效，Access Token 有效期约 ${Math.round(Number(data.expiresIn || 0) / 60)} 分钟`);
  } catch (err) {
    toast(err.message || String(err), "error");
  } finally {
    testing.value = false;
  }
}

async function clearSecret() {
  const confirmation = await confirmAction({
    title: "确认清除 QQ AppSecret",
    message: "清除后 QQ Bot 会在下一次配置刷新时断开。环境变量中的 AppSecret 不受影响。",
    confirmLabel: "确认清除",
    requireReason: false,
    phrase: "CLEAR"
  });
  if (!confirmation.confirmed) return;
  clearing.value = true;
  try {
    await save({ clearAppSecret: true });
  } finally {
    clearing.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.bot-scope-grid {
  align-items: start;
}

.compact-platform-grid {
  margin-top: 10px;
}

.compact-platform-grid .platform-chip {
  min-height: 42px;
}

.qq-style-field {
  max-width: 420px;
}
</style>
