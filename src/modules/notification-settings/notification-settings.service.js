const { adminSupabase } = require("../../config/supabase");
const { ROLES } = require("../../constants/roles");
const { logAudit } = require("../../services/audit.service");
const { invalidateSmsTriggerCache } = require("../../services/branch-alerts.service");
const { assertTenantAccess } = require("../../services/user-context.service");
const AppError = require("../../utils/app-error");
const { SMS_TRIGGER_CATALOG } = require("./notification-settings.constants");

function ensureSuperAdmin(actor) {
    if (actor.role !== ROLES.SUPER_ADMIN) {
        throw new AppError(403, "FORBIDDEN", "Only tenant super admin can manage SMS trigger controls.");
    }
}

function mapWithCatalog(rows = []) {
    const byEvent = new Map((rows || []).map((row) => [row.event_type, Boolean(row.enabled)]));
    return SMS_TRIGGER_CATALOG.map((item) => ({
        ...item,
        enabled: byEvent.has(item.event_type) ? byEvent.get(item.event_type) : true
    }));
}

async function listSmsTriggers(actor, query = {}) {
    ensureSuperAdmin(actor);
    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const { data, error } = await adminSupabase
        .from("sms_trigger_settings")
        .select("event_type, enabled")
        .eq("tenant_id", tenantId);

    if (error) {
        throw new AppError(500, "SMS_TRIGGER_SETTINGS_FETCH_FAILED", "Unable to load SMS trigger settings.", error);
    }

    return mapWithCatalog(data || []);
}

async function updateSmsTrigger(actor, eventType, payload = {}) {
    ensureSuperAdmin(actor);
    const tenantId = payload.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const { data: current, error: currentError } = await adminSupabase
        .from("sms_trigger_settings")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("event_type", eventType)
        .maybeSingle();

    if (currentError) {
        throw new AppError(500, "SMS_TRIGGER_SETTINGS_LOOKUP_FAILED", "Unable to load SMS trigger setting.", currentError);
    }

    const rowPayload = {
        tenant_id: tenantId,
        event_type: eventType,
        enabled: Boolean(payload.enabled),
        updated_by: actor.user.id,
        created_by: current?.created_by || actor.user.id
    };

    const { data, error } = await adminSupabase
        .from("sms_trigger_settings")
        .upsert(rowPayload, { onConflict: "tenant_id,event_type" })
        .select("*")
        .single();

    if (error || !data) {
        throw new AppError(500, "SMS_TRIGGER_SETTINGS_UPDATE_FAILED", "Unable to update SMS trigger setting.", error);
    }

    invalidateSmsTriggerCache(tenantId);

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "sms_trigger_settings",
        action: "UPDATE_SMS_TRIGGER_SETTING",
        entityType: "sms_trigger_setting",
        entityId: data.id,
        beforeData: current || null,
        afterData: data
    });

    const catalog = SMS_TRIGGER_CATALOG.find((item) => item.event_type === eventType);
    return {
        event_type: eventType,
        label: catalog?.label || eventType,
        description: catalog?.description || null,
        enabled: Boolean(data.enabled)
    };
}

module.exports = {
    listSmsTriggers,
    updateSmsTrigger
};
