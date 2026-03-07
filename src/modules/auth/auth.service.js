const { adminSupabase, publicSupabase } = require("../../config/supabase");
const env = require("../../config/env");
const AppError = require("../../utils/app-error");
const { getUserProfile } = require("../../services/user-context.service");
const { logAudit } = require("../../services/audit.service");
const { assertTenantAccess } = require("../../services/user-context.service");
const { ensureBranchAssignments } = require("../../services/branch-assignment.service");
const { saveCredentialHandoff } = require("../../services/credential-handoff.service");
const { sendOtpChallenge, verifyOtpChallenge } = require("../../services/otp.service");

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

async function signIn(payload) {
    const auth = await authenticatePassword(payload);

    if (env.otpRequiredOnSignIn) {
        if (!auth.profile?.phone) {
            throw new AppError(
                400,
                "OTP_PHONE_NOT_AVAILABLE",
                "A verified phone number is required for OTP sign-in."
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

    if (!auth.profile?.phone) {
        throw new AppError(
            400,
            "OTP_PHONE_NOT_AVAILABLE",
            "A verified phone number is required for OTP sign-in."
        );
    }

    return sendOtpChallenge({
        userId: auth.user.id,
        phone: auth.profile.phone,
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

    if (!profile) {
        throw new AppError(403, "PROFILE_NOT_FOUND", "User profile is not provisioned.");
    }

    return {
        session: data.session,
        user: data.user,
        profile
    };
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
    inviteUser
};
