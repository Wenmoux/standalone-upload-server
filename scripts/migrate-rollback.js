/**
 * [INPUT]: 依赖 docker/run-all 的受信配置加载器与 pg-store 的迁移回滚事务能力
 * [OUTPUT]: 提供按步数或目标版本执行显式 PostgreSQL 回滚的命令行入口及结果输出
 * [POS]: scripts 数据库运维工具，复用应用配置边界并把危险操作交由 pg-store 的确认机制约束
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const { loadConfig } = require("../docker/run-all");

loadConfig(process.env.PO18_CONFIG_FILE || "/config/app.env");

const { pool, runMigrationRollback } = require("../pg-store");

function argValue(name) {
    const index = process.argv.indexOf(name);
    if (index < 0) return "";
    return process.argv[index + 1] || "";
}

async function main() {
    const steps = Number(argValue("--steps") || 1);
    const toVersion = argValue("--to");
    const confirm = argValue("--confirm");
    const rolledBack = await runMigrationRollback({ steps, toVersion, confirm });
    if (!rolledBack.length) {
        console.log("No migrations rolled back.");
        return;
    }
    for (const item of rolledBack) {
        console.log(`${item.version} ${item.name} ${item.durationMs}ms`);
    }
}

main()
    .catch((err) => {
        console.error(err.message || String(err));
        process.exitCode = 1;
    })
    .finally(() => pool.end().catch(() => {}));
