<!--
 * [INPUT]: 依赖 reader-home.less、Reader session、平台选项、搜索建议、书架/历史与详情导航
 * [OUTPUT]: 对外提供 Index 登录后首页和个人书架页面
 * [POS]: Reader views 的用户入口，聚合个人内容但不复制服务端权限判定
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 -->
<template>
  <div class="index-wrapper" :style="readerThemeStyle">
    <div class="top-bar">
      <div class="brand" @click="refreshPage">晚风里</div>
      <div class="nav-actions">
        <div class="user-chip" @click="gotoSettings">
          <img class="user-avatar" :src="avatar || defaultAvatar" alt="头像" />
          <span class="user-name">{{ readerName }}</span>
        </div>
        <div class="nav-link active" @click="refreshPage">书架</div>
        <div class="nav-link" @click="openSearchModal">搜索</div>
        <div class="nav-link" @click="beginCheckIn(checkIn)">{{ checkIn ? '已签到' : '签到' }}</div>
        <div class="nav-link" @click="gotoSettings">设置</div>
      </div>
    </div>
    <a-spin size="large" v-if="loadStatus === 0" />
    <div class="books-wrapper" v-else-if="loadStatus === 1">
      <div class="shelf-toolbar">
        <div class="shelf-count">{{ book_list.length }} 本书</div>
        <a-select
          v-model:value="shelfSort"
          size="small"
          class="shelf-sort"
          dropdownClassName="shelf-sort-dropdown"
          :getPopupContainer="triggerNode => triggerNode.parentNode"
          @change="changeShelfSort"
        >
          <a-select-option value="last_read_time">按阅读时间</a-select-option>
          <a-select-option value="reading_time">按阅读时长</a-select-option>
          <a-select-option value="shelved_time">按加入时间</a-select-option>
        </a-select>
      </div>
      <div class="books" v-if="book_list.length">
        <div class="book" v-for="book in book_list" :key="book.id">
          <div class="book-cover-wrap" @click="gotoBook(book)">
            <img
              v-if="book.book_info.cover"
              class="book-cover"
              :src="book.book_info.cover"
              width="108"
              height="144"
              loading="lazy"
              decoding="async"
              @error="book.book_info.cover = ''"
            />
            <div v-else class="book-cover cover-fallback">{{ coverText(book) }}</div>
          </div>
          <div class="book-name" :title="book.book_info.book_name" @click="gotoBook(book)">
            {{ book.book_info.book_name }}
          </div>
          <div class="book-actions">
            <button class="remove-btn" @click.stop="removeFromShelf(book)">移除</button>
          </div>
        </div>
      </div>
      <div class="empty-shelf" v-else>
        <div class="empty-title">书架还是空的</div>
        <div class="empty-text">点击右上角搜索，找到书后加入书架。</div>
      </div>
    </div>
    <div class="err-wrapper" v-else>
      <div class="err-title">
        获取数据失败，您可以尝试
        <font class="clickable" color="#ff4d4f" @click="refreshPage">刷新</font>
        或者
        <font class="clickable" color="#ff4d4f" @click="gotoSettings">检查账号设置</font>
      </div>
      <div class="err-text">
        {{ errText }}
      </div>
    </div>
    <a-modal
      :footer="null"
      title="搜索书籍"
      v-model:open="searchModal"
      centered
      width="760px"
      class="search-modal"
      wrapClassName="search-modal-wrap"
    >
      <div class="library-search">
        <div class="search-tools">
          <a-input-search
            ref="searchInput"
            v-model:value="searchKeyword"
            placeholder="搜索书名、作者、ID、标签"
            enter-button="搜索"
            size="large"
            @change="handleSearchKeywordChange"
            @search="searchBooks"
          />
          <a-select
            v-model:value="searchPlatform"
            size="large"
            class="select-control"
            :getPopupContainer="triggerNode => triggerNode.parentNode"
          >
            <a-select-option value="">全部站点</a-select-option>
            <a-select-option v-for="option in platformOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </a-select-option>
          </a-select>
          <a-select
            v-model:value="searchSort"
            size="large"
            class="select-control"
            :getPopupContainer="triggerNode => triggerNode.parentNode"
          >
            <a-select-option value="updated_desc">最近更新</a-select-option>
            <a-select-option value="popularity_desc">热度最高</a-select-option>
            <a-select-option value="cache_desc">缓存最多</a-select-option>
            <a-select-option value="title_asc">书名排序</a-select-option>
          </a-select>
        </div>
        <div v-if="searchSuggestions.length" class="search-suggestions">
          <button
            v-for="item in searchSuggestions"
            :key="`${item.type}-${item.value}-${item.book_id || ''}`"
            type="button"
            @click="useSearchSuggestion(item)"
          >
            <span>{{ suggestionTypeLabel(item.type) }}</span>
            <strong>{{ item.value }}</strong>
          </button>
        </div>
        <a-spin v-if="searchLoading" />
        <div class="search-empty" v-else-if="!hasSearched">输入关键词后搜索，加入书架后才会显示在我的书架。</div>
        <div class="search-empty" v-else-if="!searchResults.length">没有搜到匹配书籍。</div>
        <div class="search-results" v-else>
          <div class="search-book" v-for="book in searchResults" :key="book.book_info.book_id">
            <img
              v-if="book.book_info.cover"
              class="search-cover"
              :src="book.book_info.cover"
              width="76"
              height="102"
              loading="lazy"
              decoding="async"
              @error="book.book_info.cover = ''"
            />
            <div v-else class="search-cover cover-fallback">{{ coverText(book) }}</div>
            <div class="search-info">
              <div class="search-title">{{ book.book_info.book_name }}</div>
              <div class="search-meta">
                <span>{{ book.book_info.author_name || '佚名' }}</span>

                <span>{{ platformLabel(book.book_info.platform) }}</span>

                <span>缓存 {{ book.book_info.cache_count || 0 }} 章</span>
              </div>
              <div class="search-tags" v-if="splitTags(book.book_info.tags || book.book_info.category).length">
                <span v-for="tag in splitTags(book.book_info.tags || book.book_info.category)" :key="tag">
                  {{ tag }}
                </span>
              </div>
              <div class="search-tags empty" v-else>暂无标签</div>
            </div>
            <div class="search-actions">
              <a-button
                size="small"
                type="primary"
                :loading="addingBookId === book.book_info.book_id"
                @click="addToShelf(book)"
              >
                加入书架
              </a-button>
              <a-button size="small" @click="gotoBook(book)">详情</a-button>
            </div>
          </div>
        </div>
      </div>
    </a-modal>
  </div>
