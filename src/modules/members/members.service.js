const crypto = require("crypto");

const { adminSupabase } = require("../../config/supabase");
const AppError = require("../../utils/app-error");
const { assertPlanLimit } = require("../../services/subscription.service");
const { logAudit } = require("../../services/audit.service");
const { assertBranchAccess, assertTenantAccess } = require("../../services/user-context.service");
const { ensureBranchAssignments } = require("../../services/branch-assignment.service");
const { saveCredentialHandoff, getActiveCredentialByUser } = require("../../services/credential-handoff.service");
const { sendPasswordSetupLink } = require("../auth/auth.service");
const MEMBERS_COUNT_CACHE_TTL_MS = Math.max(0, Number(process.env.MEMBERS_COUNT_CACHE_TTL_MS || 15000));
const membersCountCache = new Map();
const membersCountInFlight = new Map();

const MEMBER_LIST_COLUMNS = `
    id,
    tenant_id,
    branch_id,
    user_id,
    first_name,
    middle_name,
    last_name,
    full_name,
    gender,
    phone,
    email,
    member_no,
    national_id,
    status,
    dob,
    address_line1,
    address_line2,
    city,
    state,
    country,
    postal_code,
    nida_no,
    tin_no,
    next_of_kin_name,
    next_of_kin_phone,
    next_of_kin_relationship,
    employer,
    kyc_status,
    kyc_reason,
    notes,
    created_at
`;
const PRIVILEGED_IDENTITY_ROLES = new Set(["super_admin", "branch_manager", "auditor"]);
const TANZANIA_PHONE_PATTERN = /^(\+?255|0)?[67]\d{8}$/;
const IDENTITY_CODE_PATTERN = /^[A-Za-z0-9-]{5,50}$/;

function normalizeNullableString(value) {
    if (value === undefined || value === null) {
        return null;
    }

    const normalized = String(value).trim();
    return normalized.length ? normalized : null;
}

function normalizeEmail(value) {
    const normalized = normalizeNullableString(value);
    return normalized ? normalized.toLowerCase() : null;
}

function normalizePhone(value) {
    const normalized = normalizeNullableString(value);
    if (!normalized) {
        return null;
    }

    const compact = normalized.replace(/\s+/g, "").replace(/-/g, "");
    if (!TANZANIA_PHONE_PATTERN.test(compact)) {
        throw new AppError(
            400,
            "MEMBER_PHONE_INVALID",
            "Phone number must be a valid Tanzania mobile number (06/07 local or 2556/2557 international format)."
        );
    }

    const noPlus = compact.replace(/^\+/, "");
    if (noPlus.startsWith("255")) {
        return noPlus;
    }
    if (noPlus.startsWith("0")) {
        return `255${noPlus.slice(1)}`;
    }
    return `255${noPlus}`;
}

function normalizeIdentityCode(value, label) {
    const normalized = normalizeNullableString(value);
    if (!normalized) {
        return null;
    }

    if (!IDENTITY_CODE_PATTERN.test(normalized)) {
        throw new AppError(
            400,
            "MEMBER_IDENTITY_INVALID",
            `${label} must be 5-50 characters and can include letters, numbers, and hyphens only.`
        );
    }

    return normalized.toUpperCase();
}

function splitFullName(fullName) {
    const normalized = normalizeNullableString(fullName);
    if (!normalized) {
        return {
            firstName: null,
            middleName: null,
            lastName: null
        };
    }

    const parts = normalized.split(/\s+/).filter(Boolean);
    if (parts.length === 1) {
        return {
            firstName: parts[0],
            middleName: null,
            lastName: null
        };
    }

    if (parts.length === 2) {
        return {
            firstName: parts[0],
            middleName: null,
            lastName: parts[1]
        };
    }

    return {
        firstName: parts[0],
        middleName: parts.slice(1, -1).join(" "),
        lastName: parts[parts.length - 1]
    };
}

function composeFullName(firstName, middleName, lastName) {
    return [firstName, middleName, lastName]
        .map((entry) => normalizeNullableString(entry))
        .filter(Boolean)
        .join(" ") || null;
}

function maskSensitiveIdentity(value) {
    const normalized = normalizeNullableString(value);
    if (!normalized) {
        return null;
    }

    if (normalized.length <= 4) {
        return `${normalized.slice(0, 1)}***`;
    }

    return `${normalized.slice(0, 2)}${"*".repeat(Math.max(normalized.length - 4, 2))}${normalized.slice(-2)}`;
}

function shouldViewSensitiveIdentity(actor) {
    return actor.isInternalOps || PRIVILEGED_IDENTITY_ROLES.has(actor.role);
}

function projectMemberForRead(row, actor) {
    const firstName = normalizeNullableString(row.first_name);
    const middleName = normalizeNullableString(row.middle_name);
    const lastName = normalizeNullableString(row.last_name);
    const split = splitFullName(row.full_name);
    const resolvedFirstName = firstName || split.firstName;
    const resolvedMiddleName = middleName || split.middleName;
    const resolvedLastName = lastName || split.lastName;
    const canViewSensitiveIdentity = shouldViewSensitiveIdentity(actor);
    const tinNo = normalizeNullableString(row.tin_no);
    const nidaNo = normalizeNullableString(row.nida_no);

    return {
        ...row,
        first_name: resolvedFirstName,
        middle_name: resolvedMiddleName,
        last_name: resolvedLastName,
        full_name: normalizeNullableString(row.full_name) || composeFullName(resolvedFirstName, resolvedMiddleName, resolvedLastName),
        phone_number: row.phone || null,
        date_of_birth: row.dob || null,
        address: row.address_line1 || null,
        tin_number: canViewSensitiveIdentity ? tinNo : maskSensitiveIdentity(tinNo),
        nin: canViewSensitiveIdentity ? nidaNo : maskSensitiveIdentity(nidaNo),
        tin_no: canViewSensitiveIdentity ? tinNo : maskSensitiveIdentity(tinNo),
        nida_no: canViewSensitiveIdentity ? nidaNo : maskSensitiveIdentity(nidaNo)
    };
}

