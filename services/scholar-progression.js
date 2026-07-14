/**
 * [INPUT]: 依赖签到/等级环境参数与加密安全随机数生成器
 * [OUTPUT]: 对外提供学者等级、签到经验、红包拆分和币种文案纯领域规则
 * [POS]: services 的阅读成长规则层，被 Reader、Bot、认证和用户经济服务共同消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const crypto = require("crypto");

const SCHOLAR_LEVEL_NAMES = [
    "卷首书童",
    "青灯蒙学",
    "砚边童生",
    "案前秀才",
    "藏书廪生",
    "乡试举人",
    "春闱贡士",
    "金榜进士",
    "翰林编修",
    "御阁侍读",
    "文渊学士",
    "兰台大学士",
    "一代文宗",
    "稷下鸿儒",
    "万卷书圣"
];

function positiveNumber(value, fallback, min = 1) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(min, parsed) : fallback;
}

function currencyLabel(currency) {
    return currency === "silver" ? "银币" : "铜币";
}

function createScholarProgression(options = {}) {
    const expBase = positiveNumber(options.expBase, 1200, 1);
    const expGrowth = positiveNumber(options.expGrowth, 1.38, 1.01);
    const signExpBase = Math.trunc(positiveNumber(options.signExpBase, 60, 1));
    const signExpStreakBonus = Math.trunc(positiveNumber(options.signExpStreakBonus, 8, 0));
    const randomInt = options.randomInt || crypto.randomInt;

    function scholarExpForNextLevel(level = 1) {
        const safeLevel = Math.max(1, Math.trunc(Number(level || 1)));
        return Math.max(1, Math.round(expBase * Math.pow(expGrowth, safeLevel - 1)));
    }

    function scholarProfile(expValue = 0) {
        const totalExp = Math.max(0, Math.trunc(Number(expValue || 0)));
        let level = 1;
        let levelExp = totalExp;
        const maxLevel = 99;
        while (level < maxLevel) {
            const need = scholarExpForNextLevel(level);
            if (levelExp < need) break;
            levelExp -= need;
            level += 1;
        }
        const nextLevelExp = scholarExpForNextLevel(level);
        const name = SCHOLAR_LEVEL_NAMES[Math.min(level - 1, SCHOLAR_LEVEL_NAMES.length - 1)] || `藏书第${level}境`;
        const nextName = SCHOLAR_LEVEL_NAMES[Math.min(level, SCHOLAR_LEVEL_NAMES.length - 1)] || `藏书第${level + 1}境`;
        return {
            level,
            name,
            exp: totalExp,
            level_exp: levelExp,
            next_level_exp: nextLevelExp,
            exp_to_next: Math.max(0, nextLevelExp - levelExp),
            progress: nextLevelExp ? Number((levelExp / nextLevelExp).toFixed(4)) : 1,
            next_level_name: nextName,
            daily_free_exports: level <= 2 ? 1 : 2
        };
    }

    function signExpReward(day = 1) {
        const safeDay = Math.max(1, Math.trunc(Number(day || 1)));
        return signExpBase + (safeDay - 1) * signExpStreakBonus;
    }

    function randomRedPacketAmount(remainingAmount, remainingCount) {
        if (remainingCount <= 1) return Math.max(1, Number(remainingAmount || 0));
        const maxCan = Math.max(2, Math.floor(Number(remainingAmount || 0) * 0.6));
        const raw = randomInt(1, maxCan + 1);
        return Math.max(1, Math.min(raw, Number(remainingAmount || 0) - (remainingCount - 1)));
    }

    return {
        scholarExpForNextLevel,
        scholarProfile,
        signExpReward,
        randomRedPacketAmount
    };
}

module.exports = {
    SCHOLAR_LEVEL_NAMES,
    createScholarProgression,
    currencyLabel,
    positiveNumber
};
