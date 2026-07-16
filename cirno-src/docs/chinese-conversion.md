# Reader 繁简转换

本文说明 Reader 展示层的繁简转换边界、用户词表语义和验证门禁。转换只改变当前浏览器里的显示文本，不回写数据库正文。

## 用户能力

阅读设置提供三种显示模式：

- `原文`：不转换，默认值。
- `简体`：台湾繁体或混排正文转为大陆简体。
- `繁体`：简体正文转为台湾繁体。

选择“简体”后还可以配置：

- `台湾用语转大陆用语`：默认开启；开启时使用 OpenCC `twp -> cn`，关闭时使用 `tw -> cn`。
- `自定义词表`：每行一个 `原词=>目标`。原词可写繁体或简体；`乾坤=>乾坤` 这类同值规则用于保护专名。

词表最多持久化 20,000 个字符。输入后延迟 250ms 重建当前章，避免每次按键都转换整章。

## 运行边界

```text
Reader.vue
  -> reader-settings mixin
     -> reader-content 正文归一化
        -> chinese-convert 唯一转换事实源
           -> opencc-js
```

相关文件：

- `src/utils/chinese-convert.js`：转换内核，导出 `convertText`、`t2sCharMap` 和 `s2tCharMap`。
- `src/utils/reader-content.js`：把转换选项传入普通文本和段落转换。
- `src/utils/reader-settings.js`：设置默认值、归一化和持久化数据形状。
- `src/mixins/reader-settings.js`：动态加载转换器、监听设置并重建当前章。
- `src/views/Reader.vue`：只呈现设置控件，不复制转换规则。
- `scripts/conversion-report-analyzer.js`：复用生产转换器运行固定回归、正文扫描和多轮统计。
- `scripts/conversion-report-renderer.js`：把结构化统计纯渲染为 HTML 与 JSON。
- `scripts/conversion-report.js`：稳定 CLI 组合根，写入报告并根据汇总结果设置退出码。
- `test/conversion-summary-report.html`、`test/conversion-summary-report.json`：人工与机器可读报告。
- `tests/chinese-convert.test.js`：转换语义、碰撞安全和实现收缩的根级回归。

## API 契约

```js
convertText(text, mode, options)
```

`mode`：

- `none`
- `simplified`
- `traditional`

`options` 只影响 `simplified`：

```js
{
  twPhrases: true,
  glossary: '龍傲天=>龙傲天\n乾坤=>乾坤'
}
```

空文本、未知模式和 `none` 原样返回。函数必须满足幂等性：简体结果再次转简体不得变化。

## 繁转简管线

顺序是语义的一部分，不能随意交换：

1. 根据 `twPhrases` 选择 OpenCC `twp -> cn` 或 `tw -> cn`。
2. 台湾用语模式开启时，先处理项目兼容词和 `做著作業` 一类粒子歧义。
3. 规范化用户词表，使简体键也能匹配繁体正文。
4. 保护原著、名著、著作等内置语义词和用户专名。
5. 从未出现在原文里的私用区字符对中动态选择占位符，避免正文自带 `U+E000/U+E001` 时发生碰撞。
6. 在 OpenCC 前后各执行一次小型残留字兜底。
7. 后置修正 `显著/著称/什么` 等 OpenCC 歧义结果。
8. 恢复保护词。

项目只保留不足 50 项的真实残留字表。主体转换由 OpenCC 负责，不再维护约 2,400 字的平行字典，也不再缓存 800 篇完整正文。词组替换预编译为单个正则扫描，避免对每条规则反复遍历全文。

### “著/着”边界

必须同时覆盖两类相反语义：

- 保留：`显著`、`著称`、`原著`、`编著`、`名著`、`著作`。
- 转换：`背著书包`、`配合著`、`写著名字`、`做著作业`、`强忍著作呕`。

保护规则不得只按无边界子串匹配。例如直接保护 `合著` 会误伤 `配合著`，直接保护 `著書` 会误伤 `背著書包`。新增规则必须带相反语义回归。

## 简转繁管线

简转繁继续兼容既有能力：

1. 项目用语前置修正。
2. OpenCC `cn -> tw` 主体转换。
3. 发/髮、干/乾/幹、面/麵等后置词组修正。

当前优化重点是繁转简；简转繁不得因收缩旧字表而退化。

## 用户词表

每行只识别第一个 `=>`：

```text
龍傲天=>龙傲天
乾坤=>乾坤
軟體=>应用程序
```

- 空行和没有 `=>` 的行忽略。
- 空目标按保护原词处理。
- 后出现的重复源词覆盖前一行。
- 目标文本按用户原样恢复，不再交给 OpenCC 修改。
- 词表保存在 Reader 本地设置中，不上传服务器。

## 验证

快速语义回归：

```powershell
node --test tests/chinese-convert.test.js
```

标准转换报告：

```powershell
npm --prefix cirno-src run test:convert
```

脚本递归读取 `cirno-src/test` 下的 `.txt`、`.md`、`.text`。没有人工样本时自动组合内置回归文本，因此干净检出也能执行。默认运行 5 轮，可用 `--rounds=1` 到 `--rounds=20` 调整。

通过条件：

- 固定回归全部通过。
- `replacementChars === 0`。
- `after === 0`。
- `residualParagraphs === 0`。
- `residualWindows === 0`。
- `secondPassDiff === 0`。

任一条件失败时报告写入磁盘并返回非零退出码。`protectedAfter` 可以大于 0，但只允许是已审计的保护词。

当前内置基准：

- 11/11 固定回归通过。
- 异常残留、段落残留、分片残留均为 0。
- 二次转换差异为 0。
- `allPassed: true`。

完整 Reader 验证还必须执行：

```powershell
npm --prefix cirno-src run build:standalone
npm run check:docs
npm run check:utf8
```

## 维护原则

1. 先确认问题来自 OpenCC、台湾词汇偏好、粒子歧义还是专名。
2. 专名优先由用户词表解决；项目通用语义才进入内置规则。
3. 能用有边界词组解决的，不扩大全局单字映射。
4. 每个修复同时加入正确语义、相反语义和二次转换回归。
5. 报告脚本必须执行生产 `chinese-convert.js`，禁止复制第二套词表。
6. 大文本样本只用于本地诊断，不提交私人正文、Cookie 或 Token。

## 已知限制

- `opencc-js` 仍是较大的按需 chunk；只有开启繁简显示后才动态加载。
- 极少数“著/着”必须依赖上下文规则，无法仅靠单字映射完美判断。
- 大章节切换词表时仍在主线程重建；250ms 防抖减少重复工作，但不是 Web Worker。
- 简转繁的固定语料覆盖少于繁转简，新增简转繁规则时必须补对应测试。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
