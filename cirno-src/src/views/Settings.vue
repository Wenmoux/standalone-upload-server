<template>
  <div class="settings-wrapper">
    <div class="top-bar">
      <div class="title" @click="goBack">
        <i class="ri-arrow-left-line icon"></i>
        <div class="text">设置</div>
      </div>
    </div>

    <div class="content-wrapper">
      <div class="profile-card">
        <div class="avatar-box">
          <img class="avatar" :src="profile.avatar_url || defaultAvatar" alt="头像" />
        </div>
        <div class="profile-info">
          <div class="profile-name">{{ profile.nickname || profile.username || '本地读者' }}</div>
          <div class="profile-account">账号：{{ profile.username || account || '-' }}</div>
        </div>
      </div>

      <div class="setting-card">
        <div class="section-title">账号资料</div>
        <div class="form-row">
          <div class="label">昵称</div>
          <a-input v-model:value.trim="profile.nickname" placeholder="请输入昵称" size="large" />
        </div>
        <div class="form-row">
          <div class="label">头像地址</div>
          <a-input v-model:value.trim="profile.avatar_url" placeholder="粘贴头像图片 URL，可留空使用默认头像" size="large" />
        </div>
        <div class="tips">头像先支持图片链接；留空会显示默认头像。</div>
        <a-button type="primary" size="large" :loading="saving" @click="saveProfile">保存资料</a-button>
      </div>

      <div class="danger-card" @click="logout">
        <i class="ri-logout-box-r-line"></i>
        <span>退出登录</span>
      </div>
    </div>
  </div>
</template>

<script>
import defaultAvatarImage from '@/assets/d_avatar.jpg'
export default {
  data() {
    return {
      account: localStorage.getItem('account') || '',
      saving: false,
      defaultAvatar: defaultAvatarImage,
      profile: {
        id: '',
        username: '',
        nickname: '',
        avatar_url: ''
      }
    }
  },
  async created() {
    this.loadProfile()
  },
  methods: {
    goBack() {
      this.$router.back()
    },
    async loadProfile() {
      try {
        const res = await fetch('/reader-auth/me', { credentials: 'include' })
        const data = await res.json()
        if (!data.user) return this.$router.replace({ name: 'Login' })
        this.profile = Object.assign({}, this.profile, data.user)
        this.account = data.user.username || this.account
      } catch (e) {
        this.$message.error('获取资料失败')
      }
    },
    async saveProfile() {
      if (!this.profile.nickname) {
        this.$message.warn('昵称不能为空')
        return
      }
      this.saving = true
      try {
        const data = await this.$patch({
          url: '/reader-auth/profile',
          data: {
            nickname: this.profile.nickname,
            avatar_url: this.profile.avatar_url
          }
        })
        this.profile = Object.assign({}, this.profile, data.user)
        localStorage.setItem('account', this.profile.username || '')
        this.$store.commit('setReaderInfo', {
          reader_id: this.profile.id || 0,
          reader_name: this.profile.nickname || this.profile.username,
          account: this.profile.username || '',
          avatar_thumb_url: this.profile.avatar_url || ''
        })
        this.$message.success('资料已保存')
      } catch (e) {
        this.$message.error(e.error || e.message || '保存失败')
      } finally {
        this.saving = false
      }
    },
    async logout() {
      const confirm = this.$confirm || (this.$modal && this.$modal.confirm)
      if (!confirm) {
        if (!window.confirm('确定退出登录？')) return
        await fetch('/reader-auth/logout', { method: 'POST', credentials: 'include' }).catch(() => null)
        localStorage.removeItem('login_token')
        localStorage.removeItem('account')
        this.$store.commit('setReaderInfo', {})
        this.$router.replace({ name: 'Login' })
        return
      }
      confirm({
        title: '确定退出登录？',
        okText: '退出',
        okType: 'danger',
        cancelText: '取消',
        onOk: async () => {
          await fetch('/reader-auth/logout', { method: 'POST', credentials: 'include' }).catch(() => null)
          localStorage.removeItem('login_token')
          localStorage.removeItem('account')
          this.$store.commit('setReaderInfo', {})
          this.$router.replace({ name: 'Login' })
        }
      })
    }
  }
}
</script>

<style lang="less" scoped>
.settings-wrapper {
  width: 80%;
  min-height: 100vh;
  margin: 0 auto;
  background: #fff;
  color: #1f2933;
  .top-bar {
    z-index: 200;
    padding: 36px 0;
    position: fixed;
    width: 80%;
    background: rgba(255, 255, 255, 0.96);
    display: flex;
    align-items: center;
    .title {
      cursor: pointer;
      width: fit-content;
      font-size: 24px;
      font-weight: 600;
      user-select: none;
      display: flex;
      align-items: center;
      color: #111827;
      .icon {
        line-height: 24px;
      }
      .text {
        margin-left: 16px;
      }
    }
  }

  .content-wrapper {
    padding-top: 120px;
    max-width: 760px;
  }

  .profile-card,
  .setting-card,
  .danger-card {
    border-radius: 18px;
    border: 1px solid #e5eaf0;
    box-shadow: 0 10px 28px rgba(15, 23, 42, 0.06);
  }

  .profile-card {
    display: flex;
    align-items: center;
    padding: 22px 24px;
    background: linear-gradient(135deg, #eef6ff, #fff8f1);
    .avatar-box {
      width: 72px;
      height: 72px;
      border-radius: 50%;
      overflow: hidden;
      background: #f3f6fa;
      border: 3px solid #fff;
      box-shadow: 0 6px 16px rgba(0, 0, 0, 0.1);
      .avatar {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
    }
    .profile-info {
      margin-left: 18px;
      .profile-name {
        font-size: 22px;
        font-weight: 700;
        color: #111827;
      }
      .profile-account {
        margin-top: 6px;
        color: #6b7280;
        font-size: 14px;
      }
    }
  }

  .setting-card {
    margin-top: 22px;
    padding: 24px;
    background: #fff;
    .section-title {
      font-size: 18px;
      font-weight: 700;
      margin-bottom: 18px;
    }
    .form-row {
      margin-bottom: 16px;
      .label {
        margin-bottom: 8px;
        color: #4b5563;
        font-weight: 600;
      }
      :deep(.ant-input ){
        color: #1f2933;
        background: #fff;
        border-color: #cfd7e3;
        &::placeholder {
          color: #9aa4b2;
        }
        &:focus,
        &:hover {
          border-color: #1b88ee;
          box-shadow: 0 0 0 2px rgba(27, 136, 238, 0.16);
        }
      }
    }
    .tips {
      margin-bottom: 18px;
      color: #7b8794;
      font-size: 13px;
    }
  }

  .danger-card {
    margin-top: 22px;
    padding: 18px 22px;
    color: #ef4444;
    background: #fff5f5;
    border-color: #fecaca;
    font-size: 16px;
    font-weight: 700;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 10px;
    &:hover {
      background: #fee2e2;
    }
  }
}
</style>
