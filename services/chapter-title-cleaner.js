/**
 * [INPUT]: 依赖章节原始标题文本与内置的已确认清洗规则、括号配对和编号模式
 * [OUTPUT]: 对外提供章节标题规范化、规则匹配、括号分段及空白清洗纯函数
 * [POS]: services 的章节标题语义内核，被写入与导出链路复用以消除标题重复而保留可审计规则
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const BRACKET_PAIRS = [
    ["（", "）"],
    ["(", ")"],
    ["【", "】"],
    ["[", "]"]
];

const CHINESE_NUMBER = "一二三四五六七八九十百千万零〇两";
const NUM_TOKEN = `0-9０-９${CHINESE_NUMBER}`;

const CONFIRMED_TITLE_CLEAN_RULES = [
    {
        id: "ask-ticket",
        name: "求票求订",
        patterns: [
            /^(?:月票|推荐票|月票啊|求月票啊|求票啊|求订阅啊|求追读啊|求支持啊)$/,
            /求.{0,8}(?:月票|票|首订|首定|订阅|订|追读|推荐|收藏|投资|打赏|支持)/,
            /(?:请|求|给点|麻烦|拜托)?.{0,12}(?:追读|订阅|月票|推荐票|投资|打赏)(?:吧|啦|鸭|喵|啊|呀|求求了|~~~)?$/
        ]
    },
    {
        id: "vote-progress",
        name: "进度拉票",
        patterns: [
            new RegExp(`^[${NUM_TOKEN}]+\\/[${NUM_TOKEN}]+(?:[,，]?(?:加更|补更)\\d*)?(?:求(?:月票|首订|订阅|追读|推荐票|票))?$`)
        ]
    },
    {
        id: "ticket-milestone-note",
        name: "票数/保底标记",
        patterns: [
            new RegExp(`^[${NUM_TOKEN}]+(?:更)?[,，]?(?:保底|月票\\d{2,6}|均订\\d{2,6}|订阅\\d{2,6})$`)
        ]
    },
    {
        id: "bonus-update",
        name: "加更说明",
        patterns: [
            /(?:为.+加更|盟主|白银盟|黄金盟|万赏|打赏).*(?:加更|求月票)?/,
            /(?:加更|补更|爆更)/
        ]
    },
    {
        id: "word-count-ticket",
        name: "字数拉票",
        patterns: [
            /(?:\d+(?:\.\d+)?\s*[kK千]|[一二三四五六七八九十]+千|万字|\d+字).*(?:求月票|求票|求订阅|求首订)/
        ]
    },
    {
        id: "word-count-note",
        name: "纯字数/篇幅说明",
        patterns: [
            /^(?:\d+(?:\.\d+)?[kKwW](?:字)?(?:大章)?|\d{4,5}(?:字)?(?:大章)?|[一二三四五六七八九十百千万两]+(?:千|字)|万字大章|万字|大章)$/,
            /^(?:今(?:天|日)|本章|两章|二合一|合章)?[两二]章\d{3,5}字?$/,
            /^(?:今(?:天|日)|本章)\d{3,5}字$/,
            /^(?:今日份)?(?:日万|万字)(?:结束|完成)$/,
            /^\d+(?:\.\d+)?[kKwW]章[,，].*(?:第二更|下一更|稍后).*$/,
            new RegExp(`^(?:[${NUM_TOKEN}]+更\\d{3,5}|\\d+(?:\\.\\d+)?[kKwW]第?[${NUM_TOKEN}]+更)$`)
        ]
    },
    {
        id: "merged-chapter-note",
        name: "合章说明",
        patterns: [
            /^(?:二合一章节|二合一大章|两章合一章节|三合一章节|三合一大章|四合一章节|四合一大章)$/,
            /^(?:二合一|三合一|四合一|二合一章|三合一章|四合一章|两章合一|兩章合一|合章|合更|[234二三四两]合1?|[234二三四两]合一|[234二三四两]合1?大章|二合1)$/
        ]
    },
    {
        id: "update-count-note",
        name: "更次/补更说明",
        patterns: [
            new RegExp(`^(?:爆发之)?第?[${NUM_TOKEN}]+更(?:[,，]?(?:感谢|谢谢|送到|还债).*)?$`),
            new RegExp(`^[${NUM_TOKEN}]+更(?:送到|还债)?$`),
            /^(补欠|还欠|补欠更|补昨天的|请假一更)$/,
            new RegExp(`^(?:第?[${NUM_TOKEN}]+更|[${NUM_TOKEN}]+更|补更[,，]?第?[${NUM_TOKEN}]+更|[${NUM_TOKEN}]+\\/[${NUM_TOKEN}]+[,，]?(?:加更|补更)\\d*)$`),
            new RegExp(`^(?:今日|今天)?[${NUM_TOKEN}]+更(?:完成|完毕|结束)?$`),
            new RegExp(`^第?[${NUM_TOKEN}]+更[,，].*(?:爆发完毕|完毕|完成|结束|快乐).*$`),
            new RegExp(`^[${NUM_TOKEN}]+更补$`),
            new RegExp(`^(?:第?[${NUM_TOKEN}]+(?:更|章)在几分钟后|第二更在下午)$`),
            /^起点\d{1,6}月票\+更$/
        ]
    },
    {
        id: "thanks-support-note",
        name: "感谢支持/礼物说明",
        patterns: [
            /^感谢(?:订阅|支持|投票|月票|推荐|收藏|打赏).*$/,
            /^感谢.*(?:盟主|白银大盟|白银盟|黄金盟|打赏|月票|推荐|订阅|支持).*$/,
            /^感谢书友[\w\d一-龥“”"'‘’]+(?:打|打赏|投票|月票|推荐|支持)?.*$/,
            /^感谢[“"'‘’]?[^“”"'‘’]{1,32}[”"'‘’]?.*(?:送|打赏|投喂).*(?:奖杯|奥斯卡|礼物|盟主|白银盟|黄金盟|月票|推荐票).*$/
        ]
    },
    {
        id: "holiday-greeting-note",
        name: "节日问候",
        patterns: [
            /^(?:祝大家|祝各位|大家|各位)?(?:国庆|中秋|元旦|新年|春节|除夕|端午|五一|劳动节|七夕|圣诞|元宵|假期|周末|节日)(?:节)?(?:快乐|安康|愉快)[!！。~～]*(?:预计本月完结|本月完结)?$/
        ]
    },
    {
        id: "author-status-note",
        name: "作者说明",
        patterns: [
            /^(?:重要设定|设定章|设定说明|说明章|作者说明|作者的话|明天(?:恢复[一二两三四五六七八九十\d]+更|请假(?:一天)?)|今天请假(?:一天)?|请假(?:一天)?|预计本月完结|本月完结|前面[一二三四五六七八九十\d]+章被审核了.*|可以跳过.*)$/
        ]
    },
    {
        id: "free-chapter-note",
        name: "免费章节说明",
        patterns: [
            /^(?:免费章|免费章节|免费|本章免费|本章不收费|不收费)$/
        ]
    },
    {
        id: "dangling-support-note",
        name: "末尾未闭合感谢/加更说明",
        danglingOnly: true,
        patterns: [
            /^感谢.+/,
            /(?:盟主|白银盟|黄金盟|打赏|万赏)/,
            /^(?:为|给).+(?:加更|补更|爆更)/
        ]
    }
];

function normalizeTitleSpaces(value = "") {
    return String(value || "")
        .replace(/[ \t\r\n\f\v]+/g, " ")
        .replace(/\s+([，。！？；：、,.!?;:])/g, "$1")
        .replace(/([（(【[])\s+/g, "$1")
        .replace(/\s+([）)】\]])/g, "$1")
        .trim();
}

function bracketSegments(title = "") {
    const text = String(title || "");
    const segments = [];
    for (let index = 0; index < text.length; index += 1) {
        const pair = BRACKET_PAIRS.find(([open]) => text.startsWith(open, index));
        if (!pair) continue;
        const [open, close] = pair;
        const start = index;
        const contentStart = index + open.length;
        const end = text.indexOf(close, contentStart);
        if (end >= 0) {
            const content = text.slice(contentStart, end);
            if (content.length >= 1 && content.length <= 80) {
                segments.push({ start, end: end + close.length, content, dangling: false });
            }
            index = Math.max(index, end);
            continue;
        }
        if (contentStart > 0 && contentStart < text.length) {
            const content = text.slice(contentStart);
            if (content.length >= 1 && content.length <= 80) {
                segments.push({ start, end: text.length, content, dangling: true });
            }
        }
        break;
    }
    return segments;
}

function matchCleanRule(content = "", options = {}) {
    const text = normalizeTitleSpaces(content);
    const dangling = options.dangling === true;
    for (const rule of CONFIRMED_TITLE_CLEAN_RULES) {
        if (rule.danglingOnly && !dangling) continue;
        if (rule.patterns.some((pattern) => pattern.test(text))) return rule;
    }
    return null;
}

function cleanChapterTitle(title = "") {
    const original = String(title || "");
    const segments = bracketSegments(original)
        .map((segment) => ({ ...segment, rule: matchCleanRule(segment.content, { dangling: segment.dangling }) }))
        .filter((segment) => segment.rule);
    if (!segments.length) return { title: normalizeTitleSpaces(original), changed: false, removed: [] };

    let output = "";
    let cursor = 0;
    for (const segment of segments) {
        output += original.slice(cursor, segment.start);
        cursor = segment.end;
    }
    output += original.slice(cursor);
    const cleaned = normalizeTitleSpaces(output);
    if (!cleaned) return { title: normalizeTitleSpaces(original), changed: false, removed: [] };
    return {
        title: cleaned,
        changed: cleaned !== normalizeTitleSpaces(original),
        removed: segments.map((segment) => ({
            text: original.slice(segment.start, segment.end),
            content: normalizeTitleSpaces(segment.content),
            ruleId: segment.rule.id,
            ruleName: segment.rule.name,
            dangling: segment.dangling
        }))
    };
}

module.exports = {
    CONFIRMED_TITLE_CLEAN_RULES,
    bracketSegments,
    cleanChapterTitle,
    matchCleanRule,
    normalizeTitleSpaces
};
