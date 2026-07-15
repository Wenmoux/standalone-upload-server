<!--
 * [INPUT]: 依赖 reader-settings-panel.js 的组件契约、reader-settings-panel.less 的局部样式及 Ant Design Vue 表单控件
 * [OUTPUT]: 对外提供 ReaderSettingsPanel 阅读设置抽屉，并以语义事件提交设置、TTS 与章头操作
 * [POS]: Reader components 的设置交互边界，只负责展示与采集输入，不持久化设置也不编排朗读引擎
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 -->
<template>
  <a-drawer
    title="阅读设置"
    placement="right"
    root-class-name="reader-settings-drawer"
    :width="readerSettingsDrawerWidth"
    :open="readerSettingsVisible"
    @close="$emit('close')"
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
        <a-radio-group :value="readerSettings.titleStyle" @change="e => setReaderSetting('titleStyle', e.target.value)">
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
</template>

<script src="./reader-settings-panel.js"></script>

<style src="../styles/reader-settings-panel.less" lang="less" scoped></style>
