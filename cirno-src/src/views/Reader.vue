<!--
 * [INPUT]: 依赖 正文/设置组件、reader.less、章节/纠错/导航/阅读设置/TTS mixins、净化工具与 Reader API
 * [OUTPUT]: 对外提供 Reader 正文阅读组合页面
 * [POS]: Reader views 的阅读组合根，只编排当前后端真实支持的页面布局、纠错与阅读能力，不暴露旧上游的间贴、票券或站点购买假入口
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 -->
<template>
  <div class="book-page" ref="book" :style="readerThemeStyle">
    <div
      class="content-container"
      ref="contentContainer"
      @mouseup="handleCorrectionSelection"
      @keyup="handleCorrectionSelection"
    >
      <div v-show="loading === 1" class="book-content" ref="bookContent">
        <div class="top-bar">
          <i class="ri-arrow-left-line icon-button" @click="goBack"></i>
          <div class="topbar-title">
            {{ chapterTitle }}
            <span v-if="chapter_info.offline" class="offline-badge">离线</span>
          </div>
        </div>
        <div
          v-if="customChapterHeaderVisible"
          class="custom-chapter-header"
          :class="{
            'custom-chapter-header-empty': !customHeaderImageSrc,
            'custom-chapter-header-style1': readerSettings.chapterHeaderPreset === 'style1'
          }"
          :style="customChapterHeaderStyle"
        >
          <div v-if="customHeaderImageSrc" class="custom-header-art">
            <img :src="customHeaderImageSrc" alt="章节头图" />
          </div>
          <div class="custom-header-copy">
            <div class="custom-header-number">{{ customHeaderChapterNumber }}</div>
            <div class="custom-header-name">{{ customHeaderTitleText }}</div>
          </div>
        </div>
        <paragraph
          class="text-content"
          :class="{ 'text-content-custom-header': customChapterHeaderVisible }"
          ref="paragraph"
          :paragraphs="chapterDisplayContentData"
          :isDark="readerSettings.theme === 'dark' || readerSettings.theme === 'black'"
          :size="readerSettings.fontSize"
          :lineHeight="readerSettings.lineHeight"
          :fontFamily="readerSettings.fontFamily"
          :titleStyle="readerSettings.titleStyle"
          :textColor="readerTextColor"
          :accentColor="readerAccentColor"
          :paragraphSpacing="readerSettings.paragraphSpacing"
          :paragraphIndent="readerSettings.paragraphIndent"
          :letterSpacing="readerSettings.letterSpacing"
          :textAlign="readerSettings.textAlign"
          :fontWeight="readerSettings.fontWeight"
          :pagePadding="readerSettings.pagePadding"
          :activeTtsIndex="activeTtsParagraphIndex"
          @showPic="showPic"
        ></paragraph>
        <div class="book-footer">
          <div class="chapter-nav-button prev-chapter-button" @click="prevChapter">上一章</div>
          <div class="chapter-nav-button next-chapter-button" @click="nextChapter">下一章</div>
        </div>
      </div>
      <div v-show="loading === 0" class="skeleton-container">
        <a-skeleton active />
      </div>
      <div v-if="loading === -1" class="reader-error-state">
        <strong>章节暂时无法打开</strong>
        <span>{{ loadError || '网络不可用，且当前账号没有这章的离线缓存。' }}</span>
        <button type="button" @click="retryCurrentChapter">重试</button>
      </div>
    </div>
    <div
      v-show="loading === 1"
      class="control-bar-container content-bar"
      :class="{ collapsed: controlsCollapsed }"
      :style="{ 'margin-left': controlBarLeftMargin + 'px' }"
    >
      <div class="control-actions">
        <div class="control-button-container" title="上一章" @click="prevChapter">
          <i class="ri-arrow-left-s-line control-button"></i>
        </div>
        <div class="control-button-container" @click="showCatalog">
          <i class="ri-menu-line control-button"></i>
        </div>
        <div class="control-button-container" title="下一章" @click="nextChapter">
          <i class="ri-arrow-right-s-line control-button"></i>
        </div>
        <div class="control-button-container" @click="openReaderSettings">
          <i class="ri-settings-line control-button"></i>
        </div>
        <div class="control-button-container" title="朗读" @click="toggleTtsQuick">
          <i :class="ttsQuickIconClass"></i>
        </div>
        <div class="control-button-container" title="繁简转换" @click="toggleConvertModeQuick">
          <i class="ri-translate-2 control-button"></i>
        </div>
        <div class="control-button-container" title="保存当前章离线阅读" @click="pinCurrentChapterOffline">
          <i class="ri-download-cloud-2-line control-button"></i>
        </div>
        <div class="control-button-container" title="纠错" @click="openCorrectionFromToolbar">
          <i class="ri-edit-2-line control-button"></i>
        </div>
        <div class="control-button-container" @click="toChapterTop">
          <i class="ri-arrow-up-s-line control-button"></i>
        </div>
      </div>
      <div class="control-button-container collapse-toggle" @click="controlsCollapsed = !controlsCollapsed">
        <i :class="controlsCollapsed ? 'ri-more-2-fill control-button' : 'ri-arrow-right-s-line control-button'"></i>
      </div>
    </div>
    <button
      v-show="correctionPicker.visible"
      class="correction-picker"
      :style="{ left: correctionPicker.left + 'px', top: correctionPicker.top + 'px' }"
      @mousedown.prevent
      @click="openCorrectionModal"
    >
      <i class="ri-edit-2-line"></i>
      纠错
    </button>
    <a-modal title="提交纠错" :open="correctionModalVisible" :mask-closable="false" @cancel="closeCorrectionModal">
      <div class="correction-dialog">
        <div class="correction-tip">请保持字数一致，审核通过奖励 200 铜币 + 100 银币。</div>
        <label>原文</label>
        <a-textarea :value="correctionForm.originalText" :rows="4" read-only />
        <label>修正为</label>
        <a-textarea v-model:value="correctionForm.correctedText" :rows="4" />
        <div class="correction-count" :class="{ invalid: !correctionLengthMatched }">
          原文 {{ correctionOriginalLength }} 字 / 修正 {{ correctionCorrectedLength }} 字
        </div>
      </div>
      <template #footer>
        <a-button @click="closeCorrectionModal">取消</a-button>
        <a-button
          type="primary"
          :loading="correctionSubmitting"
          :disabled="!correctionCanSubmit"
          @click="submitCorrection"
        >
          提交
        </a-button>
      </template>
    </a-modal>
    <reader-settings-panel
      :reader-settings="readerSettings"
      :reader-settings-drawer-width="readerSettingsDrawerWidth"
      :reader-settings-visible="readerSettingsVisible"
      :current-theme-label="currentThemeLabel"
      :theme-options="themeOptions"
      :font-options="fontOptions"
      :available-tts-voices="availableTtsVoices"
      :edge-tts-voices="edgeTtsVoices"
      :custom-header-image-src="customHeaderImageSrc"
      :custom-header-chapter-number="customHeaderChapterNumber"
      :custom-header-title-text="customHeaderTitleText"
      :tts-loading="ttsLoading"
      @close="readerSettingsVisible = false"
      @update-setting="setReaderSetting"
      @update-custom-setting="setCustomReaderSetting"
      @select-theme="selectReaderTheme"
      @step-setting="stepReaderSetting"
      @upload-header="handleCustomHeaderImageUpload"
      @clear-header="clearCustomHeaderImage"
      @tts-action="handleReaderTtsAction"
      @reset="resetReaderSettings"
    />
    <catalog
      :info="book_info"
      :currentChapter="chapterIndex"
      :marginLeft="Math.max(0, -controlBarLeftMargin - 96)"
      :chapters="book_chapters"
      @getContent="jumpChapter"
      ref="catalog"
    ></catalog>
    <Picture ref="picture" />
  </div>
