/**
 * [INPUT]: 依赖 Reader HTTP/路由/消息能力、章节导航/显示重建/间贴失效方法、PerfectScrollbar、Reader 会话和离线存储
 * [OUTPUT]: 默认导出书籍初始化、竞态安全的章节加载/解密/错误反馈、购买、最近阅读与离线固定状态机
 * [POS]: cirno-src/src/mixins 的章节数据切片，为 Reader 组合根及导航/设置/间贴 mixin 提供唯一章节事实
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import PerfectScrollbar from 'perfect-scrollbar'
import { listOfflineBookChapters, pinOfflineChapter, rememberRecentChapter } from '../utils/reader-offline'
import { cachedReaderUser } from '../utils/reader-session'

export default {
  data() {
    return {
      bid: null,
      cid: null,
      loading: 0,
      loadError: '',
      chapterTitle: '',
      book_info: {},
      book_chapters: [],
      chapterIndex: 0,
      chapter_info: {},
      chapterContentData: [],
      chapterDisplayContentData: [],
      contentRequestId: 0,
      auth: true,
      chapterAmount: 0,
      buyAmount: 0
    }
  },
  async created() {
    this.bid = this.$route.query.bid
    this.cid = this.$route.query.cid
    if (this.cid === '[object Object]') this.cid = 0
    window.__cirnoCurrentBookId = this.bid

    const ownerId = String(cachedReaderUser()?.id || '')
    const offlineRows = () => (ownerId ? listOfflineBookChapters(ownerId, this.bid) : Promise.resolve([]))
    const hasInitialCid = !!this.cid && this.cid != 0
    if (hasInitialCid) this.getContent(this.cid)

    const bookInfoPromise = this.$get({
      url: '/book/get_info_by_id',
      urlParas: { book_id: this.bid }
    }).catch(async error => {
      const rows = await offlineRows()
      if (!rows.length) throw error
      return {
        data: {
          book_info: {
            book_id: String(this.bid || ''),
            book_name: rows[0].bookTitle || this.bid,
            author_name: '离线缓存',
            platform: rows[0].chapter?.platform || '',
            cache_count: rows.length,
            offline: true
          }
        }
      }
    })
    const chaptersPromise = this.$get({
      url: '/chapter/get_updated_chapter_by_division_id',
      urlParas: {
        division_id: this.bid,
        last_update_time: 0
      }
    })
      .then(response => response.data.chapter_list || [])
      .catch(async error => {
        const rows = await offlineRows()
        if (!rows.length) throw error
        return rows.map(row => ({
          chapter_id: row.chapterId,
          chapter_title: row.chapterTitle,
          chapter_order: row.chapterOrder,
          is_volume: false,
          offline: true
        }))
      })

    let bookInfoResponse
    let bookChapters
    try {
      ;[bookInfoResponse, bookChapters] = await Promise.all([bookInfoPromise, chaptersPromise])
    } catch (error) {
      this.loading = -1
      this.loadError = error?.error || error?.message || '书籍信息与目录加载失败'
      return
    }

    const bookInfo = bookInfoResponse?.data?.book_info
    if (!bookInfo || typeof bookInfo !== 'object') {
      this.loading = -1
      this.loadError = '书籍信息响应无效'
      return
    }
    this.book_info = bookInfo
    window.__cirnoCurrentBookTitle = this.book_info.book_name || this.bid
    this.book_chapters = Array.isArray(bookChapters) ? bookChapters : []
    if (
      !this.cid ||
      this.isVolumeChapter(this.book_chapters.find(chapter => String(chapter.chapter_id) === String(this.cid)))
    ) {
      const firstCid = this.firstReadableChapterId()
      if (firstCid) {
        this.cid = firstCid
        this.$router.replace({ query: { bid: this.bid, cid: this.cid } })
        this.getContent(this.cid)
      } else {
        this.loading = -1
        this.loadError = '目录中没有可阅读章节'
      }
    } else if (!hasInitialCid) {
      this.getContent(this.cid)
    }
    this.chapterIndex = this.findChapterIndex(this.cid)
  },
  beforeUnmount() {
    this.contentRequestId += 1
  },
  methods: {
    findChapterIndex(cid) {
      return this.book_chapters.findIndex(chapter => String(chapter.chapter_id) === String(cid))
    },
    isActiveChapterRequest(requestId, cid) {
      return requestId === this.contentRequestId && String(this.cid) === String(cid)
    },
    setChapterLoadError(error, requestId, cid) {
      if (!this.isActiveChapterRequest(requestId, cid)) return
      this.loading = -1
      this.loadError = error?.error || error?.message || String(error || '章节加载失败')
    },
    chapterOrderFor(chapter, chapterInfo = {}) {
      const explicitOrder = Number(chapter?.chapter_order ?? chapterInfo?.chapter_order)
      return Number.isFinite(explicitOrder) && explicitOrder > 0 ? explicitOrder : Math.max(1, this.chapterIndex + 1)
    },
    async getContent(cid) {
      this.flushReadingTime()
      cid = String(cid)
      const chapterIndex = this.findChapterIndex(cid)
      const currentChapter = this.book_chapters[chapterIndex]
      if (this.isVolumeChapter(currentChapter)) {
        const readableCid = this.nearestReadableChapterId(cid)
        if (!readableCid || String(readableCid) === cid) return
        this.$router.replace({ query: { bid: this.bid, cid: readableCid } })
        return this.getContent(readableCid)
      }

      if (String(this.cid) !== cid && typeof this.invalidateTsukkomiList === 'function') {
        this.invalidateTsukkomiList({ close: true, clear: true })
      }
      this.cid = cid
      this.loading = 0
      this.loadError = ''
      if (this.containerScroll) this.containerScroll.destroy()
      this.containerScroll = null
      this.chapterIndex = chapterIndex
      const requestId = ++this.contentRequestId
      const key = 'local-plain-text'
      let response
      try {
        response = await this.$get({
          url: '/chapter/get_cpt_ifm',
          urlParas: {
            book_id: this.bid,
            chapter_id: cid,
            chapter_command: key
          }
        })
      } catch (error) {
        this.setChapterLoadError(error, requestId, cid)
        return
      }
      if (!this.isActiveChapterRequest(requestId, cid)) return

      try {
        const chapterInfo = response?.data?.chapter_info
        if (!chapterInfo || typeof chapterInfo !== 'object') throw new Error('章节响应缺少正文数据')
        if (chapterInfo.is_local_plain) {
          chapterInfo.txt_content = chapterInfo.txt_content || ''
        } else {
          chapterInfo.txt_content = await this.decrypt(chapterInfo.txt_content, key)
        }
        if (!this.isActiveChapterRequest(requestId, cid)) return

        this.chapter_info = chapterInfo
        const ownerId = String(cachedReaderUser()?.id || '')
        if (ownerId && !chapterInfo.is_volume) {
          rememberRecentChapter({
            ownerId,
            bookId: this.bid,
            bookTitle: this.book_info.book_name || window.__cirnoCurrentBookTitle || this.bid,
            chapterId: cid,
            chapterTitle: chapterInfo.chapter_title,
            chapterOrder: this.chapterOrderFor(currentChapter, chapterInfo),
            chapter: chapterInfo
          }).catch(() => {})
        }
        if (chapterInfo.auth_access == 1) {
          this.auth = true
          this.setLastRead()
          this.markReadingStart()
        } else {
          this.auth = false
        }
        this.chapterAmount = chapterInfo.unit_hlb
        this.buyAmount = chapterInfo.buy_amount
        this.chapterTitle = chapterInfo.chapter_title

        let contentArray
        if (this.isIhuabenChapterInfo(chapterInfo)) {
          contentArray = this.parseIhuabenHtml(chapterInfo.html_content)
        } else {
          const contentLines = String(chapterInfo.txt_content || '').split(/\r?\n/)
          while (contentLines.length && contentLines[contentLines.length - 1].trim() === '') contentLines.pop()
          const authorSay = String(chapterInfo.author_say || '')
          const authorSayLines = authorSay ? authorSay.split(/\r?\n/) : []
          contentArray = [...contentLines, ...authorSayLines].map(line => ({
            text: this.normalizeParagraphLine(line),
            tsukkomi_num: 0
          }))
        }
        this.chapterContentData = contentArray
        await this.rebuildChapterDisplayContent()
        if (!this.isActiveChapterRequest(requestId, cid)) return

        this.loading = 1
        this.$nextTick(() => {
          if (!this.isActiveChapterRequest(requestId, cid)) return
          if (!this.$refs.book) return
          this.windowSizeHandler()
          this.applyReaderTheme()
          this.containerScroll = new PerfectScrollbar(this.$refs.book, {
            wheelSpeed: 2,
            wheelPropagation: true,
            minScrollbarLength: 20
          })
          Promise.resolve(this.refreshTsukkomiNums(cid, requestId)).catch(() => {})
        })
      } catch (error) {
        this.setChapterLoadError(error, requestId, cid)
      }
    },
    async decrypt(data, key) {
      const webCrypto = globalThis.crypto && globalThis.crypto.subtle
      if (!webCrypto || !data) return String(data || '')
      const rawKey = await webCrypto.digest(
        'SHA-256',
        new TextEncoder().encode(key == null ? 'zG2nSeEfSHfvTCHy5LCcqtBbQehKNLXn' : String(key))
      )
      const aesKey = await webCrypto.importKey('raw', rawKey, { name: 'AES-CBC' }, false, ['decrypt'])
      const encrypted = Uint8Array.from(atob(String(data)), char => char.charCodeAt(0))
      const decrypted = await webCrypto.decrypt({ name: 'AES-CBC', iv: new Uint8Array(16) }, aesKey, encrypted)
      return new TextDecoder().decode(decrypted).replace(/\0+$/g, '')
    },
    async buyChapter() {
      const response = await this.$get({
        url: '/chapter_buy',
        urlParas: { chapter_id: this.cid }
      })
      this.$store.commit('setPropInfo', response.data.prop_info)
      this.$store.commit('setReaderInfo', response.data.reader_info)
      return this.getContent(this.cid)
    },
    retryCurrentChapter() {
      if (this.cid) this.getContent(this.cid)
    },
    async pinCurrentChapterOffline() {
      const ownerId = String(cachedReaderUser()?.id || '')
      if (!ownerId) {
        this.$message.warn('请先登录后再保存离线章节')
        return
      }
      if (!this.cid || !this.chapter_info?.chapter_id || this.chapter_info.is_volume) {
        this.$message.warn('当前没有可保存的正文')
        return
      }
      const currentChapter = this.book_chapters.find(chapter => String(chapter.chapter_id) === String(this.cid))
      try {
        await pinOfflineChapter({
          ownerId,
          bookId: this.bid,
          bookTitle: this.book_info.book_name || this.bid,
          chapterId: this.cid,
          chapterTitle: this.chapter_info.chapter_title,
          chapterOrder: this.chapterOrderFor(currentChapter, this.chapter_info),
          chapter: this.chapter_info
        })
        this.$message.success('当前章节已保存，可离线打开')
      } catch (error) {
        this.$message.error(error?.message || '离线保存失败')
      }
    }
  }
}
