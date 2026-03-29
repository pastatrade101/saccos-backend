const { adminSupabase } = require("../config/supabase");
const env = require("../config/env");
const AppError = require("../utils/app-error");

const EMPTY_UUID = "00000000-0000-0000-0000-000000000000";
const statusByContext = new Map();

const TABLE_CAPABILITIES = [
    { name: "tenant_subscriptions", migration: "001_plans.sql" },
    { name: "plans", migration: "001_plans.sql" },
    { name: "plan_features", migration: "001_plans.sql" },
    { name: "report_export_jobs", migration: "027_phase3_report_export_jobs.sql" },
    { name: "financial_statement_runs", migration: "041_phase3_financial_statements.sql" },
    { name: "financial_snapshot_periods", migration: "041_phase3_financial_statements.sql" },
    { name: "auth_otp_challenges", migration: "025_auth_otp_challenges.sql" },
    { name: "api_rate_limit_windows", migration: "031_phase4_distributed_rate_limits.sql" },
    { name: "api_metrics", migration: "043_platform_operations_metrics.sql" },
    { name: "api_errors", migration: "043_platform_operations_metrics.sql" },
    { name: "notification_dispatches", migration: "045_branch_alert_notification_dispatches.sql" },
    { name: "notifications", migration: "077_in_app_notifications.sql" },
    { name: "user_notification_preferences", migration: "078_user_notification_preferences.sql" },
    { name: "audit_cases", migration: "079_audit_cases.sql" },
    { name: "audit_case_comments", migration: "080_audit_case_workflow.sql" },
    { name: "audit_case_evidence", migration: "080_audit_case_workflow.sql" },
    { name: "treasury_policies", migration: "081_treasury_foundation.sql" },
    { name: "treasury_assets", migration: "081_treasury_foundation.sql" },
    { name: "treasury_orders", migration: "081_treasury_foundation.sql" },
    { name: "treasury_transactions", migration: "081_treasury_foundation.sql" },
    { name: "treasury_income", migration: "081_treasury_foundation.sql" },
    { name: "treasury_portfolio_positions", migration: "081_treasury_foundation.sql" },
    { name: "sms_trigger_settings", migration: "046_sms_trigger_settings.sql" },
    { name: "payment_orders", migration: "060_phase5_member_payment_orders.sql" },
    { name: "payment_order_callbacks", migration: "060_phase5_member_payment_orders.sql" },
    { name: "webhook_events", migration: "085_snippe_webhook_events.sql" },
    { name: "loan_disbursement_orders", migration: "086_loan_mobile_disbursement_orders.sql" },
    { name: "loan_disbursement_order_callbacks", migration: "086_loan_mobile_disbursement_orders.sql" }
];

const COLUMN_CAPABILITIES = [
    { table: "loan_applications", column: "approval_cycle", migration: "057_phase4_loan_approval_cycles.sql" },
    { table: "loan_approvals", column: "approval_cycle", migration: "057_phase4_loan_approval_cycles.sql" }
];

const RPC_CAPABILITIES = [
    {
        name: "latest_tenant_subscriptions",
        migration: "047_subscription_latest_lookup.sql",
        invoke: () => adminSupabase.rpc("latest_tenant_subscriptions", {
            p_tenant_ids: []
        })
    },
    {
        name: "tenant_branch_counts",
        migration: "048_platform_tenant_branch_counts.sql",
        invoke: () => adminSupabase.rpc("tenant_branch_counts", {
            p_tenant_ids: []
        })
    },
    {
        name: "platform_operations_overview",
        migration: "049_platform_operations_overview_rpc.sql",
        invoke: () => adminSupabase.rpc("platform_operations_overview", {})
    },
    {
        name: "consume_otp_challenge_attempt",
        migration: "032_phase4_otp_atomic_verify.sql",
        invoke: () => adminSupabase.rpc("consume_otp_challenge_attempt", {
            p_challenge_id: EMPTY_UUID,
            p_user_id: EMPTY_UUID,
            p_purpose: "signin",
            p_is_valid: false
        })
    },
    {
        name: "consume_rate_limit",
        migration: "031_phase4_distributed_rate_limits.sql",
        invoke: () => adminSupabase.rpc("consume_rate_limit", {
            p_scope_key: "__schema_capability_probe__",
            p_max_requests: 1,
            p_window_ms: 1
        })
    },
    {
        name: "approve_loan_application",
        migration: "053_phase4_loan_application_approval_rpc.sql",
        invoke: () => adminSupabase.rpc("approve_loan_application", {
            p_tenant_id: EMPTY_UUID,
            p_application_id: EMPTY_UUID,
            p_actor_user_id: EMPTY_UUID,
            p_notes: null
        })
    },
    {
        name: "reject_loan_application",
        migration: "054_phase4_loan_application_rejection_rpc.sql",
        invoke: () => adminSupabase.rpc("reject_loan_application", {
            p_tenant_id: EMPTY_UUID,
            p_application_id: EMPTY_UUID,
            p_actor_user_id: EMPTY_UUID,
            p_reason: "schema capability probe",
            p_notes: null
        })
    },
    {
        name: "submit_loan_application",
        migration: "055_phase4_loan_application_submit_rpc.sql",
        invoke: () => adminSupabase.rpc("submit_loan_application", {
            p_tenant_id: EMPTY_UUID,
            p_application_id: EMPTY_UUID,
            p_actor_user_id: EMPTY_UUID
        })
    },
    {
        name: "appraise_loan_application",
        migration: "056_phase4_loan_application_appraisal_rpc.sql",
        invoke: () => adminSupabase.rpc("appraise_loan_application", {
            p_tenant_id: EMPTY_UUID,
            p_application_id: EMPTY_UUID,
            p_actor_user_id: EMPTY_UUID,
            p_appraisal_notes: "schema capability probe",
            p_risk_rating: "medium",
            p_recommended_amount: 1,
            p_recommended_term_count: 1,
            p_recommended_interest_rate: 1,
            p_recommended_repayment_frequency: "monthly"
        })
    }
];

