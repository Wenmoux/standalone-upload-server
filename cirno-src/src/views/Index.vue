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
            <img class="book-cover" :src="book.book_info.cover" loading="lazy" decoding="async" />
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
        <div class="search-empty" v-else-if="!hasSearched">
          输入关键词后搜索，加入书架后才会显示在我的书架。
        </div>
        <div class="search-empty" v-else-if="!searchResults.length">
          没有搜到匹配书籍。
        </div>
        <div class="search-results" v-else>
          <div class="search-book" v-for="book in searchResults" :key="book.book_info.book_id">
            <img class="search-cover" :src="book.book_info.cover" loading="lazy" decoding="async" />
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
          localStorage.removeItem('login_token')
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
            localStorage.removeItem('login_token')
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
          query: libraryQueryForSearch({ type: item.type, value: item.value || '' }, item.platform || this.searchPlatform)
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
            localStorage.removeItem('login_token')
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
                localStorage.removeItem('login_token')
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

<style lang="less" scoped>
.index-wrapper {
  width: 100%;
  height: 100%;
  min-height: 100vh;
  margin: 0;
  color: var(--reader-text-color);
  background: var(--reader-paper-bg);
  box-shadow: none;
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

  .ant-spin {
    position: absolute;
    top: 45%;
    left: 50%;
  }

  .err-wrapper {
    width: 100%;
    padding-top: 120px;
    font-family: SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace;
    .err-title {
      color: var(--reader-muted-color);
      font-size: 16px;
      font-weight: 500;
      user-select: none;
      .clickable {
        cursor: pointer;
      }
    }
    .err-text {
      border-left: 5px solid #ff7875;
      padding-left: 12px;
      margin-top: 32px;
      color: var(--reader-muted-color);
    }
  }

  .books-wrapper {
    padding: 104px 40px 36px;
    position: relative;
    top: auto;
    width: 100%;
    background: var(--reader-paper-bg);
    .shelf-toolbar {
      min-height: 34px;

      margin-bottom: 22px;

      display: flex;

      align-items: center;

      justify-content: space-between;

      gap: 16px;

      .shelf-count {
        color: var(--reader-muted-color);

        font-size: 14px;

        user-select: none;
      }

      .shelf-sort {
        width: 132px;
      }

      :deep(.shelf-sort .ant-select-selection ){
        background: var(--reader-soft-bg) !important;
        background-color: var(--reader-soft-bg) !important;
        border-color: var(--reader-border-color) !important;
        color: var(--reader-text-color) !important;
        box-shadow: none;
      }

      :deep(.shelf-sort .ant-select-selection__rendered),
      :deep(.shelf-sort .ant-select-selection-selected-value),
      :deep(.shelf-sort .ant-select-selection-selected-value::after ){
        background: transparent !important;
        color: var(--reader-text-color) !important;
      }

      :deep(.shelf-sort .ant-select-selection:hover),
      :deep(.shelf-sort.ant-select-focused .ant-select-selection),
      :deep(.shelf-sort.ant-select-open .ant-select-selection ){
        border-color: var(--reader-accent-color) !important;
        box-shadow: 0 0 0 2px rgba(155, 93, 46, 0.12);
      }

      :deep(.shelf-sort .ant-select-arrow ){
        color: var(--reader-muted-color) !important;
      }

      :deep(.shelf-sort-dropdown ){
        background: var(--reader-paper-bg);

        border: 1px solid var(--reader-border-color);

        box-shadow: var(--reader-shadow);
      }

      :deep(.shelf-sort-dropdown .ant-select-dropdown-menu-item ){
        color: var(--reader-muted-color);

        background: var(--reader-paper-bg);
      }

      :deep(.shelf-sort-dropdown .ant-select-dropdown-menu-item:hover),
      :deep(.shelf-sort-dropdown .ant-select-dropdown-menu-item-active:not(.ant-select-dropdown-menu-item-disabled) ){
        color: var(--reader-text-color);

        background: var(--reader-soft-bg);
      }

      :deep(.shelf-sort-dropdown .ant-select-dropdown-menu-item-selected ){
        color: var(--reader-accent-color);

        font-weight: 600;

        background: var(--reader-soft-bg);
      }
    }

    .books {
      grid-row-gap: 34px;
      grid-column-gap: 44px;
      display: grid;
      grid-template-columns: repeat(auto-fill, 108px);
      justify-content: start;
      .book {
        width: 108px;
        color: var(--reader-text-color);
        .book-cover-wrap {
          width: 108px;
          height: 144px;
          cursor: pointer;
          overflow: hidden;
          background: var(--reader-soft-bg);
          box-shadow: 0 8px 22px rgba(15, 23, 42, 0.12);
          transition: transform 0.18s ease, box-shadow 0.18s ease;
          &:hover {
            transform: translateY(-3px);
            box-shadow: 0 12px 28px rgba(15, 23, 42, 0.18);
          }
          .book-cover {
            width: 100%;
            height: 100%;
            object-fit: cover;
          }
        }
        .book-name {
          margin-top: 10px;
          color: var(--reader-muted-color);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          cursor: pointer;
          font-size: 14px;
        }
        .book-actions {
          margin-top: 6px;
          height: 22px;
          opacity: 0;
          transition: opacity 0.18s ease;
          .remove-btn {
            padding: 0;
            border: 0;
            background: transparent;
            color: #ef4444;
            cursor: pointer;
            font-size: 12px;
          }
        }
        &:hover .book-actions {
          opacity: 1;
        }
      }
    }
    .empty-shelf {
      padding-top: 72px;
      color: var(--reader-muted-color);
      user-select: none;
      .empty-title {
        color: var(--reader-text-color);
        font-size: 20px;
        font-weight: 600;
      }
      .empty-text {
        margin-top: 10px;
        font-size: 14px;
      }
    }
  }

}

