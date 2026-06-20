<template>
  <section>
    <div class="view-head">
      <div class="view-title">
        <h2>用户</h2>
        <p class="sub">读者账号、权限、会员和货币余额。</p>
      </div>
      <div class="row-actions">
        <button class="secondary" type="button" @click="exportUsersCsv">导出 CSV</button>
        <button class="secondary" type="button" @click="load">刷新</button>
        <button type="button" @click="openEditor()">新增用户</button>
      </div>
    </div>
    <section class="panel">
      <div class="section">
        <div class="toolbar user-filter-toolbar">
          <label class="field">
            <span>用户名/昵称</span>
            <input v-model.trim="filters.q" placeholder="用户名或昵称" @keydown.enter="load" />
          </label>
          <label class="field">
            <span>Telegram</span>
            <input v-model.trim="filters.telegram_id" placeholder="Telegram ID / 用户名" @keydown.enter="load" />
          </label>
          <label class="field">
            <span>会员</span>
            <select v-model="filters.membership" @change="load">
              <option value="">全部</option>
              <option value="active">有效会员</option>
              <option value="permanent">永久会员</option>
              <option value="expired">已过期</option>
              <option value="none">未授权</option>
            </select>
          </label>
          <label class="field">
            <span>状态</span>
            <select v-model="filters.status" @change="load">
              <option value="">全部</option>
              <option value="normal">普通用户</option>
              <option value="admin">管理员</option>
              <option value="banned">已封禁</option>
              <option value="library_disabled">书库禁用</option>
            </select>
          </label>
          <button type="button" @click="load">筛选</button>
        </div>

        <DataTable :columns="columns" :rows="rows" :loading="loading" empty-text="暂无用户">
          <template #cell-id="{ row }"><code>{{ row.id }}</code></template>
          <template #cell-account="{ row }">
            {{ row.username }}<br />
            <small>{{ row.nickname || "" }}</small>
            <template v-if="row.telegram_id"><br /><small>TG {{ row.telegram_id }} {{ row.telegram_username || "" }}</small></template>
          </template>
          <template #cell-membership="{ row }">
            <span v-if="row.membership_permanent" class="tag success">永久</span>
            <span v-else-if="row.membership_expires_at" class="tag" :class="new Date(row.membership_expires_at) > new Date() ? '' : 'warn'">
              {{ new Date(row.membership_expires_at) > new Date() ? "到期" : "已过期" }} {{ time(row.membership_expires_at) }}
            </span>
            <span v-else class="tag warn">未授权</span>
          </template>
          <template #cell-library="{ row }">
            <div class="tag-row">
              <span class="tag" :class="row.library_access ? 'success' : 'danger'">{{ row.library_access ? "允许" : "禁用" }}</span>
              <span v-if="row.is_admin" class="tag">管理员</span>
              <span v-if="row.is_banned" class="tag danger">封禁</span>
            </div>
          </template>
          <template #cell-coins="{ row }">铜币 {{ number(row.copper_coins) }}<br />银币 {{ number(row.silver_coins) }}</template>
          <template #cell-scholar="{ row }">
            {{ scholarName(row) }} Lv.{{ number(scholarLevel(row)) }}<br />
            <small>经验 {{ number(row.scholar_exp) }}，距下级 {{ number(row.scholar?.exp_to_next ?? 0) }}</small><br />
            <small>今日免费 {{ number(row.free_exports_today) }}/{{ number(row.daily_free_exports || row.scholar?.daily_free_exports || scholarLevel(row)) }} 本</small>
          </template>
          <template #cell-sign="{ row }">第 {{ number(row.sign_cycle_day) }} 天<br /><small>{{ dateOnly(row.last_sign_date) }}</small></template>
          <template #cell-time="{ row }">创建 {{ time(row.created_at) }}<br /><small>登录 {{ time(row.last_login_at) }}</small></template>
          <template #cell-actions="{ row }">
            <div class="row-actions">
              <button class="secondary" type="button" @click="openEditor(row)">改</button>
              <button class="secondary" type="button" @click="grant(row)">授权</button>
              <button class="danger secondary" type="button" @click="remove(row)">删</button>
            </div>
          </template>
        </DataTable>
      </div>
    </section>

    <FormModal
      :open="modal.open"
      :title="modal.title"
      :model="modal.model"
      :fields="userFields"
      :checks="checks"
      @close="modal.open = false"
      @save="save"
    />
  </section>
