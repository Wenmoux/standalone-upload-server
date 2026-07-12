/**
 * [INPUT]: 依赖 Node crypto、流式文件系统、临时目录与环境中的备份加密密钥
 * [OUTPUT]: 对外提供备份密钥解析、AES-256-GCM 加密文件生成、解密文件恢复及密文标识常量
 * [POS]: services 的备份机密性边界，仅负责流式加解密并由远程备份与恢复流程编排
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const { pipeline } = require("stream/promises");

const MAGIC = Buffer.from("PO18BKP1", "ascii");
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;

function backupEncryptionKey(env = process.env) {
    return String(env.PO18_BACKUP_ENCRYPTION_KEY || env.BACKUP_ENCRYPTION_KEY || "").trim();
}

function deriveKey(passphrase, salt) {
    return crypto.scryptSync(String(passphrase || ""), salt, 32);
}

async function encryptedBackupFile(sourceFile, options = {}) {
    const passphrase = String(options.passphrase || backupEncryptionKey()).trim();
    if (!passphrase) return null;
    const outputDir = options.outputDir || os.tmpdir();
    await fsp.mkdir(outputDir, { recursive: true });
    const salt = crypto.randomBytes(SALT_BYTES);
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);
    const outputFile = options.outputFile || path.join(outputDir, `${path.basename(sourceFile)}.${crypto.randomBytes(6).toString("hex")}.enc`);
    await fsp.writeFile(outputFile, Buffer.concat([MAGIC, salt, iv]), { flag: "wx" });
    try {
        await pipeline(fs.createReadStream(sourceFile), cipher, fs.createWriteStream(outputFile, { flags: "a" }));
        await fsp.appendFile(outputFile, cipher.getAuthTag());
        return {
            file: outputFile,
            algorithm: "aes-256-gcm",
            format: MAGIC.toString("ascii"),
            sourceFile: path.basename(sourceFile)
        };
    } catch (err) {
        await fsp.rm(outputFile, { force: true }).catch(() => {});
        throw err;
    }
}

async function decryptBackupFile(encryptedFile, options = {}) {
    const passphrase = String(options.passphrase || backupEncryptionKey()).trim();
    if (!passphrase) throw new Error("backup encryption key is not configured");
    const data = await fsp.readFile(encryptedFile);
    const headerBytes = MAGIC.length + SALT_BYTES + IV_BYTES;
    if (data.length <= headerBytes + TAG_BYTES || !data.subarray(0, MAGIC.length).equals(MAGIC)) {
        throw new Error("invalid encrypted backup format");
    }
    const salt = data.subarray(MAGIC.length, MAGIC.length + SALT_BYTES);
    const iv = data.subarray(MAGIC.length + SALT_BYTES, headerBytes);
    const tag = data.subarray(data.length - TAG_BYTES);
    const ciphertext = data.subarray(headerBytes, data.length - TAG_BYTES);
    const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

module.exports = {
    MAGIC,
    backupEncryptionKey,
    decryptBackupFile,
    encryptedBackupFile
};
