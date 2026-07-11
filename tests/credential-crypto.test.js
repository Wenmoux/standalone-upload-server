const assert = require("assert/strict");
const test = require("node:test");
const { createCredentialCrypto } = require("../services/credential-crypto");

test("credential crypto encrypts strings and json with authenticated encryption", () => {
    const cryptoService = createCredentialCrypto({ fallbackSecret: "test-secret-one" });
    const encrypted = cryptoService.encryptString("password-123");
    assert.notEqual(encrypted, "password-123");
    assert.equal(cryptoService.isEncrypted(encrypted), true);
    assert.equal(cryptoService.decryptString(encrypted), "password-123");

    const encryptedJson = cryptoService.encryptJson([{ name: "authtoken1", value: "secret" }]);
    assert.equal(Array.isArray(encryptedJson), false);
    assert.deepEqual(cryptoService.decryptJson(encryptedJson), [{ name: "authtoken1", value: "secret" }]);

    const tampered = `${encrypted.slice(0, -1)}${encrypted.endsWith("A") ? "B" : "A"}`;
    assert.throws(() => cryptoService.decryptString(tampered));
});

test("credential crypto key ring decrypts old keys and marks rotation", () => {
    const oldKey = Buffer.alloc(32, 1).toString("base64");
    const newKey = Buffer.alloc(32, 2).toString("base64");
    const oldCrypto = createCredentialCrypto({ env: { PO18_CREDENTIAL_ENCRYPTION_KEYS: `old:${oldKey}` } });
    const oldValue = oldCrypto.encryptString("rotate-me");
    const rotating = createCredentialCrypto({ env: { PO18_CREDENTIAL_ENCRYPTION_KEYS: `new:${newKey},old:${oldKey}` } });
    assert.equal(rotating.decryptString(oldValue), "rotate-me");
    assert.equal(rotating.needsStringRotation(oldValue), true);
    const rotated = rotating.encryptString(rotating.decryptString(oldValue));
    assert.equal(rotating.envelopeKeyId(rotated), "new");
});
