const env = require("../../config/env");
const { adminSupabase } = require("../../config/supabase");
const AppError = require("../../utils/app-error");
const { assertTenantAccess } = require("../../services/user-context.service");
const reportService = require("../reports/reports.service");

function toRange(page, limit) {
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    return { from, to };
}

function applyDateRange(query, column, from, to) {
    let next = query;

    if (from) {
        next = next.gte(column, from);
    }

    if (to) {
        next = next.lte(column, to);
    }

    return next;
}

function toTimeValue(value) {
    const [hours = "0", minutes = "0"] = String(value).split(":");
    return Number(hours) * 60 + Number(minutes);
}

function isOutOfHours(timestamp) {
    if (!timestamp) {
        return false;
    }

    const date = new Date(timestamp);
    const minutes = date.getHours() * 60 + date.getMinutes();
    const start = toTimeValue(env.outOfHoursStart);
    const end = toTimeValue(env.outOfHoursEnd);

    if (start > end) {
        return minutes >= start || minutes < end;
    }

    return minutes >= start && minutes < end;
}

function computeJournalFlags(journal, amount) {
    const flags = [];

    if (amount >= env.highValueThresholdTzs) {
        flags.push("HIGH_VALUE_TX");
    }

    if (journal.entry_date && journal.created_at && journal.entry_date < journal.created_at.slice(0, 10)) {
        flags.push("BACKDATED_ENTRY");
    }

    if (journal.is_reversal) {
        flags.push("REVERSAL");
    }

    if (journal.reference === "MANUAL" || journal.source_type === "adjustment") {
        flags.push("MANUAL_JOURNAL");
    }

    if (isOutOfHours(journal.posted_at || journal.created_at)) {
        flags.push("OUT_OF_HOURS_POSTING");
    }

    return flags;
}

async function getSummary(actor, query) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    let journalQuery = adminSupabase
        .from("journal_entries")
        .select("id, entry_date, created_at, posted, is_reversal, source_type, reference, posted_at", { count: "exact" })
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });

    journalQuery = applyDateRange(journalQuery, "created_at", query.from, query.to);

    const { data: journals, error: journalsError } = await journalQuery;

    if (journalsError) {
        throw new AppError(500, "AUDITOR_SUMMARY_FAILED", "Unable to load journal summary.", journalsError);
    }

    const journalIds = (journals || []).map((journal) => journal.id);
    let lineTotals = [];

    if (journalIds.length) {
        const { data: lines, error: linesError } = await adminSupabase
            .from("journal_lines")
            .select("journal_id, debit, credit")
            .in("journal_id", journalIds);

        if (linesError) {
            throw new AppError(500, "AUDITOR_SUMMARY_FAILED", "Unable to load journal lines.", linesError);
        }

        lineTotals = lines || [];
    }

    const debitTotal = lineTotals.reduce((sum, row) => sum + Number(row.debit || 0), 0);
    const creditTotal = lineTotals.reduce((sum, row) => sum + Number(row.credit || 0), 0);

    const exceptions = await getExceptions(actor, {
        from: query.from,
        to: query.to,
        page: 1,
        limit: 1000
    });

    return {
        trial_balance_balanced: Math.abs(debitTotal - creditTotal) < 0.005,
        unposted_journals_count: (journals || []).filter((journal) => !journal.posted).length,
        backdated_entries_count: (journals || []).filter((journal) => journal.entry_date < journal.created_at.slice(0, 10)).length,
        reversals_count: (journals || []).filter((journal) => journal.is_reversal).length,
        manual_journals_count: (journals || []).filter((journal) => journal.reference === "MANUAL" || journal.source_type === "adjustment").length,
        high_value_tx_count: exceptions.data.filter((item) => item.reason_code === "HIGH_VALUE_TX").length,
        out_of_hours_count: exceptions.data.filter((item) => item.reason_code === "OUT_OF_HOURS_POSTING").length
    };
}

