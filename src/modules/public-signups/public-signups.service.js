const crypto = require("crypto");

const { adminSupabase } = require("../../config/supabase");
const env = require("../../config/env");
const AppError = require("../../utils/app-error");
const { logAudit } = require("../../services/audit.service");
const { normalizePhone } = require("../../services/otp.service");
const { assertRateLimit } = require("../../services/rate-limit.service");
const { ROLES } = require("../../constants/roles");
const { resolveOptionalLocationHierarchy } = require("../locations/locations.service");
const { notifyBranchManagersNewMemberApplication } = require("../../services/branch-alerts.service");

const DEFAULT_MIN_INITIAL_SHARE_AMOUNT_TZS = 50000;
const DEFAULT_MIN_MONTHLY_SAVINGS_TZS = 10000;
const SIGNUP_DOCUMENT_FIELD_MAP = {
    upload_national_id: "national_id",
    upload_passport_photo: "passport_photo"
};
const SIGNUP_DOCUMENT_REQUIRED_FIELDS = Object.keys(SIGNUP_DOCUMENT_FIELD_MAP);

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

function normalizeOptionalText(value) {
    if (value === undefined || value === null) {
        return null;
    }

    const normalized = String(value).trim();
    return normalized || null;
}

function normalizeEnum(value) {
    const normalized = normalizeOptionalText(value);
    return normalized ? normalized.toLowerCase() : null;
}

function isMissingColumnError(error, columnName) {
    return error?.code === "PGRST204"
        && typeof error?.message === "string"
        && error.message.includes(`'${columnName}'`);
}

function isDuplicateAuthUserError(error) {
    const message = String(error?.message || "").toLowerCase();
    return message.includes("already been registered")
        || message.includes("user already registered")
        || message.includes("already registered");
}

function sanitizeFileName(fileName) {
    return String(fileName || "document")
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 120) || "document";
}

