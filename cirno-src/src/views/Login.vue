<template>
  <div class="login">
    <div class="side-pic">
      <div class="pic" :style="{ background: 'url(' + sidePic + ')' }"></div>
    </div>
    <div class="side-box">
      <div class="login-box">
        <div class="title">
          <div>{{ mode === 'login' ? '本地账号登录' : '注册本地账号' }}</div>
        </div>
        <div class="mode-switch">
          <button :class="{ active: mode === 'login' }" @click="switchMode('login')">登录</button>
          <button :class="{ active: mode === 'register' }" @click="switchMode('register')">注册</button>
        </div>
        <div class="input-box">
          <div class="user-name input">
            <a-input ref="userNameInput" size="large" v-model:value="userName" placeholder="用户名">
              <template #prefix>
                <a-icon type="user" />
              </template>
            </a-input>
          </div>
          <div class="password input">
            <a-input-password placeholder="密码" size="large" v-model:value="password" @press-enter="submit" />
          </div>
          <div class="cdk input" v-if="mode === 'register'">
            <a-input size="large" v-model:value="cdk" placeholder="注册 CDK">
              <template #prefix>
                <a-icon type="key" />
              </template>
            </a-input>
          </div>
          <div class="nickname input" v-if="mode === 'register'">
            <a-input size="large" v-model:value="nickname" placeholder="昵称，可不填">
              <template #prefix>
                <a-icon type="smile" />
              </template>
            </a-input>
          </div>
        </div>
        <div class="button">
          <a-checkbox v-model:checked="remUser" class="checkbox" v-if="mode === 'login'">
            记住密码
          </a-checkbox>
          <div class="mode-tip" v-else>注册后会自动进入书架</div>
          <div class="login-button">
            <a-button
              class="main-login-button"
              type="primary"
              :loading="confirmLoading"
              size="large"
              shape="round"
              @click="submit"
            >
              {{ mode === 'login' ? '登录' : '注册' }}
            </a-button>
            <a-button
              v-if="mode === 'login'"
              class="telegram-login-button"
              :loading="telegramLoading"
              size="large"
              shape="circle"
              title="TG 登录"
              @click="loginWithTelegram"
            >
              <i class="ri-telegram-fill"></i>
            </a-button>
          </div>
        </div>
      </div>
      <div class="footer"></div>
    </div>
  </div>
</template>

<script>
import sideImage from '@/assets/side.png'
let telegramScriptLoading = null

