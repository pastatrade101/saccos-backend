const crypto = require("crypto");

const { adminSupabase } = require("../../config/supabase");
const env = require("../../config/env");
const AppError = require("../../utils/app-error");
const { logAudit } = require("../../services/audit.service");
const { normalizePhone } = require("../../services/otp.service");
const { assertRateLimit } = require("../../services/rate-limit.service");
const { ROLES } = require("../../constants/roles");

function generateApplicationNumber() {
    return `APP-${new Date().getFullYear()}-${crypto.randomInt(100000, 999999)}`;
}

function buildRateLimitKey(ipAddress, email) {
    const parts = ["public-signup"];
    if (ipAddress) {
        parts.push(ipAddress);
    }
    if (email) {
        parts.push(email);
    }
    return parts.join(":");
}

function formatDate(value) {
    if (!value) {
        return null;
    }

    const candidate = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(candidate.getTime())) {
        return null;
    }

    return candidate.toISOString().split("T")[0];
}

function normalizeNationalId(value) {
    return String(value || "")
        .replace(/\D/g, "")
        .slice(0, 20);
}

function isMissingColumnError(error, columnName) {
    return error?.code === "PGRST204"
        && typeof error?.message === "string"
        && error.message.includes(`'${columnName}'`);
}

async function resolveBranch(branchId) {
    if (!branchId) {
        throw new AppError(400, "BRANCH_ID_REQUIRED", "Branch identifier is required.");
    }

    const { data, error } = await adminSupabase
        .from("branches")
        .select("id, tenant_id, deleted_at")
        .eq("id", branchId)
        .maybeSingle();

    if (error) {
        throw new AppError(500, "BRANCH_LOOKUP_FAILED", "Unable to validate branch.", error);
    }

    if (!data || data.deleted_at) {
        throw new AppError(404, "BRANCH_NOT_FOUND", "Branch was not found.");
    }

    return data;
}

function buildSearchFilters({ phone, nationalId, email }) {
    const filters = [];

    if (phone) {
        filters.push(`phone.eq.${phone}`);
    }

    if (nationalId) {
        filters.push(`national_id.eq.${nationalId}`);
    }

    if (email) {
        filters.push(`email.eq.${email}`);
    }

    if (!filters.length) {
        return null;
    }

    return filters.join(",");
}

async function findOpenApplication(tenantId, { phone, nationalId, email }) {
    const orClause = buildSearchFilters({ phone, nationalId, email });
    if (!orClause) {
        return null;
    }

    const { data, error } = await adminSupabase
        .from("member_applications")
        .select("id, status")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .not("status", "eq", "rejected")
        .or(orClause)
        .limit(1)
        .maybeSingle();

    if (error) {
        throw new AppError(
            500,
            "MEMBER_APPLICATION_LOOKUP_FAILED",
            "Unable to verify existing membership applications.",
            error
        );
    }

    return data || null;
}

async function getMembershipFeeAmount(tenantId) {
    const { data, error } = await adminSupabase
        .from("fee_rules")
        .select("calculation_method, flat_amount, is_active")
        .eq("tenant_id", tenantId)
        .eq("code", "MEMBERSHIP_FEE")
        .is("deleted_at", null)
        .maybeSingle();

    if (error) {
        throw new AppError(
            500,
            "MEMBERSHIP_FEE_LOOKUP_FAILED",
            "Unable to load the membership fee configuration.",
            error
        );
    }

    if (!data || data.is_active !== true) {
        throw new AppError(
            400,
            "MEMBERSHIP_FEE_UNCONFIGURED",
            "Membership fee configuration is not available for this tenant."
        );
    }

    if (data.calculation_method !== "flat") {
        throw new AppError(
            400,
            "MEMBERSHIP_FEE_UNSUPPORTED",
            "Only flat membership fee configurations are currently supported."
        );
    }

    const amount = Number(data.flat_amount || 0);
    if (amount < 0) {
        throw new AppError(
            500,
            "MEMBERSHIP_FEE_INVALID",
            "Membership fee configuration contains an invalid amount."
        );
    }

    return amount;
}

