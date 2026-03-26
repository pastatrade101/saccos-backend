const crypto = require("crypto");
const speakeasy = require("speakeasy");
const QRCode = require("qrcode");

const env = require("../config/env");
const { adminSupabase } = require("../config/supabase");
const AppError = require("../utils/app-error");
const { logAudit } = require("./audit.service");
const { invalidateUserContextCache } = require("./user-context.service");
const { STAFF_ROLES, ROLES } = require("../constants/roles");

const BACKUP_CODE_COUNT = 8;
const BACKUP_CODE_BYTES = 3;
const TOTP_WINDOW = 1;

function getEncryptionKey() {
    return crypto
        .createHash("sha256")
        .update(env.twoFactorEncryptionKey)
        .digest();
}

function encryptSecret(secret) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    return JSON.stringify({
        iv: iv.toString("base64"),
        tag: tag.toString("base64"),
        ciphertext: encrypted.toString("base64")
    });
}

function decryptSecret(payload) {
    if (!payload) {
        return null;
    }

    const parsed = typeof payload === "string" ? JSON.parse(payload) : payload;
    const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        getEncryptionKey(),
        Buffer.from(parsed.iv, "base64")
    );
    decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));

    const decrypted = Buffer.concat([
        decipher.update(Buffer.from(parsed.ciphertext, "base64")),
        decipher.final()
    ]);

    return decrypted.toString("utf8");
}

function isTwoFactorRequiredForRole(role) {
    return STAFF_ROLES.includes(role) || role === ROLES.PLATFORM_ADMIN || role === ROLES.PLATFORM_OWNER;
}

function isTwoFactorConfigured(profile) {
    return Boolean(profile?.two_factor_enabled && profile?.two_factor_verified && profile?.two_factor_secret);
}

