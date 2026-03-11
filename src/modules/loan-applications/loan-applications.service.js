const { adminSupabase } = require("../../config/supabase");
const { ROLES } = require("../../constants/roles");
const { getSubscriptionStatus } = require("../../services/subscription.service");
const { assertBranchAccess, assertTenantAccess } = require("../../services/user-context.service");
const { logAudit } = require("../../services/audit.service");
const {
    notifyLoanOfficerGuarantorDeclined,
    notifyLoanOfficersApprovedForDisbursement,
    notifyLoanOfficersNewApplication,
    notifyLoanOfficersReappraisalNeeded
} = require("../../services/branch-alerts.service");
const financeService = require("../finance/finance.service");
const creditRiskService = require("../credit-risk/credit-risk.service");
const AppError = require("../../utils/app-error");
const LOAN_APPLICATIONS_COUNT_CACHE_TTL_MS = Math.max(0, Number(process.env.LOAN_APPLICATIONS_COUNT_CACHE_TTL_MS || 15000));
const loanApplicationsCountCache = new Map();
const loanApplicationsCountInFlight = new Map();

const LOAN_APPLICATION_LIST_COLUMNS = `
    id,
    tenant_id,
    branch_id,
    member_id,
    product_id,
    external_reference,
    purpose,
    requested_amount,
    requested_term_count,
    requested_repayment_frequency,
    requested_interest_rate,
    created_via,
    status,
    requested_by,
    requested_on_behalf_by,
    submitted_at,
    appraised_by,
    appraised_at,
    appraisal_notes,
    risk_rating,
    recommended_amount,
    recommended_term_count,
    recommended_interest_rate,
    recommended_repayment_frequency,
    required_approval_count,
    approval_count,
    approval_notes,
    approved_by,
    approved_at,
    disbursement_ready_at,
    rejected_by,
    rejected_at,
    rejection_reason,
    disbursed_by,
    disbursed_at,
    loan_id,
    created_at,
    updated_at,
    members(id, full_name, member_no, branch_id, user_id),
    loan_products(id, code, name)
`;

async function getActiveLoanProduct(tenantId, productId) {
    const { data, error } = await adminSupabase
        .from("loan_products")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("id", productId)
        .is("deleted_at", null)
        .eq("status", "active")
        .single();

    if (error || !data) {
        throw new AppError(404, "LOAN_PRODUCT_NOT_FOUND", "Loan product was not found.");
    }

    return data;
}

async function getMemberRecord(tenantId, memberId) {
    const { data, error } = await adminSupabase
        .from("members")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("id", memberId)
        .is("deleted_at", null)
        .single();

    if (error || !data) {
        throw new AppError(404, "MEMBER_NOT_FOUND", "Member was not found.");
    }

    return data;
}

async function getMemberByUser(tenantId, userId) {
    const { data, error } = await adminSupabase
        .from("members")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("user_id", userId)
        .is("deleted_at", null)
        .single();

    if (error || !data) {
        throw new AppError(404, "MEMBER_PROFILE_NOT_FOUND", "Member profile was not found for this account.");
    }

    return data;
}

async function getApprovalRequirement(tenantId) {
    const [subscription, { data: policy, error: policyError }] = await Promise.all([
        getSubscriptionStatus(tenantId),
        adminSupabase.from("loan_policy_settings").select("*").eq("tenant_id", tenantId).maybeSingle()
    ]);

    if (policyError) {
        throw new AppError(500, "LOAN_POLICY_LOOKUP_FAILED", "Unable to load loan policy settings.", policyError);
    }

    const multiApprovalEnabled = Boolean(subscription.features?.multi_approval_enabled);
    const committeeCount = Number(policy?.committee_approval_count || 1);

    return {
        multiApprovalEnabled,
        requiredApprovalCount: multiApprovalEnabled && Boolean(policy?.multi_approval_required)
            ? Math.max(2, committeeCount)
            : 1
    };
}

async function replaceChildren(applicationId, tenantId, guarantors = [], collateralItems = []) {
    await adminSupabase.from("loan_guarantors").delete().eq("application_id", applicationId);
    await adminSupabase.from("collateral_items").delete().eq("application_id", applicationId);

    if (guarantors.length) {
        const { error } = await adminSupabase.from("loan_guarantors").insert(
            guarantors.map((row) => ({
                application_id: applicationId,
                tenant_id: tenantId,
                member_id: row.member_id,
                guaranteed_amount: row.guaranteed_amount || 0,
                notes: row.notes || null
            }))
        );

        if (error) {
            throw new AppError(500, "LOAN_GUARANTORS_SAVE_FAILED", "Unable to save loan guarantors.", error);
        }
    }

    if (collateralItems.length) {
        const { error } = await adminSupabase.from("collateral_items").insert(
            collateralItems.map((row) => ({
                application_id: applicationId,
                tenant_id: tenantId,
                collateral_type: row.collateral_type,
                description: row.description,
                valuation_amount: row.valuation_amount || 0,
                lien_reference: row.lien_reference || null,
                documents_json: row.documents_json || []
            }))
        );

        if (error) {
            throw new AppError(500, "COLLATERAL_SAVE_FAILED", "Unable to save collateral items.", error);
        }
    }
}