async function createPublicSignup(payload, ipAddress) {
    const key = buildRateLimitKey(ipAddress, payload.email);
    await assertRateLimit({
        key,
        max: env.authUserCreateRateLimitMax,
        windowMs: env.authUserCreateRateLimitWindowMs,
        code: "PUBLIC_SIGNUP_RATE_LIMITED",
        message: "Too many signup attempts. Try again later."
    });

    const branch = await resolveBranch(payload.branch_id);
    const tenantId = env.singleTenantId || branch.tenant_id;

    if (!tenantId) {
        throw new AppError(400, "TENANT_ID_REQUIRED", "Tenant context is missing.");
    }

    if (env.singleTenantId && branch.tenant_id && branch.tenant_id !== env.singleTenantId) {
        throw new AppError(
            400,
            "BRANCH_TENANT_MISMATCH",
            "Selected branch does not belong to the configured tenant."
        );
    }

    const normalizedPhone = normalizePhone(payload.phone);
    const normalizedEmail = payload.email.trim().toLowerCase();
    const firstName = payload.first_name.trim();
    const lastName = payload.last_name.trim();
    const fullName = `${firstName} ${lastName}`.trim();
    const nationalId = normalizeNationalId(payload.national_id);

    if (nationalId.length !== 20) {
        throw new AppError(400, "NATIONAL_ID_INVALID", "national_id must contain exactly 20 digits.");
    }
    const dobValue = formatDate(payload.date_of_birth);

    if (!dobValue) {
        throw new AppError(400, "DATE_OF_BIRTH_INVALID", "date_of_birth must be a valid date.");
    }

    const existingApplication = await findOpenApplication(tenantId, {
        phone: normalizedPhone,
        nationalId,
        email: normalizedEmail
    });

    if (existingApplication) {
        throw new AppError(409, "MEMBER_APPLICATION_EXISTS", "An application already exists for this applicant.");
    }

    const membershipFeeAmount = await getMembershipFeeAmount(tenantId);

    const authPayload = {
        email: normalizedEmail,
        password: payload.password,
        email_confirm: true,
        user_metadata: {
            full_name: fullName,
            phone: normalizedPhone,
            national_id: nationalId
        },
        app_metadata: {
            tenant_id: tenantId,
            branch_id: branch.id,
            role: ROLES.MEMBER
        }
    };

    const { data: authData, error: authError } = await adminSupabase.auth.admin.createUser(authPayload);
    if (authError || !authData?.user) {
        throw new AppError(
            500,
            "PUBLIC_SIGNUP_USER_CREATE_FAILED",
            "Unable to provision the member portal login.",
            authError
        );
    }

    const authUser = authData.user;

    try {
        const { data: profile, error: profileError } = await adminSupabase
            .from("user_profiles")
            .insert({
                user_id: authUser.id,
                tenant_id: tenantId,
                branch_id: branch.id,
                full_name: fullName,
                phone: normalizedPhone,
                role: ROLES.MEMBER,
                is_active: true,
                must_change_password: false,
                member_id: null,
                first_login_at: null
            })
            .select("*")
            .single();

        if (profileError) {
            throw new AppError(
                500,
                "PUBLIC_SIGNUP_PROFILE_FAILED",
                "Unable to create a user profile for the applicant.",
                profileError
            );
        }

        await logAudit({
            tenantId,
            actorUserId: authUser.id,
            table: "user_profiles",
            action: "public_signup",
            entityType: "user_profile",
            entityId: profile.user_id,
            afterData: profile
        });

        const applicationPayload = {
            tenant_id: tenantId,
            application_no: generateApplicationNumber(),
            branch_id: branch.id,
            status: "submitted",
            full_name: fullName,
            dob: dobValue,
            phone: normalizedPhone,
            email: normalizedEmail,
            national_id: nationalId,
            created_by: authUser.id,
            auth_user_id: authUser.id,
            membership_fee_amount: membershipFeeAmount,
            membership_fee_paid: 0,
            kyc_status: "pending"
        };

        let application;
        let applicationError;

        ({ data: application, error: applicationError } = await adminSupabase
            .from("member_applications")
            .insert(applicationPayload)
            .select("*")
            .single());

        if (isMissingColumnError(applicationError, "auth_user_id")) {
            const { auth_user_id, ...legacyApplicationPayload } = applicationPayload;

            ({ data: application, error: applicationError } = await adminSupabase
                .from("member_applications")
                .insert(legacyApplicationPayload)
                .select("*")
                .single());
        }

        if (applicationError) {
            throw new AppError(
                500,
                "PUBLIC_SIGNUP_APPLICATION_FAILED",
                "Unable to create the member application.",
                applicationError
            );
        }

        await logAudit({
            tenantId,
            actorUserId: authUser.id,
            table: "member_applications",
            action: "MEMBER_APPLICATION_CREATED",
            entityType: "member_application",
            entityId: application.id,
            afterData: application
        });

        return {
            user: {
                id: authUser.id,
                email: normalizedEmail,
                phone: normalizedPhone,
                tenant_id: tenantId,
                branch_id: branch.id
            },
            application
        };
    } catch (error) {
        await adminSupabase.auth.admin.deleteUser(authUser.id).catch(() => {
            console.warn("[public-signup] failed to delete orphaned auth user", authUser.id);
        });
        throw error;
    }
}

async function listBranches() {
    const { data, error } = await adminSupabase
        .from("branches")
        .select("id, tenant_id, name, code")
        .is("deleted_at", null)
        .order("name", { ascending: true });

    if (error) {
        throw new AppError(
            500,
            "PUBLIC_SIGNUP_BRANCHES_FAILED",
            "Unable to load branches for public signup.",
            error
        );
    }

    return data || [];
}

module.exports = {
    createPublicSignup,
    listBranches
};