function buildMemberWritePatch(payload, existing = null) {
    const patch = {};
    const has = (field) => Object.prototype.hasOwnProperty.call(payload, field);
    const hasAny = (...fields) => fields.some((field) => has(field));
    const touchesName = hasAny("first_name", "middle_name", "last_name", "full_name") || !existing;

    const firstNameInput = has("first_name")
        ? payload.first_name
        : existing?.first_name ?? null;
    const middleNameInput = has("middle_name")
        ? payload.middle_name
        : existing?.middle_name ?? null;
    const lastNameInput = has("last_name")
        ? payload.last_name
        : existing?.last_name ?? null;

    let firstName = normalizeNullableString(firstNameInput);
    let middleName = normalizeNullableString(middleNameInput);
    let lastName = normalizeNullableString(lastNameInput);
    let fullName = has("full_name")
        ? normalizeNullableString(payload.full_name)
        : normalizeNullableString(existing?.full_name);

    if (fullName && (!firstName || !lastName)) {
        const split = splitFullName(fullName);
        firstName = firstName || split.firstName;
        middleName = middleName || split.middleName;
        lastName = lastName || split.lastName;
    }

    if (!fullName && (firstName || lastName)) {
        fullName = composeFullName(firstName, middleName, lastName);
    }

    if (touchesName) {
        if (!fullName) {
            throw new AppError(400, "MEMBER_FULL_NAME_REQUIRED", "Provide full_name or both first_name and last_name.");
        }

        if (!firstName || !lastName) {
            throw new AppError(400, "MEMBER_NAME_PARTS_REQUIRED", "first_name and last_name are required.");
        }

        patch.first_name = firstName;
        patch.middle_name = middleName;
        patch.last_name = lastName;
        patch.full_name = fullName;
    }

    if (hasAny("phone_number", "phone") || !existing) {
        patch.phone = normalizePhone(has("phone_number") ? payload.phone_number : payload.phone);
    }

    if (has("email") || !existing) {
        patch.email = normalizeEmail(payload.email);
    }

    if (hasAny("date_of_birth", "dob") || !existing) {
        patch.dob = has("date_of_birth") ? (payload.date_of_birth || null) : (payload.dob || null);
    }

    if (hasAny("address", "address_line1") || !existing) {
        patch.address_line1 = has("address") ? normalizeNullableString(payload.address) : normalizeNullableString(payload.address_line1);
    }

    if (has("gender") || !existing) {
        patch.gender = normalizeNullableString(payload.gender)?.toLowerCase() || null;
    }

    if (hasAny("tin_number", "tin_no") || !existing) {
        patch.tin_no = normalizeIdentityCode(has("tin_number") ? payload.tin_number : payload.tin_no, "TIN");
    }

    if (hasAny("nin", "nida_no") || !existing) {
        patch.nida_no = normalizeIdentityCode(has("nin") ? payload.nin : payload.nida_no, "NIN");
    }

    if (has("national_id") || !existing) {
        patch.national_id = normalizeNullableString(payload.national_id);
    }

    return patch;
}

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

function buildPagination(query = {}) {
    if (query.page === undefined && query.limit === undefined && !query.cursor) {
        return null;
    }

    const limit = query.limit ? Number(query.limit) : 50;

    if (query.cursor) {
        return {
            mode: "cursor",
            cursor: String(query.cursor),
            limit
        };
    }

    const page = query.page ? Number(query.page) : 1;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    return {
        mode: "offset",
        page,
        limit,
        from,
        to
    };
}

function isMissingDeletedAtColumn(error) {
    const message = error?.message || "";
    return error?.code === "42703" && message.toLowerCase().includes("deleted_at");
}

async function listMembers(actor, filters = {}) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const pagination = buildPagination(filters);
    let memberQuery = applyMemberListFilters(
        adminSupabase.from("members").select(MEMBER_LIST_COLUMNS),
        { actor, filters, tenantId }
    )
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });

    if (pagination?.mode === "cursor") {
        memberQuery = memberQuery.lt("created_at", pagination.cursor).limit(pagination.limit);
    } else if (pagination) {
        memberQuery = memberQuery.range(pagination.from, pagination.to);
    }

    const { data, error } = await memberQuery;

    if (error) {
        throw new AppError(500, "MEMBERS_LIST_FAILED", "Unable to load members.", error);
    }

    const rows = (data || []).map((row) => projectMemberForRead(row, actor));
    if (pagination?.mode === "cursor") {
        const lastRow = rows.length ? rows[rows.length - 1] : null;
        return {
            data: rows,
            pagination: {
                mode: "cursor",
                limit: pagination.limit,
                cursor: pagination.cursor,
                next_cursor: rows.length === pagination.limit ? lastRow?.created_at || null : null,
                total: null
            }
        };
    }

    const total = pagination
        ? await getCachedMembersTotal({ actor, tenantId, filters })
        : null;

    return {
        data: rows,
        pagination: pagination
            ? {
                page: pagination.page,
                limit: pagination.limit,
                total: total || 0
            }
            : null
    };
}

function applyMemberListFilters(builder, { actor, filters, tenantId }) {
    let query = builder
        .eq("tenant_id", tenantId)
        .is("deleted_at", null);

    if (actor.role === "member") {
        query = query.eq("user_id", actor.user.id);
    } else if (!actor.isInternalOps && !["super_admin", "auditor"].includes(actor.role) && actor.branchIds.length) {
        query = query.in("branch_id", actor.branchIds);
    }

    if (filters.branch_id) {
        assertBranchAccess({ auth: actor }, filters.branch_id);
        query = query.eq("branch_id", filters.branch_id);
    }

    if (filters.status) {
        query = query.eq("status", filters.status);
    }

    if (filters.search) {
        const escaped = filters.search.replace(/[%_]/g, "\\$&");
        query = query.or(
            `full_name.ilike.%${escaped}%,phone.ilike.%${escaped}%,email.ilike.%${escaped}%,member_no.ilike.%${escaped}%`
        );
    }

    return query;
}

function getMembersCountCacheKey({ actor, tenantId, filters }) {
    const branchScope = Array.isArray(actor.branchIds) && actor.branchIds.length
        ? actor.branchIds.slice().sort().join(",")
        : "";
    const search = String(filters.search || "").trim().toLowerCase();
    const branchId = filters.branch_id || "";
    const status = filters.status || "";

    return [
        tenantId,
        actor.role || "",
        actor.user?.id || "",
        actor.isInternalOps ? "1" : "0",
        branchScope,
        branchId,
        status,
        search
    ].join("|");
}