function getGuarantorMember(row) {
    if (!row?.members) {
        return null;
    }

    return Array.isArray(row.members) ? (row.members[0] || null) : row.members;
}

function attachGuarantorConsentReference(application) {
    const guarantors = Array.isArray(application?.loan_guarantors) ? application.loan_guarantors : [];
    const normalizedGuarantors = guarantors.map((row) => {
        const member = getGuarantorMember(row);
        return {
            ...row,
            guarantor_name: member?.full_name || row?.guarantor_name || null,
            guarantorName: member?.full_name || row?.guarantor_name || null
        };
    });
    const acceptedCount = normalizedGuarantors.filter((row) => row.consent_status === "accepted").length;
    const rejectedCount = normalizedGuarantors.filter((row) => row.consent_status === "rejected").length;
    const pendingCount = normalizedGuarantors.filter((row) => row.consent_status !== "accepted" && row.consent_status !== "rejected").length;
    const totalCount = normalizedGuarantors.length;
    const referenceNames = normalizedGuarantors
        .map((row) => row.guarantor_name)
        .filter(Boolean);
    const referenceLabel = referenceNames.length ? referenceNames.join(", ") : "No guarantors";
    const consentSummary = `${acceptedCount}/${totalCount} accepted - ${referenceLabel}`;

    return {
        ...application,
        loan_guarantors: normalizedGuarantors,
        guarantor_consent_reference: normalizedGuarantors.map((row) => ({
            member_id: row.member_id,
            guarantor_name: row.guarantor_name || null,
            guarantorName: row.guarantor_name || null,
            member_name: row.guarantor_name || null,
            consent_status: row.consent_status || "pending"
        })),
        guarantor_consent_summary: consentSummary,
        guarantor_consent: consentSummary,
        guarantorConsent: consentSummary,
        guarantor_reference_names: referenceNames,
        guarantorReferenceNames: referenceNames,
        guarantor_consent_counts: {
            accepted: acceptedCount,
            rejected: rejectedCount,
            pending: pendingCount,
            total: totalCount
        },
        guarantorConsentCounts: {
            accepted: acceptedCount,
            rejected: rejectedCount,
            pending: pendingCount,
            total: totalCount
        }
    };
}

function toTimestamp(value) {
    if (!value) {
        return null;
    }

    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : null;
}

function getCurrentCycleApprovals(application) {
    const rows = Array.isArray(application?.loan_approvals) ? application.loan_approvals : [];
    const submittedAtMs = toTimestamp(application?.submitted_at);
    if (!submittedAtMs) {
        return rows;
    }

    return rows.filter((row) => {
        const createdAtMs = toTimestamp(row?.created_at);
        return createdAtMs !== null && createdAtMs >= submittedAtMs;
    });
}

async function getExpandedApplication(tenantId, applicationId) {
    const { data, error } = await adminSupabase
        .from("loan_applications")
        .select(`
            *,
            members(id, full_name, phone, email, member_no, branch_id, user_id),
            loan_products(id, code, name),
            loan_approvals(*),
            loan_guarantors(*, members(id, full_name, member_no)),
            collateral_items(*)
        `)
        .eq("tenant_id", tenantId)
        .eq("id", applicationId)
        .single();

    if (error || !data) {
        throw new AppError(404, "LOAN_APPLICATION_NOT_FOUND", "Loan application was not found.");
    }

    return attachGuarantorConsentReference(data);
}

function ensureApplicationEditAllowed(actor, application) {
    if (actor.role === ROLES.MEMBER) {
        if (application.members?.user_id !== actor.user.id) {
            throw new AppError(403, "LOAN_APPLICATION_ACCESS_DENIED", "You cannot modify another member's loan application.");
        }
    } else if (![ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER].includes(actor.role)) {
        throw new AppError(403, "FORBIDDEN", "You cannot modify loan applications.");
    }

    if (!["draft", "rejected"].includes(application.status)) {
        throw new AppError(400, "LOAN_APPLICATION_LOCKED", "Only draft or rejected applications can be edited.");
    }
}

function assertAllGuarantorsAccepted(application) {
    const guarantors = Array.isArray(application?.loan_guarantors) ? application.loan_guarantors : [];
    if (!guarantors.length) {
        return;
    }

    const unresolved = guarantors.filter((guarantor) => guarantor.consent_status !== "accepted");
    if (!unresolved.length) {
        return;
    }

    throw new AppError(
        400,
        "GUARANTOR_CONSENT_PENDING",
        "All guarantors must accept before loan can proceed.",
        {
            unresolved_guarantors: unresolved.map((guarantor) => ({
                member_id: guarantor.member_id,
                consent_status: guarantor.consent_status || "pending",
                guaranteed_amount: Number(guarantor.guaranteed_amount || 0)
            }))
        }
    );
}

