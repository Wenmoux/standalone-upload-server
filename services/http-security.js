function listValues(value) {
    return String(value || "")
        .split(/[\s,]+/)
        .map((item) => item.trim())
        .filter(Boolean);
}

function allowedCorsOrigins(env = process.env) {
    return listValues(env.PO18_CORS_ORIGINS);
}

function isCorsOriginAllowed(origin, env = process.env) {
    if (!origin) return true;
    const allowed = allowedCorsOrigins(env);
    if (allowed.includes(origin)) return true;
    if (allowed.includes("*") && env.PO18_ALLOW_INSECURE_CORS === "1") return true;
    return env.NODE_ENV !== "production" && allowed.length === 0;
}

function corsOriginCallback(env = process.env) {
    return (origin, callback) => callback(null, isCorsOriginAllowed(origin, env));
}

function trustProxySetting(value = process.env.PO18_TRUST_PROXY) {
    const normalized = String(value || "").trim().toLowerCase();
    if (!normalized || normalized === "false" || normalized === "0") return false;
    if (normalized === "true") return true;
    if (/^\d+$/.test(normalized)) return Number(normalized);
    return String(value).trim();
}

function productionSecurityErrors(env = process.env) {
    if (env.NODE_ENV !== "production" || env.PO18_ALLOW_INSECURE_DEFAULTS === "1") return [];
    const errors = [];
    const sessionSecret = String(env.PO18_UPLOAD_SESSION_SECRET || "");
    const adminPassword = String(env.PO18_UPLOAD_ADMIN_PASSWORD || "");
    if (!sessionSecret || sessionSecret === "po18-upload-pg-change-me") {
        errors.push("PO18_UPLOAD_SESSION_SECRET must be configured for production");
    }
    if (!adminPassword || adminPassword === "admin123") {
        errors.push("PO18_UPLOAD_ADMIN_PASSWORD must be configured for production");
    }
    if (env.PO18_SETUP_AUTH_DISABLED === "1") {
        errors.push("PO18_SETUP_AUTH_DISABLED cannot be enabled in production");
    }
    if (allowedCorsOrigins(env).includes("*") && env.PO18_ALLOW_INSECURE_CORS !== "1") {
        errors.push("wildcard PO18_CORS_ORIGINS requires PO18_ALLOW_INSECURE_CORS=1");
    }
    return errors;
}

function assertProductionSecurity(env = process.env) {
    const errors = productionSecurityErrors(env);
    if (errors.length) throw new Error(`unsafe production configuration: ${errors.join("; ")}`);
}

module.exports = {
    allowedCorsOrigins,
    assertProductionSecurity,
    corsOriginCallback,
    isCorsOriginAllowed,
    listValues,
    productionSecurityErrors,
    trustProxySetting
};
