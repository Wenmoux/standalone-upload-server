# Cirno 阅读器繁简转换实现与测试流程

本文档用于维护 `cirno-src` 阅读器里的繁简转换逻辑，方便后续继续补词、定位残留和优化性能。

## 目标

- 阅读页支持 `原文`、`转简体`、`转繁体` 三种显示模式。
- 转换发生在前端阅读器展示层，不改数据库原文。
- 以 `opencc-js` 作为基础转换引擎，再叠加本地词表和保护规则修正网文场景里的混用、漏转、误转。
- 测试脚本必须能用 `cirno-src/test` 下的大文本反复验证，并生成汇总报告。

## 相关文件

- `src/utils/chinese-convert.js`
  - 核心转换实现。
  - 导出 `convertText(text, mode)`。
  - 维护本地繁简字符表、词组表、保护词和特殊规则。
- `src/views/Reader.vue`
  - 阅读设置面板提供 `繁简转换` 单选项。
  - `readerSettings.convertMode` 保存到 `localStorage` 的 `cirnoReaderSettings`。
- `src/components/paragraph.vue`
  - 引入 `convertText`。
  - 渲染段落时执行 `convertText(text, this.convertMode)`。
- `scripts/conversion-report.js`
  - 多轮全量测试和报告生成脚本。
- `test/*.txt`
  - 大文本测试样本目录。
- `test/conversion-summary-report.html`
  - 线框复古像素风 HTML 汇总报告。
- `test/conversion-summary-report.json`
  - 机器可读汇总结果，适合后续做 CI 阈值校验。

## 转换模式

`convertText(text, mode)` 支持：

- `none`：返回原文。
- `simplified`：繁体、繁简混排文本转简体。
- `traditional`：简体转繁体。

阅读器默认值是 `none`，用户在阅读设置里切换后即时生效。

## 转简体流程

`mode === 'simplified'` 时的顺序很重要：

1. `t2sPrePhraseMap`
   - 先处理高优先级短语。
   - 适合放“必须按语境转换”的词，例如：
     - `手機螢幕 -> 手机屏幕`
     - `支付介面 -> 支付界面`
     - `做著作業 -> 做着作业`
     - `强忍著作呕 -> 强忍着作呕`
   - 这一步发生在保护规则之前，用来拆掉容易被保护规则误判的短语。

2. `t2sProtectedPhraseMap` / `t2sProtectedPhraseRules`
   - 对不应该被继续转换的词打临时占位。
   - 典型场景是 `著`：
     - 应保留：`著名`、`名著`、`原著`、`猫主席著作`
     - 应转换：`背著书包 -> 背着书包`、`做著作業 -> 做着作业`
   - 保护后会用 `\ue000...\ue001` 占位，防止后续 OpenCC 和字符兜底误改。

3. `opencc-js`
   - 使用 `opencc-js/t2cn`，配置 `{ from: 'tw', to: 'cn' }`。
   - 负责主体繁简转换。

4. `t2sCharMap`
   - 本地字符兜底表。
   - 用于修正 OpenCC 未覆盖或本项目文本里高频残留的单字。

5. 恢复保护词
   - 将占位符恢复为保护后的词。

## 转繁体流程

`mode === 'traditional'` 时：

1. `s2tPrePhraseMap`
   - 先处理简转繁前置短语。
2. `opencc-js/cn2t`
   - 使用 `{ from: 'cn', to: 'tw' }`。
3. `s2tCharMap`
   - 由 `t2sCharMap` 反向生成，并补少量人工覆盖。
4. `s2tPostPhraseMap`
   - 后置修正，处理 OpenCC 结果里需要按中文语义调整的词。

## 规则维护原则

优先级建议：

1. 能用短语精确解决的，放 `t2sPrePhraseMap`。
2. 确定不应转换的名词、作品相关词，放保护词或保护规则。
3. 只有确认为单字残留且不会造成大面积误转时，才补 `t2sCharMap`。
4. 每次补规则都要加固定回归用例，避免以后回退。

特别注意 `著`：

- `著名`、`名著`、`原著`、`著作` 多数情况应保留。
- `做著作业`、`忍著作呕`、`起著作用`、`跟著作美` 这类是 `着 + 作...`，必须在前置短语里先转掉。
- 如果只扩大保护规则，很容易漏转；如果只扩大字符表，又容易把 `名著/著作` 改错。

## 测试流程

### 1. 准备样本

把待验证文本放到：

```powershell
cirno-src/test
```

支持扩展名：

- `.txt`
- `.md`
- `.text`

文本建议使用 UTF-8。报告里会统计 `U+FFFD` 替换符数量，用来发现编码读错或坏字符。

### 2. 快速跑一轮

用于补规则时快速定位问题：

```powershell
cd cirno-src
node scripts\conversion-report.js --rounds=1
```

### 3. 标准多轮测试

默认跑 5 轮：

```powershell
cd cirno-src
npm run test:convert
```

等价于：

```powershell
node scripts\conversion-report.js --rounds=5
```

可自定义轮数：

```powershell
node scripts\conversion-report.js --rounds=10
```

