<template>
  <div class="detail-page" :style="readerThemeStyle">
    <div class="detail-shell" ref="detailShell">
      <div class="top-bar">
        <i class="ri-arrow-left-line icon-button" @click="goBack"></i>
        <div class="topbar-title">书籍详情</div>
      </div>

      <div v-if="loading === 0" class="skeleton-container">
        <a-skeleton active />
      </div>

      <div v-else-if="loading === 1" class="detail-content">
        <section class="book-hero">
          <div class="cover-wrap">
            <img v-if="book_info.cover" :src="book_info.cover" alt="" />
            <div v-else class="empty-cover">{{ coverText }}</div>
          </div>
          <div class="book-main">
            <div class="book-platform">{{ platformLabel(book_info.platform) }}</div>
            <h1>{{ book_info.book_name || bid }}</h1>
            <div class="author">{{ book_info.author_name || '佚名' }}</div>
            <div class="tag-row" v-if="tagsList.length">
              <span v-for="tag in tagsList" :key="tag">{{ tag }}</span>
            </div>
            <div class="action-row">
              <button class="primary-action" @click="startRead">
                <i class="ri-book-open-line"></i>
                {{ lastReadChapterId ? '继续阅读' : '开始阅读' }}
              </button>
              <button
                class="secondary-action add-shelf-action"
                :class="{ added: isInShelf }"
                :disabled="addingShelf || checkingShelf"
                @click="handleShelfAction"
              >
                <i :class="isInShelf ? 'ri-check-line' : 'ri-add-line'"></i>
                {{ shelfButtonText }}
              </button>
              <button class="secondary-action" @click="goHome">
                <i class="ri-home-4-line"></i>
                回书架
              </button>
            </div>
          </div>
        </section>

        <div class="detail-tabs">
          <button :class="{ active: activeTab === 'detail' }" @click="setActiveTab('detail')">详情</button>
          <button :class="{ active: activeTab === 'catalog' }" @click="setActiveTab('catalog')">
            目录
            <span>{{ chapters.length }}</span>
          </button>
          <button :class="{ active: activeTab === 'reviews' }" @click="setActiveTab('reviews')">
            书评
            <span>{{ reviewTotal }}</span>
          </button>
        </div>

        <div v-show="activeTab === 'detail'" class="tab-panel">
          <section class="info-grid">
            <div class="info-item" v-for="item in statItems" :key="item.label">
              <span>{{ item.label }}</span>
              <strong>{{ item.value }}</strong>
            </div>
          </section>

          <section class="detail-section">
            <div class="section-title">详情信息</div>
            <div class="meta-grid">
              <div class="meta-item" v-for="item in metaItems" :key="item.label">
                <span>{{ item.label }}</span>
                <strong>{{ item.value }}</strong>
              </div>
            </div>
            <div class="description" v-if="descriptionHtml" v-html="descriptionHtml"></div>
            <div class="description empty" v-else>暂无简介</div>
          </section>
        </div>

        <div v-show="activeTab === 'catalog'" class="tab-panel">
          <section class="detail-section chapter-section">
            <div class="chapter-head">
              <div>
                <div class="section-title">章节列表</div>
                <div class="section-subtitle">
                  共 {{ chapters.length }} 章，已缓存 {{ book_info.cache_count || chapters.length }} 章
                </div>
              </div>
              <div class="chapter-tools">
                <input v-model.trim="chapterKeyword" placeholder="筛选章节标题或 ID" />
                <button class="icon-action" @click="reverse = !reverse" :title="reverse ? '倒序' : '正序'">
                  <i :class="reverse ? 'ri-sort-desc' : 'ri-sort-asc'"></i>
                </button>
              </div>
            </div>

            <div class="chapter-list">
              <div
                class="chapter-row"
                v-for="(chapter, index) in visibleChapters"
                :key="chapter.chapter_id"
                :class="{ active: isLastRead(chapter), volume: isVolumeChapter(chapter) }"
                @click="readChapter(chapter)"
              >
                <div class="chapter-info">
                  <div class="chapter-title">
                    <i v-if="isVolumeChapter(chapter)" :class="volumeIconClass(chapter)"></i>
                    <span v-else class="chapter-index">{{ index + 1 }}</span>
                    <span class="chapter-name">{{ chapter.chapter_title }}</span>
                    <em v-if="isLastRead(chapter)">上次读到</em>
                  </div>
                </div>
                <i v-if="!isVolumeChapter(chapter)" class="ri-arrow-right-s-line chapter-arrow"></i>
              </div>
              <div v-if="!visibleChapters.length" class="chapter-empty">没有匹配的章节</div>
            </div>
          </section>
        </div>

        <div v-show="activeTab === 'reviews'" class="tab-panel">
          <section class="detail-section review-section">
            <div class="review-head">
              <div>
                <div class="section-title">书评</div>
                <div class="section-subtitle">共 {{ reviewTotal }} 条，发布入口在 Telegram Bot：/review {{ bid }} 内容</div>
              </div>
              <button class="icon-action" :disabled="reviewLoading" @click="loadReviews(true)" title="刷新书评">
                <i class="ri-refresh-line"></i>
              </button>
            </div>

            <div v-if="reviewLoading && !reviews.length" class="review-state">正在加载书评...</div>
            <div v-else-if="reviewError" class="review-state error">{{ reviewError }}</div>
            <div v-else-if="!reviews.length" class="review-state">暂无书评</div>
            <div v-else class="review-list">
              <article class="review-card" v-for="review in reviews" :key="review.id">
                <div class="review-card-head">
                  <strong>{{ reviewAuthor(review) }}</strong>
                  <span>{{ formatDateTime(review.created_at) }}</span>
                </div>
                <p>{{ review.content }}</p>
                <div class="review-card-foot">
                  <span><i class="ri-thumb-up-line"></i>{{ review.like_count || 0 }}</span>
                  <span><i class="ri-thumb-down-line"></i>{{ review.dislike_count || 0 }}</span>
                </div>
              </article>
            </div>
          </section>
        </div>
      </div>

      <div v-else class="error-state">
        <div class="error-title">详情加载失败</div>
        <div class="error-text">{{ errText }}</div>
        <button class="primary-action" @click="loadDetail">重试</button>
      </div>
    </div>

    <div
      v-show="loading === 1"
      class="control-bar-container content-bar"
      :class="{ collapsed: controlsCollapsed }"
      :style="{ 'margin-left': controlBarLeftMargin + 'px' }"
    >
      <div class="control-actions">
        <div class="control-button-container" @click="goBack">
          <i class="ri-arrow-left-line control-button"></i>
        </div>
        <div class="control-button-container" @click="startRead">
          <i class="ri-book-open-line control-button"></i>
        </div>
        <div class="control-button-container" @click="handleShelfAction">
          <i :class="isInShelf ? 'ri-check-line control-button' : 'ri-add-line control-button'"></i>
        </div>
        <div class="control-button-container" @click="toTop">
          <i class="ri-arrow-up-s-line control-button"></i>
        </div>
      </div>
      <div class="control-button-container collapse-toggle" @click="controlsCollapsed = !controlsCollapsed">
        <i :class="controlsCollapsed ? 'ri-more-2-fill control-button' : 'ri-arrow-right-s-line control-button'"></i>
      </div>
    </div>
  </div>