async function listGuarantorRequests(actor, query = {}) {
    if (actor.role !== ROLES.MEMBER) {
        throw new AppError(403, "FORBIDDEN", "Only members can view guarantor consent requests.");
    }

    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);
    const ownMember = await getMemberByUser(tenantId, actor.user.id);
    const page = Math.max(Number(query.page || 1), 1);
    const limit = Math.min(Math.max(Number(query.limit || 50), 1), 100);
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let builder = adminSupabase
        .from("loan_guarantors")
        .select(`
            id,
            application_id,
            tenant_id,
            member_id,
            guaranteed_amount,
            consent_status,
            consented_at,
            notes,
            created_at,
            loan_applications!inner(
                id,
                tenant_id,
                branch_id,
                member_id,
                product_id,
                purpose,
                requested_amount,
                requested_term_count,
                requested_repayment_frequency,
                requested_interest_rate,
                status,
                created_at,
                updated_at,
                members(id, full_name, member_no)
            )
        `, { count: "exact" })
        .eq("tenant_id", tenantId)
        .eq("member_id", ownMember.id);

    if (query.status) {
        builder = builder.eq("consent_status", query.status);
    }

    const { data, error, count } = await builder
        .order("created_at", { ascending: false })
        .range(from, to);

    if (error) {
        throw new AppError(500, "GUARANTOR_REQUESTS_FETCH_FAILED", "Unable to load guarantor requests.", error);
    }

    return {
        data: (data || []).map((row) => {
            const application = row.loan_applications || null;
            return {
                ...row,
                borrower: application?.members || null,
                loan_application: application || null
            };
        }),
        pagination: {
            page,
            limit,
            total: count || 0
        }
    };
}

async function enrichLoanApplicationListDetails(rows, tenantId) {
    const applicationIds = Array.from(new Set((rows || []).map((row) => row.id).filter(Boolean)));
    if (!applicationIds.length) {
        return rows || [];
    }

    const [{ data: guarantors, error: guarantorsError }, { data: collateralItems, error: collateralError }] = await Promise.all([
        adminSupabase
            .from("loan_guarantors")
            .select(`
                id,
                application_id,
                tenant_id,
                member_id,
                guaranteed_amount,
                consent_status,
                consented_at,
                notes,
                created_at,
                members(id, full_name, member_no)
            `)
            .eq("tenant_id", tenantId)
            .in("application_id", applicationIds),
        adminSupabase
            .from("collateral_items")
            .select(`
                id,
                application_id,
                tenant_id,
                collateral_type,
                description,
                valuation_amount,
                lien_reference,
                documents_json,
                created_at
            `)
            .eq("tenant_id", tenantId)
            .in("application_id", applicationIds)
    ]);

    if (guarantorsError) {
        throw new AppError(500, "LOAN_GUARANTORS_FETCH_FAILED", "Unable to load loan guarantors.", guarantorsError);
    }

    if (collateralError) {
        throw new AppError(500, "COLLATERAL_ITEMS_FETCH_FAILED", "Unable to load collateral details.", collateralError);
    }

    const guarantorsByApplication = new Map();
    for (const row of guarantors || []) {
        const existing = guarantorsByApplication.get(row.application_id) || [];
        existing.push(row);
        guarantorsByApplication.set(row.application_id, existing);
    }

    const collateralByApplication = new Map();
    for (const row of collateralItems || []) {
        const existing = collateralByApplication.get(row.application_id) || [];
        existing.push(row);
        collateralByApplication.set(row.application_id, existing);
    }

    return (rows || []).map((row) => attachGuarantorConsentReference({
        ...row,
        loan_guarantors: guarantorsByApplication.get(row.id) || [],
        collateral_items: collateralByApplication.get(row.id) || []
    }));
}

async function listLoanApplications(actor, query) {
    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const hasCursor = Boolean(query.cursor);
    const hasPagination = query.page !== undefined || query.limit !== undefined || hasCursor;
    const page = query.page ? Number(query.page) : 1;
    const limit = query.limit ? Number(query.limit) : 50;
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    const cursor = hasCursor ? String(query.cursor) : null;

    const ownMemberId = actor.role === ROLES.MEMBER
        ? (await getMemberByUser(tenantId, actor.user.id)).id
        : null;

    let builder = applyLoanApplicationListFilters(
        adminSupabase
            .from("loan_applications")
            .select(LOAN_APPLICATION_LIST_COLUMNS),
        { actor, query, tenantId, ownMemberId }
    )
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });

    if (hasCursor) {
        builder = builder.lt("created_at", cursor).limit(limit);
    } else if (hasPagination) {
        builder = builder.range(from, to);
    }

    const { data, error } = await builder;

    if (error) {
        throw new AppError(500, "LOAN_APPLICATIONS_FETCH_FAILED", "Unable to load loan applications.", error);
    }

    const rows = data || [];
    const hydratedRows = [ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER].includes(actor.role)
        ? await enrichLoanApplicationListDetails(rows, tenantId)
        : rows;
    if (hasCursor) {
        const lastRow = hydratedRows.length ? hydratedRows[hydratedRows.length - 1] : null;
        return {
            data: hydratedRows,
            pagination: {
                mode: "cursor",
                limit,
                cursor,
                next_cursor: hydratedRows.length === limit ? lastRow?.created_at || null : null,
                total: null
            }
        };
    }

    const total = hasPagination
        ? await getCachedLoanApplicationsTotal({ actor, query, tenantId, ownMemberId })
        : null;

    return {
        data: hydratedRows,
        pagination: hasPagination
            ? {
                page,
                limit,
                total: total || 0
            }
            : null
    };
}

