const { adminSupabase } = require("../../config/supabase");
const AppError = require("../../utils/app-error");
const { logAudit } = require("../../services/audit.service");
const { assertTenantAccess } = require("../../services/user-context.service");

const TABLE_LABELS = {
    savings_products: "Savings product",
    loan_products: "Loan product",
    share_products: "Share product",
    fee_rules: "Fee rule",
    penalty_rules: "Penalty rule",
    posting_rules: "Posting rule"
};

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 100;
const MAX_BOOTSTRAP_ROWS = 100;

function normalizePagination(query = {}) {
    const page = Math.max(Number(query.page || 1), 1);
    const limit = Math.min(Math.max(Number(query.limit || DEFAULT_LIST_LIMIT), 1), MAX_LIST_LIMIT);
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    return { page, limit, from, to };
}

async function listRows(actor, table, orderBy = "created_at", query = {}) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);
    const { page, limit, from, to } = normalizePagination(query);

    const { data, error, count } = await adminSupabase
        .from(table)
        .select("*", { count: "exact" })
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .order(orderBy, { ascending: true })
        .range(from, to);

    if (error) {
        throw new AppError(500, "PRODUCTS_FETCH_FAILED", `Unable to load ${TABLE_LABELS[table].toLowerCase()}s.`, error);
    }

    return {
        data: data || [],
        pagination: {
            page,
            limit,
            total: count || 0
        }
    };
}

async function listRowsCapped(actor, table, orderBy = "created_at", limit = MAX_BOOTSTRAP_ROWS) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const safeLimit = Math.min(Math.max(Number(limit || MAX_BOOTSTRAP_ROWS), 1), MAX_BOOTSTRAP_ROWS);
    const { data, error } = await adminSupabase
        .from(table)
        .select("*")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .order(orderBy, { ascending: true })
        .limit(safeLimit);

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
        loanProducts,
        shareProducts,
        feeRules,
        penaltyRules,
        postingRules,
        chartOfAccounts
    ] = await Promise.all([
        listRowsCapped(actor, "savings_products", "name"),
        listRowsCapped(actor, "loan_products", "name"),
        listRowsCapped(actor, "share_products", "name"),
        listRowsCapped(actor, "fee_rules", "name"),
        listRowsCapped(actor, "penalty_rules", "name"),
        listRowsCapped(actor, "posting_rules", "operation_code"),
        adminSupabase
            .from("chart_of_accounts")
            .select("id, account_code, account_name, account_type, system_tag")
            .eq("tenant_id", tenantId)
            .is("deleted_at", null)
            .order("account_code", { ascending: true })
            .limit(MAX_BOOTSTRAP_ROWS)
            .then(({ data, error }) => {
                if (error) {
                    throw new AppError(500, "COA_FETCH_FAILED", "Unable to load chart of accounts.", error);
                }

                return data || [];
            })
    ]);

    return {
        savings_products: savingsProducts,
        loan_products: loanProducts,
        share_products: shareProducts,
        fee_rules: feeRules,
        penalty_rules: penaltyRules,
        posting_rules: postingRules,
        chart_of_accounts: chartOfAccounts
    };
}

module.exports = {
    getBootstrap,
    listSavingsProducts: (actor, query) => listRows(actor, "savings_products", "name", query),
    createSavingsProduct: (actor, payload) => createRow(actor, "savings_products", payload),
    updateSavingsProduct: (actor, id, payload) => updateRow(actor, "savings_products", id, payload),
    listLoanProducts: (actor, query) => listRows(actor, "loan_products", "name", query),
    createLoanProduct: (actor, payload) => createRow(actor, "loan_products", payload),
    updateLoanProduct: (actor, id, payload) => updateRow(actor, "loan_products", id, payload),
    listShareProducts: (actor, query) => listRows(actor, "share_products", "name", query),
    createShareProduct: (actor, payload) => createRow(actor, "share_products", payload),
    updateShareProduct: (actor, id, payload) => updateRow(actor, "share_products", id, payload),
    listFeeRules: (actor, query) => listRows(actor, "fee_rules", "name", query),
    createFeeRule: (actor, payload) => createRow(actor, "fee_rules", payload),
    updateFeeRule: (actor, id, payload) => updateRow(actor, "fee_rules", id, payload),
    listPenaltyRules: (actor, query) => listRows(actor, "penalty_rules", "name", query),
    createPenaltyRule: (actor, payload) => createRow(actor, "penalty_rules", payload),
    updatePenaltyRule: (actor, id, payload) => updateRow(actor, "penalty_rules", id, payload),
    listPostingRules: (actor, query) => listRows(actor, "posting_rules", "operation_code", query),
    createPostingRule: (actor, payload) => createRow(actor, "posting_rules", payload),
    updatePostingRule: (actor, id, payload) => updateRow(actor, "posting_rules", id, payload)
};
