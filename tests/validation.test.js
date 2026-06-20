const assert = require("assert/strict");
const test = require("node:test");
const {
    bodyString,
    bodyNumber,
    compactJson,
    enumValue,
    paramPositiveInt,
    requireConfirm
} = require("../services/validation");

test("validation helpers normalize strings, numbers and enums", () => {
    assert.equal(bodyString({ name: "  abc  " }, "name", { required: true, maxLength: 2 }), "ab");
    assert.throws(() => bodyString({ name: "" }, "name", { required: true, message: "name required" }), /name required/);
    assert.equal(bodyNumber({ page: "2" }, "page", { integer: true, min: 1 }), 2);
    assert.throws(() => bodyNumber({ page: "2.5" }, "page", { integer: true }), /invalid page/);
    assert.equal(enumValue("running", ["queued", "running"], { name: "status" }), "running");
    assert.throws(() => enumValue("bad", ["queued"], { name: "status" }), /invalid status/);
});

test("validation helpers validate ids, confirmations and compact large json", () => {
    assert.equal(paramPositiveInt("42", "job id"), 42);
    assert.throws(() => paramPositiveInt("0", "job id"), /invalid job id/);
    assert.equal(requireConfirm("RETRY 7", "RETRY 7"), true);
    assert.throws(
        () => requireConfirm("bad", "RETRY 7"),
        (err) => err.status === 400 && err.expectedConfirm === "RETRY 7"
    );
    const compact = compactJson({ big: "x".repeat(21000), keep: true }, { maxBytes: 1000 });
    assert.equal(compact.truncated, true);
    assert.deepEqual(compact.keys, ["big", "keep"]);
});