脚本最多限制 20 轮，避免误跑过久。

### 4. 查看报告
线框 像素风 汇总统计
报告输出：

```text
test/conversion-summary-report.html
test/conversion-summary-report.json
```

HTML 报告重点看：

- `Round Matrix`
  - 每轮是否稳定通过。
- `File Aggregate`
  - 每本书的字符数、残留数、段落/分片残留。
- `Global Lexicon`
  - `TOP BEFORE / ALL BOOKS`：转换前命中的高频繁体字汇总。
  - `RESIDUAL AFTER / ALL BOOKS`：转换后异常残留汇总。
  - `PROTECTED KEEP / ALL BOOKS`：保护性保留汇总。
  - `TERMS / PHRASES`：固定回归用例覆盖的词和用语。
- `Regression Cases`
  - 固定短句回归是否全通过。

当前报告只在有异常时展示残留样例；正常情况下不展开段落大表。

### 5. 通过标准

推荐标准：

- `after === 0`
- `residualParagraphs === 0`
- `residualWindows === 0`
- 固定回归全部通过
- `protectedAfter` 可以大于 0，但必须确认是应保留词，例如 `著名/名著/著作`

## 当前基准结果

最近一次 5 轮测试结果：

- 文本：5 本
- 总字符：9,755,396
- 段落：297,769
- 分片：6,100
- 转换前映射命中：1,860,536
- 转换后异常残留：0
- 段落残留：0
- 分片残留：0
- 保护性保留：99
- 固定回归：9/9
- 转换率：100%

## 定位和修复残留

建议流程：

1. 加入新文本到 `test`。
2. 跑一轮：

```powershell
node scripts\conversion-report.js --rounds=1
```

3. 打开 HTML 报告看 `RESIDUAL AFTER / ALL BOOKS`。
4. 如果残留是真错误：
   - 短语问题：优先补 `t2sPrePhraseMap`。
   - 应保留词：补保护词或保护规则，同时在测试报告脚本的 `PROTECTED_RESIDUAL_PATTERNS` 加入同样的识别。
   - 单字兜底：谨慎补 `t2sCharMap`。
5. 在 `REGRESSION_CASES` 增加一条固定用例。
6. 跑 5 轮：

```powershell
node scripts\conversion-report.js --rounds=5
```

7. 通过后再构建阅读器：

```powershell
npm run reader:build
```

如果本机 PowerShell/npm 因权限或子进程问题失败，可用：

```powershell
cmd /c npm run build:standalone
```

## 服务器正文全量扫描

本地 `test/*.txt` 适合验证固定样本，但不能覆盖服务器里新缓存的所有正文。服务器全量检测使用：

```powershell
cd cirno-src
node scripts\reader-api-conversion-scan.js --scan-id=reader-api-traditional-full --tag=繁體 --all --reset
```

这个脚本会读取 `server-pg` 的 Reader API：

1. 先调用 `/reader-api/search?tag=繁體` 获取书籍列表。
2. 只保留 `cache_count > 0` 的书，因为没有章节缓存就没有正文可扫。
3. 将本次书单冻结到：

```text
docs/conversion-scans/<scan-id>.manifest.json
```

4. 再按 manifest 逐本请求：

```text
/reader-api/books/:bookId/chapters?includeContent=1
```

5. 对每章正文执行 `convertText(raw, 'simplified')`。
6. 使用当前 `src/utils/chinese-convert.js` 的 `t2sCharMap` 动态生成检测字符表，扫描转换后的异常残留。
7. 在报告里记录转换器一致性：
   - 转换源文件：`src/utils/chinese-convert.js`
   - 转换源 SHA256
   - OpenCC 版本
   - `paragraph.vue` 是否 import 同一个 `convertText`
   - `paragraph.vue` 是否调用 `convertText(text, this.convertMode)`
   - `Reader.vue` 是否传入 `readerSettings.convertMode`
8. 生成：

```text
docs/conversion-scans/<scan-id>.html
docs/conversion-scans/<scan-id>.json
docs/conversion-scans/<scan-id>.md
docs/conversion-scans/<scan-id>.state.json
docs/conversion-scans/<scan-id>.manifest.json
```

`docs/conversion-scans/` 是生成产物目录，默认被 `.gitignore` 和 `.dockerignore` 排除；需要审计时重新运行脚本生成即可，不应随源码或 Docker build context 一起发布。

### 为什么要先冻结 manifest

旧的边翻页边扫描方式有一个风险：如果扫描过程中服务器新增书籍、缓存章节变化，分页排序可能移动，导致漏扫或重复扫。

现在的流程是：

- 第一阶段只拉书单，形成固定 manifest。
- 第二阶段只按 manifest 扫描正文。
- `--resume` 时继续同一份 manifest，不会因为服务器数据变化而改变本次扫描范围。

### 常用命令

只生成书单，不扫正文：

```powershell
node scripts\reader-api-conversion-scan.js --scan-id=reader-api-traditional-full --tag=繁體 --all --reset --manifest-only
```

从中断处继续：

```powershell
node scripts\reader-api-conversion-scan.js --scan-id=reader-api-traditional-full --tag=繁體 --all --resume
```