async function probeTable(capability) {
    const { error } = await adminSupabase
        .from(capability.name)
        .select("*", { head: true, count: "planned" })
        .limit(1);

    if (error) {
        return {
            kind: "table",
            name: capability.name,
            migration: capability.migration,
            ok: false,
            code: String(error.code || "UNKNOWN_ERROR"),
            message: error.message || `Table ${capability.name} is unavailable.`
        };
    }

    return {
        kind: "table",
        name: capability.name,
        migration: capability.migration,
        ok: true
    };
}

async function probeColumn(capability) {
    const { error } = await adminSupabase
        .from(capability.table)
        .select(capability.column, { head: true, count: "planned" })
        .limit(1);

    if (error) {
        return {
            kind: "column",
            name: `${capability.table}.${capability.column}`,
            migration: capability.migration,
            ok: false,
            code: String(error.code || "UNKNOWN_ERROR"),
            message: error.message || `Column ${capability.table}.${capability.column} is unavailable.`
        };
    }

    return {
        kind: "column",
        name: `${capability.table}.${capability.column}`,
        migration: capability.migration,
        ok: true
    };
}

async function probeRpc(capability) {
    const { error } = await capability.invoke();

    if (error) {
        return {
            kind: "rpc",
            name: capability.name,
            migration: capability.migration,
            ok: false,
            code: String(error.code || "UNKNOWN_ERROR"),
            message: error.message || `RPC ${capability.name} is unavailable.`
        };
    }

    return {
        kind: "rpc",
        name: capability.name,
        migration: capability.migration,
        ok: true
    };
}

function buildStatus({ context, startedAt, strict, checks }) {
    const checkedAt = new Date().toISOString();
    const failures = checks.filter((check) => !check.ok);

    return {
        context,
        enabled: true,
        strict,
        ok: failures.length === 0,
        checked_at: checkedAt,
        duration_ms: Date.now() - startedAt,
        checks,
        failures
    };
}

function setStatus(context, status) {
    statusByContext.set(context, status);
    return status;
}

function getSchemaCapabilityStatus(context = "api") {
    return statusByContext.get(context) || {
        context,
        enabled: env.schemaCheckEnabled,
        strict: env.schemaCheckStrict,
        ok: null,
        checked_at: null,
        duration_ms: null,
        checks: [],
        failures: []
    };
}

async function runSchemaCapabilityCheck({ context = "api", strict = env.schemaCheckStrict } = {}) {
    if (!env.schemaCheckEnabled) {
        return setStatus(context, {
            context,
            enabled: false,
            strict,
            ok: true,
            checked_at: new Date().toISOString(),
            duration_ms: 0,
            checks: [],
            failures: []
        });
    }

    const startedAt = Date.now();
    const checks = await Promise.all([
        ...TABLE_CAPABILITIES.map((capability) => probeTable(capability)),
        ...COLUMN_CAPABILITIES.map((capability) => probeColumn(capability)),
        ...RPC_CAPABILITIES.map((capability) => probeRpc(capability))
    ]);

    return setStatus(context, buildStatus({
        context,
        startedAt,
        strict,
        checks
    }));
}

async function assertRequiredSchemaCapabilities({ context = "api", strict = env.schemaCheckStrict } = {}) {
    const status = await runSchemaCapabilityCheck({ context, strict });

    if (!status.ok && strict) {
        const summary = status.failures
            .map((failure) => `${failure.kind}:${failure.name} [${failure.migration}]`)
            .join(", ");

        throw new AppError(
            500,
            "SCHEMA_CAPABILITY_CHECK_FAILED",
            `Required database capabilities are missing for ${context}: ${summary}`,
            {
                context,
                failures: status.failures
            }
        );
    }

    return status;
}

module.exports = {
    assertRequiredSchemaCapabilities,
    getSchemaCapabilityStatus,
    runSchemaCapabilityCheck
};