function applyLoanApplicationListFilters(builder, { actor, query, tenantId, ownMemberId }) {
    let scoped = builder.eq("tenant_id", tenantId);

    if (actor.role === ROLES.MEMBER && ownMemberId) {
        scoped = scoped.eq("member_id", ownMemberId);
    } else if (
        !actor.isInternalOps
        && [ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER].includes(actor.role)
        && actor.branchIds.length
    ) {
        scoped = scoped.in("branch_id", actor.branchIds);
    }

    if (query.status) {
        scoped = scoped.eq("status", query.status);
    } else if (actor.role === ROLES.BRANCH_MANAGER) {
        // Branch managers should process active checker queue only, not rejected rework items.
        scoped = scoped.in("status", ["submitted", "appraised", "approved", "disbursed"]);
    }
    if (query.member_id) scoped = scoped.eq("member_id", query.member_id);
    if (query.branch_id) {
        assertBranchAccess({ auth: actor }, query.branch_id);
        scoped = scoped.eq("branch_id", query.branch_id);
    }
    if (query.product_id) scoped = scoped.eq("product_id", query.product_id);

    return scoped;
}

function getLoanApplicationsCountCacheKey({ actor, query, tenantId, ownMemberId }) {
    const branchScope = Array.isArray(actor.branchIds) && actor.branchIds.length
        ? actor.branchIds.slice().sort().join(",")
        : "";

    return [
        tenantId,
        actor.role || "",
        actor.user?.id || "",
        ownMemberId || "",
        actor.isInternalOps ? "1" : "0",
        branchScope,
        query.status || "",
        query.member_id || "",
        query.branch_id || "",
        query.product_id || ""
    ].join("|");
}

async function getCachedLoanApplicationsTotal({ actor, query, tenantId, ownMemberId }) {
    const cacheKey = getLoanApplicationsCountCacheKey({ actor, query, tenantId, ownMemberId });
    const now = Date.now();

    if (LOAN_APPLICATIONS_COUNT_CACHE_TTL_MS > 0) {
        const cached = loanApplicationsCountCache.get(cacheKey);
        if (cached && cached.expiresAt > now) {
            return cached.value;
        }
    }

    const inFlight = loanApplicationsCountInFlight.get(cacheKey);
    if (inFlight) {
        return inFlight;
    }

    const task = (async () => {
        try {
            const countQuery = applyLoanApplicationListFilters(
                adminSupabase
                    .from("loan_applications")
                    .select("id", { count: "planned", head: true }),
                { actor, query, tenantId, ownMemberId }
            );

            const { count, error } = await countQuery;
            if (error) {
                throw new AppError(
                    500,
                    "LOAN_APPLICATIONS_COUNT_FAILED",
                    "Unable to count loan applications.",
                    error
                );
            }

            const total = count || 0;
            if (LOAN_APPLICATIONS_COUNT_CACHE_TTL_MS > 0) {
                loanApplicationsCountCache.set(cacheKey, {
                    value: total,
                    expiresAt: now + LOAN_APPLICATIONS_COUNT_CACHE_TTL_MS
                });
            }

            return total;
        } finally {
            loanApplicationsCountInFlight.delete(cacheKey);
        }
    })();

    loanApplicationsCountInFlight.set(cacheKey, task);
    return task;
}

async function createLoanApplication(actor, payload) {
    const tenantId = payload.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    let member;
    if (actor.role === ROLES.MEMBER) {
        member = await getMemberByUser(tenantId, actor.user.id);
    } else {
        if (!payload.member_id) {
            throw new AppError(400, "MEMBER_ID_REQUIRED", "Member is required for staff-originated loan applications.");
        }
        member = await getMemberRecord(tenantId, payload.member_id);
    }

    const product = await getActiveLoanProduct(tenantId, payload.product_id);
    const branchId = actor.role === ROLES.MEMBER ? member.branch_id : payload.branch_id || member.branch_id;

    if (actor.role !== ROLES.MEMBER) {
        assertBranchAccess({ auth: actor }, branchId);
    }
    const approvalRequirement = await getApprovalRequirement(tenantId);

    const { data, error } = await adminSupabase
        .from("loan_applications")
        .insert({
            tenant_id: tenantId,
            branch_id: branchId,
            member_id: member.id,
            product_id: product.id,
            external_reference: payload.external_reference || null,
            purpose: payload.purpose,
            requested_amount: payload.requested_amount,
            requested_term_count: payload.requested_term_count,
            requested_repayment_frequency: payload.requested_repayment_frequency,
            requested_interest_rate: payload.requested_interest_rate ?? product.annual_interest_rate,
            created_via: actor.role === ROLES.MEMBER ? "member_portal" : "staff",
            requested_by: actor.user.id,
            requested_on_behalf_by: actor.role === ROLES.MEMBER ? null : actor.user.id,
            required_approval_count: approvalRequirement.requiredApprovalCount
        })
        .select("*")
        .single();

    if (error || !data) {
        throw new AppError(500, "LOAN_APPLICATION_CREATE_FAILED", "Unable to create loan application.", error);
    }

    await replaceChildren(data.id, tenantId, payload.guarantors, payload.collateral_items);

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "loan_applications",
        action: "LOAN_APPLICATION_CREATED",
        entityType: "loan_application",
        entityId: data.id,
        afterData: data
    });

    return getExpandedApplication(tenantId, data.id);
}