.library-search {
  .search-suggestions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 12px 0 14px;
    button {
      max-width: 100%;
      min-height: 32px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 0 10px;
      border: 1px solid var(--reader-border-color);
      border-radius: 999px;
      color: var(--reader-text-color);
      background: var(--reader-soft-bg);
      cursor: pointer;
      span {
        flex: 0 0 auto;
        color: var(--reader-muted-color);
        font-size: 12px;
      }
      strong {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 13px;
        font-weight: 650;
      }
      &:hover {
        border-color: var(--reader-accent-color);
        color: var(--reader-accent-color);
        background: var(--reader-paper-bg);
      }
    }
  }
}

@media (max-width: 768px) {
  .index-wrapper {
    .top-bar {
      height: 62px;
      padding: 0 14px;
      .brand {
        font-size: 19px;
        flex: 0 0 auto;
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
    .books-wrapper {
      padding: 92px 18px 32px;
      .books {
        grid-template-columns: repeat(2, 108px);
        justify-content: center;
        grid-column-gap: 52px;
        grid-row-gap: 30px;
        .book .book-actions {
          opacity: 1;
        }
      }
    }
  }
}

@media (max-width: 420px) {
  .index-wrapper {
    .top-bar {
      padding: 0 10px;
      .nav-actions {
        gap: 9px;
        .user-chip {
          .user-name {
            display: none;
          }
        }
        .nav-link {
          font-size: 13px;
        }
      }
    }
    .books-wrapper {
      padding-left: 14px;
      padding-right: 14px;
      .books {
        grid-template-columns: repeat(2, 108px);
        grid-column-gap: 34px;
      }
    }
  }
}

@media (max-width: 340px) {
  .index-wrapper {
    .top-bar {
      .nav-actions {
        gap: 7px;
        .nav-link {
          font-size: 12px;
        }
      }
    }
    .books-wrapper .books {
      grid-column-gap: 20px;
    }
  }
}

:deep(.ant-modal-content ){
  background: var(--reader-paper-bg);
  color: var(--reader-text-color);
  .ant-modal-header {
    border-bottom: 0;
    user-select: none;
    background: var(--reader-paper-bg);
    .ant-modal-title {
      color: var(--reader-text-color);
    }
  }
  .ant-modal-body {
    padding: 0px 24px 16px 24px;
  }
}
</style>