function normalizeBackupCode(code) {
    return String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function hashBackupCode(code) {
    return crypto
        .createHash("sha256")
        .update(`${env.twoFactorBackupCodePepper}:${normalizeBackupCode(code)}`)
        .digest("hex");
}

function generateBackupCode() {
    const token = crypto.randomBytes(BACKUP_CODE_BYTES).toString("base64url").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const normalized = token.slice(0, 8).padEnd(8, "X");
    return `${normalized.slice(0, 4)}-${normalized.slice(4, 8)}`;
}

function generateBackupCodes() {
    const codes = Array.from({ length: BACKUP_CODE_COUNT }, () => generateBackupCode());
    const hashedCodes = codes.map((code) => ({
        code_hash: hashBackupCode(code),
        used_at: null
    }));

    return {
        codes,
        hashedCodes
    };
}

function buildVerifiedUntil() {
    return new Date(Date.now() + env.twoFactorStepUpTtlMinutes * 60 * 1000).toISOString();
}

function isRecentVerification(profile) {
    if (!profile?.two_factor_last_verified_at) {
        return false;
    }

    const lastVerifiedMs = Date.parse(profile.two_factor_last_verified_at);
    if (!Number.isFinite(lastVerifiedMs)) {
        return false;
    }

    const ageMs = Date.now() - lastVerifiedMs;
    return ageMs >= 0 && ageMs <= env.twoFactorStepUpTtlMinutes * 60 * 1000;
}

async function getTwoFactorProfile(userId) {
    const { data, error } = await adminSupabase
        .from("user_profiles")
        .select([
            "user_id",
            "tenant_id",
            "full_name",
            "role",
            "two_factor_enabled",
            "two_factor_secret",
            "two_factor_verified",
            "two_factor_backup_codes",
            "two_factor_enabled_at",
            "two_factor_last_verified_at",
            "two_factor_failed_attempts",
            "two_factor_locked_until"
        ].join(","))
        .eq("user_id", userId)
        .is("deleted_at", null)
        .maybeSingle();

    if (error) {
        throw new AppError(500, "TWO_FACTOR_PROFILE_LOOKUP_FAILED", "Unable to load two-factor profile.", error);
    }

    if (!data) {
        throw new AppError(404, "PROFILE_NOT_FOUND", "User profile is not provisioned.");
    }

    return data;
}

async function updateTwoFactorProfile(userId, patch) {
    const { data, error } = await adminSupabase
        .from("user_profiles")
        .update(patch)
        .eq("user_id", userId)
        .select([
            "user_id",
            "tenant_id",
            "full_name",
            "role",
            "two_factor_enabled",
            "two_factor_secret",
            "two_factor_verified",
            "two_factor_backup_codes",
            "two_factor_enabled_at",
            "two_factor_last_verified_at",
            "two_factor_failed_attempts",
            "two_factor_locked_until"
        ].join(","))
        .single();

    if (error || !data) {
        throw new AppError(500, "TWO_FACTOR_PROFILE_UPDATE_FAILED", "Unable to update two-factor state.", error);
    }

    invalidateUserContextCache(userId);
    try {
        const authService = require("../modules/auth/auth.service");
        if (typeof authService.invalidateSignInProfileCache === "function") {
            authService.invalidateSignInProfileCache(userId);
        }
    } catch {
        // Ignore optional sign-in cache invalidation failures.
    }

    return data;
}

function assertNotLocked(profile) {
    if (!profile?.two_factor_locked_until) {
        return;
    }

    const lockedUntilMs = Date.parse(profile.two_factor_locked_until);
    if (Number.isFinite(lockedUntilMs) && lockedUntilMs > Date.now()) {
        throw new AppError(
            429,
            "TWO_FACTOR_LOCKED",
            "Too many invalid authenticator attempts. Try again later.",
            {
                locked_until: profile.two_factor_locked_until
            }
        );
    }
}

async function recordFailedAttempt(profile) {
    const nextFailedAttempts = Number(profile.two_factor_failed_attempts || 0) + 1;
    const reachedLockout = nextFailedAttempts >= env.twoFactorMaxFailedAttempts;
    const lockedUntil = reachedLockout
        ? new Date(Date.now() + env.twoFactorLockoutMinutes * 60 * 1000).toISOString()
        : null;

    await updateTwoFactorProfile(profile.user_id, {
        two_factor_failed_attempts: nextFailedAttempts,
        two_factor_locked_until: lockedUntil
    });

    if (reachedLockout) {
        throw new AppError(
            429,
            "TWO_FACTOR_LOCKED",
            "Too many invalid authenticator attempts. Try again later.",
            {
                locked_until: lockedUntil
            }
        );
    }

    throw new AppError(401, "TWO_FACTOR_INVALID", "Invalid authenticator code.");
}

async function markSuccessfulVerification(profile) {
    const now = new Date().toISOString();
    await updateTwoFactorProfile(profile.user_id, {
        two_factor_failed_attempts: 0,
        two_factor_locked_until: null,
        two_factor_last_verified_at: now
    });

    return {
        verified_at: now,
        verified_until: buildVerifiedUntil()
    };
}

async function consumeRecoveryCode(profile, recoveryCode) {
    const codes = Array.isArray(profile.two_factor_backup_codes) ? profile.two_factor_backup_codes : [];
    const normalizedHash = hashBackupCode(recoveryCode);
    const matchIndex = codes.findIndex((entry) => entry?.code_hash === normalizedHash && !entry?.used_at);

    if (matchIndex < 0) {
        return false;
    }

    const nextCodes = codes.map((entry, index) => (
        index === matchIndex
            ? {
                ...entry,
                used_at: new Date().toISOString()
            }
            : entry
    ));

    await updateTwoFactorProfile(profile.user_id, {
        two_factor_backup_codes: nextCodes,
        two_factor_failed_attempts: 0,
        two_factor_locked_until: null,
        two_factor_last_verified_at: new Date().toISOString()
    });

    return true;
}

async function verifySecondFactorForUser({
    userId,
    totpCode = null,
    recoveryCode = null,
    purpose = "signin"
}) {
    const profile = await getTwoFactorProfile(userId);
    assertNotLocked(profile);

    if (!isTwoFactorConfigured(profile)) {
        throw new AppError(
            403,
            "TWO_FACTOR_SETUP_REQUIRED",
            "Two-factor authentication must be configured before continuing.",
            {
                two_factor_setup_required: true
            }
        );
    }

    if (recoveryCode) {
        const consumed = await consumeRecoveryCode(profile, recoveryCode);
        if (!consumed) {
            await recordFailedAttempt(profile);
        }

        return {
            method: "recovery_code",
            ...await markSuccessfulVerification(profile)
        };
    }

    if (!totpCode) {
        throw new AppError(401, "TWO_FACTOR_REQUIRED", "Authenticator code required.", {
            two_factor_required: true
        });
    }

    const decryptedSecret = decryptSecret(profile.two_factor_secret);
    const valid = speakeasy.totp.verify({
        secret: decryptedSecret,
        encoding: "base32",
        token: String(totpCode).trim(),
        window: TOTP_WINDOW
    });

    if (!valid) {
        await recordFailedAttempt(profile);
    }

    return {
        method: "totp",
        ...await markSuccessfulVerification(profile)
    };
}

async function setupTwoFactor(actor) {
    const profile = await getTwoFactorProfile(actor.user.id);

    if (profile.two_factor_enabled && profile.two_factor_verified) {
        throw new AppError(409, "TWO_FACTOR_ALREADY_ENABLED", "Two-factor authentication is already enabled.");
    }

    const label = actor.user.email || profile.full_name || actor.user.id;
    const secret = speakeasy.generateSecret({
        length: 20,
        name: label,
        issuer: env.twoFactorIssuer
    });
    const qrCode = await QRCode.toDataURL(secret.otpauth_url);

    await updateTwoFactorProfile(actor.user.id, {
        two_factor_secret: encryptSecret(secret.base32),
        two_factor_enabled: false,
        two_factor_verified: false,
        two_factor_backup_codes: null,
        two_factor_enabled_at: null,
        two_factor_last_verified_at: null,
        two_factor_failed_attempts: 0,
        two_factor_locked_until: null
    });

    await logAudit({
        tenantId: profile.tenant_id,
        actorUserId: actor.user.id,
        table: "user_profiles",
        action: "TWO_FACTOR_SETUP_STARTED",
        entityType: "user_profile",
        entityId: actor.user.id,
        afterData: {
            user_id: actor.user.id,
            two_factor_enabled: false
        }
    });

    return {
        qr_code: qrCode,
        manual_entry_key: secret.base32,
        issuer: env.twoFactorIssuer,
        account_name: label
    };
}

async function verifyTwoFactorSetup(actor, totpCode) {
    const profile = await getTwoFactorProfile(actor.user.id);
    assertNotLocked(profile);

    if (!profile.two_factor_secret) {
        throw new AppError(400, "TWO_FACTOR_SETUP_NOT_STARTED", "Start two-factor setup before verifying.");
    }

    const decryptedSecret = decryptSecret(profile.two_factor_secret);
    const valid = speakeasy.totp.verify({
        secret: decryptedSecret,
        encoding: "base32",
        token: String(totpCode).trim(),
        window: TOTP_WINDOW
    });

    if (!valid) {
        await recordFailedAttempt(profile);
    }

    const { codes, hashedCodes } = generateBackupCodes();
    const now = new Date().toISOString();

    await updateTwoFactorProfile(actor.user.id, {
        two_factor_enabled: true,
        two_factor_verified: true,
        two_factor_backup_codes: hashedCodes,
        two_factor_enabled_at: now,
        two_factor_last_verified_at: now,
        two_factor_failed_attempts: 0,
        two_factor_locked_until: null
    });

    await logAudit({
        tenantId: profile.tenant_id,
        actorUserId: actor.user.id,
        table: "user_profiles",
        action: "TWO_FACTOR_ENABLED",
        entityType: "user_profile",
        entityId: actor.user.id,
        afterData: {
            user_id: actor.user.id,
            two_factor_enabled: true,
            two_factor_enabled_at: now
        }
    });

    return {
        success: true,
        backup_codes: codes,
        enabled_at: now
    };
}

async function validateTwoFactor(actor, payload = {}) {
    const verification = await verifySecondFactorForUser({
        userId: actor.user.id,
        totpCode: payload.totp_code || null,
        recoveryCode: payload.recovery_code || null,
        purpose: "validate"
    });

    return {
        success: true,
        method: verification.method,
        verified_at: verification.verified_at,
        verified_until: verification.verified_until
    };
}

async function regenerateBackupCodes(actor, payload = {}) {
    const profile = await getTwoFactorProfile(actor.user.id);

    if (!isTwoFactorConfigured(profile)) {
        throw new AppError(400, "TWO_FACTOR_NOT_ENABLED", "Two-factor authentication is not enabled.");
    }

    await verifySecondFactorForUser({
        userId: actor.user.id,
        totpCode: payload.totp_code || null,
        recoveryCode: payload.recovery_code || null,
        purpose: "backup-regenerate"
    });

    const { codes, hashedCodes } = generateBackupCodes();
    await updateTwoFactorProfile(actor.user.id, {
        two_factor_backup_codes: hashedCodes
    });

    await logAudit({
        tenantId: profile.tenant_id,
        actorUserId: actor.user.id,
        table: "user_profiles",
        action: "TWO_FACTOR_BACKUP_CODES_REGENERATED",
        entityType: "user_profile",
        entityId: actor.user.id,
        afterData: {
            user_id: actor.user.id
        }
    });

    return {
        success: true,
        backup_codes: codes
    };
}

async function disableTwoFactor(actor, payload = {}) {
    const profile = await getTwoFactorProfile(actor.user.id);

    if (!isTwoFactorConfigured(profile)) {
        throw new AppError(400, "TWO_FACTOR_NOT_ENABLED", "Two-factor authentication is not enabled.");
    }

    await verifySecondFactorForUser({
        userId: actor.user.id,
        totpCode: payload.totp_code || null,
        recoveryCode: payload.recovery_code || null,
        purpose: "disable"
    });

    await updateTwoFactorProfile(actor.user.id, {
        two_factor_enabled: false,
        two_factor_verified: false,
        two_factor_secret: null,
        two_factor_backup_codes: null,
        two_factor_enabled_at: null,
        two_factor_last_verified_at: null,
        two_factor_failed_attempts: 0,
        two_factor_locked_until: null
    });

    await logAudit({
        tenantId: profile.tenant_id,
        actorUserId: actor.user.id,
        table: "user_profiles",
        action: "TWO_FACTOR_DISABLED",
        entityType: "user_profile",
        entityId: actor.user.id,
        beforeData: {
            user_id: actor.user.id,
            two_factor_enabled: true
        },
        afterData: {
            user_id: actor.user.id,
            two_factor_enabled: false
        }
    });

    return {
        success: true
    };
}

async function authenticateWithRecovery(payload, authenticatePassword) {
    const auth = await authenticatePassword(payload);
    const profile = auth.profile;
    const twoFactorRequired = isTwoFactorRequiredForRole(profile?.role || null);

    if (!twoFactorRequired && !isTwoFactorConfigured(profile)) {
        throw new AppError(400, "TWO_FACTOR_NOT_ENABLED", "Two-factor authentication is not enabled for this account.");
    }

    await verifySecondFactorForUser({
        userId: auth.user.id,
        recoveryCode: payload.recovery_code,
        purpose: "recovery"
    });

    return auth;
}

async function assertTwoFactorStepUp(actor, payload = {}, options = {}) {
    const role = actor.role || actor.profile?.role || null;
    const requiredByRole = isTwoFactorRequiredForRole(role);
    const profile = await getTwoFactorProfile(actor.user.id);
    const enabled = isTwoFactorConfigured(profile);

    if (requiredByRole && !enabled) {
        throw new AppError(
            403,
            "TWO_FACTOR_SETUP_REQUIRED",
            "Set up authenticator-based verification before performing this action.",
            {
                two_factor_setup_required: true,
                action: options.action || null
            }
        );
    }

    if (!enabled) {
        return {
            required: false,
            verified: false
        };
    }

    if (isRecentVerification(profile)) {
        return {
            required: true,
            verified: true,
            reused_session_verification: true
        };
    }

    const totpCode = payload.two_factor_code || payload.totp_code || null;
    const recoveryCode = payload.recovery_code || null;

    if (!totpCode && !recoveryCode) {
        throw new AppError(
            403,
            "TWO_FACTOR_STEP_UP_REQUIRED",
            "Authenticator verification is required before completing this action.",
            {
                step_up_required: true,
                action: options.action || null
            }
        );
    }

    const verification = await verifySecondFactorForUser({
        userId: actor.user.id,
        totpCode,
        recoveryCode,
        purpose: "step-up"
    });

    return {
        required: true,
        verified: true,
        method: verification.method
    };
}

module.exports = {
    isTwoFactorRequiredForRole,
    isTwoFactorConfigured,
    buildVerifiedUntil,
    setupTwoFactor,
    verifyTwoFactorSetup,
    validateTwoFactor,
    regenerateBackupCodes,
    disableTwoFactor,
    authenticateWithRecovery,
    verifySecondFactorForUser,
    assertTwoFactorStepUp
};
