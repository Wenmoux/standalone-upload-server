<template>
  <div class="library-page" :style="readerThemeStyle">
    <div class="top-bar">
      <div class="brand" @click="goHome">晚风里</div>
      <div class="nav-actions">
        <div class="user-chip" @click="gotoSettings">
          <img class="user-avatar" :src="avatar || defaultAvatar" alt="头像" />
          <span class="user-name">{{ readerName }}</span>
        </div>
        <div class="nav-link" @click="goHome">书架</div>
        <div class="nav-link active">书库</div>
        <div class="nav-link" @click="refreshLibrary">刷新</div>
        <div class="nav-link" @click="gotoSettings">设置</div>
      </div>
    </div>

    <div class="library-shell">
      <div class="library-head">
        <div class="category-tabs">
          <button
            v-for="tab in categoryTabs"
            :key="tab.key"
            :class="{ active: activeTab === tab.key }"
            @click="changeTab(tab.key)"
          >
            {{ tab.label }}
          </button>
        </div>
        <div class="library-tools">
          <a-input-search
            v-model:value="keyword"
            placeholder="搜索书名、作者、ID、标签"
            enter-button="搜索"
            size="large"
            @search="searchLibrary"
          />
          <a-select
            v-model:value="sortMode"
            size="large"
            class="sort-select"
            dropdownClassName="library-select-dropdown"
            :getPopupContainer="triggerNode => triggerNode.parentNode"
            @change="changeSort"
          >
            <a-select-option value="updated_desc">更新 新到旧</a-select-option>
            <a-select-option value="updated_asc">更新 旧到新</a-select-option>
            <a-select-option value="popularity_desc">人气 高到低</a-select-option>
            <a-select-option value="popularity_asc">人气 低到高</a-select-option>
            <a-select-option value="word_desc">字数 多到少</a-select-option>
            <a-select-option value="word_asc">字数 少到多</a-select-option>
            <a-select-option value="cache_desc">缓存 多到少</a-select-option>
            <a-select-option value="cache_asc">缓存 少到多</a-select-option>
            <a-select-option value="title_asc">书名排序</a-select-option>
          </a-select>
        </div>
      </div>

      <div class="filter-row">
        <button class="filter-chip" :class="{ active: !currentFilter }" @click="selectFilter('')">
          全部
          <span>{{ formatNumber(total) }}</span>
        </button>
        <button
          class="filter-chip"
          v-for="option in tabOptions"
          :key="option.key"
          :class="{ active: currentFilter === option.key }"
          @click="selectFilter(option.key)"
        >
          {{ option.label }}
          <span v-if="option.count !== undefined">{{ formatNumber(option.count) }}</span>
        </button>
      </div>

      <a-spin v-if="loading" size="large" class="page-spin" />

      <div class="error-state" v-else-if="errText">
        <div class="error-title">书库加载失败</div>
        <div class="error-text">{{ errText }}</div>
        <button class="primary-action" @click="refreshLibrary">重试</button>
      </div>

      <div v-else>
        <div class="empty-state" v-if="!pagedBooks.length">
          <div class="empty-title">没有匹配的书籍</div>
          <div class="empty-text">换一个分类或关键词再试。</div>
        </div>

        <div class="library-grid" v-else>
          <div class="library-card" v-for="book in pagedBooks" :key="bookKey(book)" @click="gotoBook(book)">
            <div class="cover-wrap">
              <img v-if="book.book_info.cover" :src="book.book_info.cover" alt="" loading="lazy" decoding="async" />
              <div v-else class="empty-cover">{{ coverText(book) }}</div>
            </div>
            <div class="book-info">
              <div class="book-title" :title="book.book_info.book_name">{{ book.book_info.book_name }}</div>
              <div class="book-author">{{ book.book_info.author_name || '佚名' }}</div>
              <div class="book-meta">
                {{ platformLabel(book.book_info.platform) }} · 缓存 {{ formatNumber(book.book_info.cache_count) }}
              </div>
            </div>
            <button
              class="add-shelf-btn"
              :class="{ added: isAdded(book) }"
              :disabled="isAdded(book) || addingBookId === bookId(book)"
              @mousedown.stop
              @click.stop="addToShelf(book)"
            >
              <i :class="isAdded(book) ? 'ri-check-line' : 'ri-add-line'"></i>
              {{ isAdded(book) ? '已在书架' : addingBookId === bookId(book) ? '加入中' : '加入书架' }}
            </button>
          </div>
        </div>

        <a-pagination
          v-if="total > pageSize"
          class="library-pagination"
          :current="currentPage"
          :pageSize="pageSize"
          :total="total"
          :showSizeChanger="false"
          @change="changePage"
        />
      </div>
    </div>
  </div>
