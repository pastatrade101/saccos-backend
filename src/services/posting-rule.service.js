const { adminSupabase } = require("../config/supabase");
const AppError = require("../utils/app-error");

async function getPostingRule(tenantId, operationCode) {
    const { data, error } = await adminSupabase
        .from("posting_rules")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("operation_code", operationCode)
        .eq("is_active", true)
        .is("deleted_at", null)
        .maybeSingle();

    if (error) {
        throw new AppError(500, "POSTING_RULE_LOOKUP_FAILED", "Unable to load posting rule.", error);
    }

    return data || null;
}

async function assertPostingRuleConfigured(tenantId, operationCode) {
    const rule = await getPostingRule(tenantId, operationCode);

    if (!rule?.debit_account_id || !rule?.credit_account_id) {
        throw new AppError(
            400,
            "POSTING_RULE_MISSING",
            `Posting rule ${operationCode} is not configured for this tenant.`
        );
    }

    return rule;
}

module.exports = {
    getPostingRule,
    assertPostingRuleConfigured
};
