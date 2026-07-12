/**
 * [INPUT]: 依赖 docker/backup-pg 文件解析、backup-crypto 加密边界、文件系统与 WebDAV/S3 兼容 HTTP 协议
 * [OUTPUT]: 对外提供远程备份配置/状态、签名请求、对象 URL、上传与保留策略函数
 * [POS]: services 的远程备份适配层，只负责加密归档的上传、索引和删除，不冒充应用内下载/恢复通道
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { resolveBackupFile } = require("../docker/backup-pg");
const { backupEncryptionKey, encryptedBackupFile } = require("./backup-crypto");

const REMOTE_INDEX_FILE = ".po18-backups.json";

function positiveInt(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.trunc(number) : fallback;
}

function trimSlash(value = "") {
    return String(value || "").replace(/^\/+|\/+$/g, "");
}

function providerConfig(input = process.env) {
    const provider = String(input.PO18_REMOTE_BACKUP_PROVIDER || input.REMOTE_BACKUP_PROVIDER || "").trim().toLowerCase();
    return {
        provider,
        webdavUrl: String(input.PO18_REMOTE_BACKUP_WEBDAV_URL || "").trim(),
        webdavUsername: String(input.PO18_REMOTE_BACKUP_WEBDAV_USERNAME || "").trim(),
        webdavPassword: String(input.PO18_REMOTE_BACKUP_WEBDAV_PASSWORD || "").trim(),
        s3Endpoint: String(input.PO18_REMOTE_BACKUP_S3_ENDPOINT || "").trim().replace(/\/+$/, ""),
        s3Bucket: String(input.PO18_REMOTE_BACKUP_S3_BUCKET || "").trim(),
        s3Region: String(input.PO18_REMOTE_BACKUP_S3_REGION || "auto").trim() || "auto",
        s3AccessKey: String(input.PO18_REMOTE_BACKUP_S3_ACCESS_KEY || "").trim(),
        s3SecretKey: String(input.PO18_REMOTE_BACKUP_S3_SECRET_KEY || "").trim(),
        s3Prefix: trimSlash(input.PO18_REMOTE_BACKUP_S3_PREFIX || input.PO18_REMOTE_BACKUP_PREFIX || "po18-backups"),
        encryptionKey: backupEncryptionKey(input),
        remoteKeep: positiveInt(input.PO18_REMOTE_BACKUP_KEEP, 8)
    };
}

function remoteBackupStatus(config = providerConfig()) {
    const webdavReady = !!(config.webdavUrl && config.webdavUsername && config.webdavPassword);
    const s3Ready = !!(config.s3Endpoint && config.s3Bucket && config.s3AccessKey && config.s3SecretKey);
    return {
        provider: config.provider || (s3Ready ? "s3" : webdavReady ? "webdav" : ""),
        configured: webdavReady || s3Ready,
        encryption: { configured: !!config.encryptionKey, algorithm: config.encryptionKey ? "aes-256-gcm" : "" },
        retention: { keep: positiveInt(config.remoteKeep, 8), index: REMOTE_INDEX_FILE },
        webdav: { configured: webdavReady, url_present: !!config.webdavUrl, username_present: !!config.webdavUsername },
        s3: { configured: s3Ready, endpoint_present: !!config.s3Endpoint, bucket: config.s3Bucket || "", region: config.s3Region, prefix: config.s3Prefix }
    };
}

function hmac(key, value, encoding) {
    return crypto.createHmac("sha256", key).update(value).digest(encoding);
}

function sha256(value, encoding = "hex") {
    return crypto.createHash("sha256").update(value).digest(encoding);
}

async function backupFileDetails(filePath) {
    const stat = await fsp.stat(filePath);
    const hash = crypto.createHash("sha256");
    for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
    return { bytes: stat.size, sha256: hash.digest("hex") };
}

function s3SigningKey(secret, date, region) {
    const kDate = hmac(`AWS4${secret}`, date);
    const kRegion = hmac(kDate, region);
    const kService = hmac(kRegion, "s3");
    return hmac(kService, "aws4_request");
}

function s3ObjectUrl(config, objectKey) {
    const endpoint = new URL(config.s3Endpoint);
    const cleanKey = trimSlash(objectKey).split("/").map(encodeURIComponent).join("/");
    return new URL(`/${trimSlash(config.s3Bucket)}/${cleanKey}`, endpoint).toString();
}

function s3SignedRequest(config, objectKey, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const url = new URL(s3ObjectUrl(config, objectKey));
    const now = options.now || new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = options.payloadHash || sha256("");
    const canonicalUri = url.pathname
        .split("/")
        .map((part) => encodeURIComponent(decodeURIComponent(part)))
        .join("/");
    const headers = {
        host: url.host,
        "x-amz-content-sha256": payloadHash,
        "x-amz-date": amzDate,
        ...(options.metaSha256 ? { "x-amz-meta-sha256": options.metaSha256 } : {})
    };
    const canonicalHeaders = Object.keys(headers)
        .sort()
        .map((key) => `${key}:${headers[key]}\n`)
        .join("");
    const signedHeaders = Object.keys(headers).sort().join(";");
    const canonicalRequest = [method, canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
    const credentialScope = `${dateStamp}/${config.s3Region}/s3/aws4_request`;
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256(canonicalRequest)].join("\n");
    const signature = hmac(s3SigningKey(config.s3SecretKey, dateStamp, config.s3Region), stringToSign, "hex");
    return {
        url,
        headers: {
            ...headers,
            Authorization: `AWS4-HMAC-SHA256 Credential=${config.s3AccessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
        }
    };
}

async function uploadS3(filePath, config, objectKey, { details, fetchImpl = fetch } = {}) {
    const file = details || await backupFileDetails(filePath);
    const signed = s3SignedRequest(config, objectKey, { method: "PUT", payloadHash: file.sha256, metaSha256: file.sha256 });
    const response = await fetchImpl(signed.url, {
        method: "PUT",
        headers: {
            ...signed.headers,
            "Content-Length": String(file.bytes)
        },
        body: fs.createReadStream(filePath),
        duplex: "half"
    });
    if (!response.ok) throw Object.assign(new Error(`S3 upload failed: HTTP ${response.status}`), { status: response.status });
    return { provider: "s3", url: signed.url.toString(), bytes: file.bytes };
}

function webdavHeaders(config) {
    return { Authorization: `Basic ${Buffer.from(`${config.webdavUsername}:${config.webdavPassword}`).toString("base64")}` };
}

function webdavFileUrl(config, fileName) {
    const base = config.webdavUrl.endsWith("/") ? config.webdavUrl : `${config.webdavUrl}/`;
    return new URL(encodeURIComponent(fileName), base).toString();
}

async function uploadWebdav(filePath, config, fileName, { details, fetchImpl = fetch } = {}) {
    const file = details || await backupFileDetails(filePath);
    const url = webdavFileUrl(config, fileName);
    const response = await fetchImpl(url, {
        method: "PUT",
        headers: {
            ...webdavHeaders(config),
            "Content-Length": String(file.bytes),
            "X-PO18-Backup-SHA256": file.sha256
        },
        body: fs.createReadStream(filePath),
        duplex: "half"
    });
    if (!response.ok) throw Object.assign(new Error(`WebDAV upload failed: HTTP ${response.status}`), { status: response.status });
    return { provider: "webdav", url, bytes: file.bytes };
}

async function readRemoteIndex(config, fetchImpl) {
    let response;
    if (config.provider === "webdav") {
        response = await fetchImpl(webdavFileUrl(config, REMOTE_INDEX_FILE), { headers: webdavHeaders(config) });
    } else {
        const key = [config.s3Prefix, REMOTE_INDEX_FILE].filter(Boolean).join("/");
        const signed = s3SignedRequest(config, key, { method: "GET" });
        response = await fetchImpl(signed.url, { headers: signed.headers });
    }
    if (response.status === 404) return [];
    if (!response.ok) throw new Error(`remote backup index read failed: HTTP ${response.status}`);
    let payload = {};
    if (typeof response.json === "function") payload = await response.json();
    else if (typeof response.text === "function") payload = JSON.parse(await response.text());
    return Array.isArray(payload?.rows) ? payload.rows : [];
}

async function writeRemoteIndex(config, rows, fetchImpl) {
    const body = Buffer.from(`${JSON.stringify({ version: 1, updated_at: new Date().toISOString(), rows }, null, 2)}\n`);
    if (config.provider === "webdav") {
        const response = await fetchImpl(webdavFileUrl(config, REMOTE_INDEX_FILE), {
            method: "PUT",
            headers: { ...webdavHeaders(config), "Content-Type": "application/json", "Content-Length": String(body.length) },
            body
        });
        if (!response.ok) throw new Error(`remote backup index write failed: HTTP ${response.status}`);
        return;
    }
    const key = [config.s3Prefix, REMOTE_INDEX_FILE].filter(Boolean).join("/");
    const payloadHash = sha256(body);
    const signed = s3SignedRequest(config, key, { method: "PUT", payloadHash });
    const response = await fetchImpl(signed.url, {
        method: "PUT",
        headers: { ...signed.headers, "Content-Length": String(body.length) },
        body
    });
    if (!response.ok) throw new Error(`remote backup index write failed: HTTP ${response.status}`);
}

async function deleteRemoteFile(config, fileName, fetchImpl) {
    let response;
    if (config.provider === "webdav") {
        response = await fetchImpl(webdavFileUrl(config, fileName), { method: "DELETE", headers: webdavHeaders(config) });
    } else {
        const key = [config.s3Prefix, fileName].filter(Boolean).join("/");
        const signed = s3SignedRequest(config, key, { method: "DELETE" });
        response = await fetchImpl(signed.url, { method: "DELETE", headers: signed.headers });
    }
    if (!response.ok && response.status !== 404) throw new Error(`remote backup delete failed: HTTP ${response.status}`);
}

async function applyRemoteRetention(config, uploaded, fetchImpl) {
    const keep = positiveInt(config.remoteKeep, 8);
    const previous = await readRemoteIndex(config, fetchImpl);
    const row = {
        file: uploaded.file,
        created_at: new Date().toISOString(),
        bytes: uploaded.bytes,
        sha256: uploaded.sha256 || "",
        encrypted: !!uploaded.encrypted
    };
    const rows = [row, ...previous.filter((item) => item?.file && item.file !== row.file)]
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const retained = rows.slice(0, keep);
    const removed = rows.slice(keep).map((item) => item.file);
    for (const file of removed) await deleteRemoteFile(config, file, fetchImpl);
    await writeRemoteIndex(config, retained, fetchImpl);
    return { keep, removed };
}

async function uploadBackupToRemote(fileName, { backupDir, config = providerConfig(), fetchImpl = fetch } = {}) {
    const filePath = resolveBackupFile(fileName, backupDir);
    await fsp.access(filePath);
    const status = remoteBackupStatus(config);
    let uploadFile = filePath;
    let uploadName = path.basename(filePath);
    let encrypted = null;
    try {
        if (config.encryptionKey) {
            encrypted = await encryptedBackupFile(filePath, { passphrase: config.encryptionKey });
            uploadFile = encrypted.file;
            uploadName = `${path.basename(filePath)}.enc`;
        }
        const details = await backupFileDetails(uploadFile);
        let result;
        if (config.provider === "webdav" || (!config.provider && status.webdav.configured)) {
            if (!status.webdav.configured) throw Object.assign(new Error("WebDAV remote backup is not configured"), { status: 400 });
            result = await uploadWebdav(uploadFile, config, uploadName, { details, fetchImpl });
        } else if (config.provider === "s3" || config.provider === "r2" || (!config.provider && status.s3.configured)) {
            if (!status.s3.configured) throw Object.assign(new Error("S3/R2 remote backup is not configured"), { status: 400 });
            const key = [config.s3Prefix, uploadName].filter(Boolean).join("/");
            result = await uploadS3(uploadFile, config, key, { details, fetchImpl });
        } else {
            throw Object.assign(new Error("remote backup is not configured"), { status: 400 });
        }
        const uploaded = {
            ...result,
            ...(encrypted ? {
                encrypted: true,
                encryption: encrypted.algorithm,
                source_file: path.basename(filePath),
                remote_file: uploadName
            } : {})
        };
        try {
            uploaded.retention = await applyRemoteRetention({ ...config, provider: result.provider }, {
                file: uploadName,
                bytes: result.bytes,
                sha256: details.sha256,
                encrypted: !!encrypted
            }, fetchImpl);
        } catch (err) {
            uploaded.retention = { keep: positiveInt(config.remoteKeep, 8), removed: [], error: err.message || String(err) };
        }
        return uploaded;
    } finally {
        if (encrypted?.file) await fsp.rm(encrypted.file, { force: true }).catch(() => {});
    }
}

module.exports = {
    applyRemoteRetention,
    backupFileDetails,
    providerConfig,
    remoteBackupStatus,
    s3SignedRequest,
    s3ObjectUrl,
    uploadBackupToRemote
};