只扫前 10 本做 smoke：

```powershell
node scripts\reader-api-conversion-scan.js --scan-id=reader-api-traditional-smoke --tag=繁體 --books=10 --reset
```

控制请求间隔，避免压服务器：

```powershell
node scripts\reader-api-conversion-scan.js --scan-id=reader-api-traditional-full --tag=繁體 --all --resume --request-delay=200
```

限制每章最多保存多少残留命中：

```powershell
node scripts\reader-api-conversion-scan.js --scan-id=reader-api-traditional-full --tag=繁體 --all --resume --hit-limit-per-chapter=5
```

### 服务器扫描通过标准

推荐通过标准：

- `summary.afterHits === 0`
- `summary.residualChapters === 0`
- `summary.errors === 0`
- `regressions` 全部通过

`summary.protectedAfterHits` 可以大于 0，它表示 `著名/著作/名著/原著` 这类保护性保留，不算异常。

`summary.sameFormAfterHits` 也可以大于 0。它表示繁简同形或当前字表里的同形提示，例如 `阪` 常见于 `大阪`，不是简繁错误。报告会把它放在 `SAME-FORM NOTE`，只作为排查参考。

`summary.openccAuditHits` 是 OpenCC 二次偏好提示，不作为失败条件。原因是 OpenCC 的 `tw -> cn` 在某些词上会给出台式偏好差异，例如 `么 -> 幺`、`抬 -> 擡`，这不等价于阅读器简体转换错误。它只用于发现可疑词，再人工判断。

报告里的 `Converter Consistency` 必须显示 `MATCH`。如果不是 `MATCH`，说明检测脚本和阅读器实际渲染链路可能不一致，需要先修正脚本或阅读器引用关系，再讨论残留结果。

最近一次一致性 smoke：

- 转换源：`src/utils/chinese-convert.js`
- OpenCC：`1.3.0`
- `paragraph.vue` 引用同一个转换器：是
- `paragraph.vue` 使用 `convertText(text, this.convertMode)`：是
- `Reader.vue` 传入 `readerSettings.convertMode`：是
- 结论：`MATCH`

### 当前 smoke 验证

最近一次 smoke：

- 命令：`node scripts\reader-api-conversion-scan.js --scan-id=reader-api-scan-smoke --tag=繁體 --books=1 --resume`
- 书籍：1 本
- 章节：357
- 字符：901,838
- 转换前映射命中：216,251
- 转换后异常残留：0
- 保护性保留：7
- 错误：0

## 报告脚本设计

`scripts/conversion-report.js` 会做这些事：

- 递归读取 `test` 下所有文本。
- 每轮执行：
  - 固定回归用例。
  - 每本书完整转换。
  - 每段扫描。
  - 每 1600 字分片扫描。
  - 二次转换差异检查。
- 汇总多轮结果。
- 生成 HTML 和 JSON。

报告里 `PROTECTED KEEP` 不算异常残留；它用于提醒仍有被保护的繁体形态存在。

## 已知限制

- `opencc-js` 包体较大，当前构建里转换相关 chunk 约 1.85 MiB。
- 转换在前端渲染时执行，大章节首次切换可能有计算成本。
- 当前测试默认按 UTF-8 读取文本，对 GBK/Big5 源文件没有自动转码。
- `著` 这类语义消歧主要依赖短语规则，还不是通用自然语言判断。
- `traditional` 模式的测试覆盖少于 `simplified` 模式，后续需要补更多简转繁样本。

## 后续改善点

1. 动态加载转换模块
   - 只有用户选择 `转简体/转繁体` 时再加载 OpenCC chunk。
   - 可以降低默认阅读器首屏 JS 体积。

2. 段落级缓存
   - 以 `mode + text hash` 缓存转换结果。
   - 同章反复切换设置、滚动重渲染时减少重复计算。

3. Web Worker
   - 大章节转换放到 Worker，避免阻塞主线程。
   - 适合后续章节预转换、整章批量转换。

4. 规则外置
   - 把 `REGRESSION_CASES`、保护词、前置短语拆成 JSON。
   - 方便非代码维护和批量整理。

5. 编码探测
   - 对测试文本增加 GB18030/Big5 自动识别或显式参数。
   - 避免坏编码导致假残留。

6. CI 阈值
   - 使用 `conversion-summary-report.json` 做自动门禁。
   - 建议阈值：`after=0`、`residualParagraphs=0`、`residualWindows=0`、回归全通过。

7. 残留上下文导出
   - 当前正常报告不展开段落大表。
   - 可增加 `--debug` 参数，只在定位问题时输出详细上下文。

8. 简转繁测试补强
   - 目前重点是阅读页繁转简。
   - 后续应加入简转繁大文本样本和固定用例。

9. 用户侧体验
   - 切换繁简时可以增加轻量 loading。
   - 大章节可显示“正在转换本章文本”，避免用户误以为卡住。

10. 字典来源沉淀
   - 继续参考 OpenCC、Chinese_converter、zhconvert 等项目的词库思想。
   - 但本项目规则应以测试样本和阅读实际残留为准，不盲目导入超大词表。
