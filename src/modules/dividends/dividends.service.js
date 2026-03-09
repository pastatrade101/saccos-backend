const crypto = require("crypto");

const { adminSupabase } = require("../../config/supabase");
const AppError = require("../../utils/app-error");
const { logAudit } = require("../../services/audit.service");
const { assertBranchAccess, assertTenantAccess } = require("../../services/user-context.service");

function toDateOnly(value) {
    return new Date(value).toISOString().slice(0, 10);
}

function addDays(value, days) {
    const next = new Date(value);
    next.setDate(next.getDate() + days);
    return next;
}

function roundToIncrement(value, increment) {
    if (!increment || increment <= 0) {
        return value;
    }

    return Math.round(value / increment) * increment;
}

function hashConfig(config) {
    return crypto.createHash("sha256").update(JSON.stringify(config)).digest("hex");
}

function monthsBetween(startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    return (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
}

function buildDailyBalances(transactions, startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const sorted = transactions
        .slice()
        .sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime());

    let cursor = 0;
    let runningBalance = 0;

    while (cursor < sorted.length && new Date(sorted[cursor].created_at) < start) {
        runningBalance = Number(sorted[cursor].running_balance || 0);
        cursor += 1;
    }

    const balances = [];
    for (let day = new Date(start); day <= end; day = addDays(day, 1)) {
        const dayKey = toDateOnly(day);

        while (cursor < sorted.length && toDateOnly(sorted[cursor].created_at) === dayKey) {
            runningBalance = Number(sorted[cursor].running_balance || 0);
            cursor += 1;
        }

        balances.push({
            date: dayKey,
            balance: Number(runningBalance || 0)
        });
    }

    return balances;
}

function buildComponentConfig(component) {
    return {
        type: component.type,
        basis_method: component.basis_method,
        distribution_mode: component.distribution_mode,
        rate_percent: component.rate_percent ?? null,
        pool_amount: component.pool_amount ?? null,
        retained_earnings_account_id: component.retained_earnings_account_id,
        dividends_payable_account_id: component.dividends_payable_account_id,
        payout_account_id: component.payout_account_id ?? null,
        reserve_account_id: component.reserve_account_id ?? null,
        eligibility_rules_json: component.eligibility_rules_json || {},
        rounding_rules_json: component.rounding_rules_json || {}
    };
}

async function getCycleRecord(cycleId) {
    const { data, error } = await adminSupabase
        .from("dividend_cycles")
        .select("*")
        .eq("id", cycleId)
        .single();

    if (error || !data) {
        throw new AppError(404, "DIVIDEND_CYCLE_NOT_FOUND", "Dividend cycle was not found.");
    }

    return data;
}

async function getCycleBundle(cycleId) {
    const cycle = await getCycleRecord(cycleId);
    const [{ data: components }, { data: approvals }, { data: allocations }, { data: snapshots }, { data: payments }] = await Promise.all([
        adminSupabase.from("dividend_components").select("*").eq("cycle_id", cycleId).order("created_at", { ascending: true }),
        adminSupabase.from("dividend_approvals").select("*").eq("cycle_id", cycleId).order("approved_at", { ascending: true }),
        adminSupabase.from("dividend_allocations").select("*").eq("cycle_id", cycleId).order("created_at", { ascending: true }),
        adminSupabase.from("dividend_member_snapshots").select("*").eq("cycle_id", cycleId).order("created_at", { ascending: true }),
        adminSupabase.from("dividend_payments").select("*").eq("cycle_id", cycleId).order("processed_at", { ascending: false })
    ]);

    return {
        cycle,
        components: components || [],
        approvals: approvals || [],
        allocations: allocations || [],
        snapshots: snapshots || [],
        payments: payments || []
    };
}

async function assertCycleAccess(actor, cycle) {
    assertTenantAccess({ auth: actor }, cycle.tenant_id);
    if (cycle.branch_id) {
        assertBranchAccess({ auth: actor }, cycle.branch_id);
    }
}

async function getNextConfigVersion(tenantId, periodLabel) {
    const { count } = await adminSupabase
        .from("dividend_cycles")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("period_label", periodLabel);

    return Number(count || 0) + 1;
}