async function getCachedMembersTotal({ actor, tenantId, filters }) {
    const cacheKey = getMembersCountCacheKey({ actor, tenantId, filters });
    const now = Date.now();

    if (MEMBERS_COUNT_CACHE_TTL_MS > 0) {
        const cached = membersCountCache.get(cacheKey);
        if (cached && cached.expiresAt > now) {
            return cached.value;
        }
    }

    const inFlight = membersCountInFlight.get(cacheKey);
    if (inFlight) {
        return inFlight;
    }

    const task = (async () => {
        try {
            const countQuery = applyMemberListFilters(
                adminSupabase.from("members").select("id", { count: "planned", head: true }),
                { actor, filters, tenantId }
            );
            const { count, error } = await countQuery;
            if (error) {
                throw new AppError(500, "MEMBERS_COUNT_FAILED", "Unable to count members.", error);
            }

            const total = count || 0;
            if (MEMBERS_COUNT_CACHE_TTL_MS > 0) {
                membersCountCache.set(cacheKey, {
                    value: total,
                    expiresAt: now + MEMBERS_COUNT_CACHE_TTL_MS
                });
            }

            return total;
        } finally {
            membersCountInFlight.delete(cacheKey);
        }
    })();

    membersCountInFlight.set(cacheKey, task);
    return task;
}

async function assertUniqueMemberIdentityFields({
    tenantId,
    memberId = null,
    email = null,
    tinNo = null,
    nidaNo = null
}) {
    const checks = [
        {
            value: email,
            field: "email",
            code: "MEMBER_EMAIL_ALREADY_EXISTS",
            message: "Email already exists for another member."
        },
        {
            value: tinNo,
            field: "tin_no",
            code: "MEMBER_TIN_ALREADY_EXISTS",
            message: "TIN already exists for another member."
        },
        {
            value: nidaNo,
            field: "nida_no",
            code: "MEMBER_NIN_ALREADY_EXISTS",
            message: "NIN already exists for another member."
        }
    ].filter((entry) => entry.value);

    await Promise.all(checks.map(async (entry) => {
        let query = adminSupabase
            .from("members")
            .select("id", { head: true, count: "exact" })
            .eq("tenant_id", tenantId)
            .eq(entry.field, entry.value)
            .is("deleted_at", null);

        if (memberId) {
            query = query.neq("id", memberId);
        }

        const { count, error } = await query;
        if (error) {
            throw new AppError(500, "MEMBER_IDENTITY_LOOKUP_FAILED", "Unable to validate member identity fields.", error);
        }

        if ((count || 0) > 0) {
            throw new AppError(409, entry.code, entry.message);
        }
    }));
}

async function listMemberAccounts(actor, query = {}) {
    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const pagination = buildPagination(query);
    const buildAccountQuery = (includeSoftDeleteFilter = true) => {
        let candidate = adminSupabase
            .from("member_accounts")
            .select("*", pagination ? { count: "exact" } : undefined)
            .eq("tenant_id", tenantId)
            .order("created_at", { ascending: false });

        if (includeSoftDeleteFilter) {
            candidate = candidate.is("deleted_at", null);
        }

        return candidate;
    };

    let accountQuery = buildAccountQuery(true);

    if (actor.role === "member") {
        const { data: ownMember, error: ownMemberError } = await adminSupabase
            .from("members")
            .select("id")
            .eq("tenant_id", tenantId)
            .eq("user_id", actor.user.id)
            .is("deleted_at", null)
            .single();

        if (ownMemberError || !ownMember) {
            throw new AppError(404, "MEMBER_NOT_FOUND", "Linked member record was not found.");
        }

        accountQuery = accountQuery.eq("member_id", ownMember.id);
    } else if (!actor.isInternalOps && !["super_admin", "auditor"].includes(actor.role) && actor.branchIds.length) {
        accountQuery = accountQuery.in("branch_id", actor.branchIds);
    }

    if (query.product_type) {
        accountQuery = accountQuery.eq("product_type", query.product_type);
    }

    if (query.member_id) {
        accountQuery = accountQuery.eq("member_id", query.member_id);
    }

    if (query.status) {
        accountQuery = accountQuery.eq("status", query.status);
    }

    if (query.branch_id) {
        assertBranchAccess({ auth: actor }, query.branch_id);
        accountQuery = accountQuery.eq("branch_id", query.branch_id);
    }

    if (query.search) {
        const escaped = query.search.replace(/[%_]/g, "\\$&");
        accountQuery = accountQuery.or(
            `account_number.ilike.%${escaped}%,account_name.ilike.%${escaped}%`
        );
    }

    if (pagination) {
        accountQuery = accountQuery.range(pagination.from, pagination.to);
    }

    let { data, error, count } = await accountQuery;

    if (error && isMissingDeletedAtColumn(error)) {
        accountQuery = buildAccountQuery(false);

        if (actor.role === "member") {
            const { data: ownMember, error: ownMemberError } = await adminSupabase
                .from("members")
                .select("id")
                .eq("tenant_id", tenantId)
                .eq("user_id", actor.user.id)
                .is("deleted_at", null)
                .single();

            if (ownMemberError || !ownMember) {
                throw new AppError(404, "MEMBER_NOT_FOUND", "Linked member record was not found.");
            }

            accountQuery = accountQuery.eq("member_id", ownMember.id);
        } else if (!actor.isInternalOps && !["super_admin", "auditor"].includes(actor.role) && actor.branchIds.length) {
            accountQuery = accountQuery.in("branch_id", actor.branchIds);
        }

        if (query.product_type) {
            accountQuery = accountQuery.eq("product_type", query.product_type);
        }

        if (query.member_id) {
            accountQuery = accountQuery.eq("member_id", query.member_id);
        }

        if (query.status) {
            accountQuery = accountQuery.eq("status", query.status);
        }

        if (query.branch_id) {
            assertBranchAccess({ auth: actor }, query.branch_id);
            accountQuery = accountQuery.eq("branch_id", query.branch_id);
        }

        if (query.search) {
            const escaped = query.search.replace(/[%_]/g, "\\$&");
            accountQuery = accountQuery.or(
                `account_number.ilike.%${escaped}%,account_name.ilike.%${escaped}%`
            );
        }

        if (pagination) {
            accountQuery = accountQuery.range(pagination.from, pagination.to);
        }

        ({ data, error, count } = await accountQuery);
    }

    if (error) {
        throw new AppError(500, "MEMBER_ACCOUNTS_LIST_FAILED", "Unable to load member accounts.", error);
    }

    return {
        data: data || [],
        pagination: pagination
            ? {
                page: pagination.page,
                limit: pagination.limit,
                total: count || 0
            }
            : null
    };
}

async function safeDeleteAuthUser(userId) {
    if (!userId) {
        return;
    }

    await adminSupabase.auth.admin.deleteUser(userId);
}

