/**
 * [INPUT]: 依赖 Node crypto、版本化主密钥环和待存储的 PO18 Cookie/账户凭证字段
 * [OUTPUT]: 对外提供凭证加解密器、密钥环解析与存储凭证字段加密函数及密文标识常量
 * [POS]: services 的外部站点凭证边界，为数据库字段提供可轮换的版本化 AES-GCM 保护
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const crypto = require("crypto");

const PREFIX = "po18enc:v1";
const JSON_MARKER = "__po18_encrypted";

function keyBytes(value) {
    const raw = String(value || "").trim();
    if (!raw) return null;
    if (/^[a-f0-9]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
    try {
        const decoded = Buffer.from(raw, "base64");
        if (decoded.length === 32 && decoded.toString("base64").replace(/=+$/, "") === raw.replace(/=+$/, "")) return decoded;
    } catch {}
    return crypto.createHash("sha256").update(raw).digest();
}

function parseKeyRing(env = process.env, fallbackSecret = "") {
    const entries = [];
    const configured = String(env.PO18_CREDENTIAL_ENCRYPTION_KEYS || "").split(",").map((item) => item.trim()).filter(Boolean);
    for (const [index, entry] of configured.entries()) {
        const separator = entry.indexOf(":");
        const id = separator > 0 ? entry.slice(0, separator).trim() : `key-${index + 1}`;
        const value = separator > 0 ? entry.slice(separator + 1) : entry;
        const key = keyBytes(value);
        if (id && key) entries.push({ id: id.slice(0, 40), key });
    }
    if (!entries.length) {
        const explicit = env.PO18_CREDENTIAL_ENCRYPTION_KEY;
        const key = keyBytes(explicit || fallbackSecret);
        if (key) entries.push({ id: explicit ? "primary" : "session-v1", key });
    }
    return entries;
}

function createCredentialCrypto(options = {}) {
    const keys = parseKeyRing(options.env || process.env, options.fallbackSecret || "");
    const active = keys[0] || null;
    const byId = new Map(keys.map((item) => [item.id, item.key]));

    function isEncrypted(value) {
        return String(value || "").startsWith(`${PREFIX}:`);
    }

    function envelopeKeyId(value) {
        return isEncrypted(value) ? String(value).split(":")[2] || "" : "";
    }

    function encryptString(value) {
        const plain = String(value || "");
        if (!plain || !active) return plain;
        if (isEncrypted(plain) && envelopeKeyId(plain) === active.id) return plain;
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv("aes-256-gcm", active.key, iv);
        const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
        const tag = cipher.getAuthTag();
        return [PREFIX, active.id, iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(":");
    }

    function decryptString(value) {
        const stored = String(value || "");
        if (!isEncrypted(stored)) return stored;
        const parts = stored.split(":");
        if (parts.length !== 6) throw new Error("invalid encrypted credential envelope");
        const key = byId.get(parts[2]);
        if (!key) throw new Error(`credential encryption key unavailable: ${parts[2]}`);
        const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(parts[3], "base64url"));
        decipher.setAuthTag(Buffer.from(parts[4], "base64url"));
        return Buffer.concat([decipher.update(Buffer.from(parts[5], "base64url")), decipher.final()]).toString("utf8");
    }

    function encryptJson(value) {
        if (!active) return value;
        return { [JSON_MARKER]: encryptString(JSON.stringify(value ?? null)) };
    }

    function decryptJson(value, fallback = null) {
        if (!value || typeof value !== "object" || Array.isArray(value) || !value[JSON_MARKER]) return value ?? fallback;
        try {
            return JSON.parse(decryptString(value[JSON_MARKER]));
        } catch (err) {
            if (options.allowDecryptFailure) return fallback;
            throw err;
        }
    }

    function needsStringRotation(value) {
        return !!active && !!value && (!isEncrypted(value) || envelopeKeyId(value) !== active.id);
    }

    function needsJsonRotation(value) {
        return !!active && (!value || typeof value !== "object" || Array.isArray(value) || needsStringRotation(value[JSON_MARKER]));
    }

    return {
        activeKeyId: active?.id || "",
        configured: !!active,
        decryptJson,
        decryptString,
        encryptJson,
        encryptString,
        envelopeKeyId,
        isEncrypted,
        needsJsonRotation,
        needsStringRotation
    };
}

async function encryptStoredPo18Credentials(query, credentialCrypto) {
    if (!credentialCrypto?.configured) return { scanned: 0, updated: 0 };
    const rows = await query("SELECT user_id, password, cookies_json FROM reader_po18_accounts");
    let updated = 0;
    for (const row of rows.rows) {
        if (!credentialCrypto.needsStringRotation(row.password) && !credentialCrypto.needsJsonRotation(row.cookies_json)) continue;
        const password = credentialCrypto.encryptString(credentialCrypto.decryptString(row.password || ""));
        const cookies = credentialCrypto.encryptJson(credentialCrypto.decryptJson(row.cookies_json, []));
        await query("UPDATE reader_po18_accounts SET password=$2, cookies_json=$3::jsonb, updated_at=CURRENT_TIMESTAMP WHERE user_id=$1", [
            row.user_id,
            password,
            JSON.stringify(cookies)
        ]);
        updated += 1;
    }
    return { scanned: rows.rows.length, updated };
}

module.exports = {
    JSON_MARKER,
    PREFIX,
    createCredentialCrypto,
    encryptStoredPo18Credentials,
    parseKeyRing
};
