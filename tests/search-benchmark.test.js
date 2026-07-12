const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const test = require("node:test");
const { evaluateResults, parseArgs, percentile, summarizePlan } = require("../scripts/search-benchmark");

test("search benchmark baseline fixes scale, repetitions and endpoint budgets", () => {
    const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "benchmarks", "search-plan-baseline.json"), "utf8"));
    assert.equal(baseline.dataset_rows, 50000);
    assert.equal(baseline.runs, 5);
    assert.deepEqual(Object.keys(baseline.budgets_ms).sort(), ["cursor", "keyword", "taxonomy"]);
});

test("search benchmark summarizes EXPLAIN buffers and enforces p95 budgets", () => {
    const summary = summarizePlan({
        "Planning Time": 1.2,
        "Execution Time": 9.5,
        Plan: {
            "Node Type": "Limit",
            "Plan Rows": 21,
            "Actual Rows": 20,
            "Total Cost": 42,
            "Shared Hit Blocks": 2,
            Plans: [{ "Node Type": "Bitmap Index Scan", "Shared Hit Blocks": 3, "Shared Read Blocks": 1 }]
        }
    });
    assert.equal(summary.execution_ms, 9.5);
    assert.deepEqual(summary.node_types, ["Bitmap Index Scan", "Limit"]);
    assert.equal(summary.buffers.shared_hit, 2);
    assert.equal(percentile([1, 2, 3, 4, 5], 0.95), 5);
    assert.deepEqual(evaluateResults({ keyword: { samples: 5, p95_ms: 9.5, node_types: summary.node_types } }, { keyword: 10 }), []);
    assert.match(evaluateResults({ keyword: { samples: 5, p95_ms: 10.5, node_types: summary.node_types } }, { keyword: 10 })[0], /exceeds/);
    assert.deepEqual(parseArgs(["--rows", "1000", "--output", "x.json"]), { rows: "1000", output: "x.json" });
});