async function updateLoanApplication(actor, applicationId, payload) {
    const tenantId = actor.tenantId;
    const existing = await getExpandedApplication(tenantId, applicationId);
    ensureApplicationEditAllowed(actor, existing);

    const nextProductId = payload.product_id || existing.product_id;
    await getActiveLoanProduct(tenantId, nextProductId);
    const nextBranchId = payload.branch_id || existing.branch_id;
    assertBranchAccess({ auth: actor }, nextBranchId);

    const updatePayload = {
        ...payload,
        branch_id: nextBranchId,
        member_id: payload.member_id || existing.member_id,
        product_id: nextProductId,
        status: "draft",
        rejection_reason: null,
        rejected_at: null,
        rejected_by: null,
        submitted_at: null,
        approval_count: 0,
        approved_at: null,
        approved_by: null,
        disbursement_ready_at: null
    };

    const { data, error } = await adminSupabase
        .from("loan_applications")
        .update(updatePayload)
        .eq("tenant_id", tenantId)
        .eq("id", applicationId)
        .select("*")
        .single();

    if (error || !data) {
        throw new AppError(500, "LOAN_APPLICATION_UPDATE_FAILED", "Unable to update loan application.", error);
    }

    await adminSupabase.from("loan_approvals").delete().eq("application_id", applicationId);
    await replaceChildren(applicationId, tenantId, payload.guarantors ?? existing.loan_guarantors, payload.collateral_items ?? existing.collateral_items);

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "loan_applications",
        action: "LOAN_APPLICATION_UPDATED",
        entityType: "loan_application",
        entityId: applicationId,
        beforeData: existing,
        afterData: data
    });

    return getExpandedApplication(tenantId, applicationId);
}

async function submitLoanApplication(actor, applicationId) {
    if (actor.role === ROLES.BRANCH_MANAGER) {
        throw new AppError(403, "FORBIDDEN", "Branch managers cannot submit loan applications.");
    }

    const tenantId = actor.tenantId;
    const existing = await getExpandedApplication(tenantId, applicationId);

    if (!["draft", "rejected"].includes(existing.status)) {
        throw new AppError(400, "LOAN_APPLICATION_NOT_SUBMITTABLE", "Only draft or rejected applications can be submitted.");
    }

    ensureApplicationEditAllowed(actor, { ...existing, status: "draft" });

    const { data, error } = await adminSupabase
        .from("loan_applications")
        .update({
            status: "submitted",
            submitted_at: new Date().toISOString(),
            rejection_reason: null,
            rejected_at: null,
            rejected_by: null,
            approval_count: 0,
            approval_notes: null,
            approved_by: null,
            approved_at: null,
            disbursement_ready_at: null
        })
        .eq("tenant_id", tenantId)
        .eq("id", applicationId)
        .select("*")
        .single();

    if (error || !data) {
        throw new AppError(500, "LOAN_APPLICATION_SUBMIT_FAILED", "Unable to submit loan application.", error);
    }

    await creditRiskService.recomputeGuarantorExposuresForMembers({
        tenantId,
        memberIds: (existing.loan_guarantors || []).map((row) => row.member_id),
        actorUserId: actor.user.id,
        source: "application_submit"
    });

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "loan_applications",
        action: "LOAN_APPLICATION_SUBMITTED",
        entityType: "loan_application",
        entityId: applicationId,
        beforeData: existing,
        afterData: data
    });

    const expanded = await getExpandedApplication(tenantId, applicationId);
    await notifyLoanOfficersNewApplication({
        actor,
        application: expanded
    });

    return expanded;
}