</template>

<script>
import defaultAvatarImage from '@/assets/d_avatar.jpg'
import { parseSearchIntent } from '@/utils/search-intent'
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

const TAG_UNSET = '__unset_tag__'
const SORT_VALUES = [
  'updated_desc',
  'updated_asc',
  'popularity_desc',
  'popularity_asc',
  'word_desc',
  'word_asc',
  'cache_desc',
  'cache_asc',
  'title_asc'
]
const SITE_FILTERS = [
  { key: 'qidian', label: '起点', values: ['qidian', 'qd', '起点'] },
  { key: 'fanqie', label: '番茄', values: ['fanqie', 'fq', 'tomato', '番茄'] },
  { key: 'po18', label: 'PO18', values: ['po18'] }
]

const RANGE_OPTIONS = {
  word: [
    { key: 'word_unknown', label: '字数未知', params: { word_max: 0 } },
    { key: 'word_0_30', label: '30万字以下', params: { word_min: 1, word_max: 300000 } },
    { key: 'word_30_80', label: '30-80万字', params: { word_min: 300001, word_max: 800000 } },
    { key: 'word_80_150', label: '80-150万字', params: { word_min: 800001, word_max: 1500000 } },
    { key: 'word_150_up', label: '150万字以上', params: { word_min: 1500001 } }
  ],
  cache: [
    { key: 'cache_0', label: '暂无缓存', params: { cache_max: 0 } },
    { key: 'cache_1_50', label: '1-50章', params: { cache_min: 1, cache_max: 50 } },
    { key: 'cache_51_200', label: '51-200章', params: { cache_min: 51, cache_max: 200 } },
    { key: 'cache_201_up', label: '200章以上', params: { cache_min: 201 } }
  ],
  popularity: [
    { key: 'pop_0', label: '暂无人气', params: { popularity_max: 0 } },
    { key: 'pop_1_1000', label: '1-1000', params: { popularity_min: 1, popularity_max: 1000 } },
    { key: 'pop_1001_10000', label: '1001-10000', params: { popularity_min: 1001, popularity_max: 10000 } },
    { key: 'pop_10001_up', label: '10000以上', params: { popularity_min: 10001 } }
  ]
}

function normalizeSortMode(value) {
  return SORT_VALUES.includes(value) ? value : 'updated_desc'
}

function normalizePlatformKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
}

function resolveSiteFilterKey(value) {
  const normalized = normalizePlatformKey(value)
  const matched = SITE_FILTERS.find(site =>
    site.values.some(siteValue => normalizePlatformKey(siteValue) === normalized)
  )
  return matched ? matched.key : normalized
}

function routeString(route, key) {
  return String((route.query && route.query[key]) || '').trim()
}

function defaultLibraryPageSize() {
  if (typeof window === 'undefined') return 24
  const viewportWidth = Math.max(320, Number(window.innerWidth || 0))
  if (viewportWidth < 860) return 12
  const usableWidth = Math.max(320, viewportWidth - 80)
  const columns = Math.max(4, Math.min(12, Math.floor((usableWidth + 24) / 152)))
  return Math.min(24, Math.max(12, columns * 2))
}

