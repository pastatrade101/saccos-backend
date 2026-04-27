const { adminSupabase } = require("../../config/supabase");
const { ROLES } = require("../../constants/roles");
const { logAudit } = require("../../services/audit.service");
const { assertTenantAccess } = require("../../services/user-context.service");
const AppError = require("../../utils/app-error");

const MEMBER_PORTAL_PAYMENT_CONTROL_COLUMNS = [
    "tenant_id",
    "member_portal_share_contribution_enabled",
    "member_portal_savings_deposit_enabled",
    "member_portal_loan_repayment_enabled",
    "updated_at"
].join(", ");

const DEFAULT_MEMBER_PORTAL_PAYMENT_CONTROLS = Object.freeze({
    share_contribution_enabled: true,
    savings_deposit_enabled: true,
    loan_repayment_enabled: true
});

function ensureSuperAdmin(actor) {
    if (actor.role !== ROLES.SUPER_ADMIN) {
        throw new AppError(403, "FORBIDDEN", "Only tenant super admin can manage member portal payment controls.");
    }
}

function normalizeMemberPortalPaymentControls(row = {}, tenantId = null) {
    return {
        tenant_id: tenantId || row.tenant_id || null,
        share_contribution_enabled: row.member_portal_share_contribution_enabled ?? DEFAULT_MEMBER_PORTAL_PAYMENT_CONTROLS.share_contribution_enabled,
        savings_deposit_enabled: row.member_portal_savings_deposit_enabled ?? DEFAULT_MEMBER_PORTAL_PAYMENT_CONTROLS.savings_deposit_enabled,
        loan_repayment_enabled: row.member_portal_loan_repayment_enabled ?? DEFAULT_MEMBER_PORTAL_PAYMENT_CONTROLS.loan_repayment_enabled,
        updated_at: row.updated_at || null
    };
}

function buildTenantSettingsPatch(payload = {}) {
    const patch = {};

    if (typeof payload.share_contribution_enabled === "boolean") {
        patch.member_portal_share_contribution_enabled = payload.share_contribution_enabled;
    }

    if (typeof payload.savings_deposit_enabled === "boolean") {
        patch.member_portal_savings_deposit_enabled = payload.savings_deposit_enabled;
    }

    if (typeof payload.loan_repayment_enabled === "boolean") {
        patch.member_portal_loan_repayment_enabled = payload.loan_repayment_enabled;
    }

    return patch;
}

function buildTenantSettingsInsertPayload(tenantId, patch = {}) {
    return {
        tenant_id: tenantId,
        member_portal_share_contribution_enabled: DEFAULT_MEMBER_PORTAL_PAYMENT_CONTROLS.share_contribution_enabled,
        member_portal_savings_deposit_enabled: DEFAULT_MEMBER_PORTAL_PAYMENT_CONTROLS.savings_deposit_enabled,
        member_portal_loan_repayment_enabled: DEFAULT_MEMBER_PORTAL_PAYMENT_CONTROLS.loan_repayment_enabled,
        ...patch
    };
}

async function getTenantSettingsRow(tenantId) {
    const { data, error } = await adminSupabase
        .from("tenant_settings")
        .select(MEMBER_PORTAL_PAYMENT_CONTROL_COLUMNS)
        .eq("tenant_id", tenantId)
        .maybeSingle();

    if (error) {
        throw new AppError(500, "MEMBER_PORTAL_PAYMENT_CONTROLS_FETCH_FAILED", "Unable to load member portal payment controls.", error);
    }

    return data || null;
}

async function getMemberPortalPaymentControlsForTenant(tenantId) {
    if (!tenantId) {
        throw new AppError(400, "TENANT_ID_REQUIRED", "Tenant identifier is required.");
    }

    return normalizeMemberPortalPaymentControls(await getTenantSettingsRow(tenantId), tenantId);
}

async function getMemberPortalPaymentControls(actor, query = {}) {
    const tenantId = query.tenant_id || actor.tenantId;
    if (!tenantId) {
        throw new AppError(400, "TENANT_ID_REQUIRED", "Tenant identifier is required.");
    }

    assertTenantAccess({ auth: actor }, tenantId);
    return getMemberPortalPaymentControlsForTenant(tenantId);
}

async function updateMemberPortalPaymentControls(actor, payload = {}) {
    ensureSuperAdmin(actor);

    const tenantId = payload.tenant_id || actor.tenantId;
    if (!tenantId) {
        throw new AppError(400, "TENANT_ID_REQUIRED", "Tenant identifier is required.");
    }

    assertTenantAccess({ auth: actor }, tenantId);

    const patch = buildTenantSettingsPatch(payload);
    if (!Object.keys(patch).length) {
        throw new AppError(400, "MEMBER_PORTAL_PAYMENT_CONTROLS_EMPTY", "Provide at least one member portal payment control to update.");
    }

    const current = await getTenantSettingsRow(tenantId);

    let data;
    let error;

    if (current) {
        ({ data, error } = await adminSupabase
            .from("tenant_settings")
            .update(patch)
            .eq("tenant_id", tenantId)
            .select(MEMBER_PORTAL_PAYMENT_CONTROL_COLUMNS)
            .single());
    } else {
        ({ data, error } = await adminSupabase
            .from("tenant_settings")
            .insert(buildTenantSettingsInsertPayload(tenantId, patch))
            .select(MEMBER_PORTAL_PAYMENT_CONTROL_COLUMNS)
            .single());
    }

    if (error || !data) {
        throw new AppError(500, "MEMBER_PORTAL_PAYMENT_CONTROLS_UPDATE_FAILED", "Unable to update member portal payment controls.", error);
    }

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "tenant_settings",
        action: "UPDATE_MEMBER_PORTAL_PAYMENT_CONTROLS",
        entityType: "tenant_setting",
        entityId: tenantId,
        beforeData: current ? normalizeMemberPortalPaymentControls(current, tenantId) : null,
        afterData: normalizeMemberPortalPaymentControls(data, tenantId)
    });

    return normalizeMemberPortalPaymentControls(data, tenantId);
}

module.exports = {
    getMemberPortalPaymentControls,
    getMemberPortalPaymentControlsForTenant,
    updateMemberPortalPaymentControls
};