async function getExceptions(actor, query) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    let exceptionQuery = adminSupabase
        .from("v_audit_exception_feed")
        .select("*", { count: "exact" })
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });

    exceptionQuery = applyDateRange(exceptionQuery, "created_at", query.from, query.to);

    if (query.reason) {
        exceptionQuery = exceptionQuery.eq("reason_code", query.reason);
    }

    const range = toRange(query.page || 1, query.limit || 20);
    exceptionQuery = exceptionQuery.range(range.from, range.to);

    const { data, count, error } = await exceptionQuery;

    if (error) {
        throw new AppError(500, "AUDITOR_EXCEPTIONS_FAILED", "Unable to load auditor exceptions.", error);
    }

    return {
        data: data || [],
        pagination: {
            page: query.page || 1,
            limit: query.limit || 20,
            total: count || 0
        }
    };
}

async function getJournals(actor, query) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    let journalsQuery = adminSupabase
        .from("journal_entries")
        .select("id, tenant_id, reference, description, entry_date, posted, posted_at, source_type, created_by, created_at, is_reversal, reversed_journal_id", { count: "exact" })
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });

    journalsQuery = applyDateRange(journalsQuery, "created_at", query.from, query.to);

    if (query.search) {
        journalsQuery = journalsQuery.or(`reference.ilike.%${query.search}%,description.ilike.%${query.search}%`);
    }

    const range = toRange(query.page || 1, query.limit || 20);
    journalsQuery = journalsQuery.range(range.from, range.to);

    const { data: journals, count, error } = await journalsQuery;

    if (error) {
        throw new AppError(500, "AUDITOR_JOURNALS_FAILED", "Unable to load journals.", error);
    }

    const journalIds = (journals || []).map((journal) => journal.id);
    let lineMap = new Map();

    if (journalIds.length) {
        const { data: lines, error: linesError } = await adminSupabase
            .from("journal_lines")
            .select("journal_id, debit, credit")
            .in("journal_id", journalIds);

        if (linesError) {
            throw new AppError(500, "AUDITOR_JOURNALS_FAILED", "Unable to load journal totals.", linesError);
        }

        lineMap = (lines || []).reduce((map, line) => {
            const current = map.get(line.journal_id) || { debit_total: 0, credit_total: 0 };
            current.debit_total += Number(line.debit || 0);
            current.credit_total += Number(line.credit || 0);
            map.set(line.journal_id, current);
            return map;
        }, new Map());
    }

    return {
        data: (journals || []).map((journal) => ({
            ...journal,
            ...(lineMap.get(journal.id) || { debit_total: 0, credit_total: 0 }),
            flags: computeJournalFlags(
                journal,
                Math.max(
                    (lineMap.get(journal.id) || {}).debit_total || 0,
                    (lineMap.get(journal.id) || {}).credit_total || 0
                )
            )
        })),
        pagination: {
            page: query.page || 1,
            limit: query.limit || 20,
            total: count || 0
        }
    };
}

async function getJournalDetail(actor, journalId) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const { data: journal, error: journalError } = await adminSupabase
        .from("journal_entries")
        .select("id, tenant_id, reference, description, entry_date, posted, posted_at, source_type, created_by, created_at, is_reversal, reversed_journal_id")
        .eq("tenant_id", tenantId)
        .eq("id", journalId)
        .single();

    if (journalError || !journal) {
        throw new AppError(404, "JOURNAL_NOT_FOUND", "Journal was not found.", journalError);
    }

    const { data: lines, error: linesError } = await adminSupabase
        .from("journal_lines")
        .select("id, journal_id, tenant_id, account_id, member_account_id, branch_id, debit, credit, chart_of_accounts(account_code, account_name)")
        .eq("journal_id", journalId)
        .order("created_at", { ascending: true });

    if (linesError) {
        throw new AppError(500, "JOURNAL_DETAIL_FAILED", "Unable to load journal lines.", linesError);
    }

    return {
        journal,
        lines: lines || []
    };
}