async function findAuthUserByEmail(email) {
    if (!email) {
        return null;
    }

    const { data, error } = await adminSupabase.auth.admin.listUsers({
        page: 1,
        perPage: 1000
    });

    if (error) {
        throw new AppError(500, "AUTH_USERS_LIST_FAILED", "Unable to look up auth users.", error);
    }

    return (data?.users || []).find((user) => user.email?.toLowerCase() === email.toLowerCase()) || null;
}

async function getDefaultMemberProducts(tenantId) {
    const [{ data: savingsProduct, error: savingsError }, { data: shareProduct, error: shareError }] = await Promise.all([
        adminSupabase
            .from("savings_products")
            .select("id, code, name")
            .eq("tenant_id", tenantId)
            .eq("status", "active")
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle(),
        adminSupabase
            .from("share_products")
            .select("id, code, name")
            .eq("tenant_id", tenantId)
            .eq("status", "active")
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle()
    ]);

    if (savingsError) {
        throw new AppError(500, "SAVINGS_PRODUCT_LOOKUP_FAILED", "Unable to resolve savings product.", savingsError);
    }

    if (shareError) {
        throw new AppError(500, "SHARE_PRODUCT_LOOKUP_FAILED", "Unable to resolve share product.", shareError);
    }

    if (!savingsProduct || !shareProduct) {
        throw new AppError(
            500,
            "MEMBER_PRODUCTS_NOT_CONFIGURED",
            "Default savings and share products must be configured before onboarding members."
        );
    }

    return {
        savingsProduct,
        shareProduct
    };
}

async function appendMembershipStatusHistory({ tenantId, memberId, applicationId = null, statusCode, changedBy, notes = null }) {
    const { error } = await adminSupabase.from("membership_status_history").insert({
        tenant_id: tenantId,
        member_id: memberId,
        application_id: applicationId,
        status: statusCode,
        changed_by: changedBy,
        reason: notes
    });

    if (error) {
        throw new AppError(
            500,
            "MEMBERSHIP_STATUS_HISTORY_WRITE_FAILED",
            "Unable to record membership status history.",
            error
        );
    }
}

async function ensureMemberAccounts({ tenantId, branchId, member }) {
    let { data: existingAccounts, error: existingAccountsError } = await adminSupabase
        .from("member_accounts")
        .select("id, product_type")
        .eq("tenant_id", tenantId)
        .eq("member_id", member.id)
        .is("deleted_at", null);

    if (existingAccountsError && isMissingDeletedAtColumn(existingAccountsError)) {
        ({ data: existingAccounts, error: existingAccountsError } = await adminSupabase
            .from("member_accounts")
            .select("id, product_type")
            .eq("tenant_id", tenantId)
            .eq("member_id", member.id));
    }

    if (existingAccountsError) {
        throw new AppError(500, "MEMBER_ACCOUNT_LOOKUP_FAILED", "Unable to verify member accounts.", existingAccountsError);
    }

    const existingByProduct = new Set((existingAccounts || []).map((account) => account.product_type));

    if (existingByProduct.has("savings") && existingByProduct.has("shares")) {
        return existingAccounts || [];
    }

    const { data: tenantSettings, error: settingsError } = await adminSupabase
        .from("tenant_settings")
        .select("default_member_savings_control_account_id")
        .eq("tenant_id", tenantId)
        .single();

    if (settingsError || !tenantSettings?.default_member_savings_control_account_id) {
        throw new AppError(
            500,
            "TENANT_SETTINGS_MISSING",
            "Tenant savings control account is not configured."
        );
    }

    const { data: shareControlAccount, error: shareControlError } = await adminSupabase
        .from("chart_of_accounts")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("system_tag", "member_share_capital_control")
        .is("deleted_at", null)
        .single();

    if (shareControlError || !shareControlAccount?.id) {
        throw new AppError(
            500,
            "SHARE_CONTROL_ACCOUNT_MISSING",
            "Tenant member share capital account is not configured."
        );
    }

    const { savingsProduct, shareProduct } = await getDefaultMemberProducts(tenantId);
    const accountRows = [];

    if (!existingByProduct.has("savings")) {
        accountRows.push({
            tenant_id: tenantId,
            member_id: member.id,
            branch_id: branchId,
            account_number: `SV-${crypto.randomInt(100000, 999999)}`,
            account_name: `${member.full_name} Savings`,
            product_type: "savings",
            savings_product_id: savingsProduct.id,
            status: "active",
            gl_account_id: tenantSettings.default_member_savings_control_account_id
        });
    }

    if (!existingByProduct.has("shares")) {
        accountRows.push({
            tenant_id: tenantId,
            member_id: member.id,
            branch_id: branchId,
            account_number: `SH-${crypto.randomInt(100000, 999999)}`,
            account_name: `${member.full_name} Share Capital`,
            product_type: "shares",
            share_product_id: shareProduct.id,
            status: "active",
            gl_account_id: shareControlAccount.id
        });
    }

    if (!accountRows.length) {
        return existingAccounts || [];
    }

    const { error: accountError } = await adminSupabase.from("member_accounts").insert(accountRows);

    if (accountError) {
        throw new AppError(500, "MEMBER_ACCOUNT_CREATE_FAILED", "Unable to create member account.", accountError);
    }

    return [
        ...(existingAccounts || []),
        ...accountRows
    ];
}

