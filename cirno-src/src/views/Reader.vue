<!--
 * [INPUT]: 依赖 正文组件、纠错/导航/阅读设置/TTS mixins、离线/session/净化工具与章节 API
 * [OUTPUT]: 对外提供 Reader 正文阅读组合页面
 * [POS]: Reader views 的阅读组合根，负责章节数据与局部组件编排，把设置、主题、繁简转换等状态机下沉到 mixin
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
        <div v-show="tsukkomi_list.length === 0" class="skeleton-container">
          <a-skeleton active />
        </div>
        <div v-show="tsukkomi_list.length !== 0">
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
    <a-drawer
      title="阅读设置"
      placement="right"
      :width="readerSettingsDrawerWidth"
      :open="readerSettingsVisible"
      @close="readerSettingsVisible = false"
    >
      <div class="reader-settings">
        <div class="setting-block">
          <div class="setting-head">
            <span>背景</span>
            <em>{{ currentThemeLabel }}</em>
          </div>
          <div class="theme-grid">
            <button
              type="button"
              class="theme-card"
              v-for="item in themeOptions"
              :key="item.value"
              :class="{ active: readerSettings.theme === item.value }"
              :style="themePreviewStyle(item)"
              @click="selectReaderTheme(item.value)"
            >
              <span class="theme-preview">
                <i></i>
                <b></b>
              </span>
              <span>{{ item.label }}</span>
            </button>
          </div>
          <div class="custom-theme-panel" v-show="readerSettings.theme === 'custom'">
            <div class="color-row">
              <span>页面</span>
              <input
                type="color"
                :value="readerSettings.customBg"
                @input="e => setCustomReaderSetting('customBg', e.target.value)"
              />
            </div>
            <div class="color-row">
              <span>纸张</span>
              <input
                type="color"
                :value="readerSettings.customPaper"
                @input="e => setCustomReaderSetting('customPaper', e.target.value)"
              />
            </div>
            <div class="color-row">
              <span>文字</span>
              <input
                type="color"
                :value="readerSettings.customText"
                @input="e => setCustomReaderSetting('customText', e.target.value)"
              />
            </div>
            <div class="color-row">
              <span>强调</span>
              <input
                type="color"
                :value="readerSettings.customAccent"
                @input="e => setCustomReaderSetting('customAccent', e.target.value)"
              />
            </div>
          </div>
        </div>

        <div class="setting-block">
          <div class="setting-title">字体</div>
          <a-select
            style="width: 100%"
            :value="readerSettings.fontFamily"
            @change="value => setReaderSetting('fontFamily', value)"
          >
            <a-select-option v-for="font in fontOptions" :key="font.value" :value="font.value">
              {{ font.label }}
            </a-select-option>
          </a-select>
        </div>

        <div class="setting-block">
          <div class="setting-head">
            <span>字号</span>
            <em>{{ readerSettings.fontSize }}px</em>
          </div>
          <div class="slider-line">
            <a-button size="small" @click="stepReaderSetting('fontSize', -1, 14, 32)">A-</a-button>
            <a-slider
              class="setting-slider"
              :min="14"
              :max="32"
              :value="readerSettings.fontSize"
              @change="value => setReaderSetting('fontSize', value)"
            />
            <a-button size="small" @click="stepReaderSetting('fontSize', 1, 14, 32)">A+</a-button>
          </div>
        </div>

        <div class="setting-block">
          <div class="setting-head">
            <span>行高</span>
            <em>{{ readerSettings.lineHeight }}</em>
          </div>
          <a-slider
            :min="1.4"
            :max="2.8"
            :step="0.1"
            :value="readerSettings.lineHeight"
            @change="value => setReaderSetting('lineHeight', value)"
          />
        </div>

        <div class="setting-block">
          <div class="setting-head">
            <span>段距</span>
            <em>{{ readerSettings.paragraphSpacing }}em</em>
          </div>
          <a-slider
            :min="0.2"
            :max="1.8"
            :step="0.1"
            :value="readerSettings.paragraphSpacing"
            @change="value => setReaderSetting('paragraphSpacing', value)"
          />
        </div>

        <div class="setting-block">
          <div class="setting-head">
            <span>版心宽度</span>
            <em>{{ readerSettings.contentWidth }}px</em>
          </div>
          <a-slider
            :min="620"
            :max="980"
            :step="20"
            :value="readerSettings.contentWidth"
            @change="value => setReaderSetting('contentWidth', value)"
          />
        </div>

        <div class="setting-block">
          <div class="setting-head">
            <span>页边距</span>
            <em>{{ readerSettings.pagePadding }}px</em>
          </div>
          <a-slider
            :min="28"
            :max="96"
            :step="4"
            :value="readerSettings.pagePadding"
            @change="value => setReaderSetting('pagePadding', value)"
          />
        </div>

        <div class="setting-block two-column">
          <div>
            <div class="setting-title">缩进</div>
            <a-radio-group
              :value="readerSettings.paragraphIndent"
              @change="e => setReaderSetting('paragraphIndent', e.target.value)"
            >
              <a-radio-button :value="0">无</a-radio-button>
              <a-radio-button :value="2">两格</a-radio-button>
            </a-radio-group>
          </div>
          <div>
            <div class="setting-title">字重</div>
            <a-radio-group
              :value="readerSettings.fontWeight"
              @change="e => setReaderSetting('fontWeight', e.target.value)"
            >
              <a-radio-button :value="400">常规</a-radio-button>
              <a-radio-button :value="500">清晰</a-radio-button>
            </a-radio-group>
          </div>
        </div>

        <div class="setting-block">
          <div class="setting-head">
            <span>字距</span>
            <em>{{ readerSettings.letterSpacing }}px</em>
          </div>
          <a-slider
            :min="0"
            :max="2"
            :step="0.2"
            :value="readerSettings.letterSpacing"
            @change="value => setReaderSetting('letterSpacing', value)"
          />
        </div>

        <div class="setting-block">
          <div class="setting-title">对齐</div>
          <a-radio-group :value="readerSettings.textAlign" @change="e => setReaderSetting('textAlign', e.target.value)">
            <a-radio-button value="left">左对齐</a-radio-button>
            <a-radio-button value="justify">两端对齐</a-radio-button>
          </a-radio-group>
        </div>

        <div class="setting-block">
          <div class="setting-title">繁简转换</div>
          <a-radio-group
            :value="readerSettings.convertMode"
            @change="e => setReaderSetting('convertMode', e.target.value)"
          >
            <a-radio-button value="none">原文</a-radio-button>
            <a-radio-button value="simplified">简体</a-radio-button>
            <a-radio-button value="traditional">繁体</a-radio-button>
          </a-radio-group>
          <div v-show="readerSettings.convertMode === 'simplified'" class="setting-block-inner">
            <label class="setting-label check-line">
              <input
                type="checkbox"
                :checked="readerSettings.convertTwPhrases"
                @change="e => setReaderSetting('convertTwPhrases', e.target.checked)"
              />
              台湾用语转大陆用语
            </label>
            <label class="setting-label">自定义词表</label>
            <textarea
              class="setting-textarea"
              :value="readerSettings.convertGlossary"
              placeholder="每行：原词=>目标&#10;乾坤=>乾坤 可保护专名"
              @input="e => setReaderSetting('convertGlossary', e.target.value)"
            ></textarea>
            <div class="setting-tip">原词可写繁体或简体；相同词表示保护，不让 OpenCC 二次修改。</div>
          </div>
        </div>

        <div class="setting-block">
          <div class="setting-title">标题样式</div>
          <a-radio-group
            :value="readerSettings.titleStyle"
            @change="e => setReaderSetting('titleStyle', e.target.value)"
          >
            <a-radio-button value="classic">经典</a-radio-button>
            <a-radio-button value="center">居中</a-radio-button>
            <a-radio-button value="underline">下划线</a-radio-button>
          </a-radio-group>
          <div class="custom-header-settings">
            <label class="setting-label check-line">
              <input
                type="checkbox"
                :checked="readerSettings.customHeaderEnabled"
                @change="e => setReaderSetting('customHeaderEnabled', e.target.checked)"
              />
              启用自定义章头和头图
            </label>
            <div v-show="readerSettings.customHeaderEnabled" class="custom-header-config">
              <div class="setting-title">内置章头</div>
              <a-radio-group
                :value="readerSettings.chapterHeaderPreset"
                @change="e => setReaderSetting('chapterHeaderPreset', e.target.value)"
              >
                <a-radio-button value="crane">仙鹤</a-radio-button>
                <a-radio-button value="style1">江湖纸卷</a-radio-button>
              </a-radio-group>
              <div class="tts-param-grid">
                <label class="setting-label">
                  章节数覆盖
                  <input
                    class="setting-input"
                    :value="readerSettings.customHeaderChapterLabel"
                    placeholder="留空自动读取：第184章"
                    @input="e => setReaderSetting('customHeaderChapterLabel', e.target.value)"
                  />
                </label>
                <label class="setting-label">
                  标题覆盖
                  <input
                    class="setting-input"
                    :value="readerSettings.customHeaderTitle"
                    placeholder="留空自动读取章节名"
                    @input="e => setReaderSetting('customHeaderTitle', e.target.value)"
                  />
                </label>
              </div>
              <label class="setting-label">头图</label>
              <div class="custom-header-upload">
                <input type="file" accept="image/*" @change="handleCustomHeaderImageUpload" />
                <a-button size="small" @click="clearCustomHeaderImage">恢复内置头图</a-button>
              </div>
              <div class="setting-tip">
                未选择自定义图片时使用当前章头的内置图片；自定义图片只保存在当前浏览器，不会上传服务器。
              </div>
              <div
                class="custom-header-preview"
                :class="{ empty: !customHeaderImageSrc, style1: readerSettings.chapterHeaderPreset === 'style1' }"
              >
                <img v-if="customHeaderImageSrc" :src="customHeaderImageSrc" alt="头图预览" />
                <span v-else>未选择头图</span>
                <strong>{{ customHeaderChapterNumber }}</strong>
                <em>{{ customHeaderTitleText }}</em>
              </div>
            </div>
          </div>
        </div>

        <div class="setting-block">
          <div class="setting-title">TTS 朗读</div>
          <a-radio-group
            class="tts-engine-group"
            :value="readerSettings.ttsEngine"
            @change="e => setReaderSetting('ttsEngine', e.target.value)"
          >
            <a-radio-button value="browser">浏览器</a-radio-button>
            <a-radio-button value="edge">Edge TTS</a-radio-button>
            <a-radio-button value="volcengine">火山/豆包</a-radio-button>
            <a-radio-button value="aliyun">阿里百炼</a-radio-button>
            <a-radio-button value="azure">Azure</a-radio-button>
            <a-radio-button value="elevenlabs">ElevenLabs</a-radio-button>
            <a-radio-button value="cartesia">Cartesia</a-radio-button>
            <a-radio-button value="custom">自定义 API</a-radio-button>
          </a-radio-group>
          <div class="setting-block-inner" v-show="readerSettings.ttsEngine === 'browser'">
            <div class="setting-title small-title">发音人</div>
            <a-select
              style="width: 100%"
              :value="readerSettings.ttsVoice"
              @change="value => setReaderSetting('ttsVoice', value)"
            >
              <a-select-option value="">系统默认</a-select-option>
              <a-select-option v-for="voice in availableTtsVoices" :key="voice.voiceURI" :value="voice.voiceURI">
                {{ voice.name }} · {{ voice.lang }}
              </a-select-option>
            </a-select>
          </div>
          <div class="setting-block-inner" v-show="readerSettings.ttsEngine === 'edge'">
            <div class="setting-title small-title">Edge 音色</div>
            <a-select
              show-search
              style="width: 100%"
              :value="readerSettings.ttsEdgeVoice"
              @change="value => setReaderSetting('ttsEdgeVoice', value)"
            >
              <a-select-option v-for="voice in edgeTtsVoices" :key="voice.value" :value="voice.value">
                {{ voice.label }}
              </a-select-option>
            </a-select>
            <div class="setting-tip">Edge TTS 由 3100 服务合成 mp3；需要重启 3100 后生效。</div>
          </div>
          <div class="setting-block-inner" v-show="readerSettings.ttsEngine === 'volcengine'">
            <div class="tts-param-grid">
              <label class="setting-label">
                AppID
                <input
                  class="setting-input"
                  :value="readerSettings.ttsVolcAppId"
                  @input="e => setReaderSetting('ttsVolcAppId', e.target.value)"
                />
              </label>
              <label class="setting-label">
                Access Token
                <input
                  class="setting-input"
                  type="password"
                  :value="readerSettings.ttsVolcToken"
                  @input="e => setReaderSetting('ttsVolcToken', e.target.value)"
                />
              </label>
            </div>
            <div class="tts-param-grid">
              <label class="setting-label">
                Cluster
                <input
                  class="setting-input"
                  :value="readerSettings.ttsVolcCluster"
                  placeholder="volcano_tts"
                  @input="e => setReaderSetting('ttsVolcCluster', e.target.value)"
                />
              </label>
              <label class="setting-label">
                音色
                <input
                  class="setting-input"
                  :value="readerSettings.ttsVolcVoice"
                  placeholder="zh_female_xiaoxiao_moon_bigtts"
                  @input="e => setReaderSetting('ttsVolcVoice', e.target.value)"
                />
              </label>
            </div>
          </div>
          <div class="setting-block-inner" v-show="readerSettings.ttsEngine === 'aliyun'">
            <label class="setting-label">DashScope API Key</label>
            <input
              class="setting-input"
              type="password"
              :value="readerSettings.ttsAliApiKey"
              @input="e => setReaderSetting('ttsAliApiKey', e.target.value)"
            />
            <div class="tts-param-grid">
              <label class="setting-label">
                模型
                <input
                  class="setting-input"
                  :value="readerSettings.ttsAliModel"
                  placeholder="qwen3-tts-flash"
                  @input="e => setReaderSetting('ttsAliModel', e.target.value)"
                />
              </label>
              <label class="setting-label">
                音色
                <input
                  class="setting-input"
                  :value="readerSettings.ttsAliVoice"
                  placeholder="Cherry"
                  @input="e => setReaderSetting('ttsAliVoice', e.target.value)"
                />
              </label>
            </div>
            <label class="setting-label">朗读指令</label>
            <input
              class="setting-input"
              :value="readerSettings.ttsAliInstructions"
              placeholder="温柔自然地朗读小说旁白"
              @input="e => setReaderSetting('ttsAliInstructions', e.target.value)"
            />
          </div>
          <div class="setting-block-inner" v-show="readerSettings.ttsEngine === 'azure'">
            <div class="tts-param-grid">
              <label class="setting-label">
                Speech Key
                <input
                  class="setting-input"
                  type="password"
                  :value="readerSettings.ttsAzureKey"
                  @input="e => setReaderSetting('ttsAzureKey', e.target.value)"
                />
              </label>
              <label class="setting-label">
                Region
                <input
                  class="setting-input"
                  :value="readerSettings.ttsAzureRegion"
                  placeholder="eastasia"
                  @input="e => setReaderSetting('ttsAzureRegion', e.target.value)"
                />
              </label>
            </div>
            <label class="setting-label">音色</label>
            <input
              class="setting-input"
              :value="readerSettings.ttsAzureVoice"
              placeholder="zh-CN-XiaoxiaoNeural"
              @input="e => setReaderSetting('ttsAzureVoice', e.target.value)"
            />
          </div>
          <div class="setting-block-inner" v-show="readerSettings.ttsEngine === 'elevenlabs'">
            <div class="tts-param-grid">
              <label class="setting-label">
                API Key
                <input
                  class="setting-input"
                  type="password"
                  :value="readerSettings.ttsElevenKey"
                  @input="e => setReaderSetting('ttsElevenKey', e.target.value)"
                />
              </label>
              <label class="setting-label">
                Voice ID
                <input
                  class="setting-input"
                  :value="readerSettings.ttsElevenVoiceId"
                  @input="e => setReaderSetting('ttsElevenVoiceId', e.target.value)"
                />
              </label>
            </div>
            <label class="setting-label">模型</label>
            <input
              class="setting-input"
              :value="readerSettings.ttsElevenModel"
              placeholder="eleven_flash_v2_5"
              @input="e => setReaderSetting('ttsElevenModel', e.target.value)"
            />
          </div>
          <div class="setting-block-inner" v-show="readerSettings.ttsEngine === 'cartesia'">
            <div class="tts-param-grid">
              <label class="setting-label">
                API Key
                <input
                  class="setting-input"
                  type="password"
                  :value="readerSettings.ttsCartesiaKey"
                  @input="e => setReaderSetting('ttsCartesiaKey', e.target.value)"
                />
              </label>
              <label class="setting-label">
                Voice ID
                <input
                  class="setting-input"
                  :value="readerSettings.ttsCartesiaVoiceId"
                  @input="e => setReaderSetting('ttsCartesiaVoiceId', e.target.value)"
                />
              </label>
            </div>
            <div class="tts-param-grid">
              <label class="setting-label">
                模型
                <input
                  class="setting-input"
                  :value="readerSettings.ttsCartesiaModel"
                  placeholder="sonic-3"
                  @input="e => setReaderSetting('ttsCartesiaModel', e.target.value)"
                />
              </label>
              <label class="setting-label">
                语言
                <input
                  class="setting-input"
                  :value="readerSettings.ttsCartesiaLanguage"
                  placeholder="zh"
                  @input="e => setReaderSetting('ttsCartesiaLanguage', e.target.value)"
                />
              </label>
            </div>
          </div>
          <div class="setting-head compact">
            <span>语速</span>
            <em>{{ readerSettings.ttsRate }}x</em>
          </div>
          <a-slider
            :min="0.5"
            :max="3"
            :step="0.05"
            :value="readerSettings.ttsRate"
            @change="value => setReaderSetting('ttsRate', value)"
          />
          <div class="tts-param-grid">
            <div>
              <div class="setting-head compact">
                <span>音调</span>
                <em>{{ readerSettings.ttsPitch }}</em>
              </div>
              <a-slider
                :min="0"
                :max="2"
                :step="0.05"
                :value="readerSettings.ttsPitch"
                @change="value => setReaderSetting('ttsPitch', value)"
              />
            </div>
            <div>
              <div class="setting-head compact">
                <span>音量</span>
                <em>{{ readerSettings.ttsVolume }}</em>
              </div>
              <a-slider
                :min="0"
                :max="1"
                :step="0.05"
                :value="readerSettings.ttsVolume"
                @change="value => setReaderSetting('ttsVolume', value)"
              />
            </div>
          </div>
          <div class="tts-param-grid" v-show="readerSettings.ttsEngine !== 'browser'">
            <div>
              <div class="setting-head compact">
                <span>分段</span>
                <em>{{ readerSettings.ttsChunkLength }} 字</em>
              </div>
              <a-slider
                :min="120"
                :max="2000"
                :step="20"
                :value="readerSettings.ttsChunkLength"
                @change="value => setReaderSetting('ttsChunkLength', value)"
              />
            </div>
            <div>
              <div class="setting-head compact">
                <span>预加载</span>
                <em>{{ readerSettings.ttsPreloadCount }} 段</em>
              </div>
              <a-slider
                :min="0"
                :max="3"
                :step="1"
                :value="readerSettings.ttsPreloadCount"
                @change="value => setReaderSetting('ttsPreloadCount', value)"
              />
            </div>
          </div>
          <div class="setting-block-inner" v-show="readerSettings.ttsEngine === 'custom'">
            <label class="setting-label">API 地址</label>
            <input
              class="setting-input"
              :value="readerSettings.ttsApiUrl"
              placeholder="https://example.com/tts"
              @input="e => setReaderSetting('ttsApiUrl', e.target.value)"
            />
            <div class="tts-param-grid">
              <div>
                <div class="setting-title small-title">请求方式</div>
                <a-select
                  style="width: 100%"
                  :value="readerSettings.ttsApiMethod"
                  @change="value => setReaderSetting('ttsApiMethod', value)"
                >
                  <a-select-option value="POST">POST</a-select-option>
                  <a-select-option value="PUT">PUT</a-select-option>
                </a-select>
              </div>
            </div>
            <label class="setting-label">
              <input
                type="checkbox"
                :checked="readerSettings.ttsApiProxy"
                @change="e => setReaderSetting('ttsApiProxy', e.target.checked)"
              />
              使用服务器转发
            </label>
            <label class="setting-label">Headers JSON</label>
            <textarea
              class="setting-textarea"
              :value="readerSettings.ttsApiHeaders"
              @input="e => setReaderSetting('ttsApiHeaders', e.target.value)"
            ></textarea>
            <label class="setting-label">Body 模板</label>
            <textarea
              class="setting-textarea body-template"
              :value="readerSettings.ttsApiBody"
              @input="e => setReaderSetting('ttsApiBody', e.target.value)"
            ></textarea>
            <div class="tts-param-grid">
              <div>
                <div class="setting-title small-title">响应</div>
                <a-select
                  style="width: 100%"
                  :value="readerSettings.ttsApiResponse"
                  @change="value => setReaderSetting('ttsApiResponse', value)"
                >
                  <a-select-option value="audio">音频文件</a-select-option>
                  <a-select-option value="json-url">JSON 音频地址</a-select-option>
                  <a-select-option value="json-base64">JSON Base64</a-select-option>
                </a-select>
              </div>
              <div v-show="readerSettings.ttsApiResponse !== 'audio'">
                <label class="setting-label">音频字段</label>
                <input
                  class="setting-input"
                  :value="readerSettings.ttsApiAudioPath"
                  placeholder="audio / data.audio"
                  @input="e => setReaderSetting('ttsApiAudioPath', e.target.value)"
                />
              </div>
            </div>
            <label class="setting-label">音频 MIME</label>
            <input
              class="setting-input"
              :value="readerSettings.ttsApiAudioMime"
              placeholder="audio/mpeg"
              @input="e => setReaderSetting('ttsApiAudioMime', e.target.value)"
            />
          </div>
          <div class="setting-options">
            <a-button type="primary" :loading="ttsLoading" @click="startTts">
              <i class="ri-play-circle-line"></i>
              开始
            </a-button>
            <a-button @click="pauseTts">暂停</a-button>
            <a-button @click="resumeTts">继续</a-button>
            <a-button @click="stopTts">停止</a-button>
          </div>
          <div class="setting-tip">
            模板变量：&#123;&#123;text&#125;&#125;、&#123;&#123;jsonText&#125;&#125;、&#123;&#123;voice&#125;&#125;、&#123;&#123;rate&#125;&#125;、&#123;&#123;pitch&#125;&#125;、&#123;&#123;volume&#125;&#125;。
          </div>
        </div>

        <div class="settings-actions">
          <a-button @click="resetReaderSettings">恢复默认</a-button>
        </div>
      </div>
    </a-drawer>
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
import PerfectScrollbar from 'perfect-scrollbar'
import 'perfect-scrollbar/css/perfect-scrollbar.css'
import Paragraph from '../components/paragraph.vue'
import Catalog from '../components/catalog.vue'
import Picture from '../components/picture.vue'
import Tsukkomi from '../components/tsukkomi.vue'
import Tickets from '../components/tickets.vue'
import readerCorrectionMixin from '../mixins/reader-correction'
import readerNavigationMixin from '../mixins/reader-navigation'
import readerSettingsMixin from '../mixins/reader-settings'
import readerTtsMixin from '../mixins/reader-tts'
import { sanitizeHtml } from '../utils/sanitize-html'
import { cachedReaderUser } from '../utils/reader-session'
import { listOfflineBookChapters, pinOfflineChapter, rememberRecentChapter } from '../utils/reader-offline'

