<!--
 * [INPUT]: 依赖 正文/设置组件、reader.less、章节/纠错/导航/阅读设置/间贴/TTS mixins、净化工具与 Reader API
 * [OUTPUT]: 对外提供 Reader 正文阅读组合页面
 * [POS]: Reader views 的阅读组合根，只编排页面布局与局部组件，把章节事实、互动和阅读能力下沉到领域 mixin
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 -->
<template>
  <div class="book-page" ref="book" :class="{ 'book-page-tsu': showTsukkomi }" :style="readerThemeStyle">
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
          @showTsu="showTsu"
          @showPic="showPic"
        ></paragraph>
        <div class="buy-container" v-show="!auth">
          <div class="title">本章是 VIP 章节，购买后才能阅读</div>
          <div class="subtitle">
            本章节需 {{ chapterAmount }} 币，当前剩余 {{ prop_info.rest_hlb }} 币，共 {{ buyAmount }} 人购买
          </div>
          <div class="buy-chapter-button" @click="buyChapter">购买本章</div>
        </div>
        <div class="book-footer" v-show="auth">
          <div class="chapter-nav-button prev-chapter-button" @click="prevChapter">上一章</div>
          <div class="chapter-nav-button next-chapter-button" @click="nextChapter">下一章</div>
        </div>
      </div>
      <div v-show="loading === 1 && showTsukkomi" class="tsukkomi-container" :style="{ right: tsukkomiRight + 'px' }">
        <div v-if="tsukkomiLoading" class="tsukkomi-state">
          <a-skeleton active />
        </div>
        <div v-else-if="tsukkomiError" class="tsukkomi-state tsukkomi-error-state">
          <span>{{ tsukkomiError }}</span>
          <button type="button" @click="refreshTsukkomi">重试</button>
        </div>
        <div v-else-if="tsukkomi_list.length === 0" class="tsukkomi-state">暂无间贴</div>
        <div v-else>
          <div class="title-container">
            <div class="title-text" @click="toTsukkomiTop">共 {{ tsukkomi_num }} 条帖子</div>
            <div class="title-button" @click="closeTsu"><i class="ri-close-line"></i></div>
          </div>
          <div class="tsukkomis" ref="tsukkomi">
            <div class="tsukkomi" v-for="tsukkomi in tsukkomi_list" :key="tsukkomi.tsukkomi_id">
              <div class="tsukkomi-info">
                <div class="avatar">
                  <img
                    :src="
                      tsukkomi.reader_info.avatar_thumb_url.length !== 0
                        ? tsukkomi.reader_info.avatar_thumb_url
                        : tempAvatar
                    "
                  />
                </div>
                <div class="tsukkomi-info-text">
                  <div class="user-name">{{ tsukkomi.reader_info.reader_name }}</div>
                  <div class="time">{{ tsukkomi.ctime }}</div>
                </div>
              </div>
              <div class="tsukkomi-content">
                {{ tsukkomi.tsukkomi_content }}
              </div>
              <div class="tsukkomi-options">
                <div
                  class="option-button"
                  :class="{ 'like-selected': tsukkomi.is_like + '' !== '0' }"
                  @click="tsukkomiOperate(0, tsukkomi.tsukkomi_id)"
                >
                  <i class="ri-thumb-up-line"></i>
                  <div class="num">{{ tsukkomi.like_amount }}</div>
                </div>
                <div
                  class="option-button"
                  :class="{ 'unlike-selected': tsukkomi.is_unlike + '' !== '0' }"
                  @click="tsukkomiOperate(1, tsukkomi.tsukkomi_id)"
                >
                  <i class="ri-thumb-down-line"></i>
                  <div class="num">{{ tsukkomi.unlike_amount }}</div>
                </div>
              </div>
            </div>
            <div class="pagination-container">
              <a-pagination
                size="small"
                @change="changeTsukkomiPage"
                v-model:current="tsukkomiPage"
                :total="tsukkomi_num"
                :defaultPageSize="20"
                :hideOnSinglePage="true"
              />
            </div>
          </div>
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
        <div class="control-button-container" @click="giveTickets">
          <i class="ri-coupon-3-line control-button"></i>
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
    <div
      class="control-bar-container tsukkomi-bar"
      :class="{ 'tsukkomi-bar-show': showTsukkomi }"
      :style="{ 'margin-right': controlBarLeftMargin + 'px' }"
    >
      <div class="control-button-container" @click="newTsukkomi">
        <i class="ri-edit-circle-line control-button"></i>
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
      :marginLeft="tsukkomiRight"
      :chapters="book_chapters"
      @getContent="jumpChapter"
      ref="catalog"
    ></catalog>
    <Picture ref="picture" />
    <Tsukkomi ref="tsukkomiWriter" @refreshTsukkomi="refreshTsukkomi" @refreshPara="refreshPara" />
    <Tickets ref="tickets" />
  </div>
</template>

<script>
import defaultAvatarImage from '@/assets/d_avatar.jpg'
import { mapState } from 'vuex'
import 'perfect-scrollbar/css/perfect-scrollbar.css'
import Paragraph from '../components/paragraph.vue'
import Catalog from '../components/catalog.vue'
import ReaderSettingsPanel from '../components/reader-settings-panel.vue'
import Picture from '../components/picture.vue'
import Tsukkomi from '../components/tsukkomi.vue'
import Tickets from '../components/tickets.vue'
import readerChapterMixin from '../mixins/reader-chapter'
import readerCorrectionMixin from '../mixins/reader-correction'
import readerNavigationMixin from '../mixins/reader-navigation'
import readerSettingsMixin from '../mixins/reader-settings'
import readerTsukkomiMixin from '../mixins/reader-tsukkomi'
import readerTtsMixin from '../mixins/reader-tts'
import { sanitizeHtml } from '../utils/sanitize-html'

export default {
  name: 'Reader',
  mixins: [
    readerChapterMixin,
    readerCorrectionMixin,
    readerNavigationMixin,
    readerSettingsMixin,
    readerTsukkomiMixin,
    readerTtsMixin
  ],
  components: {
    Paragraph,
    Catalog,
    ReaderSettingsPanel,
    Picture,
    Tsukkomi,
    Tickets
  },
  data() {
    return {
      contentDiv: null,
      controlBarLeftMargin: 0,
      containerScroll: null,
      tempAvatar: defaultAvatarImage,
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
  computed: {
    ...mapState(['prop_info', 'reader_info'])
  },
  methods: {
    showCatalog() {
      this.$refs.catalog.showCatalog()
    },
    showPic(url) {
      this.$refs.picture.showPic(url)
    },
    giveTickets() {
      this.$refs.tickets.show(this.bid)
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