async function provisionMemberLogin(actor, member, payload) {
    const email = payload.email || member.email;

    if (!email) {
        throw new AppError(400, "MEMBER_EMAIL_REQUIRED", "Member email is required to create a login.");
    }
    if (payload.send_invite && !member.phone) {
        throw new AppError(400, "MEMBER_PHONE_REQUIRED", "Member phone is required to send the SMS setup link.");
    }

    const branchId = payload.branch_id || member.branch_id;
    const mustChangePassword = Boolean(payload.must_change_password);
    const useSmsSetupLink = Boolean(payload.send_invite);
    const temporaryPassword = !payload.send_invite && !payload.password
        ? generateTemporaryPassword()
        : null;
    const hiddenInvitePassword = useSmsSetupLink ? generateTemporaryPassword() : null;

    const assertAuthUserTenantConsistency = async (authUserId) => {
        const { data: existingProfile, error: existingProfileError } = await adminSupabase
            .from("user_profiles")
            .select("tenant_id, role")
            .eq("user_id", authUserId)
            .is("deleted_at", null)
            .maybeSingle();

        if (existingProfileError) {
            throw new AppError(500, "MEMBER_PROFILE_LOOKUP_FAILED", "Unable to verify existing user profile tenant.", existingProfileError);
        }

        if (existingProfile && existingProfile.tenant_id !== member.tenant_id) {
            throw new AppError(
                409,
                "MEMBER_LOGIN_TENANT_MISMATCH",
                "This email is already linked to a different tenant and cannot be reassigned."
            );
        }
    };

    const linkExistingAuthUser = async (authUser) => {
        const authUserId = authUser.id;
        let destinationHint = null;
        await assertAuthUserTenantConsistency(authUserId);

        const { data: existingLinkedMember, error: existingLinkedMemberError } = await adminSupabase
            .from("members")
            .select("id, full_name")
            .eq("tenant_id", member.tenant_id)
            .eq("user_id", authUserId)
            .is("deleted_at", null)
            .maybeSingle();

        if (existingLinkedMemberError) {
            throw new AppError(500, "MEMBER_LINK_LOOKUP_FAILED", "Unable to verify existing member login link.", existingLinkedMemberError);
        }

        if (existingLinkedMember && existingLinkedMember.id !== member.id) {
            throw new AppError(
                409,
                "MEMBER_LOGIN_EMAIL_IN_USE",
                `This email is already linked to member ${existingLinkedMember.full_name}.`
            );
        }

        const profilePayload = {
            user_id: authUserId,
            tenant_id: member.tenant_id,
            branch_id: branchId,
            full_name: member.full_name,
            phone: member.phone || null,
            role: "member",
            member_id: member.id,
            must_change_password: mustChangePassword,
            first_login_at: mustChangePassword ? null : payload.first_login_at || null,
            is_active: true
        };

        const { data: profile, error: profileError } = await adminSupabase
            .from("user_profiles")
            .upsert(profilePayload, { onConflict: "user_id" })
            .select("*")
            .single();

        if (profileError) {
            throw new AppError(500, "MEMBER_PROFILE_CREATE_FAILED", "Unable to create member profile.", profileError);
        }

        const { data: updatedMember, error: updateError } = await adminSupabase
            .from("members")
            .update({
                user_id: authUserId,
                email
            })
            .eq("id", member.id)
            .select("*")
            .single();

        if (updateError) {
            throw new AppError(500, "MEMBER_LINK_FAILED", "Unable to link member to existing login account.", updateError);
        }

        const authUserUpdatePayload = {
            email,
            user_metadata: {
                full_name: member.full_name,
                phone: member.phone
            },
            app_metadata: {
                ...(authUser.app_metadata || {}),
                tenant_id: member.tenant_id,
                role: "member",
                member_id: member.id
            }
        };

        if (!payload.send_invite) {
            authUserUpdatePayload.password = payload.password || temporaryPassword;
            authUserUpdatePayload.email_confirm = true;
        }

        const { error: authError } = await adminSupabase.auth.admin.updateUserById(authUserId, authUserUpdatePayload);

        if (authError) {
            throw new AppError(500, "MEMBER_AUTH_SYNC_FAILED", "Unable to sync existing member login.", authError);
        }

        await ensureBranchAssignments({
            tenantId: member.tenant_id,
            userId: authUserId,
            branchIds: [member.branch_id]
        });

        if (!payload.send_invite && (temporaryPassword || payload.password)) {
            await saveCredentialHandoff({
                tenantId: member.tenant_id,
                userId: authUserId,
                memberId: member.id,
                email,
                password: temporaryPassword || payload.password,
                createdBy: actor.user.id
            });
        } else if (useSmsSetupLink) {
            const smsResult = await sendPasswordSetupLink({ email });
            destinationHint = smsResult.destination_hint || null;
        }

        return {
            member: updatedMember,
            profile,
            user: {
                id: authUserId,
                email
            },
            already_exists: true,
            temporary_password: temporaryPassword || (await getActiveCredentialByUser({
                tenantId: member.tenant_id,
                userId: authUserId
            }))?.temporary_password || null,
            invite_delivery: payload.send_invite ? "sms_link" : "password",
            destination_hint: destinationHint
        };
    };

    if (member.user_id) {
        await assertAuthUserTenantConsistency(member.user_id);
        let destinationHint = null;

        const { data: existingProfile, error: existingProfileError } = await adminSupabase
            .from("user_profiles")
            .select("must_change_password, first_login_at")
            .eq("user_id", member.user_id)
            .maybeSingle();

        if (existingProfileError) {
            throw new AppError(500, "MEMBER_PROFILE_LOOKUP_FAILED", "Unable to load existing member profile.", existingProfileError);
        }

        const profilePayload = {
            user_id: member.user_id,
            tenant_id: member.tenant_id,
            branch_id: branchId,
            full_name: member.full_name,
            phone: member.phone || null,
            role: "member",
            member_id: member.id,
            must_change_password: mustChangePassword,
            first_login_at: mustChangePassword ? null : (existingProfile?.first_login_at ?? (payload.first_login_at || null)),
            is_active: true
        };

        const { data: profile, error: profileError } = await adminSupabase
            .from("user_profiles")
            .upsert(profilePayload, { onConflict: "user_id" })
            .select("*")
            .single();

        if (profileError) {
            throw new AppError(500, "MEMBER_PROFILE_CREATE_FAILED", "Unable to update member profile.", profileError);
        }

        const { data: updatedMember, error: updateError } = await adminSupabase
            .from("members")
            .update({
                user_id: member.user_id,
                email
            })
            .eq("id", member.id)
            .select("*")
            .single();

        if (updateError) {
            throw new AppError(500, "MEMBER_LINK_FAILED", "Unable to update member login link.", updateError);
        }

        const authUserUpdatePayload = {
            email,
            user_metadata: {
                full_name: member.full_name,
                phone: member.phone
            },
            app_metadata: {
                tenant_id: member.tenant_id,
                role: "member",
                member_id: member.id
            }
        };

        if (!payload.send_invite) {
            authUserUpdatePayload.password = payload.password || temporaryPassword;
            authUserUpdatePayload.email_confirm = true;
        }

        const { error: authError } = await adminSupabase.auth.admin.updateUserById(member.user_id, authUserUpdatePayload);

        if (authError) {
            throw new AppError(500, "MEMBER_AUTH_SYNC_FAILED", "Unable to sync existing member login.", authError);
        }

        await ensureBranchAssignments({
            tenantId: member.tenant_id,
            userId: member.user_id,
            branchIds: [member.branch_id]
        });

        if (!payload.send_invite && (temporaryPassword || payload.password)) {
            await saveCredentialHandoff({
                tenantId: member.tenant_id,
                userId: member.user_id,
                memberId: member.id,
                email,
                password: temporaryPassword || payload.password,
                createdBy: actor.user.id
            });
        } else if (useSmsSetupLink) {
            const smsResult = await sendPasswordSetupLink({ email });
            destinationHint = smsResult.destination_hint || null;
        }

        return {
            member: updatedMember,
            profile,
            user: {
                id: member.user_id,
                email
            },
            already_exists: true,
            temporary_password: temporaryPassword || (await getActiveCredentialByUser({
                tenantId: member.tenant_id,
                userId: member.user_id
            }))?.temporary_password || null,
            invite_delivery: payload.send_invite ? "sms_link" : "password",
            destination_hint: destinationHint
        };
    }

    const authOperation = payload.send_invite
        ? adminSupabase.auth.admin.createUser({
            email,
            password: hiddenInvitePassword,
            email_confirm: true,
            user_metadata: {
                full_name: member.full_name,
                phone: member.phone,
            },
            app_metadata: {
                tenant_id: member.tenant_id,
                role: "member",
                member_id: member.id
            }
        })
        : adminSupabase.auth.admin.createUser({
            email,
            password: payload.password || temporaryPassword,
            email_confirm: true,
            user_metadata: {
                full_name: member.full_name,
                phone: member.phone
            },
            app_metadata: {
                tenant_id: member.tenant_id,
                role: "member",
                member_id: member.id
            }
        });

    let { data: authData, error: authError } = await authOperation;

    if (authError && /already been registered|already exists|duplicate/i.test(authError.message || "")) {
        const existingAuthUser = await findAuthUserByEmail(email);

        if (existingAuthUser) {
            return linkExistingAuthUser(existingAuthUser);
        }
    }

    if (authError || !authData?.user) {
        throw new AppError(500, "MEMBER_LOGIN_CREATE_FAILED", "Unable to create member login.", authError);
    }

    const authUserId = authData.user.id;

    try {
        let destinationHint = null;
        const profilePayload = {
            user_id: authUserId,
            tenant_id: member.tenant_id,
            branch_id: branchId,
            full_name: member.full_name,
            phone: member.phone || null,
            role: "member",
            member_id: member.id,
            must_change_password: mustChangePassword,
            first_login_at: mustChangePassword ? null : payload.first_login_at || null,
            is_active: true
        };

        const { data: profile, error: profileError } = await adminSupabase
            .from("user_profiles")
            .upsert(profilePayload, { onConflict: "user_id" })
            .select("*")
            .single();

        if (profileError) {
            throw new AppError(500, "MEMBER_PROFILE_CREATE_FAILED", "Unable to create member profile.", profileError);
        }

        const { data: updatedMember, error: updateError } = await adminSupabase
            .from("members")
            .update({
                user_id: authUserId,
                email
            })
            .eq("id", member.id)
            .select("*")
            .single();

        if (updateError) {
            throw new AppError(500, "MEMBER_LINK_FAILED", "Unable to link member to login account.", updateError);
        }

        await ensureBranchAssignments({
            tenantId: member.tenant_id,
            userId: authUserId,
            branchIds: [member.branch_id]
        });

        if (!payload.send_invite && (temporaryPassword || payload.password)) {
            await saveCredentialHandoff({
                tenantId: member.tenant_id,
                userId: authUserId,
                memberId: member.id,
                email,
                password: temporaryPassword || payload.password,
                createdBy: actor.user.id
            });
        } else if (useSmsSetupLink) {
            const smsResult = await sendPasswordSetupLink({ email });
            destinationHint = smsResult.destination_hint || null;
        }

        return {
            member: updatedMember,
            profile,
            user: {
                id: authUserId,
                email: authData.user.email
            },
            temporary_password: temporaryPassword,
            invite_delivery: payload.send_invite ? "sms_link" : "password",
            destination_hint: destinationHint
        };
    } catch (error) {
        await safeDeleteAuthUser(authUserId);
        throw error;
    }
}

