<!--
 * [INPUT]: 依赖 book-detail.less、HTTP 适配器、平台/主题/session 工具、VirtualList、书籍目录与书评 API
 * [OUTPUT]: 对外提供 BookDetail 详情、目录、书架、书评及进入阅读页面
 * [POS]: Reader views 的单书组合页，协调公开元数据和受会话保护的个人操作
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 -->
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
            <img
              v-if="book_info.cover"
              :src="book_info.cover"
              alt=""
              width="160"
              height="220"
              decoding="async"
              fetchpriority="high"
              @error="book_info.cover = ''"
            />
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

            <virtual-list
              v-if="visibleChapters.length"
              class="chapter-list chapter-list-virtual"
              :items="visibleChapters"
              :item-height="58"
              height="min(64vh, 640px)"
              :overscan="10"
              key-field="chapter_id"
            >
              <template #default="{ item: chapter, index }">
                <div
                  class="chapter-row"
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
              </template>
            </virtual-list>
            <div v-else class="chapter-list chapter-empty">没有匹配的章节</div>
          </section>
        </div>

        <div v-show="activeTab === 'reviews'" class="tab-panel">
          <section class="detail-section review-section">
            <div class="review-head">
              <div>
                <div class="section-title">书评</div>
                <div class="section-subtitle">
                  共 {{ reviewTotal }} 条，发布入口在 Telegram Bot：/review {{ bid }} 内容
                </div>
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
                  <span>
                    <i class="ri-thumb-up-line"></i>
                    {{ review.like_count || 0 }}
                  </span>
                  <span>
                    <i class="ri-thumb-down-line"></i>
                    {{ review.dislike_count || 0 }}
                  </span>
                  <button type="button" :disabled="reportingReviewId === review.id" @click="reportReview(review)">
                    {{ reportingReviewId === review.id ? '提交中...' : '举报' }}
                  </button>
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
import { clearReaderSession } from '@/utils/reader-session'
import VirtualList from '@/components/virtual-list.vue'
import { DEFAULT_THEME, readerPalette, readerThemeStyle } from '@/utils/reader-theme'

export default {
  name: 'BookDetail',
  components: { VirtualList },
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
      reportingReviewId: null,
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
      return readerPalette(this.readerSettings)
    },
    readerThemeStyle() {
      return readerThemeStyle(this.readerSettings)
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
            clearReaderSession()
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
    async reportReview(review) {
      if (!review || this.reportingReviewId) return
      const rawReason = window.prompt(
        '举报原因：spam（垃圾）、abuse（辱骂）、spoiler（剧透）、illegal（违法）、other（其他）',
        'other'
      )
      if (rawReason === null) return
      const reason = String(rawReason || '')
        .trim()
        .toLowerCase()
      if (!['spam', 'abuse', 'spoiler', 'illegal', 'other'].includes(reason)) {
        this.$message.warn('举报原因无效')
        return
      }
      const details = window.prompt('补充说明（可选）', '')
      if (details === null) return
      this.reportingReviewId = review.id
      try {
        const response = await fetch(`/reader-api/book-reviews/${encodeURIComponent(review.id)}/report`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason, details })
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`)
        this.$message.success('举报已提交，感谢协助维护书评区')
        if (data.review_status === 'under_review') await this.loadReviews(true)
      } catch (error) {
        this.$message.error(error && error.message ? error.message : '举报提交失败')
      } finally {
        this.reportingReviewId = null
      }
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
      return this.isVolumeCollapsed(chapter)
        ? 'ri-arrow-right-s-line volume-toggle-icon'
        : 'ri-arrow-down-s-line volume-toggle-icon'
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

<style src="../styles/book-detail.less" lang="less" scoped></style>