</template>

<script>
import 'perfect-scrollbar/css/perfect-scrollbar.css'
import Paragraph from '../components/paragraph.vue'
import Catalog from '../components/catalog.vue'
import ReaderSettingsPanel from '../components/reader-settings-panel.vue'
import Picture from '../components/picture.vue'
import readerChapterMixin from '../mixins/reader-chapter'
import readerCorrectionMixin from '../mixins/reader-correction'
import readerNavigationMixin from '../mixins/reader-navigation'
import readerSettingsMixin from '../mixins/reader-settings'
import readerTtsMixin from '../mixins/reader-tts'

export default {
  name: 'Reader',
  mixins: [readerChapterMixin, readerCorrectionMixin, readerNavigationMixin, readerSettingsMixin, readerTtsMixin],
  components: {
    Paragraph,
    Catalog,
    ReaderSettingsPanel,
    Picture
  },
  data() {
    return {
      contentDiv: null,
      controlBarLeftMargin: 0,
      containerScroll: null,
      controlsCollapsed: true,
      ttsUtterance: null,
      ttsAudio: null,
      ttsAudioUrl: '',
      ttsQueue: [],
      ttsQueueMeta: [],
      ttsPrefetchMap: {},
      ttsQueueIndex: 0,
      ttsLoading: false,
      ttsStopped: false,
      ttsPlaying: false,
      activeTtsParagraphIndex: -1,
      availableTtsVoices: [],
      readingStartedAt: 0,
      readingAccumulatedSeconds: 0,
      correctionPicker: {
        visible: false,
        left: 0,
        top: 0
      },
      correctionSelection: null,
      correctionModalVisible: false,
      correctionSubmitting: false,
      correctionForm: {
        originalText: '',
        correctedText: ''
      }
    }
  },
  mounted() {
    this.contentDiv = this.$refs.contentContainer
    window.addEventListener('resize', this.windowSizeHandler)
  },
  beforeUnmount() {
    window.removeEventListener('resize', this.windowSizeHandler)
    this.flushReadingTime()
    if (this.containerScroll) this.containerScroll.destroy()
  },
  methods: {
    showCatalog() {
      this.$refs.catalog.showCatalog()
    },
    showPic(url) {
      this.$refs.picture.showPic(url)
    },
    handleReaderTtsAction(action) {
      const handlers = {
        start: this.startTts,
        pause: this.pauseTts,
        resume: this.resumeTts,
        stop: this.stopTts
      }
      if (handlers[action]) handlers[action]()
    }
  }
}
</script>

<style src="../styles/reader.less" lang="less" scoped></style>
