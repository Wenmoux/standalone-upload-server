<template>
  <div class="book-page" ref="book" :class="{ 'book-page-tsu': showTsukkomi }" :style="readerThemeStyle">
    <div class="content-container" ref="contentContainer" @mouseup="handleCorrectionSelection" @keyup="handleCorrectionSelection">
      <div v-show="loading === 1" class="book-content" ref="bookContent">
        <div class="top-bar">
          <i class="ri-arrow-left-line icon-button" @click="goBack"></i>
          <div class="topbar-title">{{ chapterTitle }}</div>
        </div>
        <div
          v-if="customChapterHeaderVisible"
          class="custom-chapter-header"
          :class="{ 'custom-chapter-header-empty': !customHeaderImageSrc }"
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
          <div class="title">
            本章是 VIP 章节，购买后才能阅读
          </div>
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
        <div class="control-button-container" @click="noAccess">
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
    <a-modal
      title="提交纠错"
      :open="correctionModalVisible"
      :mask-closable="false"
      @cancel="closeCorrectionModal"
    >
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
        <a-button type="primary" :loading="correctionSubmitting" :disabled="!correctionCanSubmit" @click="submitCorrection">
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
              @click="setReaderSetting('theme', item.value)"
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
            style="width:100%"
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
                <a-button size="small" @click="clearCustomHeaderImage">恢复默认仙鹤</a-button>
              </div>
              <div class="setting-tip">未选择自定义图片时使用内置仙鹤；自定义图片只保存在当前浏览器，不会上传服务器。</div>
              <div class="custom-header-preview" :class="{ empty: !customHeaderImageSrc }">
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
              style="width:100%"
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
              style="width:100%"
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
              <label class="setting-label">AppID<input class="setting-input" :value="readerSettings.ttsVolcAppId" @input="e => setReaderSetting('ttsVolcAppId', e.target.value)" /></label>
              <label class="setting-label">Access Token<input class="setting-input" type="password" :value="readerSettings.ttsVolcToken" @input="e => setReaderSetting('ttsVolcToken', e.target.value)" /></label>
            </div>
            <div class="tts-param-grid">
              <label class="setting-label">Cluster<input class="setting-input" :value="readerSettings.ttsVolcCluster" placeholder="volcano_tts" @input="e => setReaderSetting('ttsVolcCluster', e.target.value)" /></label>
              <label class="setting-label">音色<input class="setting-input" :value="readerSettings.ttsVolcVoice" placeholder="zh_female_xiaoxiao_moon_bigtts" @input="e => setReaderSetting('ttsVolcVoice', e.target.value)" /></label>
            </div>
          </div>
          <div class="setting-block-inner" v-show="readerSettings.ttsEngine === 'aliyun'">
            <label class="setting-label">DashScope API Key</label>
            <input class="setting-input" type="password" :value="readerSettings.ttsAliApiKey" @input="e => setReaderSetting('ttsAliApiKey', e.target.value)" />
            <div class="tts-param-grid">
              <label class="setting-label">模型<input class="setting-input" :value="readerSettings.ttsAliModel" placeholder="qwen3-tts-flash" @input="e => setReaderSetting('ttsAliModel', e.target.value)" /></label>
              <label class="setting-label">音色<input class="setting-input" :value="readerSettings.ttsAliVoice" placeholder="Cherry" @input="e => setReaderSetting('ttsAliVoice', e.target.value)" /></label>
            </div>
            <label class="setting-label">朗读指令</label>
            <input class="setting-input" :value="readerSettings.ttsAliInstructions" placeholder="温柔自然地朗读小说旁白" @input="e => setReaderSetting('ttsAliInstructions', e.target.value)" />
          </div>
          <div class="setting-block-inner" v-show="readerSettings.ttsEngine === 'azure'">
            <div class="tts-param-grid">
              <label class="setting-label">Speech Key<input class="setting-input" type="password" :value="readerSettings.ttsAzureKey" @input="e => setReaderSetting('ttsAzureKey', e.target.value)" /></label>
              <label class="setting-label">Region<input class="setting-input" :value="readerSettings.ttsAzureRegion" placeholder="eastasia" @input="e => setReaderSetting('ttsAzureRegion', e.target.value)" /></label>
            </div>
            <label class="setting-label">音色</label>
            <input class="setting-input" :value="readerSettings.ttsAzureVoice" placeholder="zh-CN-XiaoxiaoNeural" @input="e => setReaderSetting('ttsAzureVoice', e.target.value)" />
          </div>
          <div class="setting-block-inner" v-show="readerSettings.ttsEngine === 'elevenlabs'">
            <div class="tts-param-grid">
              <label class="setting-label">API Key<input class="setting-input" type="password" :value="readerSettings.ttsElevenKey" @input="e => setReaderSetting('ttsElevenKey', e.target.value)" /></label>
              <label class="setting-label">Voice ID<input class="setting-input" :value="readerSettings.ttsElevenVoiceId" @input="e => setReaderSetting('ttsElevenVoiceId', e.target.value)" /></label>
            </div>
            <label class="setting-label">模型</label>
            <input class="setting-input" :value="readerSettings.ttsElevenModel" placeholder="eleven_flash_v2_5" @input="e => setReaderSetting('ttsElevenModel', e.target.value)" />
          </div>
          <div class="setting-block-inner" v-show="readerSettings.ttsEngine === 'cartesia'">
            <div class="tts-param-grid">
              <label class="setting-label">API Key<input class="setting-input" type="password" :value="readerSettings.ttsCartesiaKey" @input="e => setReaderSetting('ttsCartesiaKey', e.target.value)" /></label>
              <label class="setting-label">Voice ID<input class="setting-input" :value="readerSettings.ttsCartesiaVoiceId" @input="e => setReaderSetting('ttsCartesiaVoiceId', e.target.value)" /></label>
            </div>
            <div class="tts-param-grid">
              <label class="setting-label">模型<input class="setting-input" :value="readerSettings.ttsCartesiaModel" placeholder="sonic-3" @input="e => setReaderSetting('ttsCartesiaModel', e.target.value)" /></label>
              <label class="setting-label">语言<input class="setting-input" :value="readerSettings.ttsCartesiaLanguage" placeholder="zh" @input="e => setReaderSetting('ttsCartesiaLanguage', e.target.value)" /></label>
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
                  style="width:100%"
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
                  style="width:100%"
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
import defaultCraneHeaderImage from '@/assets/reader-crane-header.png'
import { mapState } from 'vuex'
import PerfectScrollbar from 'perfect-scrollbar'
import 'perfect-scrollbar/css/perfect-scrollbar.css'
import Paragraph from '../components/paragraph.vue'
import Catalog from '../components/catalog.vue'
import Picture from '../components/picture.vue'
import Tsukkomi from '../components/tsukkomi.vue'
import Tickets from '../components/tickets.vue'
import { sanitizeHtml, sanitizeImageUrl } from '../utils/sanitize-html'
import {
  DEFAULT_READER_SETTINGS,
  EDGE_TTS_VOICES,
  READER_FONT_OPTIONS,
  READER_THEME_OPTIONS,
  cloneReaderSettings,
  normalizeReaderSettings as normalizeReaderSettingsValue
} from '../utils/reader-settings'
import {
  audioSourceFromBase64 as ttsAudioSourceFromBase64,
  buildTtsQueueFromParagraphs as buildReaderTtsQueue,
  cloudTtsSettings as collectCloudTtsSettings,
  isCloudTtsEngine,
  parseAudioFromJson as parseReaderTtsAudioFromJson,
  parseTtsHeaders as parseReaderTtsHeaders,
  renderTtsTemplate as renderReaderTtsTemplate,
  splitTtsText as splitReaderTtsText
} from '../utils/reader-tts'