</template>

<script setup>
import { inject, onMounted, reactive, ref } from "vue";
import DataTable from "../components/DataTable.vue";
import FormModal from "../components/FormModal.vue";
import { api } from "../services/api";
import { dateOnly, number, time } from "../utils/format";

const toast = inject("toast", () => {});
const rows = ref([]);
const loading = ref(false);
const modal = reactive({ open: false, id: null, title: "", model: {} });
const filters = reactive({ q: "", telegram_id: "", membership: "", status: "" });

const columns = [
  { key: "id", label: "ID" },
  { key: "account", label: "账号/昵称" },
  { key: "membership", label: "会员" },
  { key: "library", label: "书库" },
  { key: "coins", label: "货币" },
  { key: "scholar", label: "等级/免费" },
  { key: "sign", label: "签到" },
  { key: "time", label: "时间" },
  { key: "actions", label: "操作" }
];

const baseFields = [
  { key: "nickname", label: "昵称" },
  { key: "avatar_url", label: "头像URL" },
  { key: "copper_coins", label: "铜币", type: "number" },
  { key: "silver_coins", label: "银币", type: "number" },
  { key: "scholar_exp", label: "书卷经验", type: "number" }
];
const checks = [{ key: "library_access", label: "允许访问书库" }];
const userFields = ref(baseFields);

function scholarLevel(row) {
  return row.scholar?.level || row.scholar_level || 1;
}

function scholarName(row) {
  return row.scholar?.name || row.scholar_level_name || "卷首书童";
}

async function load() {
  loading.value = true;
  try {
    const params = new URLSearchParams({
      q: filters.q,
      telegram_id: filters.telegram_id,
      membership: filters.membership,
      status: filters.status
    });
    const data = await api(`/admin-api/users?${params}`);
    rows.value = data.rows || [];
  } catch (err) {
    toast(err.message || String(err));
  } finally {
    loading.value = false;
  }
}

function exportUsersCsv() {
  const params = new URLSearchParams({
    q: filters.q,
    telegram_id: filters.telegram_id,
    membership: filters.membership,
    status: filters.status
  });
  window.open(`/admin-api/users/export.csv?${params}`, "_blank");
}

function openEditor(row = null) {
  modal.id = row?.id || null;
  modal.title = row ? "修改用户" : "新增用户";
  userFields.value = row
    ? [...baseFields, { key: "reason", label: "余额/经验修改原因", placeholder: "修改铜币、银币或经验时必填" }]
    : [
        { key: "username", label: "用户名" },
        { key: "password", label: "密码", type: "password" },
        ...baseFields
      ];
  modal.model = {
    username: row?.username || "",
    password: "",
    nickname: row?.nickname || row?.username || "",
    avatar_url: row?.avatar_url || "",
    copper_coins: row?.copper_coins || 0,
    silver_coins: row?.silver_coins || 0,
    scholar_exp: row?.scholar_exp || 0,
    reason: "",
    library_access: row?.library_access !== false
  };
  modal.open = true;
}

async function save(form) {
  const body = {
    nickname: form.nickname,
    avatar_url: form.avatar_url,
    copper_coins: Number(form.copper_coins || 0),
    silver_coins: Number(form.silver_coins || 0),
    scholar_exp: Number(form.scholar_exp || 0),
    library_access: form.library_access !== false
  };
  if (!modal.id) {
    body.username = form.username;
    body.password = form.password;
  } else {
    body.reason = form.reason;
  }
  await api(modal.id ? `/admin-api/users/${modal.id}` : "/admin-api/users", {
    method: modal.id ? "PUT" : "POST",
    body: JSON.stringify(body)
  });
  modal.open = false;
  await load();
  toast("用户已保存");
}

async function grant(row) {
  const duration = window.prompt("授权时长：7d / 30d / 365d / permanent", "30d");
  if (!duration) return;
  await api(`/admin-api/users/${row.id}/membership`, {
    method: "POST",
    body: JSON.stringify({ duration_type: duration })
  });
  await load();
  toast("已授权");
}

async function remove(row) {
  if (!window.confirm("删除该用户？")) return;
  await api(`/admin-api/users/${row.id}`, { method: "DELETE" });
  await load();
  toast("已删除用户");
}

onMounted(load);
</script>