async function appraiseLoanApplication(actor, applicationId, payload) {
    if (actor.role !== ROLES.LOAN_OFFICER) {
        throw new AppError(403, "FORBIDDEN", "Only loan officers can appraise applications.");
    }

    const tenantId = actor.tenantId;
    const existing = await getExpandedApplication(tenantId, applicationId);

    if (!["submitted", "appraised"].includes(existing.status)) {
        throw new AppError(400, "LOAN_APPLICATION_NOT_APPRAISABLE", "Only submitted applications can be appraised.");
    }

    assertBranchAccess({ auth: actor }, existing.branch_id);
    const product = await getActiveLoanProduct(tenantId, existing.product_id);

    if (payload.recommended_amount < product.min_amount || (product.max_amount && payload.recommended_amount > product.max_amount)) {
        throw new AppError(400, "LOAN_AMOUNT_OUT_OF_POLICY", "Recommended amount is outside the configured product limits.");
    }

    const { data, error } = await adminSupabase
        .from("loan_applications")
        .update({
            status: "appraised",
            appraised_by: actor.user.id,
            appraised_at: new Date().toISOString(),
            appraisal_notes: payload.appraisal_notes,
            risk_rating: payload.risk_rating,
            recommended_amount: payload.recommended_amount,
            recommended_term_count: payload.recommended_term_count,
            recommended_interest_rate: payload.recommended_interest_rate,
            recommended_repayment_frequency: payload.recommended_repayment_frequency
        })
        .eq("tenant_id", tenantId)
        .eq("id", applicationId)
        .select("*")
        .single();

    if (error || !data) {
        throw new AppError(500, "LOAN_APPLICATION_APPRAISAL_FAILED", "Unable to save the loan appraisal.", error);
    }

    const nextGuarantors = payload.guarantors ?? existing.loan_guarantors ?? [];
    const nextCollateralItems = payload.collateral_items ?? existing.collateral_items ?? [];
    await replaceChildren(applicationId, tenantId, nextGuarantors, nextCollateralItems);

    const guarantorMemberIds = Array.from(new Set([
        ...(existing.loan_guarantors || []).map((row) => row.member_id).filter(Boolean),
        ...nextGuarantors.map((row) => row.member_id).filter(Boolean)
    ]));

    await creditRiskService.recomputeGuarantorExposuresForMembers({
        tenantId,
        memberIds: guarantorMemberIds,
        actorUserId: actor.user.id,
        source: "application_appraisal"
    });

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "loan_applications",
        action: "LOAN_APPLICATION_APPRAISED",
        entityType: "loan_application",
        entityId: applicationId,
        beforeData: existing,
        afterData: data
    });

    return getExpandedApplication(tenantId, applicationId);
}

async function approveLoanApplication(actor, applicationId, payload) {
    if (actor.role !== ROLES.BRANCH_MANAGER) {
        throw new AppError(403, "FORBIDDEN", "Only branch managers can approve loan applications.");
    }

    const tenantId = actor.tenantId;
    const existing = await getExpandedApplication(tenantId, applicationId);

    if (!["appraised", "approved"].includes(existing.status)) {
        throw new AppError(400, "LOAN_APPLICATION_NOT_APPROVABLE", "Only appraised applications can be approved.");
    }

    assertBranchAccess({ auth: actor }, existing.branch_id);

    if (existing.requested_by === actor.user.id) {
        throw new AppError(400, "MAKER_CHECKER_VIOLATION", "The application maker cannot approve the same application.");
    }

    assertAllGuarantorsAccepted(existing);

    await creditRiskService.assertGuarantorExposureWithinLimits({
        tenantId,
        guarantors: existing.loan_guarantors || [],
        actorUserId: actor.user.id,
        source: "application_approval"
    });

    const cycleApprovals = getCurrentCycleApprovals(existing);
    const actorDecision = cycleApprovals.find((row) => row.approver_id === actor.user.id) || null;
    if (actorDecision?.decision === "approved") {
        throw new AppError(400, "LOAN_APPLICATION_ALREADY_APPROVED", "You already recorded an approval for this application.");
    }

    if (actorDecision?.decision === "rejected") {
        throw new AppError(400, "LOAN_APPLICATION_ALREADY_REJECTED", "You already recorded a rejection for this application.");
    }

    const currentCycleApprovedCount = cycleApprovals.filter((row) => row.decision === "approved").length;
    const { error: approvalError } = await adminSupabase
        .from("loan_approvals")
        .upsert({
            application_id: applicationId,
            tenant_id: tenantId,
            approver_id: actor.user.id,
            approval_level: currentCycleApprovedCount + 1,
            decision: "approved",
            notes: payload.notes || null,
            created_at: new Date().toISOString()
        }, { onConflict: "application_id,approver_id" });

    if (approvalError) {
        throw new AppError(500, "LOAN_APPLICATION_APPROVAL_LOG_FAILED", "Unable to record the loan approval.", approvalError);
    }

    const nextApprovalCount = currentCycleApprovedCount + 1;
    const enoughApprovals = nextApprovalCount >= existing.required_approval_count;

    const { data, error } = await adminSupabase
        .from("loan_applications")
        .update({
            approval_count: nextApprovalCount,
            approval_notes: payload.notes || existing.approval_notes || null,
            status: enoughApprovals ? "approved" : "appraised",
            approved_by: enoughApprovals ? actor.user.id : existing.approved_by,
            approved_at: enoughApprovals ? new Date().toISOString() : existing.approved_at,
            disbursement_ready_at: enoughApprovals ? new Date().toISOString() : existing.disbursement_ready_at
        })
        .eq("tenant_id", tenantId)
        .eq("id", applicationId)
        .select("*")
        .single();

    if (error || !data) {
        throw new AppError(500, "LOAN_APPLICATION_APPROVE_FAILED", "Unable to approve the loan application.", error);
    }

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "loan_applications",
        action: "LOAN_APPLICATION_APPROVED",
        entityType: "loan_application",
        entityId: applicationId,
        beforeData: existing,
        afterData: {
            ...data,
            awaiting_additional_approvals: !enoughApprovals
        }
    });

    const expanded = await getExpandedApplication(tenantId, applicationId);
    if (enoughApprovals) {
        await notifyLoanOfficersApprovedForDisbursement({
            actor,
            application: expanded
        });
    }

    return expanded;
}

