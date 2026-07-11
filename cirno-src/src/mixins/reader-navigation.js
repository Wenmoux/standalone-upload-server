export default {
  computed: {
    readableChapters() {
      return this.book_chapters.filter(chapter => !this.isVolumeChapter(chapter))
    }
  },
  methods: {
    isVolumeChapter(chapter) {
      return !!(chapter && (chapter.is_volume || chapter.isVolume))
    },
    firstReadableChapterId() {
      const first = this.readableChapters[0]
      return first ? first.chapter_id : null
    },
    prevReadableChapterId() {
      const current = this.book_chapters.findIndex(chapter => String(chapter.chapter_id) === String(this.cid))
      for (let i = current - 1; i >= 0; i -= 1) {
        if (!this.isVolumeChapter(this.book_chapters[i])) return this.book_chapters[i].chapter_id
      }
      return null
    },
    nextReadableChapterId() {
      const current = this.book_chapters.findIndex(chapter => String(chapter.chapter_id) === String(this.cid))
      for (let i = current + 1; i < this.book_chapters.length; i += 1) {
        if (!this.isVolumeChapter(this.book_chapters[i])) return this.book_chapters[i].chapter_id
      }
      return null
    },
    nearestReadableChapterId(cid) {
      const current = this.book_chapters.findIndex(chapter => String(chapter.chapter_id) === String(cid))
      if (current >= 0) {
        for (let i = current + 1; i < this.book_chapters.length; i += 1) {
          if (!this.isVolumeChapter(this.book_chapters[i])) return this.book_chapters[i].chapter_id
        }
        for (let i = current - 1; i >= 0; i -= 1) {
          if (!this.isVolumeChapter(this.book_chapters[i])) return this.book_chapters[i].chapter_id
        }
      }
      return this.firstReadableChapterId()
    },
    windowSizeHandler() {
      if (!this.contentDiv) return
      const windowWidth = window.innerWidth
      const contentWidth = this.contentDiv.clientWidth
      this.controlBarLeftMargin = -(contentWidth / 2 + 96)
      this.tsukkomiRight = (windowWidth - contentWidth) / 2
    },
    markReadingStart() {
      this.readingStartedAt = Date.now()
      this.readingAccumulatedSeconds = 0
    },
    collectReadingSeconds() {
      if (!this.readingStartedAt) return 0
      const seconds = Math.max(0, Math.floor((Date.now() - this.readingStartedAt) / 1000))
      this.readingStartedAt = Date.now()
      this.readingAccumulatedSeconds += seconds
      return seconds
    },
    flushReadingTime() {
      this.collectReadingSeconds()
      if (!this.bid || !this.cid || !this.readingAccumulatedSeconds) return
      const readingSeconds = this.readingAccumulatedSeconds
      this.readingAccumulatedSeconds = 0
      this.setLastRead(readingSeconds)
    },
    toChapterTop() {
      this.$refs.book.scrollTo(0, 0)
    },
    toTsukkomiTop() {
      this.$refs.tsukkomi.scrollTo(0, 0)
    },
    switchChapter(cid) {
      this.showTsukkomi = false
      this.loading = 0
      this.toChapterTop()
      this.toTsukkomiTop()
      if (this.containerScroll) this.containerScroll.destroy()
      if (this.tsukkomiScroll) this.tsukkomiScroll.destroy()
      this.getContent(cid)
      this.$router.replace({ query: { bid: this.bid, cid } })
    },
    prevChapter() {
      const prevCid = this.prevReadableChapterId()
      if (prevCid) this.switchChapter(prevCid)
      else this.$message.error('已经是第一章了')
    },
    nextChapter() {
      const nextCid = this.nextReadableChapterId()
      if (nextCid) this.switchChapter(nextCid)
      else this.$message.error('已经是最后一章了')
    },
    jumpChapter(cid) {
      const targetChapter = this.book_chapters.find(chapter => String(chapter.chapter_id) === String(cid))
      if (this.isVolumeChapter(targetChapter)) return
      this.showTsukkomi = false
      this.loading = 0
      this.toChapterTop()
      this.toTsukkomiTop()
      if (this.containerScroll) this.containerScroll.destroy()
      this.getContent(cid)
      this.$router.replace({ query: { bid: this.bid, cid } })
    },
    setLastRead(readingSeconds = 0) {
      return this.$get({
        url: '/bookshelf/set_last_read_chapter',
        urlParas: {
          book_id: this.bid,
          last_read_chapter_id: this.cid,
          reading_seconds: readingSeconds
        }
      }).catch(() => {})
    },
    goBack() {
      this.$router.back()
    }
  }
}
