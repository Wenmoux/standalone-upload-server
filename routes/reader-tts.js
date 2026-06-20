const express = require("express");

function createReaderTtsRoutes(deps = {}) {
    const router = express.Router();
    const {
        requireReader,
        edgeTtsFallbackVoices,
        edgeTtsVoices,
        edgeTtsSynthesize,
        ttsProviderSettings,
        synthesizeVolcengineTts,
        synthesizeAliyunTts,
        synthesizeAzureTts,
        synthesizeElevenLabsTts,
        synthesizeCartesiaTts
    } = deps;
    const EDGE_TTS_FALLBACK_VOICES = edgeTtsFallbackVoices || [];

    router.post("/reader-api/tts/proxy", requireReader, async (req, res, next) => {
        try {
            const target = new URL(String(req.body?.url || "").trim());
            if (!["http:", "https:"].includes(target.protocol)) return res.status(400).json({ error: "TTS API 只支持 http/https" });
            const method = String(req.body?.method || "POST").toUpperCase() === "PUT" ? "PUT" : "POST";
            const rawHeaders = req.body?.headers && typeof req.body.headers === "object" && !Array.isArray(req.body.headers) ? req.body.headers : {};
            const headers = {};
            for (const [key, value] of Object.entries(rawHeaders)) {
                const safeKey = String(key || "").toLowerCase();
                if (!safeKey || ["host", "content-length", "connection"].includes(safeKey)) continue;
                headers[key] = String(value);
            }
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 60000);
            const response = await fetch(target, {
                method,
                headers,
                body: String(req.body?.body || ""),
                signal: controller.signal
            }).finally(() => clearTimeout(timer));
            const buffer = Buffer.from(await response.arrayBuffer());
            res.status(response.status);
            const contentType = response.headers.get("content-type");
            if (contentType) res.setHeader("Content-Type", contentType);
            const cacheControl = response.headers.get("cache-control");
            if (cacheControl) res.setHeader("Cache-Control", cacheControl);
            res.send(buffer);
        } catch (err) {
            if (err.name === "AbortError") return res.status(504).json({ error: "TTS API 请求超时" });
            next(err);
        }
    });

    router.get("/reader-api/tts/edge/voices", requireReader, async (req, res, next) => {
        try {
            const locale = String(req.query.locale || "zh-CN").trim();
            try {
                const rows = await edgeTtsVoices(locale);
                res.json({ rows, locale, fallback: false });
            } catch (err) {
                const target = locale.toLowerCase();
                const rows = EDGE_TTS_FALLBACK_VOICES.filter((row) => !target || row.locale.toLowerCase() === target);
                res.json({ rows, locale, fallback: true, warning: err.message || "Edge TTS voices unavailable" });
            }
        } catch (err) {
            next(err);
        }
    });

    router.post("/reader-api/tts/edge", requireReader, async (req, res, next) => {
        try {
            const text = String(req.body?.text || "").trim();
            if (!text) return res.status(400).json({ error: "缺少朗读文本" });
            if (Array.from(text).length > 3000) return res.status(400).json({ error: "Edge TTS 单段最多 3000 字，请调小分段长度" });
            const audio = await edgeTtsSynthesize({
                text,
                voice: req.body?.voice || "zh-CN-XiaoxiaoNeural",
                rate: req.body?.rate,
                pitch: req.body?.pitch,
                volume: req.body?.volume
            });
            if (!audio || !audio.length) return res.status(502).json({ error: "Edge TTS 没有返回音频，请稍后重试或切换浏览器朗读" });
            res.setHeader("Content-Type", "audio/mpeg");
            res.setHeader("Cache-Control", "no-store");
            res.send(audio);
        } catch (err) {
            res.status(502).json({ error: err.message || "Edge TTS 合成失败，请稍后重试或切换浏览器朗读" });
        }
    });

    router.post("/reader-api/tts/provider", requireReader, async (req, res) => {
        try {
            const text = String(req.body?.text || "").trim();
            if (!text) return res.status(400).json({ error: "缺少朗读文本" });
            if (Array.from(text).length > 3000) return res.status(400).json({ error: "云 TTS 单段最多 3000 字，请调小分段长度" });

            const provider = String(req.body?.provider || req.body?.engine || "").trim().toLowerCase();
            const settings = ttsProviderSettings(req);
            const payload = {
                text,
                settings,
                rate: req.body?.rate,
                pitch: req.body?.pitch,
                volume: req.body?.volume
            };
            const handlers = {
                volcengine: synthesizeVolcengineTts,
                doubao: synthesizeVolcengineTts,
                aliyun: synthesizeAliyunTts,
                dashscope: synthesizeAliyunTts,
                azure: synthesizeAzureTts,
                elevenlabs: synthesizeElevenLabsTts,
                cartesia: synthesizeCartesiaTts
            };
            const handler = handlers[provider];
            if (!handler) return res.status(400).json({ error: "不支持的 TTS 服务" });
            const audio = await handler(payload);
            if (!audio || !audio.length) return res.status(502).json({ error: "TTS 服务没有返回音频，请稍后重试" });
            res.setHeader("Content-Type", "audio/mpeg");
            res.setHeader("Cache-Control", "no-store");
            res.send(audio);
        } catch (err) {
            res.status(err.status || 502).json({ error: err.message || "云 TTS 合成失败，请稍后重试" });
        }
    });

    return router;
}

module.exports = {
    createReaderTtsRoutes
};