let chineseConverterLoader = null
const CUSTOM_HEADER_CHAPTER_REGEX = /第\s*[0-9０-９零一二三四五六七八九十百千万两〇○壹贰叁肆伍陆柒捌玖拾佰仟]+\s*[章节回卷篇话节集]/i
const CUSTOM_HEADER_IMAGE_MAX_BYTES = 1.5 * 1024 * 1024

function isConversionMode(mode) {
  return mode === 'simplified' || mode === 'traditional'
}

function loadChineseConverter() {
  if (!chineseConverterLoader) {
    chineseConverterLoader = import('../utils/chinese-convert').then(module => module.convertText)
  }
  return chineseConverterLoader
}

export default {
  name: 'Reader',
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
      readerSettingsVisible: false,
      readerSettings: cloneReaderSettings(),
      themeOptions: READER_THEME_OPTIONS,
      fontOptions: READER_FONT_OPTIONS,
      edgeTtsVoices: EDGE_TTS_VOICES,
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
      chineseConvert: null,
      conversionRequestId: 0,
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
    const hasInitialCid = !!this.cid && this.cid != 0
    const contentStarted = hasInitialCid
    if (hasInitialCid) {
      this.getContent(this.cid)
    }
    const bookInfoPromise = this.$get({
      url: '/book/get_info_by_id',
      urlParas: { book_id: this.bid }
    })
    const chaptersPromise = this.$get({
      url: '/chapter/get_updated_chapter_by_division_id',
      urlParas: {
        division_id: this.bid,
        last_update_time: 0
      }
    }).then(res => res.data.chapter_list || [])
    let [book_info, book_chapters] = await Promise.all([bookInfoPromise, chaptersPromise])
    this.book_info = book_info.data.book_info
    this.book_chapters = book_chapters
    this.book_chapterids = this.book_chapters.map(chapter => {
      return chapter['chapter_id']
    })
    if (!this.cid || this.isVolumeChapter(this.book_chapters.find(chapter => String(chapter.chapter_id) === String(this.cid)))) {
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
    this.loadReaderSettings()
    this.contentDiv = this.$refs.contentContainer
    this.loadTtsVoices()
    if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = this.loadTtsVoices
    window.addEventListener('resize', this.windowSizeHandler)
  },
  beforeUnmount() {
    window.removeEventListener('resize', this.windowSizeHandler)
    if (window.speechSynthesis && window.speechSynthesis.onvoiceschanged === this.loadTtsVoices) {
      window.speechSynthesis.onvoiceschanged = null
    }
    this.stopTts()
    this.flushReadingTime()
    if (this.containerScroll) this.containerScroll.destroy()
    if (this.tsukkomiScroll) this.tsukkomiScroll.destroy()
  },
  watch: {
    contentWidth(newValue) {},
    'readerSettings.convertMode'(newValue, oldValue) {
      if (newValue === oldValue) return
      this.rebuildChapterDisplayContent()
    }
  },
  computed: {
    ...mapState(['prop_info', 'reader_info']),
    readerSettingsDrawerWidth() {
      return window.innerWidth <= 820 ? '100vw' : 430
    },
    readerPalette() {
      return this.getReaderPalette()
    },
    readerThemeStyle() {
      const palette = this.readerPalette
      return {
        '--reader-page-bg': palette.page,
        '--reader-paper-bg': palette.paper,
        '--reader-topbar-bg': palette.topbar,
        '--reader-text-color': palette.text,
        '--reader-muted-color': palette.muted,
        '--reader-border-color': palette.border,
        '--reader-soft-bg': palette.soft,
        '--reader-control-bg': palette.control,
        '--reader-accent-color': palette.accent,
        '--reader-shadow': palette.shadow,
        '--reader-content-width': `${this.readerSettings.contentWidth}px`
      }
    },
    readerTextColor() {
      return this.readerPalette.text
    },
    readerAccentColor() {
      return this.readerPalette.accent
    },
    currentThemeLabel() {
      const theme = this.themeOptions.find(item => item.value === this.readerSettings.theme)
      return theme ? theme.label : '默认'
    },
    customChapterHeaderVisible() {
      return !!this.readerSettings.customHeaderEnabled
    },
    customHeaderImageSrc() {
      const customImage = sanitizeImageUrl(this.readerSettings.customHeaderImage)
      return customImage || sanitizeImageUrl(defaultCraneHeaderImage)
    },
    customHeaderChapterNumber() {
      const override = String(this.readerSettings.customHeaderChapterLabel || '').trim()
      if (override) return override
      const match = String(this.chapterTitle || '').match(CUSTOM_HEADER_CHAPTER_REGEX)
      if (match) return match[0].replace(/\s+/g, '')
      const index = Number(this.chapterIndex)
      return index >= 0 ? `第${index + 1}章` : '章节'
    },
    customHeaderTitleText() {
      const override = String(this.readerSettings.customHeaderTitle || '').trim()
      if (override) return override
      const title = this.chapterTitleWithoutNumber(this.chapterTitle)
      return title || this.chapterTitle || this.book_info.book_name || this.book_info.title || '正文'
    },
    customChapterHeaderStyle() {
      const padding = Math.max(20, Math.min(120, Number(this.readerSettings.pagePadding || 72)))
      return {
        padding: `128px ${padding}px 28px`
      }
    },
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
    },
    ttsQuickIconClass() {
      return this.ttsPlaying || this.ttsLoading ? 'ri-volume-up-fill control-button' : 'ri-volume-up-line control-button'
    },
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
    normalizeReaderSettings(settings) {
      return normalizeReaderSettingsValue(settings, this.themeOptions)
    },
    getReaderPalette(themeValue) {
      const theme = themeValue || this.readerSettings.theme
      if (theme === 'custom') {
        return {
          page: this.readerSettings.customBg || DEFAULT_READER_SETTINGS.customBg,
          paper: this.readerSettings.customPaper || this.readerSettings.customBg || DEFAULT_READER_SETTINGS.customPaper,
          topbar: this.readerSettings.customPaper || DEFAULT_READER_SETTINGS.customPaper,
          text: this.readerSettings.customText || this.readerSettings.textColor || DEFAULT_READER_SETTINGS.customText,
          muted: this.readerSettings.customText || DEFAULT_READER_SETTINGS.customText,
          border: 'rgba(90, 75, 58, 0.2)',
          soft: this.readerSettings.customBg || DEFAULT_READER_SETTINGS.customBg,
          control: this.readerSettings.customPaper || DEFAULT_READER_SETTINGS.customPaper,
          accent: this.readerSettings.customAccent || DEFAULT_READER_SETTINGS.customAccent,
          shadow: '0 10px 30px rgba(0, 0, 0, 0.12)'
        }
      }
      const picked = this.themeOptions.find(item => item.value === theme) || this.themeOptions[0]
      return picked.colors
    },
    themePreviewStyle(item) {
      const palette = this.getReaderPalette(item.value)
      return {
        '--preview-page': palette.page,
        '--preview-paper': palette.paper,
        '--preview-text': palette.text,
        '--preview-accent': palette.accent
      }
    },
    chapterTitleWithoutNumber(value) {
      return String(value || '')
        .replace(CUSTOM_HEADER_CHAPTER_REGEX, '')
        .replace(/^[\s:：·.。-]+/, '')
        .replace(/[\s:：·.。-]+$/, '')
        .trim()
    },
    loadReaderSettings() {
      try {
        const saved = JSON.parse(localStorage.getItem('cirnoReaderSettings') || '{}')
        this.readerSettings = this.normalizeReaderSettings(saved)
      } catch (e) {}
      this.applyReaderTheme()
    },
    saveReaderSettings() {
      try {
        localStorage.setItem('cirnoReaderSettings', JSON.stringify(this.readerSettings))
      } catch (e) {
        this.$message.error('阅读设置保存失败，图片可能过大')
      }
      this.applyReaderTheme()
    },
    handleCustomHeaderImageUpload(event) {
      const file = event && event.target && event.target.files && event.target.files[0]
      if (!file) return
      if (!/^image\//i.test(file.type || '')) {
        this.$message.error('请选择图片文件')
        event.target.value = ''
        return
      }
      if (file.size > CUSTOM_HEADER_IMAGE_MAX_BYTES) {
        this.$message.error('头图请控制在 1.5MB 内')
        event.target.value = ''
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        this.setReaderSetting('customHeaderImage', String(reader.result || ''))
        this.$message.success('头图已更新')
      }
      reader.onerror = () => this.$message.error('图片读取失败')
      reader.readAsDataURL(file)
      event.target.value = ''
    },
    clearCustomHeaderImage() {
      this.setReaderSetting('customHeaderImage', '')
    },
    applyReaderTheme() {
      this.$nextTick(() => {
        this.updateReaderLayout()
      })
    },
    isPictureParagraph(text) {
      return /^\s*<img\b[\s\S]*>\s*$/.test(String(text || ''))
    },
    isIhuabenPlatform(value = '') {
      const normalized = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[\s_-]+/g, '')
      return normalized === 'ihuaben' || normalized === 'huaben' || normalized === '话本'
    },
    isIhuabenChapterInfo(info = {}) {
      return !!(
        info.is_ihuaben ||
        this.isIhuabenPlatform(info.platform) ||
        /hbu-chapter-style/i.test(String(info.html_content || ''))
      )
    },
    decodeHtmlText(value = '') {
      const textarea = document.createElement('textarea')
      textarea.innerHTML = String(value || '')
      return textarea.value
    },
    nodeTextContent(node) {
      return this.decodeHtmlText((node && (node.textContent || node.innerText)) || '')
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t\f\v]+/g, ' ')
        .trim()
    },
    absolutizeIhuabenImage(src = '') {
      const raw = String(src || '').trim()
      if (!raw) return ''
      if (/^\/\//.test(raw)) return sanitizeImageUrl(`${window.location.protocol}${raw}`)
      return sanitizeImageUrl(raw, 'https://www.ihuaben.com/')
    },
    htmlAttr(value = '') {
      return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
    },
    parseIhuabenParagraph(node) {
      const img = node.querySelector && node.querySelector('img')
      if (img) {
        const src = this.absolutizeIhuabenImage(img.getAttribute('src') || img.getAttribute('data-src') || '')
        const alt = this.decodeHtmlText(img.getAttribute('alt') || '图片').trim() || '图片'
        return src
          ? {
              type: 'ihuaben-image',
              text: `<img src="${this.htmlAttr(src)}" alt='${this.htmlAttr(alt)}'>`,
              displayText: alt,
              imageSrc: src,
              imageAlt: alt,
              tsukkomi_num: 0
            }
          : null
      }

      const speakerNode = node.querySelector && (node.querySelector('span a') || node.querySelector('i'))
      const speaker = this.nodeTextContent(speakerNode)
      if (speakerNode && speaker) {
        const fullText = this.nodeTextContent(node)
        const content = fullText.startsWith(speaker) ? fullText.slice(speaker.length).trim() : fullText
        const speakerTag = String(speakerNode.tagName || '').toLowerCase()
        return {
          type: 'ihuaben-dialogue',
          side: speakerTag === 'i' ? 'right' : 'left',
          speaker,
          text: content,
          displayText: content,
          tsukkomi_num: 0
        }
      }

      const text = this.nodeTextContent(node)
      if (!text) return null
      return {
        type: 'ihuaben-narration',
        text,
        displayText: text,
        tsukkomi_num: 0
      }
    },
    parseIhuabenHtml(html = '') {
      const wrapper = document.createElement('div')
      wrapper.innerHTML = sanitizeHtml(html || '')
      const paragraphs = Array.from(wrapper.querySelectorAll('p'))
      return paragraphs.map(node => this.parseIhuabenParagraph(node)).filter(Boolean)
    },
    normalizeParagraphLine(text) {
      const value = String(text || '')
      if (!value || this.isPictureParagraph(value)) return value
      return value.replace(/^[\s\u3000]+/, '')
    },
    async ensureChineseConverter() {
      if (this.chineseConvert) return this.chineseConvert
      this.chineseConvert = await loadChineseConverter()
      return this.chineseConvert
    },
    convertRawText(text, converter, mode) {
      const input = String(text || '')
      return converter && isConversionMode(mode) ? converter(input, mode) : input
    },
    convertParagraphText(text, converter, mode) {
      const input = this.normalizeParagraphLine(text)
      if (!input || this.isPictureParagraph(input)) return input
      return this.convertRawText(input, converter, mode)
    },
    async rebuildChapterDisplayContent() {
      const source = this.chapterContentData || []
      const mode = this.readerSettings.convertMode
      const requestId = ++this.conversionRequestId
      const converter = isConversionMode(mode) ? await this.ensureChineseConverter() : null
      if (requestId !== this.conversionRequestId) return
      source.forEach(item => {
        if (!item) return
        const displayText =
          item.type && String(item.type).indexOf('ihuaben-') === 0
            ? this.convertRawText(item.text || '', converter, mode)
            : this.convertParagraphText(item.text, converter, mode)
        if (Object.prototype.hasOwnProperty.call(item, 'displayText')) {
          item.displayText = displayText
        } else {
          item.displayText = displayText
        }
      })
      this.chapterDisplayContentData = source.slice()
      this.hideCorrectionPicker()
      this.$nextTick(() => {
        if (this.loading === 1) this.updateReaderLayout()
      })
    },
    setReaderSetting(key, value) {
      this.readerSettings = this.normalizeReaderSettings(Object.assign({}, this.readerSettings, { [key]: value }))
      this.saveReaderSettings()
    },
    setCustomReaderSetting(key, value) {
      this.readerSettings = this.normalizeReaderSettings(
        Object.assign({}, this.readerSettings, { [key]: value, theme: 'custom' })
      )
      this.saveReaderSettings()
    },
    stepReaderSetting(key, step, min, max) {
      const current = Number(this.readerSettings[key]) || 0
      this.setReaderSetting(key, Math.min(max, Math.max(min, current + step)))
    },
    resetReaderSettings() {
      this.readerSettings = cloneReaderSettings()
      this.saveReaderSettings()
      this.$message.success('阅读设置已恢复默认')
    },
    updateReaderLayout() {
      if (this.contentDiv) this.windowSizeHandler()
      if (this.containerScroll && this.containerScroll.update) this.containerScroll.update()
      if (this.tsukkomiScroll && this.tsukkomiScroll.update) this.tsukkomiScroll.update()
    },
    openReaderSettings() {
      this.readerSettingsVisible = true
    },
    charLength(value) {
      return Array.from(String(value || '')).length
    },
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
      const anchor = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement
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
    },
    getTtsText() {
      return (this.chapterDisplayContentData || []).map(item => item.displayText || item.text).join('\n')
    },
    getTtsParagraphText(index) {
      const item = this.chapterDisplayContentData[index]
      return ((item && (item.displayText || item.text)) || '').trim()
    },
    loadTtsVoices() {
      if (!window.speechSynthesis) return
      this.availableTtsVoices = window.speechSynthesis.getVoices() || []
    },
    splitTtsText(text) {
      return splitReaderTtsText(text, this.readerSettings.ttsChunkLength)
    },
    buildTtsQueueFromParagraphs() {
      return buildReaderTtsQueue(
        this.chapterContentData,
        index => this.getTtsParagraphText(index),
        this.readerSettings.ttsChunkLength
      )
    },
    scrollTtsParagraphIntoView(index) {
      this.activeTtsParagraphIndex = Number(index)
      this.$nextTick(() => {
        const root = this.$refs.book
        const el = this.$el.querySelector(`p[data-paragraph-index="${index}"]`)
        if (!root || !el) return
        const targetTop = Math.max(0, el.offsetTop - 130)
        root.scrollTo({ top: targetTop, behavior: 'smooth' })
        if (this.containerScroll && this.containerScroll.update) this.containerScroll.update()
      })
    },
    renderTtsTemplate(template, text) {
      return renderReaderTtsTemplate(template, text, this.readerSettings)
    },
    parseTtsHeaders() {
      return parseReaderTtsHeaders(this.readerSettings.ttsApiHeaders)
    },
    parseAudioFromJson(data) {
      return parseReaderTtsAudioFromJson(data, this.readerSettings.ttsApiAudioPath)
    },
    audioSourceFromBase64(value) {
      return ttsAudioSourceFromBase64(value, this.readerSettings.ttsApiAudioMime)
    },
    async requestCustomTtsAudio(text) {
      const url = String(this.readerSettings.ttsApiUrl || '').trim()
      if (!url) throw new Error('请先填写 TTS API 地址')
      const headers = this.parseTtsHeaders()
      const body = this.renderTtsTemplate(this.readerSettings.ttsApiBody, text)
      const request = {
        method: this.readerSettings.ttsApiMethod || 'POST',
        headers,
        body
      }
      const response = this.readerSettings.ttsApiProxy
        ? await fetch('/reader-api/tts/proxy', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, responseType: this.readerSettings.ttsApiResponse, ...request })
          })
        : await fetch(url, request)
      if (!response.ok) throw new Error(`TTS API HTTP ${response.status}`)
      if (this.readerSettings.ttsApiResponse === 'audio') {
        const blob = await response.blob()
        if (!blob.size) throw new Error('TTS API 返回了空音频')
        return URL.createObjectURL(blob)
      }
      const data = await response.json()
      const audio = this.parseAudioFromJson(data)
      if (this.readerSettings.ttsApiResponse === 'json-url') {
        if (/^(https?:|blob:|data:)/i.test(audio)) return audio
        return new URL(audio, url).toString()
      }
      return this.audioSourceFromBase64(audio)
    },
    async requestEdgeTtsAudio(text) {
      const response = await fetch('/reader-api/tts/edge', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          voice: this.readerSettings.ttsEdgeVoice,
          rate: this.readerSettings.ttsRate,
          pitch: this.readerSettings.ttsPitch,
          volume: this.readerSettings.ttsVolume
        })
      })
      const contentType = response.headers.get('content-type') || ''
      if (!response.ok) {
        if (contentType.includes('application/json')) {
          const data = await response.json().catch(() => ({}))
          throw new Error(data.error || `Edge TTS HTTP ${response.status}`)
        }
        throw new Error(`Edge TTS HTTP ${response.status}`)
      }
      const blob = await response.blob()
      if (!blob.size) throw new Error('Edge TTS 返回了空音频')
      return URL.createObjectURL(blob)
    },
    cloudTtsSettings() {
      return collectCloudTtsSettings(this.readerSettings)
    },
    async requestCloudTtsAudio(text) {
      const response = await fetch('/reader-api/tts/provider', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: this.readerSettings.ttsEngine,
          text,
          rate: this.readerSettings.ttsRate,
          pitch: this.readerSettings.ttsPitch,
          volume: this.readerSettings.ttsVolume,
          settings: this.cloudTtsSettings()
        })
      })
      const contentType = response.headers.get('content-type') || ''
      if (!response.ok) {
        if (contentType.includes('application/json')) {
          const data = await response.json().catch(() => ({}))
          throw new Error(data.error || `云 TTS HTTP ${response.status}`)
        }
        throw new Error(`云 TTS HTTP ${response.status}`)
      }
      const blob = await response.blob()
      if (!blob.size) throw new Error('云 TTS 返回了空音频')
      return URL.createObjectURL(blob)
    },
    requestQueuedTtsAudio(text) {
      if (this.readerSettings.ttsEngine === 'edge') return this.requestEdgeTtsAudio(text)
      if (isCloudTtsEngine(this.readerSettings.ttsEngine)) {
        return this.requestCloudTtsAudio(text)
      }
      return this.requestCustomTtsAudio(text)
    },
    prefetchQueuedTtsAudio(text) {
      return this.requestQueuedTtsAudio(text).then(
        src => ({ ok: true, src }),
        error => ({ ok: false, error })
      )
    },
    ensureTtsPrefetchWindow(startIndex = this.ttsQueueIndex) {
      if (this.ttsStopped) return
      const preload = Math.max(0, Math.min(3, Number(this.readerSettings.ttsPreloadCount || 0)))
      const start = Math.max(0, Number(startIndex || 0))
      const end = Math.min(this.ttsQueue.length - 1, start + preload)
      for (let i = start; i <= end; i++) {
        if (!this.ttsPrefetchMap[i]) {
          this.ttsPrefetchMap[i] = this.prefetchQueuedTtsAudio(this.ttsQueue[i])
        }
      }
    },
    async getPrefetchedTtsSource(index) {
      if (!this.ttsPrefetchMap[index]) this.ttsPrefetchMap[index] = this.prefetchQueuedTtsAudio(this.ttsQueue[index])
      const fetched = await this.ttsPrefetchMap[index]
      delete this.ttsPrefetchMap[index]
      if (!fetched || !fetched.ok) throw (fetched && fetched.error) || new Error('TTS 预加载失败')
      return fetched.src
    },
    clearTtsPrefetchMap() {
      Object.values(this.ttsPrefetchMap || {}).forEach(promise => {
        Promise.resolve(promise).then(result => {
          if (result && result.ok && result.src && result.src.startsWith('blob:')) URL.revokeObjectURL(result.src)
        })
      })
      this.ttsPrefetchMap = {}
    },
    playAudioSource(src) {
      return new Promise((resolve, reject) => {
        this.revokeTtsAudioUrl()
        this.ttsAudioUrl = src && src.startsWith('blob:') ? src : ''
        this.ttsAudio = new Audio(src)
        this.ttsAudio.volume = Number(this.readerSettings.ttsVolume || 1)
        this.ttsAudio.onended = () => resolve()
        this.ttsAudio.onerror = () => reject(new Error('音频播放失败'))
        this.ttsAudio.play().catch(reject)
      })
    },
    revokeTtsAudioUrl() {
      if (this.ttsAudioUrl) {
        URL.revokeObjectURL(this.ttsAudioUrl)
        this.ttsAudioUrl = ''
      }
    },
    async playCustomTtsQueue() {
      this.ttsLoading = true
      try {
        this.ensureTtsPrefetchWindow()
        while (!this.ttsStopped && this.ttsQueueIndex < this.ttsQueue.length) {
          const meta = this.ttsQueueMeta[this.ttsQueueIndex] || {}
          if (meta.paragraphIndex !== undefined) this.scrollTtsParagraphIntoView(meta.paragraphIndex)
          const src = await this.getPrefetchedTtsSource(this.ttsQueueIndex)
          this.ensureTtsPrefetchWindow(this.ttsQueueIndex + 1)
          this.ttsLoading = false
          this.ttsPlaying = true
          await this.playAudioSource(src)
          this.ttsQueueIndex += 1
          this.ensureTtsPrefetchWindow()
          this.ttsLoading = this.ttsQueueIndex < this.ttsQueue.length && !!this.ttsPrefetchMap[this.ttsQueueIndex]
        }
      } catch (error) {
        if (!this.ttsStopped) this.$message.error(error.message || String(error || 'TTS 播放失败'))
      } finally {
        this.ttsLoading = false
        this.ttsPlaying = false
        if (!this.ttsStopped) this.activeTtsParagraphIndex = -1
        this.clearTtsPrefetchMap()
      }
    },
    startTts() {
      this.stopTts()
      const queue = this.buildTtsQueueFromParagraphs()
      const text = queue.chunks.join('\n')
      if (!queue.chunks.length || !text.trim()) {
        this.$message.warn('当前章节没有可朗读文本')
        return
      }
      this.ttsQueueMeta = queue.meta
      if (this.readerSettings.ttsEngine === 'custom' || this.readerSettings.ttsEngine === 'edge' || isCloudTtsEngine(this.readerSettings.ttsEngine)) {
        this.ttsStopped = false
        this.ttsQueue = queue.chunks
        this.ttsQueueIndex = 0
        this.playCustomTtsQueue()
        return
      }
      if (!window.speechSynthesis) {
        this.$message.error('当前浏览器不支持 TTS')
        return
      }
      this.loadTtsVoices()
      this.ttsUtterance = new SpeechSynthesisUtterance(text)
      this.ttsUtterance.lang = 'zh-CN'
      this.ttsUtterance.rate = Number(this.readerSettings.ttsRate) || 1
      this.ttsUtterance.pitch = Number(this.readerSettings.ttsPitch) || 1
      this.ttsUtterance.volume = Number(this.readerSettings.ttsVolume)
      const voice = this.availableTtsVoices.find(item => item.voiceURI === this.readerSettings.ttsVoice)
      if (voice) this.ttsUtterance.voice = voice
      this.ttsUtterance.onstart = () => {
        this.ttsPlaying = true
        this.scrollTtsParagraphIntoView(0)
      }
      this.ttsUtterance.onboundary = event => {
        if (event.name !== 'sentence' && event.name !== 'word') return
        const prefix = text.slice(0, event.charIndex || 0)
        let passed = 0
        for (let i = 0; i < this.chapterContentData.length; i++) {
          const pText = this.getTtsParagraphText(i)
          passed += this.charLength(pText) + 1
          if (prefix.length <= passed) {
            if (this.activeTtsParagraphIndex !== i) this.scrollTtsParagraphIntoView(i)
            break
          }
        }
      }
      this.ttsUtterance.onend = () => {
        this.ttsPlaying = false
        this.activeTtsParagraphIndex = -1
      }
      window.speechSynthesis.speak(this.ttsUtterance)
    },
    pauseTts() {
      if (window.speechSynthesis) window.speechSynthesis.pause()
      if (this.ttsAudio) this.ttsAudio.pause()
    },
    resumeTts() {
      if (window.speechSynthesis) window.speechSynthesis.resume()
      if (this.ttsAudio) this.ttsAudio.play().catch(() => {})
    },
    stopTts() {
      this.ttsStopped = true
      this.clearTtsPrefetchMap()
      if (window.speechSynthesis) window.speechSynthesis.cancel()
      if (this.ttsAudio) {
        this.ttsAudio.pause()
        this.ttsAudio.src = ''
        this.ttsAudio = null
      }
      this.ttsQueue = []
      this.ttsQueueMeta = []
      this.ttsQueueIndex = 0
      this.ttsLoading = false
      this.ttsPlaying = false
      this.activeTtsParagraphIndex = -1
      this.revokeTtsAudioUrl()
    },
    toggleTtsQuick() {
      if (this.ttsPlaying || this.ttsLoading) {
        this.stopTts()
        this.$message.info('朗读已停止')
      } else {
        this.startTts()
      }
    },
    toggleConvertModeQuick() {
      const order = ['none', 'simplified', 'traditional']
      const current = order.indexOf(this.readerSettings.convertMode)
      const next = order[(current + 1) % order.length]
      this.setReaderSetting('convertMode', next)
      const label = { none: '原文', simplified: '简体', traditional: '繁体' }[next]
      this.$message.success(`繁简转换：${label}`)
    },
    windowSizeHandler() {
      if (!this.contentDiv) return
      let windowWidth = window.innerWidth
      let contentWidth = this.contentDiv.clientWidth
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
      this.chapterIndex = this.book_chapterids.indexOf(cid)
      const requestId = ++this.contentRequestId
      const key = 'local-plain-text'
      let chapter_info = await this.$get({
        url: '/chapter/get_cpt_ifm',
        urlParas: {
          book_id: this.bid,
          chapter_id: cid,
          chapter_command: key
        }
      })
      if (requestId !== this.contentRequestId || String(this.cid) !== String(cid)) return
      if (chapter_info.data.chapter_info.is_local_plain) {
        chapter_info.data.chapter_info.txt_content = chapter_info.data.chapter_info.txt_content || ''
      } else {
        chapter_info.data.chapter_info.txt_content = await this.decrypt(chapter_info.data.chapter_info.txt_content, key)
      }
      if (requestId !== this.contentRequestId || String(this.cid) !== String(cid)) return
      this.chapter_info = chapter_info.data.chapter_info
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
    toChapterTop() {
      this.$refs.book.scrollTo(0, 0)
    },
    toTsukkomiTop() {
      this.$refs.tsukkomi.scrollTo(0, 0)
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
    switchChapter(cid) {
      this.showTsukkomi = false
      this.loading = 0
      this.toChapterTop()
      this.toTsukkomiTop()
      this.containerScroll ? this.containerScroll.destroy() : null
      this.tsukkomiScroll ? this.tsukkomiScroll.destroy() : null
      this.getContent(cid)
      this.$router.replace({ query: { bid: this.bid, cid: cid } })
    },
    prevChapter() {
      const prevCid = this.prevReadableChapterId()
      if (prevCid) {
        this.switchChapter(prevCid)
      } else {
        this.$message.error('已经是第一章了')
      }
    },
    nextChapter() {
      const nextCid = this.nextReadableChapterId()
      if (nextCid) {
        this.switchChapter(nextCid)
      } else {
        this.$message.error('已经是最后一章了')
      }
    },
    jumpChapter(cid) {
      const targetChapter = this.book_chapters.find(chapter => String(chapter.chapter_id) === String(cid))
      if (this.isVolumeChapter(targetChapter)) return
      this.showTsukkomi = false
      this.loading = 0
      this.toChapterTop()
      this.toTsukkomiTop()
      this.containerScroll ? this.containerScroll.destroy() : null
      this.getContent(cid)
      this.$router.replace({ query: { bid: this.bid, cid: cid } })
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
    noAccess() {
      this.$message.info('此功能尚未开放')
    },
    goBack() {
      this.$router.back()
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
  transition: background 0.2s ease, color 0.2s ease;
  .content-container {
    background: var(--reader-paper-bg);
    max-width: var(--reader-content-width);
    width: @contentWidth;
    min-height: 100%;
    margin: 0 auto;
    transition: max-width 0.2s ease, background 0.2s ease;
    .skeleton-container {
      padding: 0 64px;
      height: 72vh;
      display: flex;
      align-items: center;
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
        transition: max-width 0.2s ease, background 0.2s ease, border-color 0.2s ease;
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
        font-family: 'Noto Serif SC', Songti SC, SimSun, serif;
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
            :deep(.num ){
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
        :deep(.ant-pagination-item ){
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
      transition: background 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
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
      :deep(.ant-radio-button-wrapper ){
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
      :deep(.ant-radio-button-wrapper:not(:first-child):before ){
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
        font-family: 'Noto Serif SC', Songti SC, SimSun, serif;
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
    transition: border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease;
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
  :deep(.ant-drawer-content-wrapper ){
    width: 100vw !important;
    max-width: 100vw !important;
  }
  :deep(.ant-drawer-header ){
    padding: 16px;
  }
  :deep(.ant-drawer-body ){
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
