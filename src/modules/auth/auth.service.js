const crypto = require("crypto");

const { adminSupabase, publicSupabase } = require("../../config/supabase");
const env = require("../../config/env");
const AppError = require("../../utils/app-error");
const { getUserProfile } = require("../../services/user-context.service");
const { logAudit } = require("../../services/audit.service");
const { assertTenantAccess } = require("../../services/user-context.service");
const { ensureBranchAssignments } = require("../../services/branch-assignment.service");
const { saveCredentialHandoff } = require("../../services/credential-handoff.service");
const { normalizePhone, sendOtpChallenge, verifyOtpChallenge } = require("../../services/otp.service");
const { sendOtpSms } = require("../../services/sms.service");
const { assertRateLimit } = require("../../services/rate-limit.service");

function generateTemporaryPassword() {
    const lowers = "abcdefghjkmnpqrstuvwxyz";
    const uppers = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    const numbers = "23456789";
    const symbols = "!@#$%^&*()-_=+";
    const alphabet = `${lowers}${uppers}${numbers}${symbols}`;
    const characters = [
        lowers[Math.floor(Math.random() * lowers.length)],
        uppers[Math.floor(Math.random() * uppers.length)],
        numbers[Math.floor(Math.random() * numbers.length)],
        symbols[Math.floor(Math.random() * symbols.length)]
    ];

    while (characters.length < 14) {
        characters.push(alphabet[Math.floor(Math.random() * alphabet.length)]);
    }

    return characters.sort(() => Math.random() - 0.5).join("");
}

