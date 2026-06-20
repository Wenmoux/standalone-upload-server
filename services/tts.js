const crypto = require("crypto");
const path = require("path");

const EDGE_TTS_TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const EDGE_TTS_GEC_VERSION = "1-143.0.3650.75";
const EDGE_TTS_BASE = "speech.platform.bing.com/consumer/speech/synthesize/readaloud";
const EDGE_TTS_FALLBACK_VOICES = [
    { name: "zh-CN-XiaoxiaoNeural", displayName: "晓晓 · 女声 · 普通话", locale: "zh-CN", gender: "Female" },
    { name: "zh-CN-XiaoyiNeural", displayName: "晓伊 · 女声 · 普通话", locale: "zh-CN", gender: "Female" },
    { name: "zh-CN-YunjianNeural", displayName: "云健 · 男声 · 普通话", locale: "zh-CN", gender: "Male" },
    { name: "zh-CN-YunxiNeural", displayName: "云希 · 男声 · 普通话", locale: "zh-CN", gender: "Male" },
    { name: "zh-CN-YunxiaNeural", displayName: "云夏 · 男声 · 普通话", locale: "zh-CN", gender: "Male" },
    { name: "zh-CN-YunyangNeural", displayName: "云扬 · 男声 · 普通话", locale: "zh-CN", gender: "Male" },
    { name: "zh-CN-liaoning-XiaobeiNeural", displayName: "晓北 · 女声 · 东北", locale: "zh-CN", gender: "Female" },
    { name: "zh-CN-shaanxi-XiaoniNeural", displayName: "晓妮 · 女声 · 陕西", locale: "zh-CN", gender: "Female" },
    { name: "zh-HK-HiuGaaiNeural", displayName: "曉佳 · 女声 · 粤语", locale: "zh-HK", gender: "Female" },
    { name: "zh-HK-HiuMaanNeural", displayName: "曉曼 · 女声 · 粤语", locale: "zh-HK", gender: "Female" },
    { name: "zh-HK-WanLungNeural", displayName: "雲龍 · 男声 · 粤语", locale: "zh-HK", gender: "Male" },
    { name: "zh-TW-HsiaoChenNeural", displayName: "曉臻 · 女声 · 台湾", locale: "zh-TW", gender: "Female" },
    { name: "zh-TW-HsiaoYuNeural", displayName: "曉雨 · 女声 · 台湾", locale: "zh-TW", gender: "Female" },
    { name: "zh-TW-YunJheNeural", displayName: "雲哲 · 男声 · 台湾", locale: "zh-TW", gender: "Male" }
];

function optionalWs() {
    try {
        return require("ws");
    } catch {}
    try {
        return require(path.join(__dirname, "..", "cirno-src", "node_modules", "ws"));
    } catch {}
    return null;
}

function edgeTtsTicks() {
    const winEpochOffset = 11644473600;
    const roundedSeconds = Math.floor((Date.now() / 1000 + winEpochOffset) / 300) * 300;
    return String(Math.trunc(roundedSeconds * 10000000));
}

function edgeTtsSecMsGec() {
    return crypto
        .createHash("sha256")
        .update(`${edgeTtsTicks()}${EDGE_TTS_TRUSTED_CLIENT_TOKEN}`, "ascii")
        .digest("hex")
        .toUpperCase();
}

function edgeTtsConnectId() {
    return crypto.randomBytes(16).toString("hex");
}

function edgeTtsHeaders() {
    return {
        "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0",
        Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold"
    };
}