async function resolveBranch(branchId) {
    if (!branchId) {
        throw new AppError(400, "BRANCH_ID_REQUIRED", "Branch identifier is required.");
    }

    const { data, error } = await adminSupabase
        .from("branches")
        .select("id, tenant_id, name, code, deleted_at")
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

async function findExistingMemberIdentity(tenantId, { phone, nationalId }) {
    const orClause = buildSearchFilters({ phone, nationalId, email: null });
    if (!orClause) {
        return null;
    }

    const { data, error } = await adminSupabase
        .from("members")
        .select("id, full_name")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .or(orClause)
        .limit(1)
        .maybeSingle();

    if (error) {
        throw new AppError(
            500,
            "MEMBER_IDENTITY_LOOKUP_FAILED",
            "Unable to verify duplicate member identity.",
            error
        );
    }

    return data || null;
}

async function getMembershipFeeAmount(tenantId, { strict = true } = {}) {
    const { data, error } = await adminSupabase
        .from("fee_rules")
        .select("calculation_method, flat_amount, is_active")
        .eq("tenant_id", tenantId)
        .eq("code", "MEMBERSHIP_FEE")
        .is("deleted_at", null)
        .maybeSingle();

    if (error) {
        if (!strict) {
            return 0;
        }
        throw new AppError(
            500,
            "MEMBERSHIP_FEE_LOOKUP_FAILED",
            "Unable to load the membership fee configuration.",
            error
        );
    }

    if (!data || data.is_active !== true) {
        if (!strict) {
            return 0;
        }
        throw new AppError(
            400,
            "MEMBERSHIP_FEE_UNCONFIGURED",
            "Membership fee configuration is not available for this tenant."
        );
    }

    if (data.calculation_method !== "flat") {
        if (!strict) {
            return Number(data.flat_amount || 0);
        }
        throw new AppError(
            400,
            "MEMBERSHIP_FEE_UNSUPPORTED",
            "Only flat membership fee configurations are currently supported."
        );
    }

    const amount = Number(data.flat_amount || 0);
    if (amount < 0) {
        if (!strict) {
            return 0;
        }
        throw new AppError(
            500,
            "MEMBERSHIP_FEE_INVALID",
            "Membership fee configuration contains an invalid amount."
        );
    }

    return amount;
}

async function getPublicOnboardingRequirements(tenantId) {
    const [membershipFeeAmount, shareProductResult, savingsProductResult] = await Promise.all([
        getMembershipFeeAmount(tenantId, { strict: false }),
        adminSupabase
            .from("share_products")
            .select("minimum_shares")
            .eq("tenant_id", tenantId)
            .eq("is_default", true)
            .eq("status", "active")
            .is("deleted_at", null)
            .maybeSingle(),
        adminSupabase
            .from("savings_products")
            .select("min_opening_balance")
            .eq("tenant_id", tenantId)
            .eq("is_default", true)
            .eq("status", "active")
            .is("deleted_at", null)
            .maybeSingle()
    ]);

    if (shareProductResult.error) {
        throw new AppError(
            500,
            "SHARE_PRODUCT_LOOKUP_FAILED",
            "Unable to load the default share product for onboarding.",
            shareProductResult.error
        );
    }

    if (savingsProductResult.error) {
        throw new AppError(
            500,
            "SAVINGS_PRODUCT_LOOKUP_FAILED",
            "Unable to load the default savings product for onboarding.",
            savingsProductResult.error
        );
    }

    const minimumInitialShareAmount = Math.max(
        DEFAULT_MIN_INITIAL_SHARE_AMOUNT_TZS,
        Number(shareProductResult.data?.minimum_shares || 0)
    );
    const minimumMonthlySavingsCommitment = Math.max(
        DEFAULT_MIN_MONTHLY_SAVINGS_TZS,
        Number(savingsProductResult.data?.min_opening_balance || 0)
    );

    return {
        membership_fee_amount: Number(membershipFeeAmount || 0),
        minimum_initial_share_amount: minimumInitialShareAmount,
        minimum_monthly_savings_commitment: minimumMonthlySavingsCommitment
    };
}

function getUploadFile(filesMap, fieldName) {
    const files = filesMap?.[fieldName];
    return Array.isArray(files) && files.length ? files[0] : null;
}

async function uploadApplicationDocuments({
    tenantId,
    applicationId,
    authUserId,
    filesMap
}) {
    const uploadedPaths = [];
    const createdAttachmentIds = [];

    try {
        for (const fieldName of SIGNUP_DOCUMENT_REQUIRED_FIELDS) {
            const file = getUploadFile(filesMap, fieldName);

            if (!file) {
                throw new AppError(
                    400,
                    "PUBLIC_SIGNUP_DOCUMENT_REQUIRED",
                    "National ID and passport photo documents are required before submitting membership onboarding."
                );
            }

            const documentType = SIGNUP_DOCUMENT_FIELD_MAP[fieldName];
            const fileName = sanitizeFileName(file.originalname);
            const storagePath = `tenants/${tenantId}/applications/${applicationId}/${documentType}-${Date.now()}-${fileName}`;

            const { error: uploadError } = await adminSupabase
                .storage
                .from(env.memberApplicationsBucket)
                .upload(storagePath, file.buffer, {
                    contentType: file.mimetype,
                    cacheControl: "3600",
                    upsert: false
                });

            if (uploadError) {
                throw new AppError(
                    500,
                    "PUBLIC_SIGNUP_DOCUMENT_UPLOAD_FAILED",
                    "Unable to upload onboarding documents.",
                    uploadError
                );
            }

            uploadedPaths.push(storagePath);

            const { data: attachment, error: attachmentError } = await adminSupabase
                .from("member_application_attachments")
                .insert({
                    tenant_id: tenantId,
                    application_id: applicationId,
                    storage_bucket: env.memberApplicationsBucket,
                    storage_path: storagePath,
                    file_name: file.originalname,
                    mime_type: file.mimetype,
                    file_size_bytes: file.size,
                    uploaded_by: authUserId,
                    document_type: documentType
                })
                .select("id")
                .single();

            if (attachmentError) {
                throw new AppError(
                    500,
                    "PUBLIC_SIGNUP_DOCUMENT_RECORD_FAILED",
                    "Unable to save onboarding document metadata.",
                    attachmentError
                );
            }

            createdAttachmentIds.push(attachment.id);
        }

        return createdAttachmentIds;
    } catch (error) {
        if (createdAttachmentIds.length) {
            await adminSupabase
                .from("member_application_attachments")
                .delete()
                .in("id", createdAttachmentIds)
                .catch(() => undefined);
        }

        if (uploadedPaths.length) {
            await adminSupabase
                .storage
                .from(env.memberApplicationsBucket)
                .remove(uploadedPaths)
                .catch(() => undefined);
        }

        throw error;
    }
}

async function deleteApplicationArtifacts(applicationId, authUserId) {
    if (applicationId) {
        await adminSupabase
            .from("member_application_attachments")
            .select("storage_bucket, storage_path")
            .eq("application_id", applicationId)
            .then(async ({ data }) => {
                const filesByBucket = new Map();

                for (const item of data || []) {
                    if (!item.storage_bucket || !item.storage_path) {
                        continue;
                    }
                    const existing = filesByBucket.get(item.storage_bucket) || [];
                    existing.push(item.storage_path);
                    filesByBucket.set(item.storage_bucket, existing);
                }

                for (const [bucket, paths] of filesByBucket.entries()) {
                    if (!paths.length) {
                        continue;
                    }
                    await adminSupabase.storage.from(bucket).remove(paths).catch(() => undefined);
                }
            })
            .catch(() => undefined);

        await adminSupabase
            .from("member_applications")
            .delete()
            .eq("id", applicationId)
            .catch(() => undefined);
    }

    if (authUserId) {
        await adminSupabase
            .from("user_profiles")
            .delete()
            .eq("user_id", authUserId)
            .catch(() => undefined);

        await adminSupabase.auth.admin.deleteUser(authUserId).catch(() => {
            console.warn("[public-signup] failed to delete orphaned auth user", authUserId);
        });
    }
}

async function createPublicSignup(payload, ipAddress, filesMap = {}) {
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

    const onboardingRequirements = await getPublicOnboardingRequirements(tenantId);
    const normalizedPhone = normalizePhone(payload.phone);
    const normalizedEmail = payload.email.trim().toLowerCase();
    const firstName = payload.first_name.trim();
    const lastName = payload.last_name.trim();
    const fullName = `${firstName} ${lastName}`.trim();
    const nationalId = normalizeNationalId(payload.national_id);
    const nextOfKinPhone = normalizePhone(payload.next_of_kin_phone);
    const dobValue = formatDate(payload.date_of_birth);

    if (nationalId.length !== 20) {
        throw new AppError(400, "NATIONAL_ID_INVALID", "national_id must contain exactly 20 digits.");
    }

    if (!dobValue) {
        throw new AppError(400, "DATE_OF_BIRTH_INVALID", "date_of_birth must be a valid date.");
    }

    const initialShareAmount = Number(payload.initial_share_amount || 0);
    if (initialShareAmount < onboardingRequirements.minimum_initial_share_amount) {
        throw new AppError(
            400,
            "INITIAL_SHARE_AMOUNT_TOO_LOW",
            `Initial share amount must be at least ${onboardingRequirements.minimum_initial_share_amount.toLocaleString("en-US")} TZS.`
        );
    }

    const monthlySavingsCommitment = Number(payload.monthly_savings_commitment || 0);
    if (monthlySavingsCommitment < onboardingRequirements.minimum_monthly_savings_commitment) {
        throw new AppError(
            400,
            "MONTHLY_SAVINGS_COMMITMENT_TOO_LOW",
            `Monthly savings commitment must be at least ${onboardingRequirements.minimum_monthly_savings_commitment.toLocaleString("en-US")} TZS.`
        );
    }

    const existingApplication = await findOpenApplication(tenantId, {
        phone: normalizedPhone,
        nationalId,
        email: normalizedEmail
    });

    if (existingApplication) {
        throw new AppError(409, "MEMBER_APPLICATION_EXISTS", "An application already exists for this applicant.");
    }

    const existingMember = await findExistingMemberIdentity(tenantId, {
        phone: normalizedPhone,
        nationalId
    });

    if (existingMember) {
        throw new AppError(409, "MEMBER_IDENTITY_EXISTS", "A member with this phone number or national ID already exists.");
    }

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

    let authUserId = null;
    let applicationId = null;

    try {
        const resolvedLocation = await resolveOptionalLocationHierarchy({
            regionId: payload.region_id,
            districtId: payload.district_id,
            wardId: payload.ward_id,
            villageId: payload.village_id
        });

        const { data: authData, error: authError } = await adminSupabase.auth.admin.createUser(authPayload);
        if (authError || !authData?.user) {
            if (isDuplicateAuthUserError(authError)) {
                throw new AppError(409, "PUBLIC_SIGNUP_EMAIL_EXISTS", "An account already exists with this email address.");
            }

            throw new AppError(
                500,
                "PUBLIC_SIGNUP_USER_CREATE_FAILED",
                "Unable to provision the member portal login.",
                authError
            );
        }

        const authUser = authData.user;
        authUserId = authUser.id;

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

        const gender = normalizeEnum(payload.gender);
        const maritalStatus = normalizeEnum(payload.marital_status);
        const occupation = normalizeOptionalText(payload.occupation);
        const employer = normalizeOptionalText(payload.employer_name);
        const region = resolvedLocation?.region_name || normalizeOptionalText(payload.region);
        const district = resolvedLocation?.district_name || normalizeOptionalText(payload.district);
        const ward = resolvedLocation?.ward_name || normalizeOptionalText(payload.ward);
        const streetOrVillage = resolvedLocation?.village_name || normalizeOptionalText(payload.street_or_village);
        const residentialAddress = normalizeOptionalText(payload.residential_address);
        const nextOfKinAddress = normalizeOptionalText(payload.next_of_kin_address);
        const membershipType = normalizeEnum(payload.membership_type);

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
            gender,
            marital_status: maritalStatus,
            occupation,
            employer,
            region_id: resolvedLocation?.region_id || null,
            district_id: resolvedLocation?.district_id || null,
            ward_id: resolvedLocation?.ward_id || null,
            village_id: resolvedLocation?.village_id || null,
            region,
            district,
            ward,
            street_or_village: streetOrVillage,
            residential_address: residentialAddress,
            address_line1: residentialAddress,
            address_line2: streetOrVillage,
            city: district,
            state: region,
            country: "Tanzania",
            nida_no: nationalId,
            next_of_kin_name: normalizeOptionalText(payload.next_of_kin_name),
            next_of_kin_phone: nextOfKinPhone,
            next_of_kin_relationship: normalizeEnum(payload.relationship),
            next_of_kin_address: nextOfKinAddress,
            membership_type: membershipType,
            initial_share_amount: initialShareAmount,
            monthly_savings_commitment: monthlySavingsCommitment,
            terms_accepted: true,
            data_processing_consent: true,
            created_by: authUser.id,
            auth_user_id: authUser.id,
            membership_fee_amount: onboardingRequirements.membership_fee_amount,
            membership_fee_paid: 0,
            kyc_status: "pending",
            notes: "Application submitted via the public membership portal."
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

        applicationId = application.id;

        await uploadApplicationDocuments({
            tenantId,
            applicationId,
            authUserId: authUser.id,
            filesMap
        });

        await logAudit({
            tenantId,
            actorUserId: authUser.id,
            table: "member_applications",
            action: "MEMBER_APPLICATION_CREATED",
            entityType: "member_application",
            entityId: application.id,
            afterData: application
        });

        await notifyBranchManagersNewMemberApplication({
            actor: {
                tenantId,
                user: { id: authUser.id }
            },
            application: {
                ...application,
                branch_name: branch.name || null
            }
        }).catch((notifyError) => {
            console.warn("[public-signups] branch manager application notification failed", {
                applicationId: application.id,
                error: notifyError?.message || notifyError
            });
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
        await deleteApplicationArtifacts(applicationId, authUserId);
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

    const branches = data || [];
    const requirementsByTenant = new Map();

    for (const branch of branches) {
        if (!branch.tenant_id || requirementsByTenant.has(branch.tenant_id)) {
            continue;
        }

        try {
            requirementsByTenant.set(branch.tenant_id, await getPublicOnboardingRequirements(branch.tenant_id));
        } catch (requirementsError) {
            requirementsByTenant.set(branch.tenant_id, {
                membership_fee_amount: 0,
                minimum_initial_share_amount: DEFAULT_MIN_INITIAL_SHARE_AMOUNT_TZS,
                minimum_monthly_savings_commitment: DEFAULT_MIN_MONTHLY_SAVINGS_TZS
            });
        }
    }

    return branches.map((branch) => ({
        ...branch,
        ...requirementsByTenant.get(branch.tenant_id)
    }));
}

module.exports = {
    createPublicSignup,
    listBranches
};