function buildSmsReference(prefix = "otp") {
    return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function maskPhone(phone) {
    if (!phone || phone.length < 4) {
        return "hidden";
    }

    return `${phone.slice(0, 4)}${"*".repeat(Math.max(phone.length - 6, 2))}${phone.slice(-2)}`;
}

function buildPasswordSetupSms(linkUrl) {
    return `Complete your SMART SACCOS password setup: ${linkUrl}`;
}

function normalizePasswordSetupRedirectUrl(redirectTo) {
    if (!redirectTo) {
        return null;
    }

    let normalized = String(redirectTo).trim();

    // Common operator mistake: duplicated scheme such as https://https://domain/path
    normalized = normalized
        .replace(/^https:\/\/https:\/\//i, "https://")
        .replace(/^http:\/\/http:\/\//i, "http://");

    try {
        const parsed = new URL(normalized);
        parsed.pathname = parsed.pathname.replace(/\/{2,}/g, "/");
        return parsed.toString();
    } catch {
        return redirectTo;
    }
}

function buildPasswordSetupUrl({ redirectTo, hashedToken, actionLink }) {
    const normalizedRedirectUrl = normalizePasswordSetupRedirectUrl(redirectTo);

    if (normalizedRedirectUrl && hashedToken) {
        try {
            const url = new URL(normalizedRedirectUrl);
            // Avoid underscore in query key because some SMS clients/gateways
            // may render "_" as a different symbol (for example "§").
            url.searchParams.set("tokenhash", hashedToken);
            // Keep a compact alias for extra resilience on some handsets.
            url.searchParams.set("th", hashedToken);
            url.searchParams.set("type", "recovery");
            return url.toString();
        } catch {
            // Fall back to action_link if redirect URL is malformed.
        }
    }

    return actionLink || null;
}

function isUserNotFoundError(error) {
    const message = String(error?.message || "").toLowerCase();
    return message.includes("user not found") || message.includes("not found");
}

async function sendPasswordSetupLink(payload) {
    const email = payload.email.trim().toLowerCase();

    assertRateLimit({
        key: `password-setup-link:${email}`,
        max: env.otpSendRateLimitMax,
        windowMs: env.otpSendRateLimitWindowMs,
        code: "PASSWORD_SETUP_LINK_RATE_LIMITED",
        message: "Too many password setup link requests. Try again later."
    });

    const redirectTo = env.passwordSetupRedirectUrl || undefined;

    const { data: linkData, error: linkError } = await adminSupabase.auth.admin.generateLink({
        type: "recovery",
        email,
        options: redirectTo ? { redirectTo } : undefined
    });

    if (linkError) {
        if (isUserNotFoundError(linkError)) {
            // Avoid account enumeration from public endpoints.
            return { success: true };
        }

        throw new AppError(
            500,
            "PASSWORD_SETUP_LINK_GENERATION_FAILED",
            "Unable to generate password setup link.",
            linkError
        );
    }

    const user = linkData?.user || null;
    const actionLink = linkData?.properties?.action_link || null;
    const hashedToken = linkData?.properties?.hashed_token || null;
    const setupLink = buildPasswordSetupUrl({
        redirectTo,
        hashedToken,
        actionLink
    });

    if (!user?.id || !setupLink) {
        return { success: true };
    }

    const profile = await getUserProfile(user.id);
    const resolvedPhone = profile?.phone || user.user_metadata?.phone || null;

    if (!resolvedPhone) {
        throw new AppError(
            400,
            "PASSWORD_SETUP_PHONE_REQUIRED",
            "No phone number is registered for this account. Contact your administrator."
        );
    }

    const normalizedPhone = normalizePhone(resolvedPhone);

    await sendOtpSms({
        to: normalizedPhone,
        text: buildPasswordSetupSms(setupLink),
        reference: buildSmsReference("setup")
    });

    if (profile?.tenant_id) {
        await logAudit({
            tenantId: profile.tenant_id,
            actorUserId: profile.user_id,
            table: "user_profiles",
            entityType: "user_profile",
            entityId: profile.user_id,
            action: "PASSWORD_SETUP_LINK_SMS_SENT",
            afterData: {
                user_id: profile.user_id,
                destination_hint: maskPhone(normalizedPhone)
            }
        });
    }

    return {
        success: true,
        destination_hint: maskPhone(normalizedPhone)
    };
}

async function signIn(payload) {
    const auth = await authenticatePassword(payload);

    if (env.otpRequiredOnSignIn) {
        if (!auth.phone) {
            throw new AppError(
                401,
                "OTP_ENROLL_REQUIRED",
                "Add a verified phone number to receive OTP.",
                { otp_enroll_required: true }
            );
        }

        if (!payload.challenge_id || !payload.otp_code) {
            throw new AppError(
                401,
                "OTP_REQUIRED",
                "One-time verification code required.",
                { otp_required: true }
            );
        }

        await verifyOtpChallenge({
            challengeId: payload.challenge_id,
            userId: auth.user.id,
            purpose: "signin",
            otpCode: payload.otp_code
        });
    }

    await adminSupabase
        .from("user_profiles")
        .update({
            last_login_at: new Date().toISOString()
        })
        .eq("user_id", auth.user.id);

    return {
        session: auth.session,
        user: auth.user,
        profile: auth.profile
    };
}

async function sendSignInOtp(payload) {
    if (!env.otpRequiredOnSignIn) {
        throw new AppError(
            400,
            "OTP_NOT_ENABLED",
            "OTP sign-in is not enabled in this environment."
        );
    }

    const auth = await authenticatePassword(payload);
    const shouldEnrollPhone = !auth.phone && Boolean(payload.phone);
    const resolvedPhone = shouldEnrollPhone
        ? await persistOtpEnrollmentPhone(auth, payload.phone)
        : auth.phone;

    if (!resolvedPhone) {
        throw new AppError(
            401,
            "OTP_ENROLL_REQUIRED",
            "Add a verified phone number to receive OTP.",
            { otp_enroll_required: true }
        );
    }

    return sendOtpChallenge({
        userId: auth.user.id,
        phone: resolvedPhone,
        purpose: "signin",
        challengeId: payload.challenge_id || null
    });
}

async function verifySignInOtp(payload) {
    if (!env.otpRequiredOnSignIn) {
        throw new AppError(
            400,
            "OTP_NOT_ENABLED",
            "OTP sign-in is not enabled in this environment."
        );
    }

    const auth = await authenticatePassword(payload);

    return verifyOtpChallenge({
        challengeId: payload.challenge_id,
        userId: auth.user.id,
        purpose: "signin",
        otpCode: payload.otp_code
    });
}

async function authenticatePassword(payload) {
    const { data, error } = await publicSupabase.auth.signInWithPassword({
        email: payload.email,
        password: payload.password
    });

    if (error || !data?.session) {
        throw new AppError(401, "SIGNIN_FAILED", "Invalid email or password.");
    }

    const profile = await getUserProfile(data.user.id);
    const platformRole = data.user.app_metadata?.platform_role;
    const isInternalOps = platformRole === "internal_ops" || platformRole === "platform_admin";

    if (!profile && !isInternalOps) {
        throw new AppError(403, "PROFILE_NOT_FOUND", "User profile is not provisioned.");
    }

    return {
        session: data.session,
        user: data.user,
        profile,
        phone: profile?.phone || data.user.user_metadata?.phone || null
    };
}

async function persistOtpEnrollmentPhone(auth, phoneInput) {
    const normalizedPhone = normalizePhone(phoneInput);

    if (auth.profile?.user_id) {
        const { error: profileUpdateError } = await adminSupabase
            .from("user_profiles")
            .update({ phone: normalizedPhone })
            .eq("user_id", auth.user.id);

        if (profileUpdateError) {
            throw new AppError(
                500,
                "OTP_PHONE_ENROLL_FAILED",
                "Unable to save phone number for OTP.",
                profileUpdateError
            );
        }
    }

    const { error: metadataUpdateError } = await adminSupabase.auth.admin.updateUserById(auth.user.id, {
        user_metadata: {
            ...(auth.user.user_metadata || {}),
            phone: normalizedPhone
        }
    });

    if (metadataUpdateError) {
        throw new AppError(
            500,
            "OTP_PHONE_ENROLL_FAILED",
            "Unable to save phone number for OTP.",
            metadataUpdateError
        );
    }

    return normalizedPhone;
}

async function inviteUser({ actor, payload }) {
    const tenantId = payload.tenant_id || actor.tenantId;

    if (!tenantId) {
        throw new AppError(400, "TENANT_ID_REQUIRED", "Tenant identifier is required.");
    }

    assertTenantAccess({ auth: actor }, tenantId);

    const temporaryPassword = !payload.send_invite && !payload.password
        ? generateTemporaryPassword()
        : null;

    const authOperation = payload.send_invite
        ? adminSupabase.auth.admin.inviteUserByEmail(payload.email, {
            data: {
                full_name: payload.full_name,
                phone: payload.phone,
                tenant_id: tenantId,
                role: payload.role
            }
        })
        : adminSupabase.auth.admin.createUser({
            email: payload.email,
            password: payload.password || temporaryPassword,
            email_confirm: true,
            user_metadata: {
                full_name: payload.full_name,
                phone: payload.phone
            },
            app_metadata: {
                tenant_id: tenantId,
                role: payload.role
            }
        });

    const { data, error } = await authOperation;

    if (error || !data?.user) {
        throw new AppError(500, "USER_INVITE_FAILED", "Unable to provision user.", error);
    }

    const profilePayload = {
        user_id: data.user.id,
        tenant_id: tenantId,
        branch_id: payload.branch_ids?.[0] || null,
        full_name: payload.full_name,
        phone: payload.phone || null,
        role: payload.role,
        member_id: payload.member_id || null,
        must_change_password: Boolean(!payload.send_invite),
        first_login_at: null,
        is_active: true
    };

    const { data: profile, error: profileError } = await adminSupabase
        .from("user_profiles")
        .upsert(profilePayload, { onConflict: "user_id" })
        .select("*")
        .single();

    if (profileError) {
        throw new AppError(500, "USER_PROFILE_CREATE_FAILED", "Unable to create user profile.", profileError);
    }

    if (payload.branch_ids.length) {
        await ensureBranchAssignments({
            tenantId,
            userId: data.user.id,
            branchIds: payload.branch_ids
        });
    }

    if (!payload.send_invite && (temporaryPassword || payload.password)) {
        await saveCredentialHandoff({
            tenantId,
            userId: data.user.id,
            memberId: payload.member_id || null,
            email: payload.email,
            password: temporaryPassword || payload.password,
            createdBy: actor.user.id
        });
    }

    await logAudit({
        tenantId,
        userId: actor.user.id,
        table: "user_profiles",
        action: "invite_user",
        beforeData: null,
        afterData: profile
    });

    return {
        user: data.user,
        profile,
        temporary_password: temporaryPassword
    };
}

module.exports = {
    signIn,
    sendSignInOtp,
    verifySignInOtp,
    sendPasswordSetupLink,
    inviteUser
};