export default {
  name: 'BookLibrary',
  data() {
    const initialAuthor = routeString(this.$route, 'author')
    const initialTag = routeString(this.$route, 'tag')
    const initialPlatform = routeString(this.$route, 'platform')
    const initialQuery = routeString(this.$route, 'q')
    const initialPlatformKey = initialPlatform ? resolveSiteFilterKey(initialPlatform) : ''
    const initialKeyword = initialQuery || (initialAuthor ? `作者:${initialAuthor}` : initialTag ? `标签:${initialTag}` : '')
    return {
      allBooks: [],
      total: 0,
      siteOptions: SITE_FILTERS.map(site => ({ key: site.key, label: site.label, count: undefined })),
      loading: false,
      errText: '',
      keyword: initialKeyword,
      queryKeyword: initialQuery,
      queryAuthor: initialAuthor,
      queryPlatform: initialPlatformKey,
      sortMode: normalizeSortMode(this.$route.query.sort),
      activeTab: initialTag ? 'tag' : 'site',
      activeFilters: Object.assign(
        {},
        initialTag ? { tag: initialTag } : {},
        initialPlatformKey ? { site: initialPlatformKey } : {}
      ),
      currentPage: 1,
      pageSize: defaultLibraryPageSize(),
      addingBookId: '',
      shelfBookIds: {},
      libraryPageCache: {},
      resizeTimer: null,
      prefetchTimer: null,
      prefetchTimerType: '',
      avatar: this.$store.state.reader_info.avatar_thumb_url,
      defaultAvatar: defaultAvatarImage,
      readerSettings: Object.assign({}, DEFAULT_THEME),
      categoryTabs: [
        { key: 'site', label: '站点' },
        { key: 'tag', label: '标签' },
        { key: 'word', label: '字数' },
        { key: 'cache', label: '缓存' },
        { key: 'popularity', label: '人气' }
      ]
    }
  },
  computed: {
    readerName() {
      const info = this.$store.state.reader_info || {}
      return info.reader_name || info.account || '本地读者'
    },
    currentFilter() {
      return this.activeFilters[this.activeTab] || ''
    },
    tabOptions() {
      if (this.activeTab === 'site') {
        return this.siteOptions
      }
      if (this.activeTab === 'tag') {
        return this.countOptions(book => this.tagKeys(book), key => (key === TAG_UNSET ? '未标注' : key))
          .slice(0, 60)
          .map(option => ({ key: option.key, label: option.label }))
      }
      return RANGE_OPTIONS[this.activeTab] || []
    },
    filteredBooks() {
      return this.allBooks
    },
    pagedBooks() {
      return this.allBooks
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
    }
  },
  async created() {
    this.loadReaderSettings()
    await loadPlatformConfig()
    this.loadSiteOptions().catch(() => {})
    const ok = await this.getInfo()
    if (!ok) return
    this.loadShelfBookIds().catch(() => {})
    this.loadLibrary()
  },
  mounted() {
    window.addEventListener('resize', this.handleViewportResize)
  },
  beforeUnmount() {
    window.removeEventListener('resize', this.handleViewportResize)
    if (this.resizeTimer) clearTimeout(this.resizeTimer)
    this.clearPrefetchTimer()
  },
  methods: {
    platformLabel,
    loadReaderSettings() {
      try {
        const saved = JSON.parse(localStorage.getItem('cirnoReaderSettings') || '{}')
        this.readerSettings = Object.assign({}, DEFAULT_THEME, saved)
        if (this.readerSettings.theme === 'warm') this.readerSettings.theme = 'paper'
      } catch (e) {
        this.readerSettings = Object.assign({}, DEFAULT_THEME)
      }
    },
    async getInfo() {
      return this.$get({
        url: '/reader/get_my_info'
      }).then(
        res => {
          this.avatar = res.data.reader_info.avatar_thumb_url
          this.$store.commit('setPropInfo', res.data.prop_info)
          this.$store.commit('setReaderInfo', res.data.reader_info)
          return true
        },
        err => {
          localStorage.removeItem('login_token')
          this.errText = err
          this.$router.replace({ name: 'Login' })
          return false
        }
      )
    },
    async loadShelfBookIds() {
      const res = await this.$get({
        url: '/bookshelf/get_shelf_book_list_new',
        urlParas: {
          shelf_id: 'local',
          idsOnly: 1
        }
      })
      const ids = {}
      ;(res.data.book_list || []).forEach(book => {
        const id = this.bookId(book)
        if (id) ids[id] = true
      })
      this.shelfBookIds = ids
    },
    async loadSiteOptions() {
      const data = await fetch('/reader-api/platforms', { credentials: 'include' }).then(res => (res.ok ? res.json() : null))
      const rows = (data && data.platforms) || []
      this.siteOptions = SITE_FILTERS.map(site => {
        const count = rows
          .filter(row => site.values.some(value => normalizePlatformKey(value) === normalizePlatformKey(row.value)))
          .reduce((sum, row) => sum + Number(row.count || 0), 0)
        return {
          key: site.key,
          label: site.label,
          count
        }
      })
    },
    async loadLibrary() {
      this.errText = ''
      const cacheKey = this.libraryCacheKey(this.currentPage)
      const cached = this.libraryPageCache[cacheKey]
      if (cached) {
        this.applyLibraryResponse(cached)
        this.loading = false
        this.schedulePrefetchPage(this.currentPage + 1)
        return
      }
      this.loading = true
      try {
        const first = await this.fetchLibraryPage(this.currentPage)
        this.libraryPageCache[cacheKey] = first
        this.applyLibraryResponse(first)
        this.$nextTick(() => this.schedulePrefetchPage(this.currentPage + 1))
      } catch (err) {
        this.errText = err && err.message ? err.message : String(err || '请求失败')
      } finally {
        this.loading = false
      }
    },
    applyLibraryResponse(response) {
      const books = (response.data && response.data.book_list) || []
      const total = Number((response.data && response.data.total) || books.length)
      this.total = total
      this.allBooks = this.dedupeBooks(books)
    },
    libraryRequestParams(page) {
      return {
        keyword: this.queryKeyword,
        sort: this.sortMode,
        limit: this.pageSize,
        page,
        author: this.queryAuthor,
        ...this.filterParams()
      }
    },
    libraryCacheKey(page) {
      return JSON.stringify(this.libraryRequestParams(page))
    },
    fetchLibraryPage(page) {
      return this.$get({
        url: '/book/search',
        urlParas: this.libraryRequestParams(page)
      })
    },
    clearLibraryCache() {
      this.libraryPageCache = {}
      this.clearPrefetchTimer()
    },
    clearPrefetchTimer() {
      if (!this.prefetchTimer) return
      if (this.prefetchTimerType === 'idle' && typeof window !== 'undefined' && window.cancelIdleCallback) {
        window.cancelIdleCallback(this.prefetchTimer)
      } else {
        clearTimeout(this.prefetchTimer)
      }
      this.prefetchTimer = null
      this.prefetchTimerType = ''
    },
    schedulePrefetchPage(page) {
      this.clearPrefetchTimer()
      if (!page || !this.total || (page - 1) * this.pageSize >= this.total) return
      const run = () => this.prefetchLibraryPage(page)
      if (typeof window !== 'undefined' && window.requestIdleCallback) {
        this.prefetchTimerType = 'idle'
        this.prefetchTimer = window.requestIdleCallback(run, { timeout: 1400 })
      } else {
        this.prefetchTimerType = 'timeout'
        this.prefetchTimer = setTimeout(run, 700)
      }
    },
    async prefetchLibraryPage(page) {
      this.prefetchTimer = null
      this.prefetchTimerType = ''
      const cacheKey = this.libraryCacheKey(page)
      if (this.libraryPageCache[cacheKey]) return
      try {
        this.libraryPageCache[cacheKey] = await this.fetchLibraryPage(page)
      } catch (e) {}
    },
    handleViewportResize() {
      if (this.resizeTimer) clearTimeout(this.resizeTimer)
      this.resizeTimer = setTimeout(() => {
        const nextPageSize = defaultLibraryPageSize()
        if (nextPageSize === this.pageSize) return
        this.pageSize = nextPageSize
        this.currentPage = 1
        this.clearLibraryCache()
        this.loadLibrary()
      }, 180)
    },
    filterParams() {
      const filter = this.currentFilter
      const params = {}
      const platform = this.activeTab === 'site' ? filter : this.queryPlatform
      if (platform) params.platform = platform
      if (this.activeTab === 'tag') {
        if (filter && filter !== TAG_UNSET) params.tag = filter
        return params
      }
      if (!filter || this.activeTab === 'site') return params
      const option = (RANGE_OPTIONS[this.activeTab] || []).find(item => item.key === filter)
      return option ? Object.assign(params, option.params) : params
    },
    dedupeBooks(books) {
      const seen = {}
      return books.filter(book => {
        const id = this.bookId(book)
        if (!id || seen[id]) return false
        seen[id] = true
        return true
      })
    },
    searchLibrary() {
      const intent = parseSearchIntent(this.keyword)
      this.queryKeyword = intent.type === 'keyword' ? intent.value : ''
      this.queryAuthor = intent.type === 'author' ? intent.value : ''
      if (intent.type === 'tag') {
        this.activeTab = 'tag'
        this.activeFilters.tag = intent.value
      } else if (this.activeTab === 'tag') {
        this.activeFilters.tag = ''
        this.activeTab = 'site'
      }
      this.currentPage = 1
      this.syncRouteQuery()
      this.clearLibraryCache()
      this.loadLibrary()
    },
    refreshLibrary() {
      this.loadSiteOptions().catch(() => {})
      this.clearLibraryCache()
      this.loadLibrary()
      this.loadShelfBookIds().catch(() => {})
    },
    changeSort() {
      this.currentPage = 1
      this.syncRouteQuery()
      this.clearLibraryCache()
      this.loadLibrary()
    },
    changeTab(tab) {
      this.activeTab = tab
      this.currentPage = 1
      this.syncRouteQuery()
      this.clearLibraryCache()
      this.loadLibrary()
    },
    selectFilter(key) {
      this.activeFilters[this.activeTab] = key
      if (this.activeTab === 'site') this.queryPlatform = key
      this.currentPage = 1
      this.syncRouteQuery()
      this.clearLibraryCache()
      this.loadLibrary()
    },
    changePage(page) {
      this.currentPage = page
      this.loadLibrary()
      window.scrollTo({ top: 0, behavior: 'smooth' })
    },
    syncRouteQuery() {
      const query = {}
      if (this.queryKeyword) query.q = this.queryKeyword
      if (this.queryAuthor) query.author = this.queryAuthor
      const platform = this.activeTab === 'site' ? this.currentFilter : this.queryPlatform
      if (platform) query.platform = platform
      if (this.activeTab === 'tag' && this.currentFilter && this.currentFilter !== TAG_UNSET) query.tag = this.currentFilter
      if (this.sortMode !== 'updated_desc') query.sort = this.sortMode
      const sameQ = String(this.$route.query.q || '') === String(query.q || '')
      const sameAuthor = String(this.$route.query.author || '') === String(query.author || '')
      const samePlatform = String(this.$route.query.platform || '') === String(query.platform || '')
      const sameTag = String(this.$route.query.tag || '') === String(query.tag || '')
      const sameSort = String(this.$route.query.sort || '') === String(query.sort || '')
      if (sameQ && sameAuthor && samePlatform && sameTag && sameSort) return
      this.$router.replace({ name: 'BookLibrary', query }).catch(() => {})
    },
    countOptions(resolveKeys, resolveLabel) {
      const counts = {}
      this.allBooks.forEach(book => {
        resolveKeys(book).forEach(key => {
          if (!key) return
          counts[key] = (counts[key] || 0) + 1
        })
      })
      return Object.keys(counts)
        .map(key => ({ key, label: resolveLabel(key), count: counts[key] }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-Hans-CN'))
    },
    splitTags(value) {
      return String(value || '')
        .split(/[,，、|/\s:：;；#＃·•・]+/)
        .map(item => item.trim())
        .filter(Boolean)
    },
    tagKeys(book) {
      const info = book.book_info || {}
      const tags = this.splitTags(info.tags || info.category)
      return tags.length ? tags : [TAG_UNSET]
    },
    bookId(book) {
      return String((book.book_info && book.book_info.book_id) || '')
    },
    bookKey(book) {
      return this.bookId(book) || book.id
    },
    coverText(book) {
      return String((book.book_info && book.book_info.book_name) || this.bookId(book) || '书').slice(0, 4)
    },
    isAdded(book) {
      return !!this.shelfBookIds[this.bookId(book)]
    },
    addToShelf(book) {
      const id = this.bookId(book)
      if (!id || this.isAdded(book)) return
      this.addingBookId = id
      this.$post({
        url: '/bookshelf/add',
        paras: { book_id: id }
      }).then(
        () => {
          this.shelfBookIds[id] = true
          this.addingBookId = ''
          this.$message.success('已加入书架')
        },
        err => {
          this.addingBookId = ''
          if (String(err).includes('登录')) {
            localStorage.removeItem('login_token')
            this.$router.replace({ name: 'Login' })
          }
        }
      )
    },
    gotoBook(book) {
      const id = this.bookId(book)
      if (!id) return
      this.$router.push({
        name: 'BookDetail',
        query: {
          bid: id,
          cid: book.last_read_chapter_id || ''
        }
      })
    },
    goHome() {
      this.$router.push({ name: 'Index' })
    },
    gotoSettings() {
      this.$router.push({ name: 'Settings' })
    },
    formatNumber(value) {
      const number = Number(value || 0)
      if (!number) return '0'
      if (number >= 10000) return `${(number / 10000).toFixed(number >= 100000 ? 0 : 1)}万`
      return String(number)
    }
  }
}
</script>

<style lang="less" scoped>
.library-page {
  width: 100%;
  min-height: 100vh;
  color: var(--reader-text-color);
  background: var(--reader-paper-bg);
  button {
    border: 0;
    font: inherit;
    cursor: pointer;
  }
  .top-bar {
    z-index: 200;
    padding: 0 40px;
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 68px;
    background: var(--reader-topbar-bg);
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid var(--reader-border-color);
    box-shadow: 0 4px 18px rgba(15, 23, 42, 0.05);
    .brand {
      color: var(--reader-text-color);
      font-size: 20px;
      font-weight: 600;
      cursor: pointer;
      user-select: none;
    }
    .nav-actions {
      display: flex;
      align-items: center;
      gap: 28px;
      .user-chip {
        display: flex;
        align-items: center;
        gap: 10px;
        cursor: pointer;
        color: var(--reader-text-color);
        .user-avatar {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          object-fit: cover;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
        }
        .user-name {
          max-width: 120px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-weight: 500;
        }
      }
      .nav-link {
        color: var(--reader-muted-color);
        cursor: pointer;
        font-size: 15px;
        user-select: none;
        &:hover,
        &.active {
          color: var(--reader-accent-color);
        }
      }
    }
  }
  .library-shell {
    padding: 96px 40px 42px;
  }
  .library-head {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(360px, 560px);
    gap: 24px;
    align-items: center;
    margin-bottom: 14px;
    .library-tools {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 136px;
      gap: 12px;
      align-items: center;
    }
  }
  .category-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    button {
      height: 36px;
      padding: 0 14px;
      border-radius: 6px;
      color: var(--reader-muted-color);
      background: transparent;
      font-size: 14px;
      font-weight: 750;
      &:hover,
      &.active {
        color: var(--reader-paper-bg);
        background: var(--reader-accent-color);
      }
    }
  }
  .filter-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 28px;
    padding-top: 14px;
    border-top: 1px solid var(--reader-border-color);
    .filter-chip {
      min-height: 32px;
      max-width: 240px;
      padding: 0 10px;
      border-radius: 6px;
      color: var(--reader-muted-color);
      background: var(--reader-soft-bg);
      font-size: 13px;
      display: inline-flex;
      align-items: center;
      gap: 7px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      span {
        min-width: 22px;
        height: 20px;
        padding: 0 6px;
        border-radius: 999px;
        color: var(--reader-muted-color);
        background: var(--reader-paper-bg);
        font-size: 12px;
        line-height: 20px;
      }
      &:hover,
      &.active {
        color: var(--reader-accent-color);
      }
    }
  }
  .page-spin {
    display: block;
    margin-top: 120px;
    text-align: center;
  }
  .library-toolbar {
    min-height: 28px;
    margin-bottom: 18px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    color: var(--reader-muted-color);
    font-size: 14px;
  }
  .library-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(128px, 1fr));
    gap: 34px 24px;
    justify-content: stretch;
    justify-items: center;
    align-items: start;
  }
  .library-card {
    width: 108px;
    min-width: 0;
    color: var(--reader-text-color);
    cursor: pointer;
    .cover-wrap {
      width: 108px;
      height: 144px;
      overflow: hidden;
      background: var(--reader-soft-bg);
      box-shadow: 0 8px 22px rgba(15, 23, 42, 0.12);
      transition: transform 0.18s ease, box-shadow 0.18s ease;
      &:hover {
        transform: translateY(-3px);
        box-shadow: 0 12px 28px rgba(15, 23, 42, 0.18);
      }
      img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      .empty-cover {
        height: 100%;
        padding: 12px;
        color: var(--reader-muted-color);
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
        font-size: 16px;
        font-weight: 750;
        line-height: 1.45;
      }
    }
    .book-info {
      min-width: 0;
    }
    .book-title {
      margin-top: 10px;
      color: var(--reader-muted-color);
      font-size: 14px;
      line-height: 20px;
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .book-author {
      margin-top: 2px;
      color: var(--reader-muted-color);
      font-size: 12px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      opacity: 0.8;
    }
    .book-meta {
      margin-top: 2px;
      color: var(--reader-muted-color);
      font-size: 12px;
      line-height: 18px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      opacity: 0.72;
    }
    .add-shelf-btn {
      width: 100%;
      height: 26px;
      margin-top: 7px;
      padding: 0 6px;
      border-radius: 4px;
      color: var(--reader-accent-color);
      background: var(--reader-soft-bg);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      font-size: 12px;
      font-weight: 700;
      white-space: nowrap;
      i {
        font-size: 14px;
      }
      &.added {
        color: var(--reader-muted-color);
      }
      &:disabled {
        cursor: default;
        opacity: 0.8;
      }
    }
  }
  .library-pagination {
    margin-top: 28px;
    text-align: center;
  }
  .empty-state,
  .error-state {
    padding: 76px 20px;
    color: var(--reader-muted-color);
    text-align: center;
    .empty-title,
    .error-title {
      color: var(--reader-text-color);
      font-size: 20px;
      font-weight: 750;
    }
    .empty-text,
    .error-text {
      margin-top: 10px;
      font-size: 14px;
    }
    .primary-action {
      height: 40px;
      margin-top: 20px;
      padding: 0 18px;
      border-radius: 6px;
      color: var(--reader-paper-bg);
      background: var(--reader-accent-color);
      font-size: 14px;
      font-weight: 750;
    }
  }
  :deep(.ant-input),
  :deep(.ant-input-search .ant-input),
  :deep(.ant-select-selection),
  :deep(.ant-input-search-button ){
    height: 40px;
    border-radius: 6px;
    font-size: 14px;
  }
  :deep(.ant-input),
  :deep(.ant-input-search .ant-input),
  :deep(.ant-select-selection ){
    color: var(--reader-text-color);
    background: var(--reader-soft-bg);
    border-color: var(--reader-border-color);
    box-shadow: none;
  }
  :deep(.ant-input::placeholder ){
    color: var(--reader-muted-color);
    opacity: 0.78;
  }
  :deep(.ant-input-search .ant-input ){
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }
  :deep(.ant-input-search-button ){
    min-width: 82px;
    color: var(--reader-paper-bg);
    background: var(--reader-accent-color);
    border-color: var(--reader-accent-color);
    font-weight: 800;
    text-shadow: none;
    box-shadow: none;
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
  }
  :deep(.ant-select-selection__rendered),
  :deep(.ant-select-selection-selected-value),
  :deep(.ant-select-arrow ){
    color: var(--reader-text-color);
  }
  :deep(.library-select-dropdown ){
    background: var(--reader-paper-bg);
    border: 1px solid var(--reader-border-color);
    box-shadow: var(--reader-shadow);
  }
  :deep(.library-select-dropdown .ant-select-dropdown-menu-item ){
    color: var(--reader-muted-color);
    background: var(--reader-paper-bg);
  }
  :deep(.library-select-dropdown .ant-select-dropdown-menu-item:hover),
  :deep(.library-select-dropdown .ant-select-dropdown-menu-item-active:not(.ant-select-dropdown-menu-item-disabled) ){
    color: var(--reader-text-color);
    background: var(--reader-soft-bg);
  }
  :deep(.library-select-dropdown .ant-select-dropdown-menu-item-selected ){
    color: var(--reader-accent-color);
    font-weight: 750;
    background: var(--reader-soft-bg);
  }
}

@media (max-width: 860px) {
  .library-page {
    .top-bar {
      height: 62px;
      padding: 0 14px;
      .brand {
        font-size: 19px;
      }
      .nav-actions {
        gap: 12px;
        min-width: 0;
        .user-chip {
          gap: 6px;
          .user-avatar {
            width: 32px;
            height: 32px;
          }
          .user-name {
            max-width: 54px;
            font-size: 14px;
          }
        }
        .nav-link {
          font-size: 14px;
          white-space: nowrap;
        }
      }
    }
    .library-shell {
      padding: 92px 18px 32px;
    }
    .library-head {
      grid-template-columns: 1fr;
      gap: 16px;
      h1 {
        font-size: 28px;
      }
      .library-tools {
        grid-template-columns: 1fr 128px;
      }
    }
    .library-grid {
      grid-template-columns: repeat(2, 108px);
      justify-content: center;
      gap: 30px 52px;
    }
  }
}

@media (max-width: 520px) {
  .library-page {
    .top-bar {
      padding: 0 10px;
      .nav-actions {
        gap: 9px;
        .user-chip .user-name {
          display: none;
        }
        .nav-link {
          font-size: 13px;
        }
      }
    }
    .library-head .library-tools {
      grid-template-columns: 1fr;
    }
    .library-grid {
      gap: 30px 34px;
    }
  }
}

@media (max-width: 360px) {
  .library-page {
    .top-bar .nav-actions {
      gap: 7px;
      .nav-link {
        font-size: 12px;
      }
    }
    .library-grid {
      gap: 28px 20px;
    }
  }
}
</style>