async function getDistributableSurplus(tenantId) {
    const { data } = await adminSupabase
        .from("chart_of_accounts")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("system_tag", "retained_earnings")
        .is("deleted_at", null)
        .single();

    if (!data?.id) {
        return 0;
    }

    const { data: balanceRow } = await adminSupabase
        .from("account_balances")
        .select("balance")
        .eq("tenant_id", tenantId)
        .eq("account_id", data.id)
        .maybeSingle();

    return Number(balanceRow?.balance || 0);
}

async function getPendingPayableAllocations(cycleId) {
    const { count, error } = await adminSupabase
        .from("dividend_allocations")
        .select("id", { count: "exact", head: true })
        .eq("cycle_id", cycleId)
        .eq("status", "pending")
        .gt("payout_amount", 0);

    if (error) {
        throw new AppError(500, "DIVIDEND_ALLOCATIONS_FETCH_FAILED", "Unable to validate dividend allocations.", error);
    }

    return Number(count || 0);
}

function computeEndBalance(transactions, recordDate) {
    return transactions
        .filter((entry) => toDateOnly(entry.created_at) <= recordDate)
        .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())[0]?.running_balance || 0;
}

function computeAverageMonthlyBalance(dailyBalances) {
    const monthEnds = new Map();

    dailyBalances.forEach((entry) => {
        monthEnds.set(entry.date.slice(0, 7), Number(entry.balance || 0));
    });

    const values = [...monthEnds.values()];
    if (!values.length) {
        return 0;
    }

    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function computeBasisValue({
    component,
    recordDate,
    startDate,
    memberAccounts,
    accountTransactions,
    memberTransactions,
    memberLoanSchedules
}) {
    const productType = component.type === "share_dividend"
        ? "shares"
        : component.type === "savings_interest_bonus"
            ? "savings"
            : null;

    if (component.basis_method === "transaction_volume") {
        return memberTransactions.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
    }

    if (component.basis_method === "total_interest_paid") {
        return memberLoanSchedules.reduce((sum, entry) => sum + Number(entry.interest_paid || 0), 0);
    }

    if (component.basis_method === "total_fees_paid") {
        return memberTransactions
            .filter((entry) => String(entry.transaction_type || "").toLowerCase().includes("fee"))
            .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
    }

    const relevantAccounts = memberAccounts.filter((account) => account.product_type === productType);

    return relevantAccounts.reduce((sum, account) => {
        const transactions = accountTransactions.filter((entry) => entry.member_account_id === account.id);

        if (component.basis_method === "end_balance") {
            return sum + Number(computeEndBalance(transactions, recordDate) || 0);
        }

        const dailyBalances = buildDailyBalances(transactions, startDate, recordDate);
        const values = dailyBalances.map((entry) => Number(entry.balance || 0));

        if (!values.length) {
            return sum;
        }

        if (component.basis_method === "average_daily_balance") {
            return sum + values.reduce((inner, value) => inner + value, 0) / values.length;
        }

        if (component.basis_method === "average_monthly_balance") {
            return sum + computeAverageMonthlyBalance(dailyBalances);
        }

        if (component.basis_method === "minimum_balance") {
            return sum + Math.min(...values);
        }

        return sum;
    }, 0);
}

function evaluateEligibility({
    member,
    component,
    recordDate,
    shareBalance,
    maxParDays,
    contributionCount
}) {
    const rules = component.eligibility_rules_json || {};
    const reasons = [];

    if (rules.active_only !== false && member.status !== "active") {
        reasons.push("Member is not active.");
    }

    if (rules.exclude_suspended_exited !== false && ["suspended", "exited"].includes(member.status)) {
        reasons.push("Suspended or exited members are excluded.");
    }

    if (rules.min_membership_months && monthsBetween(member.created_at, recordDate) < Number(rules.min_membership_months)) {
        reasons.push(`Minimum membership age of ${rules.min_membership_months} months was not met.`);
    }

    if (rules.minimum_shares && shareBalance < Number(rules.minimum_shares)) {
        reasons.push(`Minimum shares threshold of ${rules.minimum_shares} was not met.`);
    }

    if (rules.max_par_days !== undefined && maxParDays > Number(rules.max_par_days)) {
        reasons.push(`Member arrears exceed ${rules.max_par_days} days.`);
    }

    if (rules.min_contributions_count && contributionCount < Number(rules.min_contributions_count)) {
        reasons.push(`Minimum contribution count of ${rules.min_contributions_count} was not met.`);
    }

    if (rules.require_kyc_completed && !(member.national_id && member.phone)) {
        reasons.push("KYC requirement was not satisfied.");
    }

    return {
        eligible: reasons.length === 0,
        reason: reasons.join(" ")
    };
}

function calculateComponentAllocations(component, memberSnapshots) {
    const rules = component.rounding_rules_json || {};
    const increment = Number(rules.rounding_increment || 1);
    const minimumPayout = Number(rules.minimum_payout_threshold || 0);
    const maxPayout = Number(rules.max_payout_cap || 0);
    const residualHandling = rules.residual_handling || "carry_to_retained_earnings";

    const eligibleRows = memberSnapshots
        .map((snapshot) => {
            const componentSnapshot = (snapshot.snapshot_json?.components || []).find(
                (entry) => entry.component_id === component.id
            );

            return componentSnapshot && componentSnapshot.eligible
                ? {
                    member_id: snapshot.member_id,
                    basis_value: Number(componentSnapshot.basis_value || 0)
                }
                : null;
        })
        .filter(Boolean)
        .filter((entry) => entry.basis_value > 0);

    const totalBasis = eligibleRows.reduce((sum, entry) => sum + entry.basis_value, 0);
    const expectedTotal = component.distribution_mode === "fixed_pool"
        ? Number(component.pool_amount || 0)
        : eligibleRows.reduce((sum, entry) => sum + (entry.basis_value * Number(component.rate_percent || 0)) / 100, 0);

    let allocatedTotal = 0;
    const allocations = eligibleRows.map((entry) => {
        const rawPayout = component.distribution_mode === "fixed_pool"
            ? totalBasis > 0
                ? (entry.basis_value / totalBasis) * Number(component.pool_amount || 0)
                : 0
            : (entry.basis_value * Number(component.rate_percent || 0)) / 100;

        let payout = roundToIncrement(rawPayout, increment);

        if (minimumPayout && payout < minimumPayout) {
            payout = 0;
        }

        if (maxPayout && payout > maxPayout) {
            payout = maxPayout;
        }

        allocatedTotal += payout;

        return {
            member_id: entry.member_id,
            basis_value: entry.basis_value,
            payout_amount: payout
        };
    });

    let residual = roundToIncrement(expectedTotal - allocatedTotal, increment);

    if (residualHandling === "allocate_pro_rata" && residual > 0 && allocations.length) {
        const ordered = allocations
            .slice()
            .sort((left, right) => right.basis_value - left.basis_value);

        let pointer = 0;
        while (residual >= increment && ordered.length) {
            ordered[pointer].payout_amount += increment;
            residual -= increment;
            pointer = (pointer + 1) % ordered.length;
        }
    }

    return {
        allocations,
        total_basis: totalBasis,
        expected_total: expectedTotal,
        allocated_total: allocations.reduce((sum, entry) => sum + entry.payout_amount, 0),
        residual_amount: Math.max(residual, 0),
        residual_handling: residualHandling
    };
}

async function getOptions(actor) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const [{ data: branches }, { data: accounts }] = await Promise.all([
        adminSupabase
            .from("branches")
            .select("id, name, code")
            .eq("tenant_id", tenantId)
            .is("deleted_at", null)
            .order("name", { ascending: true })
            .limit(200),
        adminSupabase
            .from("chart_of_accounts")
            .select("id, account_code, account_name, account_type, system_tag")
            .eq("tenant_id", tenantId)
            .is("deleted_at", null)
            .order("account_code", { ascending: true })
            .limit(200)
    ]);

    return {
        branches: branches || [],
        accounts: accounts || []
    };
}