</template>

<script>
import PerfectScrollbar from 'perfect-scrollbar'
import 'perfect-scrollbar/css/perfect-scrollbar.css'
import { sanitizeHtml } from '@/utils/sanitize-html'
import { loadPlatformConfig, platformLabel } from '@/utils/platform'

const DEFAULT_THEME = {
  theme: 'default',
  customBg: '#f4ead8',
  customPaper: '#fff9ed',
  customText: '#2f251d',
  customAccent: '#1b88ee'
}

const PALETTES = {
  default: {
    page: '#f6f7f9',
    paper: '#ffffff',
    topbar: 'rgba(255, 255, 255, 0.96)',
    text: '#0d141e',
    muted: '#626b78',
    border: 'rgba(33, 40, 50, 0.1)',
    soft: '#f1f3f6',
    control: '#ffffff',
    accent: '#1b88ee',
    shadow: '0 8px 32px rgba(0, 25, 104, 0.1)'
  },
  paper: {
    page: '#e7dcc9',
    paper: '#fbf3e4',
    topbar: 'rgba(251, 243, 228, 0.96)',
    text: '#2f251d',
    muted: '#7a6754',
    border: 'rgba(97, 70, 41, 0.18)',
    soft: '#efe2ce',
    control: '#fff9ed',
    accent: '#9b5d2e',
    shadow: '0 10px 30px rgba(88, 60, 30, 0.14)'
  },
  green: {
    page: '#dbe8d3',
    paper: '#edf7e8',
    topbar: 'rgba(237, 247, 232, 0.96)',
    text: '#223628',
    muted: '#5f7464',
    border: 'rgba(63, 96, 69, 0.18)',
    soft: '#dfeedd',
    control: '#f5fbf1',
    accent: '#3d8b58',
    shadow: '0 10px 30px rgba(45, 89, 55, 0.12)'
  },
  blue: {
    page: '#dce8ef',
    paper: '#f0f7fb',
    topbar: 'rgba(240, 247, 251, 0.96)',
    text: '#22313f',
    muted: '#64798a',
    border: 'rgba(51, 87, 113, 0.16)',
    soft: '#e3f0f7',
    control: '#f8fcff',
    accent: '#417aa0',
    shadow: '0 10px 30px rgba(46, 82, 111, 0.12)'
  },
  dark: {
    page: '#111722',
    paper: '#1f2430',
    topbar: 'rgba(31, 36, 48, 0.96)',
    text: '#d8dee9',
    muted: '#9aa7b7',
    border: 'rgba(214, 224, 238, 0.12)',
    soft: '#252d3b',
    control: '#283142',
    accent: '#79a8ff',
    shadow: '0 12px 32px rgba(0, 0, 0, 0.28)'
  },
  black: {
    page: '#000000',
    paper: '#0b0d10',
    topbar: 'rgba(11, 13, 16, 0.96)',
    text: '#d6d7d9',
    muted: '#8d949d',
    border: 'rgba(214, 215, 217, 0.13)',
    soft: '#15181d',
    control: '#15181d',
    accent: '#8ab4ff',
    shadow: '0 12px 32px rgba(0, 0, 0, 0.36)'
  }
}