export default {
  name: 'Reader',
  mixins: [readerCorrectionMixin, readerNavigationMixin, readerSettingsMixin, readerTtsMixin],
  components: {
    Paragraph,
    Catalog,
    Picture,
    Tsukkomi,
    Tickets
  },
  data() {
    return {
      bid: null,
      cid: null,
      contentDiv: null,
      contentWidth: 0,
      controlBarLeftMargin: 0,
      loading: 0,
      loadError: '',
      chapterTitle: '',
      book_info: {},
      book_chapters: [],
      book_chapterids: [],
      chapterIndex: 0,
      chapter_info: {},
      chapterContentData: [],
      chapterDisplayContentData: [],
      chapterCache: Object.create(null),
      contentRequestId: 0,
      containerScroll: null,
      tsukkomi_num: 0,
      tsukkomi_list: [],
      showTsukkomi: false,
      tsukkomiRight: 0,
      tsukkomiPage: 1,
      tsukkomiScroll: null,
      tsukkomiIndex: 0,
      tempAvatar: defaultAvatarImage,
      cataMarginLeft: 0,
      auth: true,
      chapterAmount: 0,
      buyAmount: 0,
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
  async created() {
    this.bid = this.$route.query.bid
    this.cid = this.$route.query.cid
    if (this.cid === '[object Object]') this.cid = 0
    window.__cirnoCurrentBookId = this.bid
    const ownerId = String(cachedReaderUser()?.id || '')
    const offlineRows = () => (ownerId ? listOfflineBookChapters(ownerId, this.bid) : Promise.resolve([]))
    const hasInitialCid = !!this.cid && this.cid != 0
    const contentStarted = hasInitialCid
    if (hasInitialCid) {
      this.getContent(this.cid)
    }
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
      .then(res => res.data.chapter_list || [])
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
    let book_info
    let book_chapters
    try {
      ;[book_info, book_chapters] = await Promise.all([bookInfoPromise, chaptersPromise])
    } catch (error) {
      this.loading = -1
      this.loadError = error?.error || error?.message || '书籍信息与目录加载失败'
      return
    }
    this.book_info = book_info.data.book_info
    window.__cirnoCurrentBookTitle = this.book_info.book_name || this.bid
    this.book_chapters = book_chapters
    this.book_chapterids = this.book_chapters.map(chapter => {
      return chapter['chapter_id']
    })
    if (
      !this.cid ||
      this.isVolumeChapter(this.book_chapters.find(chapter => String(chapter.chapter_id) === String(this.cid)))
    ) {
      const firstCid = this.firstReadableChapterId()
      if (firstCid) {
        this.cid = firstCid
        this.$router.replace({ query: { bid: this.bid, cid: this.cid } })
        this.getContent(this.cid)
      }
    } else if (!contentStarted) {
      this.getContent(this.cid)
    }
    this.chapterIndex = this.book_chapterids.indexOf(this.cid)
    // if (this.cid == 0) {
    //   this.cid = this.book_chapterids[0]
    //   this.$router.replace({ query: { bid: this.bid, cid: this.cid } })
    // }
  },
  mounted() {
    this.contentDiv = this.$refs.contentContainer
    window.addEventListener('resize', this.windowSizeHandler)
  },
  beforeUnmount() {
    window.removeEventListener('resize', this.windowSizeHandler)
    this.flushReadingTime()
    if (this.containerScroll) this.containerScroll.destroy()
    if (this.tsukkomiScroll) this.tsukkomiScroll.destroy()
  },
  computed: {
    ...mapState(['prop_info', 'reader_info'])
  },
  methods: {
    async getContent(cid) {
      this.flushReadingTime()
      typeof cid === 'string' ? null : (cid = `${cid}`)
      const currentChapter = this.book_chapters.find(chapter => String(chapter.chapter_id) === String(cid))
      if (this.isVolumeChapter(currentChapter)) {
        const readableCid = this.nearestReadableChapterId(cid)
        if (!readableCid || String(readableCid) === String(cid)) return
        this.$router.replace({ query: { bid: this.bid, cid: readableCid } })
        return this.getContent(readableCid)
      }
      this.cid = cid
      this.loading = 0
      this.loadError = ''
      this.chapterIndex = this.book_chapterids.indexOf(cid)
      const requestId = ++this.contentRequestId
      const key = 'local-plain-text'
      let chapter_info
      try {
        chapter_info = await this.$get({
          url: '/chapter/get_cpt_ifm',
          urlParas: {
            book_id: this.bid,
            chapter_id: cid,
            chapter_command: key
          }
        })
      } catch (error) {
        if (requestId === this.contentRequestId && String(this.cid) === String(cid)) {
          this.loading = -1
          this.loadError = error?.error || error?.message || String(error || '章节加载失败')
        }
        return
      }
      if (requestId !== this.contentRequestId || String(this.cid) !== String(cid)) return
      if (chapter_info.data.chapter_info.is_local_plain) {
        chapter_info.data.chapter_info.txt_content = chapter_info.data.chapter_info.txt_content || ''
      } else {
        chapter_info.data.chapter_info.txt_content = await this.decrypt(chapter_info.data.chapter_info.txt_content, key)
      }
      if (requestId !== this.contentRequestId || String(this.cid) !== String(cid)) return
      this.chapter_info = chapter_info.data.chapter_info
      const ownerId = String(cachedReaderUser()?.id || '')
      if (ownerId && !this.chapter_info.is_volume) {
        rememberRecentChapter({
          ownerId,
          bookId: this.bid,
          bookTitle: this.book_info.book_name || window.__cirnoCurrentBookTitle || this.bid,
          chapterId: cid,
          chapterTitle: this.chapter_info.chapter_title,
          chapterOrder: currentChapter?.chapter_order || this.chapterIndex + 1,
          chapter: this.chapter_info
        }).catch(() => {})
      }
      if (this.chapter_info.auth_access == 1) {
        this.auth = true
        this.setLastRead()
        this.markReadingStart()
      } else {
        this.auth = false
      }
      this.chapterAmount = this.chapter_info.unit_hlb
      this.buyAmount = this.chapter_info.buy_amount
      this.chapterTitle = this.chapter_info.chapter_title
      let contentArray = []
      if (this.isIhuabenChapterInfo(this.chapter_info)) {
        contentArray = this.parseIhuabenHtml(this.chapter_info.html_content)
      } else {
        let txt_content = String(this.chapter_info.txt_content || '')
        let content_arr = txt_content.split(/\r?\n/)
        while (content_arr.length && content_arr[content_arr.length - 1].trim() === '') {
          content_arr.pop()
        }
        let author_say = String(this.chapter_info.author_say || '')
        let author_say_arr = author_say ? author_say.split(/\r?\n/) : []
        contentArray = [...content_arr, ...author_say_arr]
        contentArray = contentArray.map(ca => {
          let obj = {}
          obj.text = this.normalizeParagraphLine(ca)
          obj.tsukkomi_num = 0
          return obj
        })
      }
      this.chapterContentData = contentArray
      await this.rebuildChapterDisplayContent()
      if (requestId !== this.contentRequestId || String(this.cid) !== String(cid)) return
      this.loading = 1
      this.$nextTick(() => {
        this.windowSizeHandler()
        this.applyReaderTheme()
        if (this.containerScroll) {
          this.containerScroll.destroy()
          this.containerScroll = null
        }
        this.containerScroll = new PerfectScrollbar(this.$refs.book, {
          wheelSpeed: 2,
          wheelPropagation: true,
          minScrollbarLength: 20
        })
        this.refreshTsukkomiNums(cid, requestId)
      })
    },
    async refreshTsukkomiNums(cid, requestId) {
      const tsukkomiNums = await this.getTsukkomiNum(cid).catch(() => [])
      if (requestId !== this.contentRequestId || String(this.cid) !== String(cid) || !tsukkomiNums.length) return
      const contentArray = this.chapterContentData.slice()
      let changed = false
      for (let tsukkomiNum of tsukkomiNums) {
        let pIndex = tsukkomiNum['paragraph_index']
        if (pIndex < contentArray.length) {
          contentArray[pIndex] = Object.assign({}, contentArray[pIndex], { tsukkomi_num: tsukkomiNum.tsukkomi_num })
          changed = true
        }
      }
      if (!changed) return
      this.chapterContentData = contentArray
      await this.rebuildChapterDisplayContent()
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
    async getTsukkomiNum(cid) {
      typeof cid === 'string' ? null : (cid = `${cid}`)
      let tsukkomi_num_info = await this.$get({
        url: '/chapter/get_tsukkomi_num',
        urlParas: {
          chapter_id: cid
        }
      })
      return tsukkomi_num_info.data.tsukkomi_num_info
    },
    async getTsukkomiList(paragraph_index) {
      let tsukkomi_list = await this.$get({
        url: '/chapter/get_paragraph_tsukkomi_list_new',
        urlParas: {
          chapter_id: this.cid,
          paragraph_index: paragraph_index,
          count: 20,
          page: this.tsukkomiPage - 1
        }
      })
      this.tsukkomi_list = tsukkomi_list.data.tsukkomi_list
      this.$nextTick(() => {
        this.tsukkomiScroll = new PerfectScrollbar(this.$refs.tsukkomi, {
          wheelSpeed: 1,
          wheelPropagation: false,
          minScrollbarLength: 20
        })
      })
    },
    showTsu(index, num, page, noSkeleton) {
      this.tsukkomiIndex = index
      num ? (this.tsukkomi_num = parseInt(num)) : null
      page ? (this.tsukkomiPage = page) : (this.tsukkomiPage = 1)
      this.tsukkomiScroll ? this.tsukkomiScroll.destroy() : null
      if (!noSkeleton) {
        this.tsukkomi_list = []
        this.showTsukkomi = true
        this.toTsukkomiTop()
      }
      this.getTsukkomiList(index)
      this.$nextTick(() => {
        this.windowSizeHandler()
      })
    },
    closeTsu() {
      this.showTsukkomi = false
      this.toTsukkomiTop()
      this.$nextTick(() => {
        this.windowSizeHandler()
      })
    },
    changeTsukkomiPage(page) {
      this.showTsu(this.tsukkomiIndex, null, page)
    },
    showCatalog() {
      this.$refs.catalog.showCatalog()
    },
    async tsukkomiOperate(unlike, tsukkomi_id) {
      let url = ''
      if (unlike) {
        url = '/chapter/unlike_tsukkomi'
      } else {
        url = '/chapter/like_tsukkomi'
      }
      let result = await this.$get({
        url: url,
        urlParas: {
          tsukkomi_id: tsukkomi_id
        }
      })
      this.refreshTsukkomi()
    },
    refreshTsukkomi() {
      this.showTsu(this.tsukkomiIndex, this.tsukkomi_num, this.tsukkomiPage, true)
    },
    refreshPara(pid) {
      this.chapterContentData[pid].tsukkomi_num++
      this.tsukkomi_num++
    },
    newTsukkomi() {
      let text = this.chapterContentData[this.tsukkomiIndex].text
      this.$refs.tsukkomiWriter.show(text, this.bid, this.cid, this.tsukkomiIndex)
    },
    showPic(url) {
      this.$refs.picture.showPic(url)
    },
    async buyChapter() {
      let buy_result = await this.$get({
        url: '/chapter_buy',
        urlParas: {
          chapter_id: this.cid
        }
      })
      let prop_info = buy_result.data.prop_info
      let reader_info = buy_result.data.reader_info
      this.$store.commit('setPropInfo', prop_info)
      this.$store.commit('setReaderInfo', reader_info)
      this.getContent(this.cid)
    },
    giveTickets() {
      this.$refs.tickets.show(this.bid)
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
          chapterOrder: currentChapter?.chapter_order || this.chapterIndex + 1,
          chapter: this.chapter_info
        })
        this.$message.success('当前章节已保存，可离线打开')
      } catch (error) {
        this.$message.error(error?.message || '离线保存失败')
      }
    }
  }
}
</script>