async function listCycles(actor, query) {
    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const page = Number(query.page || 1);
    const limit = Math.min(Number(query.limit || 50), 100);
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let request = adminSupabase
        .from("dividend_cycles")
        .select("*", { count: "exact" })
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .range(from, to);

    if (query.status) {
        request = request.eq("status", query.status);
    }

    const { data, error, count } = await request;

    if (error) {
        throw new AppError(500, "DIVIDEND_CYCLES_FETCH_FAILED", "Unable to load dividend cycles.", error);
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

async function getCycle(actor, cycleId) {
    const bundle = await getCycleBundle(cycleId);
    await assertCycleAccess(actor, bundle.cycle);
    return bundle;
}

async function createCycle(actor, payload) {
    const tenantId = payload.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);
    if (payload.branch_id) {
        assertBranchAccess({ auth: actor }, payload.branch_id);
    }

    const configVersion = await getNextConfigVersion(tenantId, payload.period_label);
    const configJson = {
        period_label: payload.period_label,
        start_date: payload.start_date,
        end_date: payload.end_date,
        declaration_date: payload.declaration_date,
        record_date: payload.record_date || payload.end_date,
        payment_date: payload.payment_date || null,
        required_checker_count: payload.required_checker_count,
        components: payload.components.map(buildComponentConfig)
    };
    const configHash = hashConfig(configJson);

    const { data: cycle, error } = await adminSupabase
        .from("dividend_cycles")
        .insert({
            tenant_id: tenantId,
            branch_id: payload.branch_id || null,
            period_label: payload.period_label,
            start_date: payload.start_date,
            end_date: payload.end_date,
            declaration_date: payload.declaration_date,
            record_date: payload.record_date || payload.end_date,
            payment_date: payload.payment_date || null,
            required_checker_count: payload.required_checker_count,
            config_json: configJson,
            config_version: configVersion,
            config_hash: configHash,
            created_by: actor.user.id
        })
        .select("*")
        .single();

    if (error || !cycle) {
        throw new AppError(500, "DIVIDEND_CYCLE_CREATE_FAILED", "Unable to create dividend cycle.", error);
    }

    const { error: componentError } = await adminSupabase.from("dividend_components").insert(
        payload.components.map((component) => ({
            cycle_id: cycle.id,
            tenant_id: tenantId,
            ...buildComponentConfig(component)
        }))
    );

    if (componentError) {
        throw new AppError(500, "DIVIDEND_COMPONENT_CREATE_FAILED", "Unable to create dividend components.", componentError);
    }

    await logAudit({
        tenantId,
        userId: actor.user.id,
        table: "dividend_cycles",
        action: "create_dividend_cycle",
        afterData: cycle
    });

    return getCycle(actor, cycle.id);
}

async function updateCycle(actor, cycleId, payload) {
    const existing = await getCycleRecord(cycleId);
    await assertCycleAccess(actor, existing);

    if (existing.status !== "draft") {
        throw new AppError(409, "DIVIDEND_CYCLE_LOCKED", "Only draft dividend cycles can be edited.");
    }

    const nextComponents = payload.components || (await getCycleBundle(cycleId)).components;
    const nextConfig = {
        period_label: payload.period_label || existing.period_label,
        start_date: payload.start_date || existing.start_date,
        end_date: payload.end_date || existing.end_date,
        declaration_date: payload.declaration_date || existing.declaration_date,
        record_date: payload.record_date || existing.record_date || existing.end_date,
        payment_date: payload.payment_date || existing.payment_date,
        required_checker_count: payload.required_checker_count || existing.required_checker_count,
        components: nextComponents.map(buildComponentConfig)
    };

    const { error } = await adminSupabase
        .from("dividend_cycles")
        .update({
            branch_id: payload.branch_id === undefined ? existing.branch_id : payload.branch_id,
            period_label: payload.period_label || existing.period_label,
            start_date: payload.start_date || existing.start_date,
            end_date: payload.end_date || existing.end_date,
            declaration_date: payload.declaration_date || existing.declaration_date,
            record_date: payload.record_date || existing.record_date || existing.end_date,
            payment_date: payload.payment_date === undefined ? existing.payment_date : payload.payment_date,
            required_checker_count: payload.required_checker_count || existing.required_checker_count,
            config_json: nextConfig,
            config_hash: hashConfig(nextConfig)
        })
        .eq("id", cycleId);

    if (error) {
        throw new AppError(500, "DIVIDEND_CYCLE_UPDATE_FAILED", "Unable to update dividend cycle.", error);
    }

    if (payload.components) {
        await adminSupabase.from("dividend_components").delete().eq("cycle_id", cycleId);
        const { error: componentError } = await adminSupabase.from("dividend_components").insert(
            payload.components.map((component) => ({
                cycle_id: cycleId,
                tenant_id: existing.tenant_id,
                ...buildComponentConfig(component)
            }))
        );

        if (componentError) {
            throw new AppError(500, "DIVIDEND_COMPONENT_UPDATE_FAILED", "Unable to update dividend components.", componentError);
        }
    }

    return getCycle(actor, cycleId);
}

async function freezeCycle(actor, cycleId) {
    const bundle = await getCycleBundle(cycleId);
    const { cycle, components } = bundle;
    await assertCycleAccess(actor, cycle);

    if (cycle.status !== "draft") {
        throw new AppError(409, "DIVIDEND_CYCLE_LOCKED", "Only draft dividend cycles can be frozen.");
    }

    const tenantId = cycle.tenant_id;
    const recordDate = cycle.record_date || cycle.end_date;
    const { data: members, error: membersError } = await adminSupabase
        .from("members")
        .select("*")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .order("full_name", { ascending: true });

    if (membersError) {
        throw new AppError(500, "DIVIDEND_MEMBERS_FETCH_FAILED", "Unable to load members for dividend snapshot.", membersError);
    }

    const scopedMembers = (members || []).filter((member) => !cycle.branch_id || member.branch_id === cycle.branch_id);
    const memberIds = scopedMembers.map((member) => member.id);

    const [{ data: accounts }, { data: transactions }, { data: loans }] = await Promise.all([
        adminSupabase
            .from("member_accounts")
            .select("*")
            .eq("tenant_id", tenantId)
            .in("member_id", memberIds.length ? memberIds : ["00000000-0000-0000-0000-000000000000"])
            .is("deleted_at", null),
        adminSupabase
            .from("member_account_transactions")
            .select("*")
            .eq("tenant_id", tenantId)
            .lte("created_at", `${recordDate}T23:59:59.999Z`),
        adminSupabase
            .from("loans")
            .select("id, member_id")
            .eq("tenant_id", tenantId)
            .in("member_id", memberIds.length ? memberIds : ["00000000-0000-0000-0000-000000000000"])
    ]);

    const loanIds = (loans || []).map((loan) => loan.id);
    const { data: loanSchedules } = loanIds.length
        ? await adminSupabase
            .from("loan_schedules")
            .select("*")
            .in("loan_id", loanIds)
        : { data: [] };
    const filteredSchedules = loanSchedules || [];
    const accountsByMember = new Map();
    const transactionsByAccount = new Map();
    const transactionsByMember = new Map();
    const schedulesByMember = new Map();

    (accounts || []).forEach((account) => {
        const existing = accountsByMember.get(account.member_id) || [];
        existing.push(account);
        accountsByMember.set(account.member_id, existing);
    });

    (transactions || []).forEach((transaction) => {
        const accountTransactions = transactionsByAccount.get(transaction.member_account_id) || [];
        accountTransactions.push(transaction);
        transactionsByAccount.set(transaction.member_account_id, accountTransactions);

        const memberAccount = (accounts || []).find((entry) => entry.id === transaction.member_account_id);
        if (memberAccount) {
            const memberTransactions = transactionsByMember.get(memberAccount.member_id) || [];
            if (toDateOnly(transaction.created_at) >= cycle.start_date && toDateOnly(transaction.created_at) <= recordDate) {
                memberTransactions.push(transaction);
            }
            transactionsByMember.set(memberAccount.member_id, memberTransactions);
        }
    });

    filteredSchedules.forEach((schedule) => {
        const loan = (loans || []).find((entry) => entry.id === schedule.loan_id);
        if (!loan) {
            return;
        }

        const existing = schedulesByMember.get(loan.member_id) || [];
        if (schedule.due_date >= cycle.start_date && schedule.due_date <= recordDate) {
            existing.push(schedule);
        }
        schedulesByMember.set(loan.member_id, existing);
    });

    const snapshotRows = scopedMembers.map((member) => {
        const memberAccounts = accountsByMember.get(member.id) || [];
        const accountTransactions = memberAccounts.flatMap((account) => transactionsByAccount.get(account.id) || []);
        const memberTransactions = transactionsByMember.get(member.id) || [];
        const memberLoanSchedules = schedulesByMember.get(member.id) || [];
        const shareBalance = memberAccounts
            .filter((account) => account.product_type === "shares")
            .reduce((sum, account) => sum + Number(account.available_balance || 0), 0);
        const maxParDays = memberLoanSchedules
            .filter((schedule) => schedule.status === "overdue")
            .reduce((max, schedule) => {
                const days = Math.max(
                    0,
                    Math.floor((new Date(recordDate).getTime() - new Date(schedule.due_date).getTime()) / 86400000)
                );
                return Math.max(max, days);
            }, 0);
        const contributionCount = memberTransactions.filter((entry) => entry.direction === "in").length;
        const componentSnapshots = components.map((component) => {
            const basisValue = computeBasisValue({
                component,
                recordDate,
                startDate: cycle.start_date,
                memberAccounts,
                accountTransactions,
                memberTransactions,
                memberLoanSchedules
            });
            const eligibility = evaluateEligibility({
                member,
                component,
                recordDate,
                shareBalance,
                maxParDays,
                contributionCount
            });

            return {
                component_id: component.id,
                type: component.type,
                basis_method: component.basis_method,
                basis_value: Number(basisValue.toFixed(2)),
                eligible: eligibility.eligible,
                reason: eligibility.reason
            };
        });

        return {
            cycle_id: cycleId,
            tenant_id: tenantId,
            member_id: member.id,
            eligibility_status: componentSnapshots.some((entry) => entry.eligible),
            eligibility_reason: componentSnapshots.filter((entry) => !entry.eligible && entry.reason).map((entry) => entry.reason).join(" | "),
            snapshot_json: {
                member_name: member.full_name,
                record_date: recordDate,
                config_hash: cycle.config_hash,
                components: componentSnapshots
            }
        };
    });

    await adminSupabase.from("dividend_member_snapshots").delete().eq("cycle_id", cycleId);
    if (snapshotRows.length) {
        const { error: snapshotError } = await adminSupabase.from("dividend_member_snapshots").insert(snapshotRows);
        if (snapshotError) {
            throw new AppError(500, "DIVIDEND_SNAPSHOT_FAILED", "Unable to create dividend snapshots.", snapshotError);
        }
    }

    const totalsJson = {
        snapshot_member_count: snapshotRows.length,
        snapshot_generated_at: new Date().toISOString(),
        config_hash: cycle.config_hash
    };

    const { error: cycleError } = await adminSupabase
        .from("dividend_cycles")
        .update({
            status: "frozen",
            totals_json: totalsJson
        })
        .eq("id", cycleId);

    if (cycleError) {
        throw new AppError(500, "DIVIDEND_FREEZE_FAILED", "Unable to freeze dividend cycle.", cycleError);
    }

    await logAudit({
        tenantId,
        userId: actor.user.id,
        table: "dividend_cycles",
        action: "freeze_dividend_cycle",
        afterData: { cycle_id: cycleId, totals_json: totalsJson }
    });

    return getCycle(actor, cycleId);
}

async function allocateCycle(actor, cycleId) {
    const bundle = await getCycleBundle(cycleId);
    const { cycle, components, snapshots } = bundle;
    await assertCycleAccess(actor, cycle);

    if (cycle.status !== "frozen") {
        throw new AppError(409, "INVALID_DIVIDEND_STATE", "Only frozen dividend cycles can be allocated.");
    }

    const distributableSurplus = await getDistributableSurplus(cycle.tenant_id);
    const componentTotals = [];
    const rows = [];

    components.forEach((component) => {
        const summary = calculateComponentAllocations(component, snapshots);

        if (component.distribution_mode === "fixed_pool" && Number(component.pool_amount || 0) > distributableSurplus) {
            throw new AppError(
                400,
                "DIVIDEND_POOL_EXCEEDS_SURPLUS",
                "Configured pool exceeds available retained earnings."
            );
        }

        if (summary.allocations.some((entry) => entry.payout_amount < 0)) {
            throw new AppError(400, "NEGATIVE_DIVIDEND_PAYOUT", "Negative dividend payouts are not allowed.");
        }

        summary.allocations
            .filter((allocation) => Number(allocation.payout_amount || 0) > 0)
            .forEach((allocation) => {
            rows.push({
                cycle_id: cycleId,
                component_id: component.id,
                tenant_id: cycle.tenant_id,
                member_id: allocation.member_id,
                basis_value: Number(allocation.basis_value.toFixed(2)),
                payout_amount: Number(allocation.payout_amount.toFixed(2)),
                status: "pending"
            });
        });

        componentTotals.push({
            component_id: component.id,
            type: component.type,
            total_basis: Number(summary.total_basis.toFixed(2)),
            expected_total: Number(summary.expected_total.toFixed(2)),
            allocated_total: Number(summary.allocated_total.toFixed(2)),
            residual_amount: Number(summary.residual_amount.toFixed(2)),
            residual_handling: summary.residual_handling,
            eligible_members: summary.allocations.filter((entry) => entry.payout_amount > 0).length
        });
    });

    if (!rows.length) {
        throw new AppError(
            400,
            "NO_ALLOCATIONS_TO_APPROVE",
            "No payable dividend allocations were generated. Reduce minimum payout threshold or increase rates, then allocate again.",
            { component_totals: componentTotals }
        );
    }

    await adminSupabase.from("dividend_allocations").delete().eq("cycle_id", cycleId);
    if (rows.length) {
        const { error: allocationError } = await adminSupabase.from("dividend_allocations").insert(rows);
        if (allocationError) {
            throw new AppError(500, "DIVIDEND_ALLOCATION_FAILED", "Unable to store dividend allocations.", allocationError);
        }
    }

    const totalsJson = {
        component_totals: componentTotals,
        total_allocated: Number(componentTotals.reduce((sum, component) => sum + component.allocated_total, 0).toFixed(2)),
        total_residual: Number(componentTotals.reduce((sum, component) => sum + component.residual_amount, 0).toFixed(2))
    };

    const { error: cycleError } = await adminSupabase
        .from("dividend_cycles")
        .update({
            status: "allocated",
            totals_json: totalsJson,
            submitted_for_approval_at: null,
            submitted_for_approval_by: null
        })
        .eq("id", cycleId);

    if (cycleError) {
        throw new AppError(500, "DIVIDEND_ALLOCATION_STATUS_FAILED", "Unable to update dividend cycle allocation status.", cycleError);
    }

    await logAudit({
        tenantId: cycle.tenant_id,
        userId: actor.user.id,
        table: "dividend_allocations",
        action: "allocate_dividend_cycle",
        afterData: { cycle_id: cycleId, totals_json: totalsJson }
    });

    return getCycle(actor, cycleId);
}

async function submitCycle(actor, cycleId) {
    const cycle = await getCycleRecord(cycleId);
    await assertCycleAccess(actor, cycle);

    if (cycle.status !== "allocated") {
        throw new AppError(409, "INVALID_DIVIDEND_STATE", "Only allocated cycles can be submitted for approval.");
    }

    const pendingPayableCount = await getPendingPayableAllocations(cycleId);
    if (!pendingPayableCount) {
        throw new AppError(
            400,
            "NO_ALLOCATIONS_TO_APPROVE",
            "No payable dividend allocations are pending for approval. Re-run allocation with updated payout rules."
        );
    }

    const { error } = await adminSupabase
        .from("dividend_cycles")
        .update({
            submitted_for_approval_at: new Date().toISOString(),
            submitted_for_approval_by: actor.user.id
        })
        .eq("id", cycleId);

    if (error) {
        throw new AppError(500, "DIVIDEND_SUBMISSION_FAILED", "Unable to submit dividend cycle for approval.", error);
    }

    await logAudit({
        tenantId: cycle.tenant_id,
        userId: actor.user.id,
        table: "dividend_cycles",
        action: "submit_dividend_cycle_for_approval",
        afterData: { cycle_id: cycleId }
    });

    return getCycle(actor, cycleId);
}

async function approveCycle(actor, cycleId, payload) {
    const cycle = await getCycleRecord(cycleId);
    await assertCycleAccess(actor, cycle);

    if (!cycle.submitted_for_approval_at) {
        throw new AppError(409, "DIVIDEND_NOT_SUBMITTED", "The dividend cycle must be submitted for approval before it can be approved.");
    }

    const pendingPayableCount = await getPendingPayableAllocations(cycleId);
    if (!pendingPayableCount) {
        throw new AppError(
            400,
            "NO_ALLOCATIONS_TO_APPROVE",
            "No payable dividend allocations are pending for approval. Ask branch manager to re-run allocation with updated payout rules."
        );
    }

    const { data, error } = await adminSupabase.rpc("approve_dividend_cycle", {
        p_cycle_id: cycleId,
        p_user_id: actor.user.id,
        p_notes: payload.notes || null,
        p_signature_hash: payload.signature_hash || null
    });

    if (error) {
        throw new AppError(500, "DIVIDEND_APPROVAL_FAILED", "Unable to approve dividend cycle.", error);
    }

    if (data?.success === false) {
        throw new AppError(400, data.code || "DIVIDEND_APPROVAL_REJECTED", data.message, data);
    }

    await logAudit({
        tenantId: cycle.tenant_id,
        userId: actor.user.id,
        table: "dividend_cycles",
        action: "approve_dividend_cycle",
        afterData: data
    });

    return getCycle(actor, cycleId);
}

async function rejectCycle(actor, cycleId, payload) {
    const cycle = await getCycleRecord(cycleId);
    await assertCycleAccess(actor, cycle);

    if (cycle.status !== "allocated") {
        throw new AppError(409, "INVALID_DIVIDEND_STATE", "Only allocated cycles can be rejected for rework.");
    }

    const { error } = await adminSupabase
        .from("dividend_approvals")
        .upsert({
            cycle_id: cycleId,
            tenant_id: cycle.tenant_id,
            approved_by: actor.user.id,
            decision: "rejected",
            notes: payload.notes || null,
            signature_hash: payload.signature_hash || null
        }, { onConflict: "cycle_id,approved_by" });

    if (error) {
        throw new AppError(500, "DIVIDEND_REJECTION_FAILED", "Unable to record dividend rejection.", error);
    }

    await adminSupabase
        .from("dividend_cycles")
        .update({
            status: "draft",
            submitted_for_approval_at: null,
            submitted_for_approval_by: null
        })
        .eq("id", cycleId);

    return getCycle(actor, cycleId);
}

async function payCycle(actor, cycleId, payload) {
    const cycle = await getCycleRecord(cycleId);
    await assertCycleAccess(actor, cycle);

    const { data, error } = await adminSupabase.rpc("pay_dividend_cycle", {
        p_cycle_id: cycleId,
        p_payment_method: payload.payment_method,
        p_user_id: actor.user.id,
        p_reference: payload.reference || null,
        p_description: payload.description || null
    });

    if (error) {
        throw new AppError(500, "DIVIDEND_PAYMENT_FAILED", "Unable to post dividend payment batch.", error);
    }

    if (data?.success === false) {
        throw new AppError(400, data.code || "DIVIDEND_PAYMENT_REJECTED", data.message, data);
    }

    await logAudit({
        tenantId: cycle.tenant_id,
        userId: actor.user.id,
        table: "dividend_payments",
        action: "pay_dividend_cycle",
        afterData: data
    });

    return getCycle(actor, cycleId);
}

async function closeCycle(actor, cycleId) {
    const cycle = await getCycleRecord(cycleId);
    await assertCycleAccess(actor, cycle);

    if (cycle.status !== "paid") {
        throw new AppError(409, "INVALID_DIVIDEND_STATE", "Only paid dividend cycles can be closed.");
    }

    const { error } = await adminSupabase
        .from("dividend_cycles")
        .update({ status: "closed" })
        .eq("id", cycleId);

    if (error) {
        throw new AppError(500, "DIVIDEND_CLOSE_FAILED", "Unable to close dividend cycle.", error);
    }

    await logAudit({
        tenantId: cycle.tenant_id,
        userId: actor.user.id,
        table: "dividend_cycles",
        action: "close_dividend_cycle",
        afterData: { cycle_id: cycleId }
    });

    return getCycle(actor, cycleId);
}

module.exports = {
    getOptions,
    listCycles,
    getCycle,
    createCycle,
    updateCycle,
    freezeCycle,
    allocateCycle,
    submitCycle,
    approveCycle,
    rejectCycle,
    payCycle,
    closeCycle
};