async function createMember(actor, payload) {
    const tenantId = payload.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);
    assertBranchAccess({ auth: actor }, payload.branch_id);
    await assertPlanLimit(tenantId, "members", "members");
    const normalizedPatch = buildMemberWritePatch(payload);

    await assertUniqueMemberIdentityFields({
        tenantId,
        email: normalizedPatch.email || null,
        tinNo: normalizedPatch.tin_no || null,
        nidaNo: normalizedPatch.nida_no || null
    });

    const { data: member, error } = await adminSupabase
        .from("members")
        .insert({
            tenant_id: tenantId,
            branch_id: payload.branch_id,
            first_name: normalizedPatch.first_name,
            middle_name: normalizedPatch.middle_name,
            last_name: normalizedPatch.last_name,
            full_name: normalizedPatch.full_name,
            gender: normalizedPatch.gender || null,
            dob: normalizedPatch.dob || null,
            phone: normalizedPatch.phone || null,
            email: normalizedPatch.email || null,
            member_no: payload.member_no || null,
            national_id: normalizedPatch.national_id || null,
            address_line1: normalizedPatch.address_line1 || null,
            address_line2: payload.address_line2 || null,
            city: payload.city || null,
            state: payload.state || null,
            country: payload.country || null,
            postal_code: payload.postal_code || null,
            nida_no: normalizedPatch.nida_no || null,
            tin_no: normalizedPatch.tin_no || null,
            next_of_kin_name: payload.next_of_kin_name || null,
            next_of_kin_phone: payload.next_of_kin_phone || null,
            next_of_kin_relationship: payload.next_of_kin_relationship || null,
            employer: payload.employer || null,
            kyc_status: payload.kyc_status || "pending",
            kyc_reason: payload.kyc_reason || null,
            notes: payload.notes || null,
            status: payload.status,
            user_id: payload.user_id || null
        })
        .select("*")
        .single();

    if (error) {
        throw new AppError(500, "MEMBER_CREATE_FAILED", "Unable to create member.", error);
    }

    await ensureMemberAccounts({
        tenantId,
        branchId: payload.branch_id,
        member
    });
    await appendMembershipStatusHistory({
        tenantId,
        memberId: member.id,
        statusCode: payload.status || "active",
        changedBy: actor.user.id,
        notes: "Member onboarded directly."
    });

    let createdMember = member;
    let loginResult = null;

    try {
        if (payload.login?.create_login) {
            loginResult = await provisionMemberLogin(actor, member, {
                email: normalizedPatch.email || null,
                send_invite: payload.login.send_invite,
                password: payload.login.send_invite ? null : payload.login.password,
                branch_id: payload.branch_id,
                must_change_password: Boolean(!payload.login.send_invite)
            });
            createdMember = loginResult.member;
        }
    } catch (error) {
        await adminSupabase
            .from("member_accounts")
            .delete()
            .eq("tenant_id", tenantId)
            .eq("member_id", member.id);
        await adminSupabase
            .from("members")
            .delete()
            .eq("tenant_id", tenantId)
            .eq("id", member.id);
        throw error;
    }

    await logAudit({
        tenantId,
        userId: actor.user.id,
        table: "members",
        action: payload.login?.create_login ? "create_member_with_login" : "create_member",
        afterData: projectMemberForRead(createdMember, actor)
    });

    return {
        member: projectMemberForRead(createdMember, actor),
        login: loginResult
    };
}

