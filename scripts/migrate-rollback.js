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
