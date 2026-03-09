const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const env = require("../config/env");
const AppError = require("../utils/app-error");

const JWKS_CACHE_TTL_MS = 5 * 60 * 1000;
const SUPABASE_JWT_AUDIENCE = "authenticated";

let jwksCache = {
    expiresAt: 0,
    keysByKid: new Map()
};

function getSupabaseIssuer() {
    return `${env.supabaseUrl.replace(/\/+$/, "")}/auth/v1`;
}

function toAppError() {
    return new AppError(401, "AUTH_TOKEN_INVALID", "Authorization token is invalid.");
}

function isJwtError(error) {
    return error instanceof jwt.JsonWebTokenError
        || error instanceof jwt.NotBeforeError
        || error instanceof jwt.TokenExpiredError;
}

async function refreshJwksCache() {
    const jwksUrl = `${getSupabaseIssuer()}/.well-known/jwks.json`;
    const response = await fetch(jwksUrl, { method: "GET" });

    if (!response.ok) {
        throw new Error(`JWKS_FETCH_FAILED:${response.status}`);
    }

    const payload = await response.json();
    const keys = Array.isArray(payload?.keys) ? payload.keys : [];
    const keysByKid = new Map();

    for (const jwk of keys) {
        if (!jwk?.kid) {
            continue;
        }

        try {
            const keyObject = crypto.createPublicKey({ key: jwk, format: "jwk" });
            keysByKid.set(jwk.kid, keyObject);
        } catch {
            // Skip malformed keys and continue with valid entries.
        }
    }

    if (!keysByKid.size) {
        throw new Error("JWKS_EMPTY");
    }

    jwksCache = {
        expiresAt: Date.now() + JWKS_CACHE_TTL_MS,
        keysByKid
    };
}

async function getKeyByKid(kid) {
    if (!kid) {
        return null;
    }

    const now = Date.now();
    if (jwksCache.expiresAt <= now || !jwksCache.keysByKid.size) {
        await refreshJwksCache();
    }

    let key = jwksCache.keysByKid.get(kid) || null;

    if (!key) {
        await refreshJwksCache();
        key = jwksCache.keysByKid.get(kid) || null;
    }

    return key;
}

function buildAuthUserFromClaims(claims) {
    return {
        id: claims.sub,
        aud: claims.aud,
        role: claims.role,
        email: claims.email || null,
        phone: claims.phone || "",
        app_metadata: claims.app_metadata || {},
        user_metadata: claims.user_metadata || {},
        is_anonymous: Boolean(claims.is_anonymous)
    };
}

async function verifySupabaseAccessToken(token) {
    if (!token || typeof token !== "string") {
        throw toAppError();
    }

    let decoded;
    try {
        decoded = jwt.decode(token, { complete: true });
    } catch {
        throw toAppError();
    }

    const header = decoded?.header || {};
    const algorithm = String(header.alg || "").toUpperCase();

    if (!algorithm) {
        throw toAppError();
    }

    try {
        let claims;
        const verifyOptions = {
            issuer: getSupabaseIssuer(),
            audience: SUPABASE_JWT_AUDIENCE
        };

        if (algorithm.startsWith("HS")) {
            if (!env.jwtSecret) {
                throw toAppError();
            }

            claims = jwt.verify(token, env.jwtSecret, {
                ...verifyOptions,
                algorithms: [algorithm]
            });
        } else {
            const key = await getKeyByKid(header.kid);
            if (!key) {
                throw toAppError();
            }

            claims = jwt.verify(token, key, {
                ...verifyOptions,
                algorithms: [algorithm]
            });
        }

        if (!claims?.sub) {
            throw toAppError();
        }

        return buildAuthUserFromClaims(claims);
    } catch (error) {
        if (error instanceof AppError || isJwtError(error)) {
            throw toAppError();
        }

        throw error;
    }
}

module.exports = {
    verifySupabaseAccessToken
};