export default {
  name: 'BookDetail',
  data() {
    return {
      bid: '',
      lastReadChapterId: '',
      book_info: {},
      chapters: [],
      loading: 0,
      errText: '',
      reverse: false,
      activeTab: 'detail',
      chapterKeyword: '',
      addingShelf: false,
      checkingShelf: false,
      isInShelf: false,
      reviews: [],
      reviewTotal: 0,
      reviewLoading: false,
      reviewLoaded: false,
      reviewError: '',
      collapsedVolumes: {},
      controlsCollapsed: true,
      detailScroll: null,
      controlBarLeftMargin: 0,
      platformVersion: 0,
      readerSettings: Object.assign({}, DEFAULT_THEME)
    }
  },
  computed: {
    shelfButtonText() {
      if (this.checkingShelf) return '检查中'
      if (this.addingShelf) return '加入中'
      return this.isInShelf ? '已在书架' : '加入书架'
    },
    palette() {
      if (this.readerSettings.theme === 'custom') {
        return {
          page: this.readerSettings.customBg || DEFAULT_THEME.customBg,
          paper: this.readerSettings.customPaper || DEFAULT_THEME.customPaper,
          topbar: this.readerSettings.customPaper || DEFAULT_THEME.customPaper,
          text: this.readerSettings.customText || DEFAULT_THEME.customText,
          muted: this.readerSettings.customText || DEFAULT_THEME.customText,
          border: 'rgba(90, 75, 58, 0.2)',
          soft: this.readerSettings.customBg || DEFAULT_THEME.customBg,
          control: this.readerSettings.customPaper || DEFAULT_THEME.customPaper,
          accent: this.readerSettings.customAccent || DEFAULT_THEME.customAccent,
          shadow: '0 10px 30px rgba(0, 0, 0, 0.12)'
        }
      }
      return PALETTES[this.readerSettings.theme] || PALETTES.default
    },
    readerThemeStyle() {
      return {
        '--reader-page-bg': this.palette.page,
        '--reader-paper-bg': this.palette.paper,
        '--reader-topbar-bg': this.palette.topbar,
        '--reader-text-color': this.palette.text,
        '--reader-muted-color': this.palette.muted,
        '--reader-border-color': this.palette.border,
        '--reader-soft-bg': this.palette.soft,
        '--reader-control-bg': this.palette.control,
        '--reader-accent-color': this.palette.accent,
        '--reader-shadow': this.palette.shadow
      }
    },
    tagsList() {
      return String(this.book_info.tags || '')
        .split(/[,，、|/\s:：;；#＃·•・]+/)
        .map(item => item.trim())
        .filter(Boolean)
        .slice(0, 8)
    },
    coverText() {
      return String(this.book_info.book_name || this.bid || '书').slice(0, 4)
    },
    descriptionHtml() {
      return sanitizeHtml(this.book_info.description || '')
    },
    statItems() {
      return [
        { label: '缓存章节', value: this.formatNumber(this.book_info.cache_count || this.chapters.length) },
        { label: '总章节', value: this.formatNumber(this.book_info.total_chapters || this.chapters.length) },
        { label: '字数', value: this.formatNumber(this.book_info.word_count) },
        { label: '总热度', value: this.formatNumber(this.book_info.total_popularity) },
        { label: '书评', value: this.formatNumber(this.reviewTotal) }
      ]
    },
    metaItems() {
      const book = this.book_info
      const items = [
        { label: '书号', value: book.book_id },
        { label: '站点', value: this.platformLabel(book.platform) },
        { label: '分类', value: book.category },
        { label: '状态', value: book.status },
        { label: '免费章节', value: this.formatNumber(book.free_chapters) },
        { label: '付费章节', value: this.formatNumber(book.paid_chapters) },
        { label: '订阅章节', value: this.formatNumber(book.subscribed_chapters) },
        { label: '月热度', value: this.formatNumber(book.monthly_popularity) },
        { label: '周热度', value: this.formatNumber(book.weekly_popularity) },
        { label: '日热度', value: this.formatNumber(book.daily_popularity) },
        { label: '收藏', value: this.formatNumber(book.favorites_count) },
        { label: '评论', value: this.formatNumber(book.comments_count) },
        { label: '阅读人数', value: this.formatNumber(book.readers_count) },
        { label: '最新章节', value: book.latest_chapter_name },
        { label: '最新更新', value: this.formatDate(book.latest_chapter_date || book.updated_at) },
        { label: '入库时间', value: this.formatDate(book.created_at) }
      ]
      return items.filter(item => item.value !== '' && item.value !== null && item.value !== undefined)
    },
    visibleChapters() {
      const keyword = this.chapterKeyword.toLowerCase()
      let rows = this.filteredVisibleChapters(this.chapters)
      if (keyword) {
        rows = rows.filter(chapter => {
          return (
            String(chapter.chapter_title || '')
              .toLowerCase()
              .includes(keyword) ||
            String(chapter.chapter_id || '')
              .toLowerCase()
              .includes(keyword)
          )
        })
      }
      rows = rows.slice()
      if (this.reverse) rows.reverse()
      return rows
    },
    firstChapter() {
      return this.chapters.find(chapter => !this.isVolumeChapter(chapter)) || null
    },
    primaryChapter() {
      if (this.lastReadChapterId) {
        const last = this.chapters.find(chapter => String(chapter.chapter_id) === String(this.lastReadChapterId))
        if (last && !this.isVolumeChapter(last)) return last
      }
      return this.firstChapter
    }
  },
  created() {
    this.bid = this.$route.query.bid || this.$route.params.bid || ''
    this.lastReadChapterId = this.$route.query.cid || ''
    this.loadReaderSettings()
    loadPlatformConfig()
      .then(() => {
        this.platformVersion += 1
      })
      .catch(() => {})
    this.loadDetail()
  },
  mounted() {
    window.addEventListener('resize', this.windowSizeHandler)
  },
  beforeUnmount() {
    window.removeEventListener('resize', this.windowSizeHandler)
    if (this.detailScroll) this.detailScroll.destroy()
  },
  methods: {
    loadReaderSettings() {
      try {
        const saved = JSON.parse(localStorage.getItem('cirnoReaderSettings') || '{}')
        this.readerSettings = Object.assign({}, DEFAULT_THEME, saved)
        if (this.readerSettings.theme === 'warm') this.readerSettings.theme = 'paper'
      } catch (e) {
        this.readerSettings = Object.assign({}, DEFAULT_THEME)
      }
    },
    async loadDetail() {
      if (!this.bid) {
        this.loading = -1
        this.errText = '缺少 book_id'
        return
      }
      this.loading = 0
      this.errText = ''
      try {
        const [bookRes, chapterRes] = await Promise.all([
          this.$get({
            url: '/book/get_info_by_id',
            urlParas: { book_id: this.bid }
          }),
          this.$get({
            url: '/chapter/get_updated_chapter_by_division_id',
            urlParas: {
              division_id: this.bid,
              last_update_time: 0
            }
          })
        ])
        this.book_info = bookRes.data.book_info || {}
        this.chapters = chapterRes.data.chapter_list || []
        this.loading = 1
        this.$nextTick(() => {
          this.windowSizeHandler()
          this.detailScroll = new PerfectScrollbar(this.$refs.detailShell, {
            wheelSpeed: 2,
            wheelPropagation: true,
            minScrollbarLength: 20
          })
          this.checkShelfStatus().catch(() => {})
          this.loadReviews().catch(() => {})
        })
      } catch (err) {
        this.loading = -1
        this.errText = err && err.message ? err.message : String(err || '请求失败')
      }
    },
    async checkShelfStatus() {
      if (!this.bid) return
      this.checkingShelf = true
      try {
        const res = await fetch(`/reader-api/me/bookshelf/${encodeURIComponent(this.bid)}/status`, {
          credentials: 'include'
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        this.isInShelf = !!data.inShelf
      } catch (e) {
        // 权限/网络错误不阻塞详情页，按钮仍允许尝试加入
        this.isInShelf = false
      } finally {
        this.checkingShelf = false
      }
    },
    handleShelfAction() {
      if (this.isInShelf) {
        this.goHome()
        return
      }
      this.addToShelf()
    },
    addToShelf() {
      if (!this.bid) return
      this.addingShelf = true
      this.$post({
        url: '/bookshelf/add',
        paras: { book_id: this.bid }
      }).then(
        () => {
          this.addingShelf = false
          this.isInShelf = true
          this.$message.success('已加入书架')
        },
        err => {
          this.addingShelf = false
          if (String(err).includes('登录')) {
            localStorage.removeItem('login_token')
            this.$router.replace({ name: 'Login' })
          }
        }
      )
    },
    startRead() {
      if (!this.primaryChapter) {
        this.$message.warn('暂无可阅读章节')
        return
      }
      this.readChapter(this.primaryChapter)
    },
    setActiveTab(tab) {
      this.activeTab = tab
      if (tab === 'reviews' && !this.reviewLoaded && !this.reviewLoading) {
        this.loadReviews().catch(() => {})
      }
      this.$nextTick(() => {
        if (this.detailScroll && this.detailScroll.update) this.detailScroll.update()
      })
    },
    async loadReviews(force = false) {
      if (!this.bid) return
      if (this.reviewLoaded && !force) return
      this.reviewLoading = true
      this.reviewError = ''
      try {
        const res = await fetch(`/reader-api/books/${encodeURIComponent(this.bid)}/reviews?limit=10&page=1`, {
          credentials: 'include'
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
        this.reviews = Array.isArray(data.rows) ? data.rows : []
        this.reviewTotal = Number(data.total || this.reviews.length || 0)
        this.reviewLoaded = true
        this.$nextTick(() => {
          if (this.detailScroll && this.detailScroll.update) this.detailScroll.update()
        })
      } catch (err) {
        this.reviewError = err && err.message ? err.message : String(err || '书评加载失败')
      } finally {
        this.reviewLoading = false
      }
    },
    reviewAuthor(review) {
      if (!review) return 'reader'
      if (review.author_telegram_username) return `@${review.author_telegram_username}`
      return review.author_nickname || review.nickname || review.author_username || 'reader'
    },
    readChapter(chapter) {
      if (this.isVolumeChapter(chapter)) {
        this.toggleVolume(chapter)
        return
      }
      this.$router.push({
        name: 'Book',
        query: {
          bid: this.bid,
          cid: chapter.chapter_id
        }
      })
    },
    isVolumeChapter(chapter) {
      return !!(chapter && (chapter.is_volume || chapter.isVolume))
    },
    volumeKey(chapter) {
      return String((chapter && (chapter.chapter_id || chapter.chapter_title)) || '')
    },
    isVolumeCollapsed(chapter) {
      return !!this.collapsedVolumes[this.volumeKey(chapter)]
    },
    volumeIconClass(chapter) {
      return this.isVolumeCollapsed(chapter) ? 'ri-arrow-right-s-line volume-toggle-icon' : 'ri-arrow-down-s-line volume-toggle-icon'
    },
    toggleVolume(chapter) {
      const key = this.volumeKey(chapter)
      if (!key) return
      this.collapsedVolumes[key] = !this.collapsedVolumes[key]
      this.$nextTick(() => {
        if (this.detailScroll && this.detailScroll.update) this.detailScroll.update()
      })
    },
    filteredVisibleChapters(chapters) {
      const rows = []
      let collapsed = false
      for (const chapter of chapters || []) {
        if (this.isVolumeChapter(chapter)) {
          collapsed = this.isVolumeCollapsed(chapter)
          rows.push(chapter)
          continue
        }
        if (!collapsed) rows.push(chapter)
      }
      return rows
    },
    isLastRead(chapter) {
      return this.lastReadChapterId && String(this.lastReadChapterId) === String(chapter.chapter_id)
    },
    toTop() {
      if (this.$refs.detailShell) this.$refs.detailShell.scrollTo(0, 0)
    },
    goBack() {
      if (window.history.length > 1) this.$router.back()
      else this.goHome()
    },
    goHome() {
      this.$router.push({ name: 'Index' })
    },
    windowSizeHandler() {
      if (!this.$refs.detailShell) return
      const contentWidth = this.$refs.detailShell.clientWidth
      this.controlBarLeftMargin = -(contentWidth / 2 + 96)
      if (this.detailScroll && this.detailScroll.update) this.detailScroll.update()
    },
    formatNumber(value) {
      const num = Number(value || 0)
      if (!num) return '0'
      if (num >= 10000) return `${(num / 10000).toFixed(num >= 100000 ? 0 : 1)}万`
      return String(num)
    },
    formatDate(value) {
      if (!value) return ''
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return String(value)
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(
        2,
        '0'
      )}`
    },
    formatDateTime(value) {
      if (!value) return ''
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return String(value)
      return `${this.formatDate(value)} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
    },
    platformLabel(platform) {
      this.platformVersion
      return platformLabel(platform)
    }
  }
}
</script>

<style lang="less" scoped>
.detail-page {
  width: 100%;
  height: 100%;
  color: var(--reader-text-color);
  background: var(--reader-page-bg);
  overflow: hidden;
  position: relative;
  .detail-shell {
    width: calc(~'100% - 288px');
    max-width: 860px;
    height: 100%;
    margin: 0 auto;
    background: var(--reader-paper-bg);
    overflow: hidden;
    position: relative;
  }
  .top-bar {
    position: fixed;
    top: 0;
    z-index: 20;
    height: 73px;
    width: calc(~'100% - 288px');
    max-width: 860px;
    background: var(--reader-topbar-bg);
    border-bottom: 1px solid var(--reader-border-color);
    display: flex;
    align-items: center;
    backdrop-filter: blur(12px);
    .icon-button {
      font-size: 24px;
      margin-left: 32px;
      cursor: pointer;
      color: var(--reader-text-color);
      opacity: 0.85;
    }
    .topbar-title {
      color: var(--reader-muted-color);
      font-size: 16px;
      font-weight: 500;
      line-height: 16px;
      margin-left: 16px;
    }
  }
  .skeleton-container,
  .error-state {
    padding: 128px 72px 64px;
  }
  .detail-content {
    padding: 128px 72px 72px;
  }
  .book-hero {
    display: grid;
    grid-template-columns: 148px 1fr;
    gap: 32px;
    align-items: start;
    padding-bottom: 36px;
    border-bottom: 1px solid var(--reader-border-color);
  }
  .detail-tabs {
    display: flex;
    gap: 8px;
    margin-top: 22px;
    padding-bottom: 18px;
    border-bottom: 1px solid var(--reader-border-color);
    button {
      min-width: 88px;
      height: 38px;
      padding: 0 16px;
      border-radius: 6px;
      color: var(--reader-muted-color);
      background: transparent;
      font-size: 14px;
      font-weight: 750;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      span {
        min-width: 24px;
        height: 20px;
        padding: 0 7px;
        border-radius: 999px;
        color: var(--reader-muted-color);
        background: var(--reader-soft-bg);
        font-size: 12px;
        line-height: 20px;
      }
      &.active {
        color: var(--reader-paper-bg);
        background: var(--reader-accent-color);
        span {
          color: var(--reader-accent-color);
          background: var(--reader-paper-bg);
        }
      }
    }
  }
  .tab-panel {
    min-height: 320px;
  }
  .cover-wrap {
    width: 148px;
    height: 210px;
    border-radius: 6px;
    overflow: hidden;
    background: var(--reader-soft-bg);
    box-shadow: var(--reader-shadow);
    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .empty-cover {
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 18px;
      text-align: center;
      color: var(--reader-muted-color);
      font-size: 18px;
      font-weight: 700;
      line-height: 1.5;
    }
  }
  .book-main {
    min-width: 0;
    .book-platform {
      width: fit-content;
      padding: 4px 10px;
      margin-bottom: 12px;
      border-radius: 999px;
      color: var(--reader-accent-color);
      background: var(--reader-soft-bg);
      font-size: 12px;
      font-weight: 700;
    }
    h1 {
      margin: 0;
      color: var(--reader-text-color);
      font-size: 30px;
      line-height: 1.25;
      font-weight: 750;
    }
    .author {
      margin-top: 12px;
      color: var(--reader-muted-color);
      font-size: 16px;
      font-weight: 600;
    }
  }
  .tag-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 18px;
    span {
      padding: 4px 10px;
      border-radius: 4px;
      color: var(--reader-muted-color);
      background: var(--reader-soft-bg);
      font-size: 12px;
    }
  }
  .action-row {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-top: 28px;
  }
  button {
    border: 0;
    font: inherit;
    cursor: pointer;
  }
  .primary-action,
  .secondary-action {
    height: 42px;
    padding: 0 18px;
    border-radius: 6px;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-size: 14px;
    font-weight: 700;
  }
  .primary-action {
    color: var(--reader-paper-bg);
    background: var(--reader-accent-color);
  }
  .secondary-action,
  .icon-action {
    color: var(--reader-text-color);
    background: var(--reader-soft-bg);
  }
  .secondary-action:disabled {
    opacity: 0.62;
    cursor: not-allowed;
  }
  .add-shelf-action {
    color: var(--reader-accent-color);
    background: rgba(27, 136, 238, 0.1);
  }
  .info-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
    margin: 28px 0;
    .info-item {
      padding: 16px;
      border-radius: 6px;
      background: var(--reader-soft-bg);
      span {
        display: block;
        color: var(--reader-muted-color);
        font-size: 12px;
      }
      strong {
        display: block;
        margin-top: 8px;
        color: var(--reader-text-color);
        font-size: 20px;
        line-height: 1;
      }
    }
  }
  .detail-section {
    margin-top: 30px;
    .section-title {
      color: var(--reader-text-color);
      font-size: 20px;
      line-height: 1;
      font-weight: 750;
    }
    .section-subtitle {
      margin-top: 8px;
      color: var(--reader-muted-color);
      font-size: 13px;
    }
  }
  .meta-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px 24px;
    margin-top: 18px;
    .meta-item {
      min-width: 0;
      display: flex;
      gap: 12px;
      align-items: baseline;
      span {
        flex: 0 0 70px;
        color: var(--reader-muted-color);
        font-size: 13px;
      }
      strong {
        min-width: 0;
        color: var(--reader-text-color);
        font-size: 14px;
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }
  }
  .description {
    margin-top: 22px;
    color: var(--reader-text-color);
    font-size: 15px;
    line-height: 1.9;
    word-break: break-word;
    :deep(p ){
      margin: 0 0 0.9em;
    }
  }
  .description.empty {
    color: var(--reader-muted-color);
  }
  .chapter-section {
    margin-top: 18px;
  }
  .chapter-head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 20px;
    margin-bottom: 16px;
    padding: 18px 20px;
    border: 1px solid var(--reader-border-color);
    border-radius: 8px;
    background: linear-gradient(180deg, var(--reader-paper-bg), var(--reader-soft-bg));
    box-shadow: 0 10px 28px rgba(15, 23, 42, 0.05);
  }
  .chapter-tools {
    display: flex;
    gap: 10px;
    align-items: center;
    input {
      width: 220px;
      height: 38px;
      padding: 0 14px;
      border: 1px solid var(--reader-border-color);
      border-radius: 6px;
      outline: none;
      color: var(--reader-text-color);
      background: var(--reader-paper-bg);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.38);
      transition: border-color 0.16s ease, box-shadow 0.16s ease;
      &:focus {
        border-color: var(--reader-accent-color);
        box-shadow: 0 0 0 3px rgba(27, 136, 238, 0.12);
      }
    }
    .icon-action {
      width: 38px;
      height: 38px;
      border-radius: 6px;
      font-size: 18px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: color 0.16s ease, background 0.16s ease;
      &:hover {
        color: var(--reader-accent-color);
        background: var(--reader-paper-bg);
      }
    }
  }
  .chapter-list {
    border: 1px solid var(--reader-border-color);
    border-radius: 8px;
    background: var(--reader-paper-bg);
    overflow: hidden;
    box-shadow: 0 14px 34px rgba(15, 23, 42, 0.06);
  }
  .chapter-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 24px;
    gap: 12px;
    align-items: center;
    min-height: 58px;
    padding: 0 18px;
    border-bottom: 1px solid var(--reader-border-color);
    cursor: pointer;
    position: relative;
    transition: background 0.16s ease, box-shadow 0.16s ease, transform 0.16s ease;
    &:last-child {
      border-bottom: 0;
    }
    &::before {
      content: "";
      position: absolute;
      top: 12px;
      bottom: 12px;
      left: 0;
      width: 3px;
      border-radius: 0 999px 999px 0;
      background: transparent;
      transition: background 0.16s ease;
    }
    .chapter-info {
      min-width: 0;
    }
    .chapter-title {
      color: var(--reader-text-color);
      font-size: 15px;
      font-weight: 650;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      display: flex;
      align-items: center;
      gap: 10px;
      .chapter-name {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      em {
        flex: 0 0 auto;
        padding: 2px 7px;
        border-radius: 999px;
        color: var(--reader-accent-color);
        background: rgba(27, 136, 238, 0.1);
        font-size: 12px;
        font-style: normal;
        font-weight: 750;
      }
    }
    .chapter-index {
      flex: 0 0 34px;
      width: 34px;
      height: 24px;
      border-radius: 999px;
      color: var(--reader-muted-color);
      background: var(--reader-soft-bg);
      text-align: center;
      font-size: 12px;
      font-weight: 800;
      line-height: 24px;
    }
    .chapter-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 7px;
      color: var(--reader-muted-color);
      font-size: 12px;
    }
    .chapter-arrow {
      color: var(--reader-muted-color);
      font-size: 20px;
      transition: color 0.16s ease, transform 0.16s ease;
    }
    &:hover,
    &.active {
      background: linear-gradient(90deg, rgba(27, 136, 238, 0.08), transparent 58%);
      .chapter-title,
      .chapter-arrow {
        color: var(--reader-accent-color);
      }
      .chapter-arrow {
        transform: translateX(2px);
      }
      &::before {
        background: var(--reader-accent-color);
      }
      .chapter-index {
        color: var(--reader-paper-bg);
        background: var(--reader-accent-color);
      }
    }
    &.volume {
      min-height: 44px;
      grid-template-columns: minmax(0, 1fr);
      padding: 0 18px;
      cursor: pointer;
      background: var(--reader-soft-bg);
      &::before {
        background: rgba(27, 136, 238, 0.28);
      }
      .chapter-title {
        display: flex;
        align-items: center;
        gap: 6px;
        color: var(--reader-muted-color);
        font-size: 13px;
        font-weight: 800;
      }
      .volume-toggle-icon {
        color: var(--reader-accent-color);
        font-size: 17px;
      }
      &:hover .chapter-title {
        color: var(--reader-accent-color);
      }
    }
  }
  .chapter-empty {
    padding: 34px 18px;
    color: var(--reader-muted-color);
    text-align: center;
    font-size: 14px;
  }
  .review-section {
    margin-top: 18px;
  }
  .review-head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 20px;
    margin-bottom: 16px;
    padding: 18px 20px;
    border: 1px solid var(--reader-border-color);
    border-radius: 8px;
    background: linear-gradient(180deg, var(--reader-paper-bg), var(--reader-soft-bg));
    box-shadow: 0 10px 28px rgba(15, 23, 42, 0.05);
    .icon-action {
      width: 38px;
      height: 38px;
      border-radius: 6px;
      font-size: 18px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: color 0.16s ease, background 0.16s ease;
      &:hover {
        color: var(--reader-accent-color);
        background: var(--reader-paper-bg);
      }
      &:disabled {
        opacity: 0.55;
        cursor: not-allowed;
      }
    }
  }
  .review-list {
    display: grid;
    gap: 12px;
  }
  .review-card {
    margin: 0;
    padding: 16px 18px;
    border: 1px solid var(--reader-border-color);
    border-radius: 8px;
    background: var(--reader-paper-bg);
    box-shadow: 0 10px 28px rgba(15, 23, 42, 0.05);
    .review-card-head,
    .review-card-foot {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      color: var(--reader-muted-color);
      font-size: 13px;
    }
    .review-card-head strong {
      min-width: 0;
      color: var(--reader-text-color);
      font-size: 14px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    p {
      margin: 12px 0;
      color: var(--reader-text-color);
      font-size: 15px;
      line-height: 1.8;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .review-card-foot {
      justify-content: flex-start;
      span {
        display: inline-flex;
        align-items: center;
        gap: 5px;
      }
      i {
        color: var(--reader-accent-color);
      }
    }
  }
  .review-state {
    padding: 34px 18px;
    border: 1px solid var(--reader-border-color);
    border-radius: 8px;
    color: var(--reader-muted-color);
    text-align: center;
    background: var(--reader-paper-bg);
    font-size: 14px;
    &.error {
      color: #d14343;
    }
  }
  .error-title {
    font-size: 22px;
    font-weight: 750;
  }
  .error-text {
    margin: 12px 0 20px;
    color: var(--reader-muted-color);
  }
  .control-bar-container {
    width: 48px;
    position: fixed;
    bottom: 48px;
    flex-direction: column;
    transition: transform 0.18s ease, opacity 0.18s ease;
    .control-actions {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .control-button-container {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: var(--reader-control-bg);
      text-align: center;
      cursor: pointer;
      box-shadow: var(--reader-shadow);
      .control-button {
        font-size: 24px;
        line-height: 48px;
        color: var(--reader-muted-color);
      }
      &:hover .control-button {
        color: var(--reader-accent-color);
      }
    }
    .collapse-toggle {
      margin-top: 8px;
      background: var(--reader-soft-bg);
    }
    &.collapsed {
      .control-actions {
        display: none;
      }
      .collapse-toggle {
        margin-top: 0;
      }
    }
  }
  .content-bar {
    left: 50%;
    display: flex;
    justify-content: space-between;
  }
}

@media (max-width: 820px) {
  .detail-page {
    .detail-shell,
    .top-bar {
      width: 100%;
      max-width: 100%;
    }
    .detail-content {
      padding: 104px 24px 48px;
    }
    .book-hero {
      grid-template-columns: 108px 1fr;
      gap: 20px;
    }
    .cover-wrap {
      width: 108px;
      height: 154px;
    }
    .book-main h1 {
      font-size: 22px;
    }
    .info-grid,
    .meta-grid {
      grid-template-columns: 1fr 1fr;
    }
    .chapter-head {
      align-items: stretch;
      flex-direction: column;
    }
    .chapter-tools input {
      flex: 1;
      width: auto;
    }
    .action-row {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
      margin-top: 18px;
      .primary-action,
      .secondary-action {
        width: 100%;
        min-width: 0;
        height: 40px;
        padding: 0 8px;
        justify-content: center;
        font-size: 13px;
        white-space: nowrap;
      }
    }
    .control-bar-container {
      right: 16px;
      left: auto;
      margin-left: 0 !important;
    }
  }
}

@media (max-width: 420px) {
  .detail-page {
    .detail-content {
      padding-left: 18px;
      padding-right: 18px;
    }
    .book-hero {
      grid-template-columns: 96px 1fr;
      gap: 16px;
    }
    .cover-wrap {
      width: 96px;
      height: 136px;
    }
    .action-row {
      gap: 6px;
      .primary-action,
      .secondary-action {
        height: 38px;
        font-size: 12px;
        i {
          display: none;
        }
      }
    }
  }
}
</style>
