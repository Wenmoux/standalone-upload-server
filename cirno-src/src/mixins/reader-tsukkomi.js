/**
 * [INPUT]: 依赖 Reader HTTP/消息/章节状态、正文显示重建、布局方法、PerfectScrollbar 与间贴/图片组件引用
 * [OUTPUT]: 默认导出间贴数量、分页列表、加载/失败反馈、点赞/点踩、发布入口和跨章节并发隔离状态机
 * [POS]: cirno-src/src/mixins 的段落间贴交互切片，与章节数据 mixin 协作但不拥有正文事实
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import PerfectScrollbar from 'perfect-scrollbar'

export default {
  data() {
    return {
      tsukkomi_num: 0,
      tsukkomi_list: [],
      showTsukkomi: false,
      tsukkomiRight: 0,
      tsukkomiPage: 1,
      tsukkomiScroll: null,
      tsukkomiIndex: 0,
      tsukkomiRequestId: 0,
      tsukkomiLoading: false,
      tsukkomiError: ''
    }
  },
  beforeUnmount() {
    this.invalidateTsukkomiList({ close: true })
  },
  methods: {
    invalidateTsukkomiList({ close = false, clear = false } = {}) {
      this.tsukkomiRequestId += 1
      this.tsukkomiLoading = false
      if (close) {
        this.showTsukkomi = false
        this.tsukkomiError = ''
      }
      if (clear) this.tsukkomi_list = []
      if (this.tsukkomiScroll) this.tsukkomiScroll.destroy()
      this.tsukkomiScroll = null
    },
    isActiveTsukkomiRequest(requestId, chapterId, paragraphIndex, page) {
      return (
        requestId === this.tsukkomiRequestId &&
        String(this.cid) === String(chapterId) &&
        this.tsukkomiIndex === paragraphIndex &&
        this.tsukkomiPage === page &&
        this.showTsukkomi
      )
    },
    async refreshTsukkomiNums(cid, requestId) {
      const tsukkomiNums = await this.getTsukkomiNum(cid).catch(() => [])
      if (requestId !== this.contentRequestId || String(this.cid) !== String(cid) || !tsukkomiNums.length) return
      const contentArray = this.chapterContentData.slice()
      let changed = false
      for (const item of tsukkomiNums) {
        const paragraphIndex = Number(item.paragraph_index)
        if (Number.isInteger(paragraphIndex) && paragraphIndex >= 0 && paragraphIndex < contentArray.length) {
          contentArray[paragraphIndex] = Object.assign({}, contentArray[paragraphIndex], {
            tsukkomi_num: item.tsukkomi_num
          })
          changed = true
        }
      }
      if (!changed) return
      this.chapterContentData = contentArray
      await this.rebuildChapterDisplayContent()
    },
    async getTsukkomiNum(cid) {
      const response = await this.$get({
        url: '/chapter/get_tsukkomi_num',
        urlParas: { chapter_id: String(cid) }
      })
      return response.data.tsukkomi_num_info
    },
    async getTsukkomiList(paragraphIndex) {
      const chapterId = String(this.cid)
      const page = this.tsukkomiPage
      const requestId = ++this.tsukkomiRequestId
      this.tsukkomiLoading = true
      this.tsukkomiError = ''
      let response
      try {
        response = await this.$get({
          url: '/chapter/get_paragraph_tsukkomi_list_new',
          urlParas: {
            chapter_id: chapterId,
            paragraph_index: paragraphIndex,
            count: 20,
            page: page - 1
          }
        })
      } catch (error) {
        if (this.isActiveTsukkomiRequest(requestId, chapterId, paragraphIndex, page)) {
          this.tsukkomiLoading = false
          this.tsukkomiError = error?.error || error?.message || '间贴加载失败，请重试'
        }
        return
      }
      if (!this.isActiveTsukkomiRequest(requestId, chapterId, paragraphIndex, page)) return
      this.tsukkomiLoading = false
      this.tsukkomi_list = Array.isArray(response?.data?.tsukkomi_list) ? response.data.tsukkomi_list : []
      this.$nextTick(() => {
        if (!this.isActiveTsukkomiRequest(requestId, chapterId, paragraphIndex, page)) return
        if (this.tsukkomiScroll) this.tsukkomiScroll.destroy()
        if (!this.$refs.tsukkomi) return
        this.tsukkomiScroll = new PerfectScrollbar(this.$refs.tsukkomi, {
          wheelSpeed: 1,
          wheelPropagation: false,
          minScrollbarLength: 20
        })
      })
    },
    showTsu(index, num, page, noSkeleton) {
      if (noSkeleton && !this.showTsukkomi) return
      const paragraphIndex = Number(index)
      if (!Number.isInteger(paragraphIndex) || paragraphIndex < 0) return
      this.tsukkomiIndex = paragraphIndex
      if (num !== undefined && num !== null) this.tsukkomi_num = Number.parseInt(num, 10) || 0
      const requestedPage = Number(page)
      this.tsukkomiPage = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1
      if (this.tsukkomiScroll) this.tsukkomiScroll.destroy()
      this.tsukkomiScroll = null
      if (!noSkeleton) {
        this.tsukkomi_list = []
        this.showTsukkomi = true
        this.toTsukkomiTop()
      }
      this.getTsukkomiList(paragraphIndex)
      this.$nextTick(() => this.windowSizeHandler())
    },
    closeTsu() {
      this.invalidateTsukkomiList({ close: true, clear: true })
      this.toTsukkomiTop()
      this.$nextTick(() => this.windowSizeHandler())
    },
    changeTsukkomiPage(page) {
      this.showTsu(this.tsukkomiIndex, null, page)
    },
    async tsukkomiOperate(unlike, tsukkomiId) {
      const chapterId = String(this.cid)
      const paragraphIndex = this.tsukkomiIndex
      try {
        await this.$get({
          url: unlike ? '/chapter/unlike_tsukkomi' : '/chapter/like_tsukkomi',
          urlParas: { tsukkomi_id: tsukkomiId }
        })
      } catch (error) {
        if (this.showTsukkomi && String(this.cid) === chapterId && this.tsukkomiIndex === paragraphIndex) {
          this.tsukkomiError = error?.error || error?.message || '间贴操作失败，请重试'
        }
        return
      }
      if (this.showTsukkomi && String(this.cid) === chapterId && this.tsukkomiIndex === paragraphIndex) {
        this.refreshTsukkomi()
      }
    },
    refreshTsukkomi() {
      if (!this.showTsukkomi) return
      this.showTsu(this.tsukkomiIndex, this.tsukkomi_num, this.tsukkomiPage, true)
    },
    refreshPara(paragraphIndex) {
      const paragraph = this.chapterContentData[paragraphIndex]
      if (!paragraph) return
      paragraph.tsukkomi_num = (Number(paragraph.tsukkomi_num) || 0) + 1
      this.tsukkomi_num = (Number(this.tsukkomi_num) || 0) + 1
    },
    newTsukkomi() {
      const paragraph = this.chapterContentData[this.tsukkomiIndex]
      if (!paragraph || !this.$refs.tsukkomiWriter) return
      const text = paragraph.text
      this.$refs.tsukkomiWriter.show(text, this.bid, this.cid, this.tsukkomiIndex)
    }
  }
}