export default {
  data() {
    return {
      sidePic: sideImage,
      confirmLoading: false,
      telegramLoading: false,
      telegramConfig: null,
      mode: 'login',
      userName: '',
      password: '',
      cdk: '',
      nickname: '',
      remUser: false
    }
  },
  created() {
    if (localStorage.getItem('loginInfo')) {
      let json = JSON.parse(localStorage.getItem('loginInfo'))
      this.userName = json.userName
      this.password = json.passwd
      this.remUser = true
    }
  },
  methods: {
    switchMode(mode) {
      this.mode = mode
      this.confirmLoading = false
    },
    submit() {
      if (this.mode === 'register') {
        this.register()
      } else {
        this.login()
      }
    },
    validate() {
      if (!this.userName.trim()) {
        this.$message.warn('请输入用户名')
        return false
      }
      if (!this.password) {
        this.$message.warn('请输入密码')
        return false
      }
      if (this.mode === 'register' && this.password.length < 6) {
        this.$message.warn('密码至少 6 位')
        return false
      }
      if (this.mode === 'register' && !this.cdk.trim()) {
        this.$message.warn('请输入注册 CDK')
        return false
      }
      return true
    },
    applyLogin(res) {
      localStorage.setItem('login_token', res.data.login_token || 'local-session')
      localStorage.setItem('account', res.data.reader_info.account)
      const isPasswordLogin = !res.data.telegram_login
      if (isPasswordLogin && this.remUser && this.mode === 'login') {
        localStorage.setItem(
          'loginInfo',
          JSON.stringify({
            userName: this.userName,
            passwd: this.password
          })
        )
      }
      if (isPasswordLogin && !this.remUser && this.mode === 'login') {
        localStorage.removeItem('loginInfo')
      }
      const redirect = String(this.$route.query.redirect || '')
      if (redirect && redirect.charAt(0) === '/') {
        this.$router.push(redirect)
        return
      }
      this.$router.push({
        name: 'Index',
        params: { forceReload: true }
      })
    },
    login() {
      if (!this.validate()) return
      this.confirmLoading = true
      this.$get({
        url: '/signup/login',
        urlParas: {
          login_name: this.userName,
          passwd: this.password
        }
      }).then(
        res => {
          this.confirmLoading = false
          this.applyLogin(res)
        },
        () => {
          this.confirmLoading = false
        }
      )
    },
    register() {
      if (!this.validate()) return
      this.confirmLoading = true
      this.$post({
        url: '/signup/register',
        paras: {
          username: this.userName.trim(),
          password: this.password,
          cdk: this.cdk.trim(),
          nickname: this.nickname.trim() || this.userName.trim()
        }
      }).then(
        res => {
          const user = res.data.user || {}
          this.confirmLoading = false
          this.applyLogin({
            data: {
              login_token: 'local-session',
              reader_info: {
                account: user.username || this.userName,
                reader_name: user.nickname || user.username || this.userName
              }
            }
          })
        },
        () => {
          this.confirmLoading = false
        }
      )
    },
    readerInfo(user = {}) {
      return {
        reader_id: user.id || 0,
        reader_name: user.nickname || user.username || 'TG 读者',
        account: user.username || '',
        avatar_thumb_url: user.avatar_url || '',
        membership_expires_at: user.membership_expires_at || null,
        membership_permanent: !!user.membership_permanent,
        library_access: user.library_access !== false,
        copper_coins: user.copper_coins || 0,
        silver_coins: user.silver_coins || 0,
        sign_cycle_day: user.sign_cycle_day || 0,
        last_sign_date: user.last_sign_date || null
      }
    },
    async getTelegramConfig() {
      if (this.telegramConfig) return this.telegramConfig
      const res = await fetch('/reader-auth/telegram/config', { credentials: 'include' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'TG 登录配置读取失败')
      this.telegramConfig = data
      return data
    },
    loadTelegramScript() {
      if (window.Telegram && window.Telegram.Login && window.Telegram.Login.auth) return Promise.resolve()
      if (telegramScriptLoading) return telegramScriptLoading
      telegramScriptLoading = new Promise((resolve, reject) => {
        const script = document.createElement('script')
        script.src = 'https://telegram.org/js/telegram-widget.js?22'
        script.async = true
        script.onload = resolve
        script.onerror = () => reject(new Error('TG 登录组件加载失败'))
        document.head.appendChild(script)
      })
      return telegramScriptLoading
    },
    async loginWithTelegram() {
      this.telegramLoading = true
      try {
        const config = await this.getTelegramConfig()
        if (!config.enabled || !config.botId) throw new Error('TG 登录未配置')
        await this.loadTelegramScript()
        if (!window.Telegram || !window.Telegram.Login || !window.Telegram.Login.auth) {
          throw new Error('TG 登录组件不可用')
        }
        window.Telegram.Login.auth({ bot_id: config.botId, request_access: true }, this.handleTelegramAuth)
      } catch (err) {
        this.telegramLoading = false
        this.$message.error(err.message || 'TG 登录失败')
      }
    },
    async handleTelegramAuth(user) {
      if (!user) {
        this.telegramLoading = false
        this.$message.warn('已取消 TG 登录')
        return
      }
      try {
        const res = await fetch('/reader-auth/telegram', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(user)
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || 'TG 登录失败')
        this.applyLogin({
          data: {
            telegram_login: true,
            login_token: 'local-session',
            reader_info: this.readerInfo(data.user || {})
          }
        })
      } catch (err) {
        this.$message.error(err.message || 'TG 登录失败')
      } finally {
        this.telegramLoading = false
      }
    }
  }
}
</script>

<style lang="less" scoped>
.login {
  width: 100vw;
  min-height: 100vh;
  display: flex;
  overflow-x: hidden;
  background: #ffffff;
  color: #1f2933;

  .side-pic {
    width: 42vw;
    max-width: 520px;
    min-width: 320px;
    background: #f8fafc;
    overflow: hidden;
    .pic {
      width: 100%;
      height: 100%;
      background-repeat: no-repeat !important;
      background-size: cover !important;
      background-position: center !important;
      opacity: 0.96;
    }
  }

  .side-box {
    flex: 1;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 48px;
    background: linear-gradient(135deg, #f7fbff 0%, #ffffff 48%, #fff8f1 100%);

    .login-box {
      width: 100%;
      max-width: 440px;
      padding: 34px;
      border: 1px solid #e5eaf0;
      border-radius: 22px;
      background: rgba(255, 255, 255, 0.92);
      box-shadow: 0 18px 46px rgba(15, 23, 42, 0.1);
      backdrop-filter: blur(10px);

      .title {
        display: flex;
        align-items: center;
        font-weight: 700;
        font-size: 26px;
        line-height: 1.25;
        margin-bottom: 22px;
        color: #111827;
      }

      .mode-switch {
        width: fit-content;
        display: flex;
        padding: 4px;
        margin-bottom: 26px;
        border-radius: 999px;
        background: #edf2f7;
        button {
          border: 0;
          height: 38px;
          min-width: 82px;
          padding: 0 20px;
          border-radius: 999px;
          color: #64748b;
          background: transparent;
          cursor: pointer;
          font-weight: 700;
          font-size: 15px;
          transition: all 0.18s ease;
          &:hover {
            color: #1b88ee;
          }
        }
        button.active {
          color: #ffffff;
          background: #1b88ee;
          box-shadow: 0 8px 18px rgba(27, 136, 238, 0.22);
        }
      }

      .input-box {
        margin: 0;
        .input {
          margin-bottom: 18px;
        }
        :deep(.ant-input),
        :deep(.ant-input-affix-wrapper ){
          height: 52px;
          color: #1f2933;
          font-size: 16px;
          border-radius: 10px;
          border-color: #d7dee8;
          background: #ffffff;
          box-shadow: none;
          &:hover,
          &:focus {
            border-color: #1b88ee;
            box-shadow: 0 0 0 2px rgba(27, 136, 238, 0.14);
          }
        }
        :deep(.ant-input::placeholder ){
          color: #98a2b3;
        }
        :deep(.ant-input-prefix ){
          color: #6b7280;
        }
      }

      .button {
        width: 100%;
        margin-top: 24px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 18px;
        .login-button {
          width: 46%;
          min-width: 150px;
          display: flex;
          gap: 10px;
          :deep(.ant-btn ){
            height: 52px;
            font-size: 18px;
            font-weight: 700;
            box-shadow: 0 8px 18px rgba(27, 136, 238, 0.24);
          }
          .main-login-button {
            flex: 1;
          }
          .telegram-login-button {
            width: 52px;
            min-width: 52px;
            color: #ffffff;
            border-color: #229ed9;
            background: #229ed9;
            i {
              font-size: 22px;
              line-height: 1;
            }
          }
        }
        .checkbox,
        .mode-tip {
          color: #526173;
          user-select: none;
          font-size: 15px;
        }
      }
    }
  }
}

@media (max-width: 768px) {
  .login {
    display: block;
    background: linear-gradient(180deg, #f7fbff 0%, #ffffff 45%, #fff8f1 100%);
    .side-pic {
      display: none;
    }
    .side-box {
      width: 100%;
      min-height: 100vh;
      padding: 28px 18px;
      align-items: flex-start;
      justify-content: center;
      background: transparent;
      .login-box {
        max-width: 420px;
        margin: 9vh auto 0;
        padding: 28px 22px;
        border-radius: 20px;
        .title {
          font-size: 25px;
          margin-bottom: 22px;
        }
        .mode-switch {
          margin-bottom: 24px;
          button {
            min-width: 78px;
            height: 38px;
          }
        }
        .input-box {
          .input {
            margin-bottom: 16px;
          }
        }
        .button {
          display: block;
          margin-top: 22px;
          .checkbox,
          .mode-tip {
            display: block;
            margin-bottom: 16px;
          }
          .login-button {
            width: 100%;
            .telegram-login-button {
              flex: 0 0 52px;
            }
          }
        }
      }
    }
  }
}

@media (max-width: 420px) {
  .login {
    .side-box {
      padding: 22px 14px;
      .login-box {
        margin-top: 7vh;
        padding: 24px 18px;
        .title {
          font-size: 23px;
        }
      }
    }
  }
}
</style>
