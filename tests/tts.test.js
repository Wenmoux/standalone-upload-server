const assert = require("assert/strict");
const test = require("node:test");
const {
    EDGE_TTS_FALLBACK_VOICES,
    edgeTtsPayloadFromMessage,
    ttsProviderSettings,
    ttsSpeedName
} = require("../services/tts");

test("tts service exposes fallback voices and classifies speed", () => {
    assert.ok(EDGE_TTS_FALLBACK_VOICES.some((voice) => voice.name === "zh-CN-XiaoxiaoNeural"));
    assert.equal(ttsSpeedName(1.25), "fast");
    assert.equal(ttsSpeedName(0.8), "slow");
    assert.equal(ttsSpeedName(1), "normal");
    assert.equal(ttsSpeedName("bad"), "normal");
});

test("tts service extracts Edge binary audio payload", () => {
    const header = Buffer.from("Path:audio\r\nContent-Type:audio/mpeg\r\n");
    const audio = Buffer.from([1, 2, 3, 4]);
    const frame = Buffer.concat([
        Buffer.from([header.length >> 8, header.length & 0xff]),
        header,
        Buffer.from("\r\n"),
        audio
    ]);

    assert.deepEqual(edgeTtsPayloadFromMessage(frame), audio);
    assert.equal(edgeTtsPayloadFromMessage(Buffer.from("Path:turn.end\r\n\r\n")), null);
});

test("tts provider settings prefer nested settings object", () => {
    assert.deepEqual(ttsProviderSettings({ body: { settings: { apiKey: "nested" }, apiKey: "root" } }), { apiKey: "nested" });
    assert.deepEqual(ttsProviderSettings({ body: { apiKey: "root" } }), { apiKey: "root" });
});
