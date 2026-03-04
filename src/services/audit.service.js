const { adminSupabase } = require("../config/supabase");
const AppError = require("../utils/app-error");

async function logAudit({
    tenantId,
    userId,
    actorUserId,
    table,
    action,
    entityType,
    entityId = null,
    beforeData = null,
    afterData = null,
    ip = null,
    userAgent = null
}) {
    const { error } = await adminSupabase.from("audit_logs").insert({
        tenant_id: tenantId,
        user_id: userId || actorUserId,
        actor_user_id: actorUserId || userId,
        table,
        action,
        entity_type: entityType || table,
        entity_id: entityId,
        before_data: beforeData,
        after_data: afterData,
        ip,
        user_agent: userAgent
    });

    if (error) {
        throw new AppError(500, "AUDIT_LOG_WRITE_FAILED", "Unable to write audit log.", error);
    }
}

module.exports = {
    logAudit
};