async function rejectLoanApplication(actor, applicationId, payload) {
    if (actor.role !== ROLES.BRANCH_MANAGER) {
        throw new AppError(403, "FORBIDDEN", "Only branch managers can reject loan applications.");
    }

    const tenantId = actor.tenantId;
    const existing = await getExpandedApplication(tenantId, applicationId);

    if (!["appraised", "approved"].includes(existing.status)) {
        throw new AppError(400, "LOAN_APPLICATION_NOT_REJECTABLE", "Only appraised or approved applications can be rejected.");
    }

    assertBranchAccess({ auth: actor }, existing.branch_id);

    if (existing.requested_by === actor.user.id) {
        throw new AppError(400, "MAKER_CHECKER_VIOLATION", "The application maker cannot reject the same application.");
    }

    const cycleApprovals = getCurrentCycleApprovals(existing);
    const actorDecision = cycleApprovals.find((row) => row.approver_id === actor.user.id) || null;
    if (actorDecision?.decision === "rejected") {
        throw new AppError(400, "LOAN_APPLICATION_ALREADY_REJECTED", "You already recorded a rejection for this application.");
    }

    if (actorDecision?.decision === "approved") {
        throw new AppError(400, "LOAN_APPLICATION_ALREADY_APPROVED", "You already recorded an approval for this application.");
    }

    const currentCycleApprovedCount = cycleApprovals.filter((row) => row.decision === "approved").length;
    const { error: approvalError } = await adminSupabase
        .from("loan_approvals")
        .upsert({
            application_id: applicationId,
            tenant_id: tenantId,
            approver_id: actor.user.id,
            approval_level: currentCycleApprovedCount + 1,
            decision: "rejected",
            notes: payload.notes || payload.reason,
            created_at: new Date().toISOString()
        }, { onConflict: "application_id,approver_id" });

    if (approvalError) {
        throw new AppError(500, "LOAN_APPLICATION_REJECTION_LOG_FAILED", "Unable to record the loan rejection.", approvalError);
    }

    const { data, error } = await adminSupabase
        .from("loan_applications")
        .update({
            status: "rejected",
            rejection_reason: payload.reason,
            rejected_at: new Date().toISOString(),
            rejected_by: actor.user.id,
            approval_notes: payload.notes || null,
            disbursement_ready_at: null,
            approved_by: null,
            approved_at: null
        })
        .eq("tenant_id", tenantId)
        .eq("id", applicationId)
        .select("*")
        .single();

    if (error || !data) {
        throw new AppError(500, "LOAN_APPLICATION_REJECT_FAILED", "Unable to reject the loan application.", error);
    }

    await creditRiskService.recomputeGuarantorExposuresForMembers({
        tenantId,
        memberIds: (existing.loan_guarantors || []).map((row) => row.member_id),
        actorUserId: actor.user.id,
        source: "application_reject"
    });

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "loan_applications",
        action: "LOAN_APPLICATION_REJECTED",
        entityType: "loan_application",
        entityId: applicationId,
        beforeData: existing,
        afterData: data
    });

    const expanded = await getExpandedApplication(tenantId, applicationId);
    await notifyLoanOfficersReappraisalNeeded({
        actor,
        application: expanded,
        reason: payload.reason || payload.notes || ""
    });

    return expanded;
}

