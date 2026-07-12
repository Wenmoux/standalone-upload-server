/**
 * [INPUT]: 依赖 Reader 组合根提供的章节、段落、选区、HTTP 和消息能力
 * [OUTPUT]: 默认导出纠错 computed/methods 状态机，管理等长校验、选择与提交
 * [POS]: cirno-src/src/mixins 的正文纠错切片，由 Reader.vue 混入以控制组合根体积
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export default {
  computed: {
    correctionOriginalLength() {
      return this.charLength(this.correctionForm.originalText)
    },
    correctionCorrectedLength() {
      return this.charLength(this.correctionForm.correctedText)
    },
    correctionLengthMatched() {
      return this.correctionOriginalLength > 0 && this.correctionOriginalLength === this.correctionCorrectedLength
    },
    correctionCanSubmit() {
      return (
        this.correctionLengthMatched &&
        this.correctionForm.originalText.trim() &&
        this.correctionForm.correctedText.trim() &&
        this.correctionForm.originalText !== this.correctionForm.correctedText
      )
    }
  },
  methods: {
    normalizeCorrectionText(value) {
      return String(value || '').replace(/\r\n?/g, '\n')
    },
    hideCorrectionPicker() {
      this.correctionPicker.visible = false
    },
    handleCorrectionSelection() {
      window.setTimeout(() => this.captureCorrectionSelection(false), 0)
    },
    getCorrectionTextElement(node) {
      let el = node && node.nodeType === 1 ? node : node && node.parentElement
      while (el && el !== this.$refs.bookContent) {
        if (el.classList && el.classList.contains('content-text')) return el
        el = el.parentElement
      }
      return null
    },
    chapterTextOffsetForParagraph(paragraphIndex) {
      let offset = 0
      for (let i = 0; i < paragraphIndex; i++) {
        offset += this.charLength(this.normalizeCorrectionText(this.chapterContentData[i] && this.chapterContentData[i].text))
        offset += 1
      }
      return offset
    },
    correctionSourceFromRange(range, displayText) {
      const fallback = {
        originalText: displayText,
        displayText,
        paragraphIndex: null,
        startOffset: null,
        endOffset: null
      }
      const startEl = this.getCorrectionTextElement(range.startContainer)
      const endEl = this.getCorrectionTextElement(range.endContainer)
      if (!startEl || startEl !== endEl) return fallback
      const paragraphIndex = Number(startEl.getAttribute('data-paragraph-index'))
      const item = this.chapterContentData[paragraphIndex]
      const rawText = this.normalizeCorrectionText(item && item.text)
      if (!rawText) return fallback

      let startOffset = 0
      try {
        const preRange = range.cloneRange()
        preRange.selectNodeContents(startEl)
        preRange.setEnd(range.startContainer, range.startOffset)
        startOffset = this.charLength(preRange.toString())
      } catch (e) {
        startOffset = 0
      }

      const selectedLength = this.charLength(displayText)
      const rawChars = Array.from(rawText)
      let originalText = rawChars.slice(startOffset, startOffset + selectedLength).join('')
      const convertedOriginal = this.convertRawText(originalText, this.chineseConvert, this.readerSettings.convertMode)
      if (convertedOriginal !== displayText) {
        const convertedText =
          this.normalizeCorrectionText(item && item.displayText) ||
          this.convertRawText(rawText, this.chineseConvert, this.readerSettings.convertMode)
        const displayIndex = convertedText.indexOf(displayText)
        if (displayIndex >= 0) {
          startOffset = this.charLength(convertedText.slice(0, displayIndex))
          originalText = rawChars.slice(startOffset, startOffset + selectedLength).join('')
        }
      }

      return {
        originalText: originalText || displayText,
        displayText,
        paragraphIndex,
        startOffset: this.chapterTextOffsetForParagraph(paragraphIndex) + startOffset,
        endOffset: this.chapterTextOffsetForParagraph(paragraphIndex) + startOffset + selectedLength
      }
    },
    captureCorrectionSelection(showMessage = false) {
      const selection = window.getSelection && window.getSelection()
      if (!selection || selection.rangeCount === 0) {
        this.hideCorrectionPicker()
        if (showMessage) this.$message.info('请先选中需要纠错的文字')
        return false
      }
      const selectedText = this.normalizeCorrectionText(selection.toString()).replace(/\u00a0/g, ' ')
      if (!selectedText.trim()) {
        this.hideCorrectionPicker()
        if (showMessage) this.$message.info('请先选中需要纠错的文字')
        return false
      }
      const range = selection.getRangeAt(0)
      const anchor =
        range.commonAncestorContainer.nodeType === 1
          ? range.commonAncestorContainer
          : range.commonAncestorContainer.parentElement
      if (!this.$refs.bookContent || !anchor || !this.$refs.bookContent.contains(anchor)) {
        this.hideCorrectionPicker()
        if (showMessage) this.$message.info('只能选择正文内容提交纠错')
        return false
      }
      const rect = range.getBoundingClientRect()
      const left = Math.min(window.innerWidth - 58, Math.max(58, rect.left + rect.width / 2))
      const top = Math.max(78, rect.top - 46)
      this.correctionSelection = this.correctionSourceFromRange(range, selectedText)
      this.correctionPicker = { visible: true, left, top }
      return true
    },
    openCorrectionFromToolbar() {
      if (this.captureCorrectionSelection(true)) this.openCorrectionModal()
    },
    openCorrectionModal() {
      if (!this.correctionSelection && !this.captureCorrectionSelection(true)) return
      if (this.charLength(this.correctionSelection.originalText) > 1000) {
        this.$message.error('单次纠错最多选择 1000 字')
        return
      }
      this.correctionForm = {
        originalText: this.correctionSelection.originalText,
        correctedText: this.correctionSelection.originalText
      }
      this.hideCorrectionPicker()
      this.correctionModalVisible = true
    },
    closeCorrectionModal() {
      if (this.correctionSubmitting) return
      this.correctionModalVisible = false
      this.correctionForm = { originalText: '', correctedText: '' }
    },
    async submitCorrection() {
      if (!this.correctionCanSubmit) {
        this.$message.error('纠错前后字数必须一致，且内容需要有变化')
        return
      }
      this.correctionSubmitting = true
      try {
        await this.$post({
          url: '/reader-api/corrections',
          paras: {
            bookId: this.bid,
            chapterId: this.cid,
            bookTitle: this.book_info.book_name || this.book_info.title || '',
            chapterTitle: this.chapterTitle || '',
            originalText: this.correctionForm.originalText,
            correctedText: this.correctionForm.correctedText,
            startOffset: this.correctionSelection ? this.correctionSelection.startOffset : null,
            endOffset: this.correctionSelection ? this.correctionSelection.endOffset : null
          }
        })
        this.$message.success('纠错已提交，等待后台审核')
        this.correctionModalVisible = false
        this.correctionSelection = null
        this.correctionForm = { originalText: '', correctedText: '' }
        const selection = window.getSelection && window.getSelection()
        if (selection) selection.removeAllRanges()
      } catch (e) {
        this.$message.error(e && e.message ? e.message : String(e || '提交失败'))
      } finally {
        this.correctionSubmitting = false
      }
    }
  }
}
