const env = require("../../config/env");
const { adminSupabase } = require("../../config/supabase");
const { notifyMemberRepaymentDueSoon, notifyRepaymentOverdue } = require("../../services/branch-alerts.service");
const { runObservedJob } = require("../../services/observability.service");
const AppError = require("../../utils/app-error");

const ACTIVE_LOAN_STATUSES = ["active", "in_arrears"];
const DUE_SOON_SCHEDULE_STATUSES = ["pending", "partial"];
const OVERDUE_SCHEDULE_STATUSES = ["pending", "partial", "overdue"];
const DAY_MS = 24 * 60 * 60 * 1000;

function toDateKey(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    return date.toISOString().slice(0, 10);
}

function addDays(value, days) {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    date.setUTCDate(date.getUTCDate() + Number(days || 0));
    return date;
}

function toOutstandingAmount(schedule) {
    const principalOutstanding = Number(schedule?.principal_due || 0) - Number(schedule?.principal_paid || 0);
    const interestOutstanding = Number(schedule?.interest_due || 0) - Number(schedule?.interest_paid || 0);
    return Math.max(Number((principalOutstanding + interestOutstanding).toFixed(2)), 0);
}

function toDaysPastDue(dueDate, today = new Date()) {
    const due = new Date(`${dueDate}T00:00:00.000Z`);
    const current = new Date(`${toDateKey(today)}T00:00:00.000Z`);
    return Math.max(0, Math.floor((current.getTime() - due.getTime()) / DAY_MS));
}

async function fetchReminderCandidates(tenantId, todayKey, dueSoonKey) {
    const limit = env.repaymentReminderMaxSchedulesPerTenant;

    const [dueSoonResult, overdueResult] = await Promise.all([
        adminSupabase
            .from("loan_schedules")
            .select("id, tenant_id, loan_id, due_date, principal_due, interest_due, principal_paid, interest_paid, status")
            .eq("tenant_id", tenantId)
            .in("status", DUE_SOON_SCHEDULE_STATUSES)
            .gte("due_date", todayKey)
            .lte("due_date", dueSoonKey)
            .order("due_date", { ascending: true })
            .limit(limit),
        adminSupabase
            .from("loan_schedules")
            .select("id, tenant_id, loan_id, due_date, principal_due, interest_due, principal_paid, interest_paid, status")
            .eq("tenant_id", tenantId)
            .in("status", OVERDUE_SCHEDULE_STATUSES)
            .lt("due_date", todayKey)
            .order("due_date", { ascending: true })
            .limit(limit)
    ]);

    if (dueSoonResult.error) {
        throw new AppError(500, "REPAYMENT_REMINDER_SCHEDULE_LOOKUP_FAILED", "Unable to load due-soon loan schedules.", dueSoonResult.error);
    }

    if (overdueResult.error) {
        throw new AppError(500, "REPAYMENT_REMINDER_SCHEDULE_LOOKUP_FAILED", "Unable to load overdue loan schedules.", overdueResult.error);
    }

    return {
        dueSoon: (dueSoonResult.data || []).filter((schedule) => toOutstandingAmount(schedule) > 0),
        overdue: (overdueResult.data || []).filter((schedule) => toOutstandingAmount(schedule) > 0)
    };
}

