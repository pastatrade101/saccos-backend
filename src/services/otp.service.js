const crypto = require("crypto");

const env = require("../config/env");
const { adminSupabase } = require("../config/supabase");
const AppError = require("../utils/app-error");
const { assertRateLimit } = require("./rate-limit.service");
const { sendOtpSms } = require("./sms.service");

function isMissingConsumeOtpFunction(error) {
    const message = String(error?.message || "").toLowerCase();
    return error?.code === "42883" && message.includes("consume_otp_challenge_attempt");
}

function normalizePhone(phone) {
    const normalized = (phone || "")
        .trim()
        .replace(/\s+/g, "")
        .replace(/-/g, "")
        .replace(/^\+/, "");

    if (/^0[67]\d{8}$/.test(normalized)) {
        return `255${normalized.slice(1)}`;
    }

    if (/^[67]\d{8}$/.test(normalized)) {
        return `255${normalized}`;
    }

    if (/^255[67]\d{8}$/.test(normalized)) {
        return normalized;
    }

    throw new AppError(
        400,
        "OTP_PHONE_INVALID",
        "Phone number must be a valid Tanzania mobile number (06/07 local or 2556/2557 international format)."
    );
}

function maskPhone(phone) {
    if (!phone || phone.length < 4) {
        return "hidden";
    }

    return `${phone.slice(0, 4)}${"*".repeat(Math.max(phone.length - 6, 2))}${phone.slice(-2)}`;
}