async function disburseLoanApplication(actor, applicationId, payload) {
    if (![ROLES.LOAN_OFFICER, ROLES.TELLER].includes(actor.role)) {
        throw new AppError(403, "FORBIDDEN", "You are not allowed to disburse approved loan applications.");
    }

    const tenantId = actor.tenantId;
    const existing = await getExpandedApplication(tenantId, applicationId);

    if (existing.status !== "approved") {
        throw new AppError(400, "LOAN_APPLICATION_NOT_APPROVED", "Only approved applications can be disbursed.");
    }

    if (existing.loan_id) {
        throw new AppError(400, "LOAN_ALREADY_DISBURSED", "This application has already been disbursed.");
    }

    assertAllGuarantorsAccepted(existing);

    assertBranchAccess({ auth: actor }, existing.branch_id);

    const disburseResult = await financeService.loanDisburse(
        actor,
        {
            tenant_id: tenantId,
            application_id: applicationId,
            approval_request_id: payload.approval_request_id || null,
            member_id: existing.member_id,
            branch_id: existing.branch_id,
            principal_amount: existing.recommended_amount || existing.requested_amount,
            annual_interest_rate: existing.recommended_interest_rate || existing.requested_interest_rate || 0,
            term_count: existing.recommended_term_count || existing.requested_term_count,
            repayment_frequency: existing.recommended_repayment_frequency || existing.requested_repayment_frequency,
            reference: payload.reference || existing.external_reference || null,
            description: payload.description || `Loan disbursement for application ${applicationId}`,
            receipt_ids: payload.receipt_ids || []
        },
        { skipWorkflow: true }
    );

    if (disburseResult?.approval_required) {
        return {
            approval_required: true,
            application_id: applicationId,
            ...disburseResult
        };
    }

    const updatePayload = {
        status: "disbursed",
        disbursed_by: actor.user.id,
        disbursed_at: new Date().toISOString(),
        loan_id: disburseResult.loan_id
    };

    const { data, error } = await adminSupabase
        .from("loan_applications")
        .update(updatePayload)
        .eq("tenant_id", tenantId)
        .eq("id", applicationId)
        .select("*")
        .single();

    if (error || !data) {
        throw new AppError(500, "LOAN_APPLICATION_DISBURSE_UPDATE_FAILED", "Loan disbursement posted but application status could not be updated.", error);
    }

    await adminSupabase
        .from("loans")
        .update({ application_id: applicationId })
        .eq("id", disburseResult.loan_id);

    await creditRiskService.recomputeGuarantorExposuresForMembers({
        tenantId,
        memberIds: (existing.loan_guarantors || []).map((row) => row.member_id),
        actorUserId: actor.user.id,
        source: "application_disburse"
    });

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "loan_applications",
        action: "LOAN_APPLICATION_DISBURSED",
        entityType: "loan_application",
        entityId: applicationId,
        beforeData: existing,
        afterData: {
            ...data,
            loan_number: disburseResult.loan_number,
            journal_id: disburseResult.journal_id
        }
    });

    return {
        application: await getExpandedApplication(tenantId, applicationId),
        disbursement: disburseResult
    };
}

async function respondGuarantorConsent(actor, applicationId, payload = {}) {
    if (actor.role !== ROLES.MEMBER) {
        throw new AppError(403, "FORBIDDEN", "Only guarantor members can respond to guarantor requests.");
    }

    const tenantId = payload.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);
    const guarantorMember = await getMemberByUser(tenantId, actor.user.id);
    const application = await getExpandedApplication(tenantId, applicationId);

    if (!["submitted", "appraised"].includes(application.status)) {
        throw new AppError(
            400,
            "GUARANTOR_CONSENT_WINDOW_CLOSED",
            "Guarantor response is only allowed while application is submitted or appraised."
        );
    }

    const { data: current, error: currentError } = await adminSupabase
        .from("loan_guarantors")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("application_id", applicationId)
        .eq("member_id", guarantorMember.id)
        .maybeSingle();

    if (currentError) {
        throw new AppError(500, "GUARANTOR_CONSENT_LOOKUP_FAILED", "Unable to load guarantor assignment.", currentError);
    }

    if (!current) {
        throw new AppError(404, "GUARANTOR_REQUEST_NOT_FOUND", "No guarantor request was found for your member profile.");
    }

    const patch = {
        consent_status: payload.decision,
        consented_at: new Date().toISOString(),
        notes: Object.prototype.hasOwnProperty.call(payload, "notes")
            ? (payload.notes || null)
            : current.notes || null
    };

    const { error: updateError } = await adminSupabase
        .from("loan_guarantors")
        .update(patch)
        .eq("tenant_id", tenantId)
        .eq("application_id", applicationId)
        .eq("member_id", guarantorMember.id);

    if (updateError) {
        throw new AppError(500, "GUARANTOR_CONSENT_UPDATE_FAILED", "Unable to update guarantor consent.", updateError);
    }

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "loan_guarantors",
        action: payload.decision === "accepted"
            ? "LOAN_GUARANTOR_CONSENT_ACCEPTED"
            : "LOAN_GUARANTOR_CONSENT_REJECTED",
        entityType: "loan_guarantor",
        entityId: current.id,
        beforeData: current,
        afterData: {
            ...current,
            ...patch
        }
    });

    const expanded = await getExpandedApplication(tenantId, applicationId);
    if (payload.decision === "rejected") {
        await notifyLoanOfficerGuarantorDeclined({
            actor,
            application: expanded,
            guarantorMemberId: guarantorMember.id
        });
    }

    return expanded;
}

module.exports = {
    listLoanApplications,
    listGuarantorRequests,
    createLoanApplication,
    updateLoanApplication,
    submitLoanApplication,
    appraiseLoanApplication,
    approveLoanApplication,
    rejectLoanApplication,
    disburseLoanApplication,
    respondGuarantorConsent
};