async function getAuditLogs(actor, query) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    let auditQuery = adminSupabase
        .from("audit_logs")
        .select("*", { count: "exact" })
        .eq("tenant_id", tenantId)
        .order("timestamp", { ascending: false });

    auditQuery = applyDateRange(auditQuery, "timestamp", query.from, query.to);

    if (query.action) {
        auditQuery = auditQuery.ilike("action", `%${query.action}%`);
    }

    if (query.entity_type) {
        auditQuery = auditQuery.eq("entity_type", query.entity_type);
    }

    if (query.actor_user_id) {
        auditQuery = auditQuery.eq("actor_user_id", query.actor_user_id);
    }

    const range = toRange(query.page || 1, query.limit || 20);
    auditQuery = auditQuery.range(range.from, range.to);

    const { data, count, error } = await auditQuery;

    if (error) {
        throw new AppError(500, "AUDIT_LOGS_FAILED", "Unable to load audit logs.", error);
    }

    const rows = data || [];
    const actorIds = Array.from(new Set(rows.map((row) => row.actor_user_id || row.user_id).filter(Boolean)));
    let actorNameMap = new Map();

    if (actorIds.length) {
        const { data: actorProfiles, error: actorProfilesError } = await adminSupabase
            .from("user_profiles")
            .select("user_id, full_name")
            .in("user_id", actorIds);

        if (actorProfilesError) {
            throw new AppError(500, "AUDIT_LOG_ACTOR_LOOKUP_FAILED", "Unable to resolve audit log actors.", actorProfilesError);
        }

        actorNameMap = new Map((actorProfiles || []).map((row) => [row.user_id, row.full_name]));
    }

    return {
        data: rows.map((row) => {
            const eventAt = row.timestamp || row.created_at || null;
            const actorUserId = row.actor_user_id || row.user_id || null;

            return {
                ...row,
                action: row.action || null,
                entity_type: row.entity_type || row.table || "unknown",
                actor_user_id: actorUserId,
                actor_name: actorNameMap.get(actorUserId) || null,
                event_at: eventAt,
                created_at: row.created_at || eventAt,
                timestamp: row.timestamp || eventAt
            };
        }),
        pagination: {
            page: query.page || 1,
            limit: query.limit || 20,
            total: count || 0
        }
    };
}

async function getDividendRegister(actor, query) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    let allocationsQuery = adminSupabase
        .from("dividend_allocations")
        .select("id, cycle_id, member_id, basis_value, payout_amount, status, payment_ref, paid_at, dividend_cycles(period_label), members(full_name)")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });

    if (query.periodId) {
        allocationsQuery = allocationsQuery.eq("cycle_id", query.periodId);
    }

    const { data, error } = await allocationsQuery;

    if (error) {
        throw new AppError(500, "AUDITOR_DIVIDEND_REGISTER_FAILED", "Unable to load dividend register.", error);
    }

    return {
        title: "Dividend Register",
        filename: "dividends-register",
        rows: (data || []).map((row) => ({
            period_label: row.dividend_cycles?.period_label || "Unknown period",
            member_name: row.members?.full_name || "Unknown member",
            basis_value: row.basis_value,
            payout_amount: row.payout_amount,
            status: row.status,
            payment_ref: row.payment_ref,
            paid_at: row.paid_at
        }))
    };
}

async function getTrialBalanceReport(actor, query) {
    return reportService.trialBalance(actor, {
        tenant_id: actor.tenantId,
        from_date: query.from,
        to_date: query.to
    });
}

async function getLoanAgingReport(actor, query) {
    return reportService.loanAging(actor, {
        tenant_id: actor.tenantId,
        as_of_date: query.asOf
    });
}

async function getParReport(actor, query) {
    return reportService.parReport(actor, {
        tenant_id: actor.tenantId,
        as_of_date: query.asOf
    });
}

module.exports = {
    getSummary,
    getExceptions,
    getJournals,
    getJournalDetail,
    getAuditLogs,
    getTrialBalanceReport,
    getLoanAgingReport,
    getParReport,
    getDividendRegister
};