async function getMember(actor, memberId) {
    const { data, error } = await adminSupabase
        .from("members")
        .select("*")
        .eq("id", memberId)
        .is("deleted_at", null)
        .single();

    if (error || !data) {
        throw new AppError(404, "MEMBER_NOT_FOUND", "Member was not found.");
    }

    assertTenantAccess({ auth: actor }, data.tenant_id);

    if (actor.role === "member" && data.user_id !== actor.user.id) {
        throw new AppError(403, "FORBIDDEN", "Members can only access their own record.");
    }

    assertBranchAccess({ auth: actor }, data.branch_id);
    return projectMemberForRead(data, actor);
}

async function updateMember(actor, memberId, payload) {
    const before = await getMember(actor, memberId);
    const normalizedPayload = buildMemberWritePatch(payload, before);
    const rawUpdates = {};
    const rawMutableColumns = [
        "branch_id",
        "member_no",
        "address_line2",
        "city",
        "state",
        "country",
        "postal_code",
        "next_of_kin_name",
        "next_of_kin_phone",
        "next_of_kin_relationship",
        "employer",
        "kyc_status",
        "kyc_reason",
        "notes",
        "status"
    ];

    for (const column of rawMutableColumns) {
        if (Object.prototype.hasOwnProperty.call(payload, column)) {
            rawUpdates[column] = payload[column];
        }
    }

    if (normalizedPayload.branch_id || payload.branch_id) {
        assertBranchAccess({ auth: actor }, normalizedPayload.branch_id || payload.branch_id);
    }

    await assertUniqueMemberIdentityFields({
        tenantId: before.tenant_id,
        memberId,
        email: Object.prototype.hasOwnProperty.call(normalizedPayload, "email") ? normalizedPayload.email : null,
        tinNo: Object.prototype.hasOwnProperty.call(normalizedPayload, "tin_no") ? normalizedPayload.tin_no : null,
        nidaNo: Object.prototype.hasOwnProperty.call(normalizedPayload, "nida_no") ? normalizedPayload.nida_no : null
    });

    const { data: updated, error } = await adminSupabase
        .from("members")
        .update({
            ...rawUpdates,
            ...normalizedPayload
        })
        .eq("id", memberId)
        .select("*")
        .single();

    if (error) {
        throw new AppError(500, "MEMBER_UPDATE_FAILED", "Unable to update member.", error);
    }

    if (payload.status && payload.status !== before.status) {
        await appendMembershipStatusHistory({
            tenantId: before.tenant_id,
            memberId,
            statusCode: payload.status,
            changedBy: actor.user.id,
            notes: "Membership status updated from member maintenance."
        });
    }

    if (updated.user_id) {
        const { error: profileError } = await adminSupabase
            .from("user_profiles")
            .update({
                branch_id: updated.branch_id,
                full_name: updated.full_name,
                phone: updated.phone || null,
                member_id: updated.id
            })
            .eq("user_id", updated.user_id);

        if (profileError) {
            throw new AppError(500, "MEMBER_PROFILE_SYNC_FAILED", "Unable to sync linked member profile.", profileError);
        }

        const { error: authError } = await adminSupabase.auth.admin.updateUserById(updated.user_id, {
            email: updated.email || undefined,
            user_metadata: {
                full_name: updated.full_name,
                phone: updated.phone
            },
            app_metadata: {
                tenant_id: updated.tenant_id,
                role: "member",
                member_id: updated.id
            }
        });

        if (authError) {
            throw new AppError(500, "MEMBER_AUTH_SYNC_FAILED", "Unable to sync linked member login.", authError);
        }

        await ensureBranchAssignments({
            tenantId: updated.tenant_id,
            userId: updated.user_id,
            branchIds: [updated.branch_id]
        });
    }

    await logAudit({
        tenantId: before.tenant_id,
        userId: actor.user.id,
        table: "members",
        action: "update_member",
        beforeData: projectMemberForRead(before, actor),
        afterData: projectMemberForRead(updated, actor)
    });

    return projectMemberForRead(updated, actor);
}

async function deleteMember(actor, memberId) {
    const before = await getMember(actor, memberId);

    const { count: activeLoansCount, error: activeLoansError } = await adminSupabase
        .from("loans")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", before.tenant_id)
        .eq("member_id", before.id)
        .in("status", ["active", "in_arrears"]);

    if (activeLoansError) {
        throw new AppError(500, "MEMBER_DELETE_LOAN_CHECK_FAILED", "Unable to verify member active loans.", activeLoansError);
    }

    if ((activeLoansCount || 0) > 0) {
        throw new AppError(
            409,
            "MEMBER_DELETE_BLOCKED_ACTIVE_LOANS",
            "Member cannot be deleted while they have active or in-arrears loans."
        );
    }

    const payload = {
        status: "exited",
        deleted_at: new Date().toISOString(),
        deleted_by: actor.user.id
    };

    const { data: updated, error } = await adminSupabase
        .from("members")
        .update(payload)
        .eq("id", memberId)
        .select("*")
        .single();

    if (error) {
        throw new AppError(500, "MEMBER_DELETE_FAILED", "Unable to soft delete member.", error);
    }

    const memberAccountArchivePayload = {
        status: "closed",
        deleted_by: actor.user.id,
        deleted_at: new Date().toISOString()
    };
    let { error: memberAccountsError } = await adminSupabase
        .from("member_accounts")
        .update(memberAccountArchivePayload)
        .eq("tenant_id", before.tenant_id)
        .eq("member_id", before.id)
        .is("deleted_at", null);

    if (memberAccountsError && isMissingDeletedAtColumn(memberAccountsError)) {
        ({ error: memberAccountsError } = await adminSupabase
            .from("member_accounts")
            .update({
                status: "closed"
            })
            .eq("tenant_id", before.tenant_id)
            .eq("member_id", before.id));
    }

    if (memberAccountsError) {
        throw new AppError(500, "MEMBER_ACCOUNT_ARCHIVE_FAILED", "Unable to archive member accounts.", memberAccountsError);
    }

    await appendMembershipStatusHistory({
        tenantId: before.tenant_id,
        memberId: before.id,
        statusCode: "exited",
        changedBy: actor.user.id,
        notes: "Member deleted by administrator."
    });

    if (before.user_id) {
        const userProfileArchivePayload = {
            is_active: false,
            deleted_by: actor.user.id,
            deleted_at: new Date().toISOString()
        };
        let { error: profileError } = await adminSupabase
            .from("user_profiles")
            .update(userProfileArchivePayload)
            .eq("user_id", before.user_id)
            .eq("tenant_id", before.tenant_id)
            .is("deleted_at", null);

        if (profileError && isMissingDeletedAtColumn(profileError)) {
            ({ error: profileError } = await adminSupabase
                .from("user_profiles")
                .update({ is_active: false })
                .eq("user_id", before.user_id)
                .eq("tenant_id", before.tenant_id));
        }

        if (profileError) {
            throw new AppError(500, "MEMBER_PROFILE_ARCHIVE_FAILED", "Unable to deactivate linked member profile.", profileError);
        }
    }

    await logAudit({
        tenantId: before.tenant_id,
        userId: actor.user.id,
        table: "members",
        action: "delete_member",
        beforeData: before,
        afterData: updated
    });

    return updated;
}