function generateOtpCode() {
    return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

function hashOtp({ challengeId, userId, otpCode }) {
    return crypto
        .createHmac("sha256", env.otpHashSecret)
        .update(`${challengeId}:${userId}:${otpCode}`)
        .digest("hex");
}

function compareOtpHash(storedHash, nextHash) {
    const left = Buffer.from(storedHash, "hex");
    const right = Buffer.from(nextHash, "hex");

    if (left.length !== right.length) {
        return false;
    }

    return crypto.timingSafeEqual(left, right);
}

function buildReference() {
    return `otp-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function buildExpiresAt() {
    return new Date(Date.now() + env.otpCodeTtlSeconds * 1000).toISOString();
}

function buildOtpText(otpCode) {
    const minutes = Math.max(Math.round(env.otpCodeTtlSeconds / 60), 1);
    return `Your OTP is ${otpCode}. Expires in ${minutes} minute${minutes > 1 ? "s" : ""}.`;
}

async function insertChallenge({
    challengeId,
    userId,
    phone,
    purpose,
    otpHash,
    reference,
    expiresAt
}) {
    const { data, error } = await adminSupabase
        .from("auth_otp_challenges")
        .insert({
            id: challengeId,
            user_id: userId,
            phone,
            purpose,
            otp_hash: otpHash,
            reference,
            expires_at: expiresAt,
            max_attempts: env.otpMaxVerifyAttempts,
            resend_count: 0,
            attempt_count: 0,
            last_sent_at: new Date().toISOString()
        })
        .select("id, expires_at, resend_count")
        .single();

    if (error || !data) {
        throw new AppError(
            500,
            "OTP_CHALLENGE_CREATE_FAILED",
            "Unable to create OTP challenge.",
            error
        );
    }

    return data;
}

async function updateChallenge({
    challengeId,
    userId,
    purpose,
    otpHash,
    reference,
    expiresAt,
    resendCount
}) {
    const { data, error } = await adminSupabase
        .from("auth_otp_challenges")
        .update({
            otp_hash: otpHash,
            reference,
            expires_at: expiresAt,
            resend_count: resendCount,
            attempt_count: 0,
            verified_at: null,
            consumed_at: null,
            last_attempt_at: null,
            last_sent_at: new Date().toISOString()
        })
        .eq("id", challengeId)
        .eq("user_id", userId)
        .eq("purpose", purpose)
        .select("id, expires_at, resend_count")
        .single();

    if (error || !data) {
        throw new AppError(
            500,
            "OTP_CHALLENGE_UPDATE_FAILED",
            "Unable to refresh OTP challenge.",
            error
        );
    }

    return data;
}

async function getChallenge({ challengeId, userId, purpose }) {
    const { data, error } = await adminSupabase
        .from("auth_otp_challenges")
        .select("*")
        .eq("id", challengeId)
        .eq("user_id", userId)
        .eq("purpose", purpose)
        .maybeSingle();

    if (error) {
        throw new AppError(
            500,
            "OTP_CHALLENGE_LOOKUP_FAILED",
            "Unable to load OTP challenge.",
            error
        );
    }

    return data || null;
}

async function sendOtpChallenge({
    userId,
    phone,
    purpose,
    challengeId = null
}) {
    const normalizedPhone = normalizePhone(phone);
    await assertRateLimit({
        key: `otp-send:${userId}:${purpose}`,
        max: env.otpSendRateLimitMax,
        windowMs: env.otpSendRateLimitWindowMs,
        code: "OTP_SEND_RATE_LIMITED",
        message: "Too many OTP requests. Try again later."
    });

    const existing = challengeId
        ? await getChallenge({ challengeId, userId, purpose })
        : null;

    if (existing && existing.resend_count >= env.otpResendMax) {
        throw new AppError(
            429,
            "OTP_RESEND_LIMIT_REACHED",
            "OTP resend limit reached for this challenge."
        );
    }

    const resolvedChallengeId = existing?.id || crypto.randomUUID();
    const otpCode = generateOtpCode();
    const otpHash = hashOtp({
        challengeId: resolvedChallengeId,
        userId,
        otpCode
    });
    const reference = buildReference();
    const expiresAt = buildExpiresAt();

    await sendOtpSms({
        to: normalizedPhone,
        text: buildOtpText(otpCode),
        reference
    });

    const saved = existing
        ? await updateChallenge({
            challengeId: resolvedChallengeId,
            userId,
            purpose,
            otpHash,
            reference,
            expiresAt,
            resendCount: existing.resend_count + 1
        })
        : await insertChallenge({
            challengeId: resolvedChallengeId,
            userId,
            phone: normalizedPhone,
            purpose,
            otpHash,
            reference,
            expiresAt
        });

    return {
        challenge_id: saved.id,
        expires_at: saved.expires_at,
        destination_hint: maskPhone(normalizedPhone),
        resend_count: saved.resend_count,
        resend_remaining: Math.max(env.otpResendMax - saved.resend_count, 0)
    };
}

async function verifyOtpChallenge({
    challengeId,
    userId,
    purpose,
    otpCode
}) {
    const challenge = await getChallenge({ challengeId, userId, purpose });

    if (!challenge) {
        throw new AppError(
            401,
            "OTP_CHALLENGE_NOT_FOUND",
            "OTP challenge is invalid or expired."
        );
    }

    if (challenge.consumed_at) {
        throw new AppError(401, "OTP_ALREADY_USED", "OTP has already been used.");
    }

    if (new Date(challenge.expires_at).getTime() <= Date.now()) {
        throw new AppError(401, "OTP_EXPIRED", "OTP code has expired.");
    }

    if (challenge.attempt_count >= challenge.max_attempts) {
        throw new AppError(
            429,
            "OTP_ATTEMPTS_EXCEEDED",
            "Maximum OTP verification attempts exceeded."
        );
    }

    const nextHash = hashOtp({
        challengeId,
        userId,
        otpCode
    });
    const valid = compareOtpHash(challenge.otp_hash, nextHash);

    const nowIso = new Date().toISOString();

    const consumeWithFallback = async () => {
        const { data, error } = await adminSupabase.rpc("consume_otp_challenge_attempt", {
            p_challenge_id: challenge.id,
            p_user_id: userId,
            p_purpose: purpose,
            p_is_valid: valid,
            p_now: nowIso
        });

        if (!error) {
            const row = Array.isArray(data) ? (data[0] || null) : data;
            if (!row?.status) {
                throw new AppError(
                    500,
                    "OTP_CONSUME_FAILED",
                    "Unable to finalize OTP verification."
                );
            }
            return row.status;
        }

        if (!isMissingConsumeOtpFunction(error)) {
            throw new AppError(
                500,
                "OTP_CONSUME_FAILED",
                "Unable to finalize OTP verification.",
                error
            );
        }

        // Backward compatibility for environments that have not yet applied migration 032.
        if (!valid) {
            const { error: attemptError } = await adminSupabase
                .from("auth_otp_challenges")
                .update({
                    attempt_count: challenge.attempt_count + 1,
                    last_attempt_at: nowIso
                })
                .eq("id", challenge.id);

            if (attemptError) {
                throw new AppError(
                    500,
                    "OTP_ATTEMPT_UPDATE_FAILED",
                    "Unable to update OTP attempts.",
                    attemptError
                );
            }

            return "invalid";
        }

        const { data: consumed, error: consumeError } = await adminSupabase
            .from("auth_otp_challenges")
            .update({
                verified_at: nowIso,
                consumed_at: nowIso,
                last_attempt_at: nowIso
            })
            .eq("id", challenge.id)
            .is("consumed_at", null)
            .select("id")
            .maybeSingle();

        if (consumeError) {
            throw new AppError(
                500,
                "OTP_CONSUME_FAILED",
                "Unable to finalize OTP verification.",
                consumeError
            );
        }

        if (!consumed) {
            const refreshed = await getChallenge({ challengeId, userId, purpose });
            if (refreshed?.consumed_at) {
                return "already_used";
            }
            return "invalid";
        }

        return "verified";
    };

    const status = await consumeWithFallback();

    if (status === "verified") {
        return {
            verified: true,
            challenge_id: challenge.id
        };
    }

    if (status === "invalid") {
        throw new AppError(401, "OTP_INVALID", "OTP code is invalid.");
    }

    if (status === "already_used") {
        throw new AppError(401, "OTP_ALREADY_USED", "OTP has already been used.");
    }

    if (status === "expired") {
        throw new AppError(401, "OTP_EXPIRED", "OTP code has expired.");
    }

    if (status === "attempts_exceeded") {
        throw new AppError(
            429,
            "OTP_ATTEMPTS_EXCEEDED",
            "Maximum OTP verification attempts exceeded."
        );
    }

    if (status === "not_found") {
        throw new AppError(
            401,
            "OTP_CHALLENGE_NOT_FOUND",
            "OTP challenge is invalid or expired."
        );
    }

    throw new AppError(
        500,
        "OTP_CONSUME_FAILED",
        "Unable to finalize OTP verification."
    );
}

module.exports = {
    normalizePhone,
    sendOtpChallenge,
    verifyOtpChallenge
};