</template>

<script>
import defaultAvatarImage from '@/assets/d_avatar.jpg'
import { getPlatformOptions, loadPlatformConfig, platformLabel } from '@/utils/platform'
import { libraryQueryForSearch, parseSearchIntent } from '@/utils/search-intent'
import { clearReaderSession } from '@/utils/reader-session'

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
  jianghu: {
    page: '#e5d4bc',
    paper: '#f3e6d4',
    topbar: 'rgba(243, 230, 212, 0.96)',
    text: '#17120e',
    muted: '#756b60',
    border: 'rgba(124, 82, 54, 0.2)',
    soft: '#ead8bf',
    control: '#f8eddd',
    accent: '#a80000',
    shadow: '0 12px 34px rgba(83, 49, 26, 0.16)'
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
  name: 'Index',
  data() {
    return {
      book_list: [],
      loadStatus: 0,
      errText: '',
      currentShelfId: 'local',
      avatar: this.$store.state.reader_info.avatar_thumb_url,
      checkIn: false,
      shelfSort: localStorage.getItem('cirnoShelfSort') || 'last_read_time',

      searchModal: false,
      searchKeyword: '',
      searchPlatform: '',
      searchSort: 'updated_desc',
      searchLoading: false,
      hasSearched: false,
      searchResults: [],
      searchSuggestions: [],
      searchSuggestTimer: null,
      platformOptions: getPlatformOptions(),
      addingBookId: '',
      removingBookId: '',
      defaultAvatar: defaultAvatarImage,
      readerSettings: Object.assign({}, DEFAULT_THEME)
    }
  },
  async created() {
    this.loadReaderSettings()
    this.loadPlatforms()
    let info = await this.getInfo()
    if (info) {
      await this.refreshBooks()
    }
  },
  mounted() {},
  beforeUnmount() {
    if (this.searchSuggestTimer) clearTimeout(this.searchSuggestTimer)
  },
  computed: {
    readerName() {
      const info = this.$store.state.reader_info || {}
      return info.reader_name || info.account || '本地读者'
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
  methods: {
    coverText(book) {
      const info = (book && book.book_info) || {}
      return String(info.book_name || info.book_id || '书').slice(0, 4)
    },
    splitTags(value) {
      return String(value || '')
        .split(/[,，、|/\s:：;；#＃·•・]+/)
        .map(item => item.trim())
        .filter(Boolean)
        .slice(0, 8)
    },
    platformLabel,
    async loadPlatforms() {
      this.platformOptions = await loadPlatformConfig()
    },
    loadReaderSettings() {
      try {
        const saved = JSON.parse(localStorage.getItem('cirnoReaderSettings') || '{}')
        this.readerSettings = Object.assign({}, DEFAULT_THEME, saved)
        if (this.readerSettings.theme === 'warm') this.readerSettings.theme = 'paper'
      } catch (e) {
        this.readerSettings = Object.assign({}, DEFAULT_THEME)
      }
    },
    async refreshBooks() {
      this.loadStatus = 0
      this.errText = ''
      this.currentShelfId = 'local'
      await this.getBooks()
    },
    refreshPage() {
      this.loadStatus = 0
      this.currentShelfId = 'local'
      this.refreshBooks()
    },
    async getInfo() {
      return this.$get({
        url: '/reader/get_my_info'
      }).then(
        async res => {
          this.avatar = res.data.reader_info.avatar_thumb_url
          this.$store.commit('setPropInfo', res.data.prop_info)
          this.$store.commit('setReaderInfo', res.data.reader_info)
          this.checkIn = this.isSignedToday(res.data.reader_info.last_sign_date)
          return true
        },
        err => {
          clearReaderSession()
          this.loadStatus = -1
          this.errText = err
          this.$router.replace({ name: 'Login' })
          return false
        }
      )
    },
    isSignedToday(lastSignDate) {
      if (!lastSignDate) return false
      const today = new Date(Date.now() + 480 * 60 * 1000).toISOString().slice(0, 10)
      return String(lastSignDate).slice(0, 10) === today
    },
    async beginCheckIn(checkIn) {
      if (checkIn) {
        this.$message.warn(`请勿重复签到。`)
      } else {
        let sign_recommend = await this.$get({
          url: '/reader/get_task_bonus_with_sign_recommend',
          urlParas: {
            task_type: 1
          }
        }).then(res => {
          this.checkIn = true
          let my_info = res.data
          let bonus = my_info.bonus
          this.$store.commit('setPropInfo', my_info.prop_info)
          this.$store.commit('setReaderInfo', my_info.reader_info)
          this.$message.success(
            `签到成功：第 ${bonus.sign_day || 1} 天，获得 ${bonus.copper || 0} 铜币${
              bonus.silver ? `、${bonus.silver} 银币` : ''
            }。`
          )
        })
      }
    },
    async getBooks(retried = false) {
      if (!this.currentShelfId) {
        this.loadStatus = -1
        this.errText = '没有选中的书架'
        return
      }
      return this.$get({
        url: '/bookshelf/get_shelf_book_list_new',
        urlParas: {
          shelf_id: this.currentShelfId,
          count: 1000,
          page: 0,
          order: this.shelfSort
        }
      }).then(
        res => {
          this.book_list = res.data.book_list
          this.loadStatus = 1
        },
        err => {
          if (!retried) {
            setTimeout(() => this.getBooks(true), 350)
            return
          }
          if (String(err).includes('登录')) {
            clearReaderSession()
            this.$router.replace({ name: 'Login' })
          }
          this.loadStatus = -1
          this.errText = err
        }
      )
    },
    changeShelfSort(value) {
      this.shelfSort = value
      localStorage.setItem('cirnoShelfSort', value)
      this.loadStatus = 0
      this.getBooks()
    },
    openSearchModal() {
      this.searchModal = true
      this.loadSearchSuggestions()
      this.$nextTick(() => {
        if (this.$refs.searchInput) this.$refs.searchInput.focus()
      })
    },
    handleSearchKeywordChange() {
      if (this.searchSuggestTimer) clearTimeout(this.searchSuggestTimer)
      this.searchSuggestTimer = setTimeout(() => this.loadSearchSuggestions(), 260)
    },
    async loadSearchSuggestions() {
      try {
        const query = new URLSearchParams({
          q: this.searchKeyword.trim(),
          platform: this.searchPlatform,
          limit: '10'
        })
        const res = await fetch(`/reader-api/search/suggest?${query}`, { credentials: 'include' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        this.searchSuggestions = data.rows || []
      } catch (e) {
        this.searchSuggestions = []
      }
    },
    suggestionTypeLabel(type) {
      if (type === 'author') return '作者'
      if (type === 'tag') return '标签'
      if (type === 'hot') return '热词'
      return '书名'
    },
    useSearchSuggestion(item) {
      if (!item) return
      if (item.type === 'title' && item.book_id) {
        this.searchModal = false
        this.$router.push({ name: 'BookDetail', query: { bid: item.book_id } })
        return
      }
      if (item.type === 'author' || item.type === 'tag') {
        this.searchModal = false
        this.$router.push({
          name: 'BookLibrary',
          query: libraryQueryForSearch(
            { type: item.type, value: item.value || '' },
            item.platform || this.searchPlatform
          )
        })
        return
      }
      this.searchKeyword = item.value || ''
      this.searchBooks()
    },
    searchBooks() {
      const intent = parseSearchIntent(this.searchKeyword)
      if (!intent.value) {
        this.$message.warn('请输入关键词')
        return
      }
      if (intent.type === 'author' || intent.type === 'tag') {
        this.searchModal = false
        this.$router.push({ name: 'BookLibrary', query: libraryQueryForSearch(intent, this.searchPlatform) })
        return
      }
      this.searchLoading = true
      this.hasSearched = true
      this.$get({
        url: '/book/search',
        urlParas: {
          keyword: intent.value,
          platform: this.searchPlatform,
          sort: this.searchSort,
          limit: 50,
          page: 1
        }
      }).then(
        res => {
          this.searchResults = res.data.book_list
          this.searchLoading = false
        },
        () => {
          this.searchLoading = false
        }
      )
    },
    addToShelf(book) {
      const bookId = book.book_info.book_id
      this.addingBookId = bookId
      this.$post({
        url: '/bookshelf/add',
        paras: { book_id: bookId }
      }).then(
        () => {
          this.$message.success('已加入书架')
          this.addingBookId = ''
          this.refreshBooks()
        },
        err => {
          this.addingBookId = ''
          if (String(err).includes('登录')) {
            clearReaderSession()
            this.$router.replace({ name: 'Login' })
          }
        }
      )
    },
    removeFromShelf(book) {
      const bookId = book.book_info.book_id
      const confirm = this.$confirm || (this.$modal && this.$modal.confirm)
      if (!confirm) {
        if (!window.confirm(`从书架移除《${book.book_info.book_name}》？`)) return
        this.removingBookId = bookId
        this.$post({ url: '/bookshelf/remove', paras: { book_id: bookId } }).then(() => {
          this.$message.success('已从书架移除')
          this.book_list = this.book_list.filter(item => item.book_info.book_id !== bookId)
          this.removingBookId = ''
        })
        return
      }
      confirm({
        title: `从书架移除《${book.book_info.book_name}》？`,
        okText: '移除',
        okType: 'danger',
        cancelText: '取消',
        onOk: () => {
          this.removingBookId = bookId
          return this.$post({
            url: '/bookshelf/remove',
            paras: { book_id: bookId }
          }).then(
            () => {
              this.$message.success('已从书架移除')
              this.book_list = this.book_list.filter(item => item.book_info.book_id !== bookId)
              this.removingBookId = ''
            },
            err => {
              this.removingBookId = ''
              if (String(err).includes('登录')) {
                clearReaderSession()
                this.$router.replace({ name: 'Login' })
              }
            }
          )
        }
      })
    },
    gotoBook(book) {
      this.$router.push({
        name: 'BookDetail',
        query: {
          bid: book.book_info.book_id,
          cid: book.last_read_chapter_id
        }
      })
    },
    gotoSettings() {
      this.$router.push({ name: 'Settings' })
    }
  }
}
</script>

<style src="../styles/reader-home.less" lang="less" scoped></style>