<style lang="less" scoped>
@contentWidth: calc(~'100% - 288px');
.book-page {
  width: 100%;
  height: 100%;
  color: var(--reader-text-color);
  background: var(--reader-page-bg);
  overflow: hidden;
  position: relative;
  transition:
    background 0.2s ease,
    color 0.2s ease;
  .content-container {
    background: var(--reader-paper-bg);
    max-width: var(--reader-content-width);
    width: @contentWidth;
    min-height: 100%;
    margin: 0 auto;
    transition:
      max-width 0.2s ease,
      background 0.2s ease;
    .skeleton-container {
      padding: 0 64px;
      height: 72vh;
      display: flex;
      align-items: center;
    }
    .reader-error-state {
      min-height: 72vh;
      padding: 96px 32px;
      display: grid;
      place-content: center;
      justify-items: center;
      gap: 12px;
      text-align: center;
      color: var(--reader-muted-color);
      strong {
        color: var(--reader-text-color);
        font-size: 20px;
      }
      button {
        margin-top: 8px;
        padding: 9px 20px;
        border: 1px solid var(--reader-border-color);
        border-radius: 999px;
        color: var(--reader-text-color);
        background: var(--reader-paper-bg);
        cursor: pointer;
      }
    }
    .book-content {
      .top-bar {
        position: fixed;
        top: 0;
        z-index: 20;
        height: 73px;
        width: @contentWidth;
        max-width: var(--reader-content-width);
        color: var(--reader-text-color);
        background: var(--reader-topbar-bg);
        border-bottom: 1px solid var(--reader-border-color);
        display: flex;
        align-items: center;
        backdrop-filter: blur(12px);
        transition:
          max-width 0.2s ease,
          background 0.2s ease,
          border-color 0.2s ease;
        .icon-button {
          font-size: 24px;
          margin-left: 32px;
          cursor: pointer;
          color: var(--reader-text-color);
          opacity: 0.85;
        }
        .topbar-title {
          color: var(--reader-muted-color);
          font-size: 16px;
          font-weight: 500;
          line-height: 16px;
          margin-left: 16px;
          .offline-badge {
            margin-left: 6px;
            padding: 2px 7px;
            border-radius: 999px;
            color: #166534;
            background: #dcfce7;
            font-size: 11px;
            font-weight: 700;
          }
        }
      }
      .text-content {
        padding-top: 128px;
      }
      .custom-chapter-header {
        box-sizing: border-box;
        min-height: 340px;
        color: var(--reader-text-color);
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 28px;
        overflow: hidden;
      }
      .custom-chapter-header-empty {
        min-height: 232px;
        justify-content: flex-end;
      }
      .custom-header-art {
        flex: 0 1 48%;
        min-width: 0;
        height: 190px;
        display: flex;
        align-items: flex-end;
        justify-content: flex-start;
        pointer-events: none;
        img {
          display: block;
          max-width: 100%;
          max-height: 100%;
          width: auto;
          height: auto;
          object-fit: contain;
          filter: drop-shadow(0 14px 28px rgba(0, 0, 0, 0.1));
        }
      }
      .custom-header-copy {
        flex: 1 1 auto;
        min-width: 180px;
        max-width: 56%;
        margin-bottom: 16px;
        text-align: right;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
      }
      .custom-chapter-header-empty .custom-header-copy {
        max-width: 100%;
      }
      .custom-header-number {
        max-width: 100%;
        color: var(--reader-text-color);
        font-family:
          'Noto Serif SC',
          Songti SC,
          SimSun,
          serif;
        font-size: 48px;
        font-weight: 800;
        line-height: 1.08;
        letter-spacing: 0;
        overflow-wrap: anywhere;
      }
      .custom-header-name {
        max-width: 100%;
        margin-top: 12px;
        padding: 10px 22px;
        border-radius: 999px;
        color: #fff;
        background: rgba(35, 39, 46, 0.88);
        box-shadow: 0 12px 26px rgba(0, 0, 0, 0.12);
        font-size: 19px;
        font-weight: 700;
        line-height: 1.35;
        letter-spacing: 0;
        overflow-wrap: anywhere;
      }
      .custom-chapter-header-style1 {
        min-height: 390px;
        flex-direction: column;
        align-items: center;
        justify-content: flex-end;
        gap: 4px;
        .custom-header-art {
          flex: none;
          width: 100%;
          height: 230px;
          align-items: center;
          justify-content: center;
          img {
            width: 100%;
            max-width: 560px;
            max-height: 100%;
            object-fit: contain;
            filter: none;
          }
        }
        .custom-header-copy {
          max-width: 100%;
          min-width: 0;
          margin: 0;
          align-items: center;
          text-align: center;
        }
        .custom-header-number {
          color: var(--reader-muted-color);
          font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif;
          font-size: 18px;
          font-weight: 600;
          line-height: 1.3;
          text-align: center;
        }
        .custom-header-name {
          margin-top: 8px;
          padding: 0;
          border-radius: 0;
          color: var(--reader-accent-color);
          background: transparent;
          box-shadow: none;
          font-family: 'Noto Serif SC', 'Songti SC', SimSun, serif;
          font-size: 34px;
          font-weight: 700;
          line-height: 1.35;
          text-align: center;
        }
      }
      .text-content.text-content-custom-header {
        padding-top: 0;
      }
      .buy-container {
        position: absolute;
        bottom: 0;
        width: @contentWidth;
        max-width: var(--reader-content-width);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding-bottom: 36px;
        color: var(--reader-text-color);
        border-top: 1px solid var(--reader-border-color);
        background: var(--reader-paper-bg);
        z-index: 30;
        .title {
          font-size: 24px;
          padding: 36px 0 24px 0;
        }
        .subtitle {
          padding-bottom: 24px;
        }
        .buy-chapter-button {
          width: 400px;
          background-color: var(--reader-soft-bg);
          height: 60px;
          line-height: 60px;
          margin: 0 auto 24px;
          border-radius: 6px;
          text-align: center;
          font-size: 16px;
          font-weight: 500;
          color: var(--reader-accent-color);
          cursor: pointer;
        }
      }
      .book-footer {
        height: 164px;
        width: 100%;
        display: flex;
        gap: 16px;
        justify-content: center;
        align-items: flex-start;
        .chapter-nav-button {
          width: 192px;
          background-color: var(--reader-soft-bg);
          height: 60px;
          line-height: 60px;
          margin: 0 0 24px;
          border-radius: 6px;
          text-align: center;
          font-size: 16px;
          font-weight: 500;
          color: var(--reader-accent-color);
          cursor: pointer;
        }
        .prev-chapter-button {
          color: var(--reader-muted-color);
        }
      }
    }
    .tsukkomi-container {
      width: 400px;
      height: 100vh;
      position: fixed;
      padding-top: 90px;
      border-left: 1px solid var(--reader-border-color);
      top: 0;
      z-index: 16;
      color: var(--reader-text-color);
      background: var(--reader-paper-bg);
      .title-container {
        color: var(--reader-muted-color);
        display: flex;
        justify-content: space-between;
        border-bottom: 1px solid var(--reader-border-color);
        margin: 0 16px 0 16px;
        align-items: center;
        padding-bottom: 14px;
        .title-text {
          font-size: 12px;
          cursor: pointer;
        }
        .title-button {
          font-size: 14px;
          cursor: pointer;
        }
      }
      .tsukkomis {
        padding: 0 16px;
        height: calc(~'100vh - 128px');
        position: relative;
        overflow: hidden;
        .tsukkomi {
          display: flex;
          flex-direction: column;
          padding: 16px 0;
          border-bottom: 1px solid var(--reader-border-color);
          .tsukkomi-info {
            display: flex;
            align-items: center;
            .avatar {
              img {
                width: 45px;
                border-radius: 50%;
              }
            }
            .tsukkomi-info-text {
              margin-left: 16px;
              .user-name {
                font-size: 13px;
                font-weight: 700;
                line-height: 13px;
                display: block;
                margin-bottom: 8px;
                color: var(--reader-text-color);
              }
              .time {
                font-size: 13px;
                color: var(--reader-muted-color);
              }
            }
          }
          .tsukkomi-content {
            font-size: 14px;
            line-height: 22px;
            color: var(--reader-text-color);
            padding: 10px 0;
          }
          .tsukkomi-options {
            font-size: 14px;
            color: var(--reader-muted-color);
            display: flex;
            justify-content: flex-end;
            .option-button {
              display: flex;
              align-items: center;
              margin-right: 18px;
              cursor: pointer;
            }
            .like-selected {
              color: var(--reader-accent-color);
            }
            .unlike-selected {
              color: #f5222d;
            }
            :deep(.num) {
              padding-left: 6px;
              font-size: 13px;
            }
          }
        }
      }
      .pagination-container {
        width: 100%;
        display: flex;
        justify-content: center;
        padding: 18px 0;
        :deep(.ant-pagination-item) {
          border: none;
        }
      }
    }
  }
  .control-bar-container {
    width: 48px;
    position: fixed;
    bottom: 48px;
    flex-direction: column;
    .control-actions {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .control-button-container {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: var(--reader-control-bg);
      text-align: center;
      cursor: pointer;
      box-shadow: var(--reader-shadow);
      transition:
        background 0.2s ease,
        transform 0.2s ease,
        box-shadow 0.2s ease;
      .control-button {
        font-size: 24px;
        line-height: 48px;
        color: var(--reader-muted-color);
        opacity: 0.92;
      }
      &:hover {
        transform: translateY(-1px);
        .control-button {
          color: var(--reader-accent-color);
          opacity: 1;
        }
      }
    }
    .collapse-toggle {
      margin-top: 8px;
      background: var(--reader-soft-bg);
    }
    &.collapsed {
      .control-actions {
        display: none;
      }
      .collapse-toggle {
        margin-top: 0;
      }
    }
  }
  .content-bar {
    left: 50%;
    display: flex;
    justify-content: space-between;
  }
  .tsukkomi-bar {
    right: 50%;
    display: none;
    justify-content: flex-end;
  }
  .tsukkomi-bar-show {
    display: flex;
  }
  .correction-picker {
    position: fixed;
    z-index: 80;
    height: 36px;
    padding: 0 13px;
    border: 1px solid var(--reader-border-color);
    border-radius: 6px;
    color: var(--reader-paper-bg);
    background: var(--reader-accent-color);
    box-shadow: var(--reader-shadow);
    transform: translateX(-50%);
    font-size: 13px;
    font-weight: 700;
    line-height: 34px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    i {
      font-size: 16px;
    }
  }
}
.correction-dialog {
  label {
    display: block;
    margin: 12px 0 6px;
    color: #353c46;
    font-size: 13px;
    font-weight: 700;
  }
  .correction-tip {
    padding: 10px 12px;
    border: 1px solid #e8ddc8;
    border-radius: 6px;
    color: #6c553b;
    background: #fff8ea;
    font-size: 13px;
    line-height: 1.6;
  }
  .correction-count {
    margin-top: 8px;
    color: #4d7246;
    font-size: 12px;
    font-weight: 700;
    &.invalid {
      color: #a33a32;
    }
  }
}
.reader-settings {
  padding-bottom: 16px;
  .setting-block {
    padding-bottom: 22px;
    margin-bottom: 22px;
    border-bottom: 1px solid #eef0f4;
    .setting-title,
    .setting-head {
      font-size: 14px;
      font-weight: 600;
      color: #353c46;
      margin-bottom: 10px;
    }
    .setting-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      em {
        font-style: normal;
        font-size: 12px;
        font-weight: 600;
        color: #858c96;
      }
    }
    .setting-head.compact {
      margin-top: 8px;
      margin-bottom: 0;
    }
    .setting-block-inner {
      margin-top: 12px;
    }
    .small-title {
      margin-top: 0;
      margin-bottom: 6px;
      font-size: 13px;
    }
    .tts-engine-group {
      width: 100%;
      margin-bottom: 12px;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      :deep(.ant-radio-button-wrapper) {
        width: 100%;
        min-width: 0;
        height: auto;
        min-height: 40px;
        padding: 6px 8px;
        line-height: 1.2;
        white-space: normal;
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
        border-left: 1px solid #d9dde6;
        border-radius: 6px;
        box-sizing: border-box;
      }
      :deep(.ant-radio-button-wrapper:not(:first-child):before) {
        display: none;
      }
    }
    .tts-param-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-top: 10px;
    }
    .setting-label {
      display: block;
      margin: 10px 0 6px;
      font-size: 12px;
      font-weight: 700;
      color: #5e6570;
      input[type='checkbox'] {
        width: auto;
        margin-right: 6px;
      }
    }
    .setting-input,
    .setting-textarea {
      width: 100%;
      border: 1px solid #d9dde6;
      border-radius: 6px;
      padding: 8px 10px;
      color: #252c36;
      background: #fff;
      font: inherit;
      outline: none;
      &:focus {
        border-color: #1b88ee;
        box-shadow: 0 0 0 2px rgba(27, 136, 238, 0.12);
      }
    }
    .setting-textarea {
      min-height: 68px;
      resize: vertical;
      font-family: Consolas, 'Courier New', monospace;
      font-size: 12px;
      line-height: 1.45;
    }
    .setting-textarea.body-template {
      min-height: 126px;
    }
    .setting-options {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 12px;
    }
    .setting-tip {
      margin-top: 8px;
      font-size: 12px;
      color: #858c96;
      line-height: 1.6;
    }
    .custom-header-settings {
      margin-top: 12px;
    }
    .check-line {
      padding: 10px 12px;
      border: 1px solid #e4e8ef;
      border-radius: 8px;
      background: #f8fafc;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      input[type='checkbox'] {
        margin: 0;
      }
    }
    .custom-header-config {
      margin-top: 10px;
      padding: 12px;
      border: 1px solid #e4e8ef;
      border-radius: 8px;
      background: #fbfcfe;
    }
    .custom-header-upload {
      display: flex;
      align-items: center;
      gap: 8px;
      input[type='file'] {
        flex: 1 1 auto;
        min-width: 0;
        padding: 7px 8px;
        border: 1px solid #d9dde6;
        border-radius: 6px;
        color: #4c5663;
        background: #fff;
        font-size: 12px;
      }
    }
    .custom-header-preview {
      min-height: 116px;
      margin-top: 12px;
      padding: 14px;
      border: 1px solid #e3e7ee;
      border-radius: 8px;
      background: linear-gradient(135deg, #fff 0%, #f6f8fb 100%);
      display: grid;
      grid-template-columns: 116px minmax(0, 1fr);
      grid-template-rows: 1fr auto;
      align-items: end;
      gap: 8px 12px;
      overflow: hidden;
      img,
      span {
        grid-row: 1 / 3;
        width: 116px;
        height: 88px;
        border-radius: 6px;
      }
      img {
        object-fit: contain;
      }
      span {
        border: 1px dashed #cfd6e2;
        color: #8a929d;
        background: #fff;
        font-size: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      strong {
        min-width: 0;
        color: #252c36;
        font-family:
          'Noto Serif SC',
          Songti SC,
          SimSun,
          serif;
        font-size: 24px;
        font-weight: 800;
        line-height: 1.08;
        letter-spacing: 0;
        text-align: right;
        overflow-wrap: anywhere;
      }
      em {
        max-width: 100%;
        justify-self: end;
        padding: 6px 12px;
        border-radius: 999px;
        color: #fff;
        background: #252c36;
        font-size: 13px;
        font-style: normal;
        font-weight: 700;
        line-height: 1.25;
        letter-spacing: 0;
        overflow-wrap: anywhere;
      }
    }
    .custom-header-preview.style1 {
      background: #f3e6d4;
      img {
        border-radius: 0;
      }
      strong {
        color: #756b60;
        font-size: 15px;
        text-align: center;
      }
      em {
        padding: 0;
        border-radius: 0;
        color: #a80000;
        background: transparent;
        font-family: 'Noto Serif SC', 'Songti SC', SimSun, serif;
        font-size: 18px;
        text-align: center;
      }
    }
  }
  .setting-block:last-child {
    border-bottom: 0;
  }
  .theme-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
  }
  .theme-card {
    min-width: 0;
    height: 82px;
    padding: 8px;
    border: 1px solid #e4e8ef;
    border-radius: 8px;
    background: #fff;
    color: #353c46;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    align-items: stretch;
    text-align: left;
    transition:
      border-color 0.18s ease,
      box-shadow 0.18s ease,
      transform 0.18s ease;
    span:last-child {
      font-size: 12px;
      font-weight: 600;
      line-height: 1;
    }
  }
  .theme-card:hover,
  .theme-card.active {
    border-color: #1b88ee;
    box-shadow: 0 8px 24px rgba(27, 136, 238, 0.14);
    transform: translateY(-1px);
  }
  .theme-preview {
    height: 42px;
    border-radius: 6px;
    background: var(--preview-page);
    position: relative;
    overflow: hidden;
    border: 1px solid rgba(0, 0, 0, 0.06);
    i {
      position: absolute;
      left: 15%;
      top: 8px;
      width: 70%;
      height: 26px;
      border-radius: 4px;
      background: var(--preview-paper);
      box-shadow: 0 4px 10px rgba(0, 0, 0, 0.08);
    }
    b {
      position: absolute;
      left: 28%;
      top: 18px;
      width: 44%;
      height: 3px;
      border-radius: 999px;
      background: var(--preview-text);
      box-shadow: 0 7px 0 var(--preview-accent);
    }
  }
  .custom-theme-panel {
    margin-top: 12px;
    padding: 10px 12px;
    border-radius: 8px;
    background: #f7f9fc;
  }
  .color-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 8px 0;
    color: #4c5663;
    font-size: 13px;
    input[type='color'] {
      width: 58px;
      height: 32px;
      padding: 0;
      border: 1px solid #d9dfe8;
      border-radius: 6px;
      background: transparent;
      cursor: pointer;
    }
  }
  .slider-line {
    display: grid;
    grid-template-columns: 44px 1fr 44px;
    gap: 10px;
    align-items: center;
  }
  .setting-slider {
    margin: 0;
  }
  .two-column {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .settings-actions {
    display: flex;
    justify-content: flex-end;
  }
}