async function loadLoanContext(tenantId, schedules) {
    const loanIds = Array.from(new Set((schedules || []).map((schedule) => schedule.loan_id).filter(Boolean)));
    if (!loanIds.length) {
        return {
            loansById: new Map(),
            membersById: new Map()
        };
    }

    const { data: loans, error: loansError } = await adminSupabase
        .from("loans")
        .select("id, tenant_id, member_id, branch_id, loan_number, status")
        .eq("tenant_id", tenantId)
        .in("id", loanIds)
        .in("status", ACTIVE_LOAN_STATUSES);

    if (loansError) {
        throw new AppError(500, "REPAYMENT_REMINDER_LOAN_LOOKUP_FAILED", "Unable to load loan context for repayment reminders.", loansError);
    }

    const memberIds = Array.from(new Set((loans || []).map((loan) => loan.member_id).filter(Boolean)));
    const { data: members, error: membersError } = memberIds.length
        ? await adminSupabase
            .from("members")
            .select("id, tenant_id, branch_id, user_id, full_name")
            .eq("tenant_id", tenantId)
            .in("id", memberIds)
            .is("deleted_at", null)
        : { data: [], error: null };

    if (membersError) {
        throw new AppError(500, "REPAYMENT_REMINDER_MEMBER_LOOKUP_FAILED", "Unable to load member context for repayment reminders.", membersError);
    }

    return {
        loansById: new Map((loans || []).map((loan) => [loan.id, loan])),
        membersById: new Map((members || []).map((member) => [member.id, member]))
    };
}

async function runRepaymentReminderScanForTenant({ tenantId, now = new Date() }) {
    const todayKey = toDateKey(now);
    const dueSoonKey = toDateKey(addDays(now, env.repaymentReminderDueSoonDays));
    const candidates = await fetchReminderCandidates(tenantId, todayKey, dueSoonKey);
    const allSchedules = [...candidates.dueSoon, ...candidates.overdue];
    const { loansById, membersById } = await loadLoanContext(tenantId, allSchedules);

    let dueSoonNotifications = 0;
    let overdueNotifications = 0;

    for (const schedule of candidates.dueSoon) {
        const loan = loansById.get(schedule.loan_id);
        const member = loan ? membersById.get(loan.member_id) : null;
        if (!loan || !member?.user_id) {
            continue;
        }

        const result = await notifyMemberRepaymentDueSoon({
            tenantId,
            branchId: loan.branch_id || member.branch_id || null,
            memberUserId: member.user_id,
            memberId: member.id,
            scheduleId: schedule.id,
            loanId: loan.id,
            loanNumber: loan.loan_number,
            dueDate: schedule.due_date,
            amount: toOutstandingAmount(schedule)
        });

        dueSoonNotifications += Number(result?.in_app_delivered || 0);
    }

    for (const schedule of candidates.overdue) {
        const loan = loansById.get(schedule.loan_id);
        const member = loan ? membersById.get(loan.member_id) : null;
        if (!loan) {
            continue;
        }

        const result = await notifyRepaymentOverdue({
            tenantId,
            branchId: loan.branch_id || member?.branch_id || null,
            memberUserId: member?.user_id || null,
            memberId: member?.id || null,
            scheduleId: schedule.id,
            loanId: loan.id,
            loanNumber: loan.loan_number,
            dueDate: schedule.due_date,
            amount: toOutstandingAmount(schedule),
            daysPastDue: toDaysPastDue(schedule.due_date, now)
        });

        overdueNotifications += Number(result?.member_in_app_delivered || 0) + Number(result?.staff_in_app_delivered || 0);
    }

    return {
        tenant_id: tenantId,
        due_soon_candidates: candidates.dueSoon.length,
        overdue_candidates: candidates.overdue.length,
        due_soon_notifications: dueSoonNotifications,
        overdue_notifications: overdueNotifications
    };
}

async function runScheduledRepaymentReminders() {
    const { data: tenants, error } = await adminSupabase
        .from("tenants")
        .select("id")
        .eq("status", "active")
        .is("deleted_at", null)
        .limit(env.repaymentReminderMaxTenantsPerRun);

    if (error) {
        throw new AppError(500, "TENANTS_LOOKUP_FAILED", "Unable to load tenants for repayment reminders.", error);
    }

    const summaries = [];
    for (const tenant of tenants || []) {
        const summary = await runObservedJob(
            "notifications.repayment_reminders",
            { tenantId: tenant.id },
            () => runRepaymentReminderScanForTenant({ tenantId: tenant.id, now: new Date() })
        );
        summaries.push(summary);
    }

    return {
        tenants_scanned: summaries.length,
        summaries
    };
}

module.exports = {
    runRepaymentReminderScanForTenant,
    runScheduledRepaymentReminders
};