function ssmlEscape(value = "") {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function edgeTtsPercent(value, fallback = 1, scale = 100, min = -100, max = 200) {
    const num = Number(value);
    const safe = Number.isFinite(num) ? num : fallback;
    const pct = Math.max(min, Math.min(max, Math.round((safe - 1) * scale)));
    return `${pct >= 0 ? "+" : ""}${pct}%`;
}

function edgeTtsSsml({ text, voice, rate, pitch, volume }) {
    const pickedVoice = String(voice || "zh-CN-XiaoxiaoNeural").replace(/[^A-Za-z0-9_.-]/g, "") || "zh-CN-XiaoxiaoNeural";
    const lang = pickedVoice.split("-").slice(0, 2).join("-") || "zh-CN";
    return `<speak version="1.0" xml:lang="${lang}" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts"><voice name="${pickedVoice}"><prosody rate="${edgeTtsPercent(rate)}" pitch="${edgeTtsPercent(pitch, 1, 50, -50, 50)}" volume="${edgeTtsPercent(volume, 1, 100, -100, 100)}">${ssmlEscape(text)}</prosody></voice></speak>`;
}

async function edgeTtsVoices(locale = "zh-CN") {
    const url = `https://${EDGE_TTS_BASE}/voices/list?trustedclienttoken=${EDGE_TTS_TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${edgeTtsSecMsGec()}&Sec-MS-GEC-Version=${EDGE_TTS_GEC_VERSION}`;
    const response = await fetch(url, { headers: edgeTtsHeaders() });
    if (!response.ok) throw new Error(`Edge TTS voices HTTP ${response.status}`);
    const rows = await response.json();
    const target = String(locale || "").toLowerCase();
    return (Array.isArray(rows) ? rows : [])
        .filter((row) => !target || String(row.Locale || "").toLowerCase() === target)
        .map((row) => ({
            name: row.ShortName || "",
            displayName: row.FriendlyName || row.LocalName || row.ShortName || "",
            locale: row.Locale || "",
            gender: row.Gender || "",
            contentCategories: row.VoiceTag?.ContentCategories || [],
            voicePersonalities: row.VoiceTag?.VoicePersonalities || []
        }))
        .filter((row) => row.name);
}

function edgeTtsPayloadFromMessage(data) {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (buffer.length >= 2) {
        const headerLength = buffer.readUInt16BE(0);
        const headerStart = 2;
        const headerEnd = headerStart + headerLength;
        if (headerLength > 0 && headerEnd <= buffer.length) {
            const header = buffer.slice(headerStart, headerEnd).toString("utf8");
            let payloadStart = headerEnd;
            if (buffer.slice(payloadStart, payloadStart + 2).toString("utf8") === "\r\n") payloadStart += 2;
            if (/Path:audio/i.test(header) && /Content-Type:audio\/mpeg/i.test(header)) {
                const audio = buffer.slice(payloadStart);
                return audio.length ? audio : null;
            }
            return null;
        }
    }
    const marker = Buffer.from("\r\n\r\n");
    const index = buffer.indexOf(marker);
    if (index < 0) return null;
    const header = buffer.slice(0, index).toString("utf8");
    if (!/Path:audio/i.test(header)) return null;
    return buffer.slice(index + marker.length);
}

function edgeTtsSynthesize({ text, voice, rate, pitch, volume }) {
    const Ws = optionalWs();
    if (!Ws) throw new Error("Edge TTS 需要 ws 模块，请在服务端执行 npm install ws 或保留 cirno-src/node_modules");
    const connectionId = edgeTtsConnectId();
    const requestId = edgeTtsConnectId();
    const url = `wss://${EDGE_TTS_BASE}/edge/v1?TrustedClientToken=${EDGE_TTS_TRUSTED_CLIENT_TOKEN}&ConnectionId=${connectionId}&Sec-MS-GEC=${edgeTtsSecMsGec()}&Sec-MS-GEC-Version=${EDGE_TTS_GEC_VERSION}`;
    const outputFormat = "audio-24khz-48kbitrate-mono-mp3";
    const ssml = edgeTtsSsml({ text, voice, rate, pitch, volume });
    const chunks = [];
    return new Promise((resolve, reject) => {
        const ws = new Ws(url, { headers: edgeTtsHeaders(), perMessageDeflate: false });
        const timer = setTimeout(() => {
            try {
                ws.close();
            } catch {}
            reject(new Error("Edge TTS 请求超时"));
        }, 60000);
        const done = () => clearTimeout(timer);
        ws.on("open", () => {
            const timestamp = new Date().toISOString();
            ws.send(
                `X-Timestamp:${timestamp}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
                    JSON.stringify({
                        context: {
                            synthesis: {
                                audio: {
                                    metadataoptions: { sentenceBoundaryEnabled: false, wordBoundaryEnabled: false },
                                    outputFormat
                                }
                            }
                        }
                    })
            );
            ws.send(`X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${timestamp}\r\nPath:ssml\r\n\r\n${ssml}`);
        });
        ws.on("message", (data) => {
            if (typeof data === "string") {
                if (/Path:turn\.end/i.test(data)) {
                    done();
                    try {
                        ws.close();
                    } catch {}
                    resolve(Buffer.concat(chunks));
                }
                return;
            }
            const audio = edgeTtsPayloadFromMessage(data);
            if (audio && audio.length) chunks.push(audio);
        });
        ws.on("error", (err) => {
            done();
            reject(err);
        });
        ws.on("close", () => {
            done();
            if (!chunks.length) reject(new Error("Edge TTS 没有返回音频"));
        });
    });
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMs(value) {
    if (!value) return 0;
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(value);
    return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

async function fetchWithTtsRetry(url, options = {}, retryOptions = {}) {
    const attempts = Math.max(1, Math.min(8, Number(retryOptions.attempts || 6)));
    const retryStatuses = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
    let lastError = null;
    for (let index = 0; index < attempts; index += 1) {
        try {
            const response = await fetch(url, options);
            if (!retryStatuses.has(response.status) || index === attempts - 1) return response;
            const retryAfter = retryAfterMs(response.headers.get("retry-after"));
            const backoff = retryAfter || Math.min(8000, 450 * Math.pow(1.75, index));
            await sleep(backoff + Math.floor(Math.random() * 180));
        } catch (err) {
            lastError = err;
            if (index === attempts - 1) throw err;
            await sleep(Math.min(8000, 450 * Math.pow(1.75, index)) + Math.floor(Math.random() * 180));
        }
    }
    throw lastError || new Error("TTS 请求失败");
}

async function readErrorBody(response) {
    const text = await response.text().catch(() => "");
    if (!text) return `${response.status} ${response.statusText || ""}`.trim();
    try {
        const data = JSON.parse(text);
        return data.message || data.error || data.code || text.slice(0, 500);
    } catch {
        return text.slice(0, 500);
    }
}

function ttsProviderSettings(req) {
    return req.body?.settings && typeof req.body.settings === "object" && !Array.isArray(req.body.settings) ? req.body.settings : req.body || {};
}

function ttsSpeedName(rate) {
    const num = Number(rate);
    if (!Number.isFinite(num)) return "normal";
    if (num >= 1.2) return "fast";
    if (num <= 0.85) return "slow";
    return "normal";
}

function ttsAzureSsml({ text, voice, rate, pitch, volume }) {
    const pickedVoice = String(voice || "zh-CN-XiaoxiaoNeural").replace(/[^A-Za-z0-9_.-]/g, "") || "zh-CN-XiaoxiaoNeural";
    const lang = pickedVoice.split("-").slice(0, 2).join("-") || "zh-CN";
    return `<speak version="1.0" xml:lang="${lang}" xmlns="http://www.w3.org/2001/10/synthesis"><voice name="${pickedVoice}"><prosody rate="${edgeTtsPercent(rate)}" pitch="${edgeTtsPercent(pitch, 1, 50, -50, 50)}" volume="${edgeTtsPercent(volume, 1, 100, -100, 100)}">${ssmlEscape(text)}</prosody></voice></speak>`;
}

async function synthesizeVolcengineTts({ text, settings, rate, pitch, volume }) {
    const appid = String(settings.ttsVolcAppId || settings.appId || "").trim();
    const token = String(settings.ttsVolcToken || settings.token || settings.apiKey || "").trim();
    if (!appid || !token) throw Object.assign(new Error("请填写火山引擎 AppID 和 Access Token"), { status: 400 });
    const body = {
        app: {
            appid,
            token,
            cluster: String(settings.ttsVolcCluster || "volcano_tts")
        },
        user: { uid: String(settings.ttsVolcUid || "reader") },
        audio: {
            voice_type: String(settings.ttsVolcVoice || settings.voice || "zh_female_xiaoxiao_moon_bigtts"),
            encoding: "mp3",
            speed_ratio: Number(rate || 1),
            volume_ratio: Number(volume || 1),
            pitch_ratio: Number(pitch || 1)
        },
        request: {
            reqid: crypto.randomUUID ? crypto.randomUUID() : edgeTtsConnectId(),
            text,
            operation: "query"
        }
    };
    const response = await fetchWithTtsRetry("https://openspeech.bytedance.com/api/v1/tts", {
        method: "POST",
        headers: {
            Authorization: `Bearer;${token}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) throw Object.assign(new Error(`火山引擎 TTS 失败：${data?.message || data?.error || response.status}`), { status: response.status });
    const audio = data.data || data.audio || data.result?.audio || data.result?.data;
    if (!audio) throw Object.assign(new Error(`火山引擎 TTS 没有返回音频：${data.message || data.code || "empty data"}`), { status: 502 });
    return Buffer.from(String(audio), "base64");
}

async function synthesizeAliyunTts({ text, settings }) {
    const apiKey = String(settings.ttsAliApiKey || settings.apiKey || "").trim();
    if (!apiKey) throw Object.assign(new Error("请填写阿里云百炼 DashScope API Key"), { status: 400 });
    const baseUrl = String(settings.ttsAliBaseUrl || "https://dashscope.aliyuncs.com/api/v1").replace(/\/+$/, "");
    const body = {
        model: String(settings.ttsAliModel || "qwen3-tts-flash"),
        input: {
            text,
            voice: String(settings.ttsAliVoice || settings.voice || "Cherry"),
            language_type: String(settings.ttsAliLanguage || "Chinese")
        }
    };
    if (settings.ttsAliInstructions) body.input.instructions = String(settings.ttsAliInstructions);
    const response = await fetchWithTtsRetry(`${baseUrl}/services/aigc/multimodal-generation/generation`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) throw Object.assign(new Error(`阿里云百炼 TTS 失败：${data?.message || data?.code || response.status}`), { status: response.status });
    const audio = data.output?.audio || data.output?.choices?.[0]?.message?.audio || data.audio || data.data?.audio;
    const audioUrl = typeof audio === "string" ? audio : audio?.url;
    const audioData = typeof audio === "object" ? audio.data : "";
    if (audioData) return Buffer.from(String(audioData), "base64");
    if (!audioUrl) throw Object.assign(new Error(`阿里云百炼 TTS 没有返回音频地址：${data.message || data.code || "empty audio"}`), { status: 502 });
    const audioResponse = await fetchWithTtsRetry(audioUrl, { method: "GET" });
    if (!audioResponse.ok) throw Object.assign(new Error(`下载阿里云音频失败：${await readErrorBody(audioResponse)}`), { status: audioResponse.status });
    return Buffer.from(await audioResponse.arrayBuffer());
}

async function synthesizeAzureTts({ text, settings, rate, pitch, volume }) {
    const key = String(settings.ttsAzureKey || settings.apiKey || "").trim();
    const region = String(settings.ttsAzureRegion || "").trim();
    if (!key || !region) throw Object.assign(new Error("请填写 Azure Speech Key 和 Region"), { status: 400 });
    const format = String(settings.ttsAzureFormat || "audio-24khz-48kbitrate-mono-mp3");
    const response = await fetchWithTtsRetry(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
        method: "POST",
        headers: {
            "Ocp-Apim-Subscription-Key": key,
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": format,
            "User-Agent": "po18-reader"
        },
        body: ttsAzureSsml({ text, voice: settings.ttsAzureVoice || "zh-CN-XiaoxiaoNeural", rate, pitch, volume })
    });
    if (!response.ok) throw Object.assign(new Error(`Azure Speech TTS 失败：${await readErrorBody(response)}`), { status: response.status });
    return Buffer.from(await response.arrayBuffer());
}

async function synthesizeElevenLabsTts({ text, settings, rate }) {
    const apiKey = String(settings.ttsElevenKey || settings.apiKey || "").trim();
    const voiceId = String(settings.ttsElevenVoiceId || settings.voice || "").trim();
    if (!apiKey || !voiceId) throw Object.assign(new Error("请填写 ElevenLabs API Key 和 Voice ID"), { status: 400 });
    const outputFormat = String(settings.ttsElevenOutputFormat || "mp3_44100_128");
    const modelId = String(settings.ttsElevenModel || "eleven_flash_v2_5");
    const optimizeLatency = Math.max(0, Math.min(4, Number(settings.ttsElevenLatency ?? 3)));
    const response = await fetchWithTtsRetry(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${encodeURIComponent(outputFormat)}&optimize_streaming_latency=${optimizeLatency}`,
        {
        method: "POST",
        headers: {
            "xi-api-key": apiKey,
            "Content-Type": "application/json",
            Accept: "audio/mpeg"
        },
        body: JSON.stringify({
            text,
            model_id: modelId,
            voice_settings: {
                stability: Number(settings.ttsElevenStability || 0.5),
                similarity_boost: Number(settings.ttsElevenSimilarity || 0.75),
                style: Number(settings.ttsElevenStyle || 0),
                use_speaker_boost: true
            }
        })
        }
    );
    if (!response.ok) throw Object.assign(new Error(`ElevenLabs TTS 失败：${await readErrorBody(response)}`), { status: response.status });
    return Buffer.from(await response.arrayBuffer());
}

async function synthesizeCartesiaTts({ text, settings, rate, volume }) {
    const apiKey = String(settings.ttsCartesiaKey || settings.apiKey || "").trim();
    const voiceId = String(settings.ttsCartesiaVoiceId || settings.voice || "").trim();
    if (!apiKey || !voiceId) throw Object.assign(new Error("请填写 Cartesia API Key 和 Voice ID"), { status: 400 });
    const response = await fetchWithTtsRetry("https://api.cartesia.ai/tts/bytes", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "X-API-Key": apiKey,
            "Cartesia-Version": String(settings.ttsCartesiaVersion || "2026-03-01"),
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model_id: String(settings.ttsCartesiaModel || "sonic-3"),
            transcript: text,
            voice: { mode: "id", id: voiceId },
            language: String(settings.ttsCartesiaLanguage || "zh"),
            output_format: {
                container: "mp3",
                bit_rate: Number(settings.ttsCartesiaBitrate || 128000),
                sample_rate: Number(settings.ttsCartesiaSampleRate || 44100)
            },
            generation_config: {
                volume: Number(volume || 1),
                speed: Number(rate || 1)
            },
            speed: ttsSpeedName(rate)
        })
    });
    if (!response.ok) throw Object.assign(new Error(`Cartesia TTS 失败：${await readErrorBody(response)}`), { status: response.status });
    return Buffer.from(await response.arrayBuffer());
}

module.exports = {
    EDGE_TTS_FALLBACK_VOICES,
    edgeTtsVoices,
    edgeTtsSynthesize,
    edgeTtsPayloadFromMessage,
    fetchWithTtsRetry,
    readErrorBody,
    ttsProviderSettings,
    ttsSpeedName,
    synthesizeVolcengineTts,
    synthesizeAliyunTts,
    synthesizeAzureTts,
    synthesizeElevenLabsTts,
    synthesizeCartesiaTts
};