.book-page-tsu {
  .content-container {
    max-width: calc(~'var(--reader-content-width) + 400px');
    .book-content {
      max-width: var(--reader-content-width);
      .top-bar {
        max-width: calc(~'var(--reader-content-width) + 400px');
      }
    }
  }
}

@media (max-width: 820px) {
  .book-page {
    .content-container {
      width: 100%;
      max-width: 100%;
      .book-content {
        .top-bar,
        .buy-container {
          width: 100%;
          max-width: 100%;
        }
        .custom-chapter-header {
          min-height: 286px;
          gap: 16px;
        }
        .custom-chapter-header-empty {
          min-height: 214px;
        }
        .custom-header-art {
          flex-basis: 44%;
          height: 148px;
        }
        .custom-header-copy {
          min-width: 0;
          max-width: 60%;
          margin-bottom: 8px;
        }
        .custom-chapter-header-empty .custom-header-copy {
          max-width: 100%;
        }
        .custom-header-number {
          font-size: 34px;
        }
        .custom-header-name {
          padding: 8px 14px;
          font-size: 15px;
        }
      }
    }
    .control-bar-container {
      right: 16px;
      left: auto;
      margin-left: 0 !important;
    }
  }
  :deep(.ant-drawer-content-wrapper) {
    width: 100vw !important;
    max-width: 100vw !important;
  }
  :deep(.ant-drawer-header) {
    padding: 16px;
  }
  :deep(.ant-drawer-body) {
    padding: 16px;
    overflow-x: hidden;
  }
  .reader-settings {
    max-width: 100%;
    overflow-x: hidden;
    .setting-block {
      margin-bottom: 18px;
      padding-bottom: 18px;
    }
    .theme-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    .theme-card {
      min-width: 0;
    }
    .two-column {
      grid-template-columns: 1fr;
    }
    .slider-line {
      grid-template-columns: 40px minmax(0, 1fr) 40px;
      gap: 8px;
    }
    .settings-actions {
      justify-content: stretch;
      button {
        width: 100%;
      }
    }
    .custom-header-preview {
      grid-template-columns: 92px minmax(0, 1fr);
      img,
      span {
        width: 92px;
        height: 72px;
      }
      strong {
        font-size: 21px;
      }
    }
  }
}

@media (max-width: 420px) {
  .book-page {
    .content-container {
      .book-content {
        .custom-chapter-header {
          flex-direction: column;
          align-items: stretch;
          justify-content: flex-end;
          min-height: 316px;
        }
        .custom-chapter-header-empty {
          min-height: 218px;
        }
        .custom-header-art {
          flex: none;
          width: 100%;
          height: 126px;
          justify-content: center;
        }
        .custom-header-copy {
          max-width: 100%;
        }
      }
    }
  }
  .reader-settings {
    .theme-grid {
      grid-template-columns: 1fr;
    }
    .setting-block {
      .tts-param-grid {
        grid-template-columns: 1fr;
      }
      .custom-header-upload {
        flex-direction: column;
        align-items: stretch;
      }
    }
  }
}
</style>
