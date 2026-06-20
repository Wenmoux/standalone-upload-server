const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { resolveBackupFile } = require("../docker/backup-pg");

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
        s3Prefix: trimSlash(input.PO18_REMOTE_BACKUP_S3_PREFIX || input.PO18_REMOTE_BACKUP_PREFIX || "po18-backups")
    };
}

function remoteBackupStatus(config = providerConfig()) {
    const webdavReady = !!(config.webdavUrl && config.webdavUsername && config.webdavPassword);
    const s3Ready = !!(config.s3Endpoint && config.s3Bucket && config.s3AccessKey && config.s3SecretKey);
    return {
        provider: config.provider || (s3Ready ? "s3" : webdavReady ? "webdav" : ""),
        configured: webdavReady || s3Ready,
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

async function uploadS3(filePath, config, objectKey) {
    const body = await fs.readFile(filePath);
    const url = new URL(s3ObjectUrl(config, objectKey));
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = sha256(body);
    const canonicalUri = url.pathname.split("/").map((part) => encodeURIComponent(decodeURIComponent(part))).join("/");
    const canonicalQuery = "";
    const headers = {
        "host": url.host,
        "x-amz-content-sha256": payloadHash,
        "x-amz-date": amzDate
    };
    const canonicalHeaders = Object.keys(headers).sort().map((key) => `${key}:${headers[key]}\n`).join("");
    const signedHeaders = Object.keys(headers).sort().join(";");
    const canonicalRequest = ["PUT", canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join("\n");
    const credentialScope = `${dateStamp}/${config.s3Region}/s3/aws4_request`;
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256(canonicalRequest)].join("\n");
    const signature = hmac(s3SigningKey(config.s3SecretKey, dateStamp, config.s3Region), stringToSign, "hex");
    const response = await fetch(url, {
        method: "PUT",
        headers: {
            ...headers,
            Authorization: `AWS4-HMAC-SHA256 Credential=${config.s3AccessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
        },
        body
    });
    if (!response.ok) throw Object.assign(new Error(`S3 upload failed: HTTP ${response.status}`), { status: response.status });
    return { provider: "s3", url: url.toString(), bytes: body.length };
}

async function uploadWebdav(filePath, config, fileName) {
    const body = await fs.readFile(filePath);
    const base = config.webdavUrl.endsWith("/") ? config.webdavUrl : `${config.webdavUrl}/`;
    const url = new URL(encodeURIComponent(fileName), base).toString();
    const response = await fetch(url, {
        method: "PUT",
        headers: {
            Authorization: `Basic ${Buffer.from(`${config.webdavUsername}:${config.webdavPassword}`).toString("base64")}`
        },
        body
    });
    if (!response.ok) throw Object.assign(new Error(`WebDAV upload failed: HTTP ${response.status}`), { status: response.status });
    return { provider: "webdav", url, bytes: body.length };
}

async function uploadBackupToRemote(fileName, { backupDir, config = providerConfig() } = {}) {
    const filePath = resolveBackupFile(fileName, backupDir);
    await fs.access(filePath);
    const baseName = path.basename(filePath);
    const status = remoteBackupStatus(config);
    if (config.provider === "webdav" || (!config.provider && status.webdav.configured)) {
        if (!status.webdav.configured) throw Object.assign(new Error("WebDAV remote backup is not configured"), { status: 400 });
        return uploadWebdav(filePath, config, baseName);
    }
    if (config.provider === "s3" || config.provider === "r2" || (!config.provider && status.s3.configured)) {
        if (!status.s3.configured) throw Object.assign(new Error("S3/R2 remote backup is not configured"), { status: 400 });
        const key = [config.s3Prefix, baseName].filter(Boolean).join("/");
        return uploadS3(filePath, config, key);
    }
    throw Object.assign(new Error("remote backup is not configured"), { status: 400 });
}

module.exports = {
    providerConfig,
    remoteBackupStatus,
    s3ObjectUrl,
    uploadBackupToRemote
};
