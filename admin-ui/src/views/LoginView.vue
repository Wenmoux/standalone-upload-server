<template>
  <section>
    <header class="topbar">
      <div class="brand">
        <div class="mark">P</div>
        <div>
          <strong>PO18 Reader Setup</strong>
          <span>书库后台与初始化面板</span>
        </div>
      </div>
      <div class="chip"><span class="dot"></span><span>后台登录</span></div>
    </header>

    <main class="page-main">
      <div class="layout auth-layout">
        <aside class="summary">
          <h1>书库后台</h1>
          <p class="lead">登录后管理书籍、章节、用户、CDK、Telegram Bot 和运行状态。</p>
          <div class="path">3100 管理端</div>
          <nav class="nav">
            <a href="/setup">初始化面板</a>
            <a :href="readerUrl" target="_blank" rel="noreferrer">阅读器 3200</a>
            <a href="/health/version">版本信息</a>
          </nav>
        </aside>
        <section class="panel">
          <form class="section" @submit.prevent="submit">
            <div class="section-head">
              <div>
                <p class="section-title">管理员登录</p>
                <p class="section-desc">使用安装向导里配置的后台账号密码。</p>
              </div>
            </div>
            <label class="field">
              <span>用户名</span>
              <input v-model.trim="username" autocomplete="username" />
            </label>
            <label class="field" style="margin-top: 12px">
              <span>密码</span>
              <input v-model="password" type="password" autocomplete="current-password" />
            </label>
            <div class="button-row" style="margin-top: 18px">
              <button :disabled="loading" type="submit">{{ loading ? "登录中..." : "登录" }}</button>
              <a class="ghost-button" href="/setup">进入 setup</a>
            </div>
            <p v-if="error" class="error-block" style="margin-top: 14px">{{ error }}</p>
            <p class="sub" style="margin-top: 14px">如果数据库还没配置，先进入 setup 保存 PostgreSQL 和 Bot 配置，再重启服务。</p>
          </form>
        </section>
      </div>
    </main>
  </section>
</template>

<script setup>
import { ref } from "vue";
import { api } from "../services/api";

defineProps({
  readerUrl: { type: String, required: true }
});

const emit = defineEmits(["login"]);

const username = ref("admin");
const password = ref("");
const loading = ref(false);
const error = ref("");

async function submit() {
  error.value = "";
  loading.value = true;
  try {
    const data = await api("/admin-api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: username.value, password: password.value })
    });
    emit("login", data.user);
  } catch (err) {
    error.value = err.message || String(err);
  } finally {
    loading.value = false;
  }
}
</script>
