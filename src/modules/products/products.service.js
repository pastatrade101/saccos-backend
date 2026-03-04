const { adminSupabase } = require("../../config/supabase");
const AppError = require("../../utils/app-error");
const { logAudit } = require("../../services/audit.service");
const { assertTenantAccess } = require("../../services/user-context.service");

const TABLE_LABELS = {
    savings_products: "Savings product",
    share_products: "Share product",
    fee_rules: "Fee rule",
    penalty_rules: "Penalty rule",
    posting_rules: "Posting rule"
};

async function listRows(actor, table, orderBy = "created_at") {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const { data, error } = await adminSupabase
        .from(table)
        .select("*")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .order(orderBy, { ascending: true });

    if (error) {
        throw new AppError(500, "PRODUCTS_FETCH_FAILED", `Unable to load ${TABLE_LABELS[table].toLowerCase()}s.`, error);
    }

    return data || [];
}

async function createRow(actor, table, payload) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const { data, error } = await adminSupabase
        .from(table)
        .insert({
            tenant_id: tenantId,
            ...payload
        })
        .select("*")
        .single();

    if (error) {
        throw new AppError(500, "PRODUCT_CREATE_FAILED", `Unable to create ${TABLE_LABELS[table].toLowerCase()}.`, error);
    }

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table,
        action: `create_${table}`,
        entityType: table,
        entityId: data.id,
        afterData: data
    });

    return data;
}

async function updateRow(actor, table, id, payload) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const { data: before, error: beforeError } = await adminSupabase
        .from(table)
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("id", id)
        .is("deleted_at", null)
        .single();

    if (beforeError || !before) {
        throw new AppError(404, "PRODUCT_NOT_FOUND", `${TABLE_LABELS[table]} was not found.`);
    }

    const { data, error } = await adminSupabase
        .from(table)
        .update(payload)
        .eq("tenant_id", tenantId)
        .eq("id", id)
        .select("*")
        .single();

    if (error) {
        throw new AppError(500, "PRODUCT_UPDATE_FAILED", `Unable to update ${TABLE_LABELS[table].toLowerCase()}.`, error);
    }

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table,
        action: `update_${table}`,
        entityType: table,
        entityId: id,
        beforeData: before,
        afterData: data
    });

    return data;
}

async function getBootstrap(actor) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const [
        savingsProducts,
        shareProducts,
        feeRules,
        penaltyRules,
        postingRules,
        chartOfAccounts
    ] = await Promise.all([
        listRows(actor, "savings_products", "name"),
        listRows(actor, "share_products", "name"),
        listRows(actor, "fee_rules", "name"),
        listRows(actor, "penalty_rules", "name"),
        listRows(actor, "posting_rules", "operation_code"),
        adminSupabase
            .from("chart_of_accounts")
            .select("id, account_code, account_name, account_type, system_tag")
            .eq("tenant_id", tenantId)
            .is("deleted_at", null)
            .order("account_code", { ascending: true })
            .then(({ data, error }) => {
                if (error) {
                    throw new AppError(500, "COA_FETCH_FAILED", "Unable to load chart of accounts.", error);
                }

                return data || [];
            })
    ]);

    return {
        savings_products: savingsProducts,
        share_products: shareProducts,
        fee_rules: feeRules,
        penalty_rules: penaltyRules,
        posting_rules: postingRules,
        chart_of_accounts: chartOfAccounts
    };
}

module.exports = {
    getBootstrap,
    listSavingsProducts: (actor) => listRows(actor, "savings_products", "name"),
    createSavingsProduct: (actor, payload) => createRow(actor, "savings_products", payload),
    updateSavingsProduct: (actor, id, payload) => updateRow(actor, "savings_products", id, payload),
    listShareProducts: (actor) => listRows(actor, "share_products", "name"),
    createShareProduct: (actor, payload) => createRow(actor, "share_products", payload),
    updateShareProduct: (actor, id, payload) => updateRow(actor, "share_products", id, payload),
    listFeeRules: (actor) => listRows(actor, "fee_rules", "name"),
    createFeeRule: (actor, payload) => createRow(actor, "fee_rules", payload),
    updateFeeRule: (actor, id, payload) => updateRow(actor, "fee_rules", id, payload),
    listPenaltyRules: (actor) => listRows(actor, "penalty_rules", "name"),
    createPenaltyRule: (actor, payload) => createRow(actor, "penalty_rules", payload),
    updatePenaltyRule: (actor, id, payload) => updateRow(actor, "penalty_rules", id, payload),
    listPostingRules: (actor) => listRows(actor, "posting_rules", "operation_code"),
    createPostingRule: (actor, payload) => createRow(actor, "posting_rules", payload),
    updatePostingRule: (actor, id, payload) => updateRow(actor, "posting_rules", id, payload)
};