async function bulkDeleteMembers(actor, payload) {
    const memberIds = [...new Set(payload.member_ids || [])];
    const deleted_members = [];
    const failed_members = [];

    for (const memberId of memberIds) {
        try {
            const deleted = await deleteMember(actor, memberId);
            deleted_members.push({
                id: deleted.id,
                full_name: deleted.full_name
            });
        } catch (error) {
            failed_members.push({
                id: memberId,
                code: error?.code || "MEMBER_DELETE_FAILED",
                message: error?.message || "Unable to delete member."
            });
        }
    }

    return {
        requested: memberIds.length,
        deleted_count: deleted_members.length,
        failed_count: failed_members.length,
        deleted_members,
        failed_members
    };
}

async function createMemberLogin(actor, memberId, payload) {
    const member = await getMember(actor, memberId);
    const result = await provisionMemberLogin(actor, member, {
        ...payload,
        branch_id: member.branch_id,
        must_change_password: Boolean(!payload.send_invite)
    });

    await logAudit({
        tenantId: member.tenant_id,
        userId: actor.user.id,
        table: "members",
        action: "create_member_login",
        beforeData: member,
        afterData: result.member
    });

    return result;
}

async function resetMemberPassword(actor, memberId, payload = {}) {
    const member = await getMember(actor, memberId);

    if (!member.user_id) {
        throw new AppError(404, "MEMBER_LOGIN_NOT_FOUND", "This member does not have a linked login.");
    }

    const nextPassword = payload.password?.trim()
        ? payload.password.trim()
        : generateTemporaryPassword();

    const { error: authError } = await adminSupabase.auth.admin.updateUserById(member.user_id, {
        password: nextPassword,
        email_confirm: true,
        user_metadata: {
            full_name: member.full_name,
            phone: member.phone
        },
        app_metadata: {
            tenant_id: member.tenant_id,
            role: "member",
            member_id: member.id
        }
    });

    if (authError) {
        throw new AppError(500, "MEMBER_PASSWORD_RESET_FAILED", "Unable to reset member password.", authError);
    }

    const { data: profile, error: profileError } = await adminSupabase
        .from("user_profiles")
        .upsert(
            {
                user_id: member.user_id,
                tenant_id: member.tenant_id,
                branch_id: member.branch_id,
                full_name: member.full_name,
                phone: member.phone || null,
                role: "member",
                member_id: member.id,
                must_change_password: true,
                first_login_at: null,
                is_active: true
            },
            { onConflict: "user_id" }
        )
        .select("*")
        .single();

    if (profileError) {
        throw new AppError(500, "MEMBER_PROFILE_SYNC_FAILED", "Unable to enforce password reset policy.", profileError);
    }

    let loginEmail = member.email || null;

    if (!loginEmail) {
        const { data: authUserData, error: authUserError } = await adminSupabase.auth.admin.getUserById(member.user_id);

        if (authUserError) {
            throw new AppError(500, "MEMBER_LOGIN_LOOKUP_FAILED", "Unable to load member login details.", authUserError);
        }

        loginEmail = authUserData?.user?.email || null;
    }

    if (!loginEmail) {
        throw new AppError(400, "MEMBER_EMAIL_REQUIRED", "Member email is required to reset login password.");
    }

    await saveCredentialHandoff({
        tenantId: member.tenant_id,
        userId: member.user_id,
        memberId: member.id,
        email: loginEmail,
        password: nextPassword,
        createdBy: actor.user.id
    });

    await logAudit({
        tenantId: member.tenant_id,
        userId: actor.user.id,
        table: "members",
        action: "reset_member_password",
        beforeData: {
            member_id: member.id,
            user_id: member.user_id,
            email: loginEmail
        },
        afterData: {
            member_id: member.id,
            user_id: member.user_id,
            email: loginEmail,
            must_change_password: true
        }
    });

    return {
        member,
        profile,
        user: {
            id: member.user_id,
            email: loginEmail
        },
        temporary_password: nextPassword
    };
}

async function getMemberTemporaryCredential(actor, memberId) {
    const member = await getMember(actor, memberId);

    if (!member.user_id) {
        throw new AppError(404, "MEMBER_LOGIN_NOT_FOUND", "This member does not have a linked login.");
    }

    const handoff = await getActiveCredentialByUser({
        tenantId: member.tenant_id,
        userId: member.user_id
    });

    if (!handoff) {
        throw new AppError(404, "TEMPORARY_CREDENTIAL_NOT_FOUND", "No active temporary credential is available for this member.");
    }

    return {
        ...handoff,
        member_id: member.id,
        full_name: member.full_name
    };
}

module.exports = {
    listMembers,
    listMemberAccounts,
    createMember,
    getMember,
    updateMember,
    deleteMember,
    bulkDeleteMembers,
    createMemberLogin,
    resetMemberPassword,
    ensureMemberAccounts,
    provisionMemberLogin,
    getMemberTemporaryCredential
};
