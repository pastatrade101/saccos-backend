const { adminSupabase } = require("../../config/supabase");
const { ROLES } = require("../../constants/roles");
const { getSubscriptionStatus } = require("../../services/subscription.service");
const { assertBranchAccess, assertTenantAccess } = require("../../services/user-context.service");
const { logAudit } = require("../../services/audit.service");
const financeService = require("../finance/finance.service");
const AppError = require("../../utils/app-error");

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

async function getExpandedApplication(tenantId, applicationId) {
    const { data, error } = await adminSupabase
        .from("loan_applications")
        .select(`
            *,
            members(id, full_name, phone, email, member_no, branch_id, user_id),
            loan_products(id, code, name),
            loan_approvals(*),
            loan_guarantors(*),
            collateral_items(*)
        `)
        .eq("tenant_id", tenantId)
        .eq("id", applicationId)
        .single();

    if (error || !data) {
        throw new AppError(404, "LOAN_APPLICATION_NOT_FOUND", "Loan application was not found.");
    }

    return data;
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

async function listLoanApplications(actor, query) {
    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const hasPagination = query.page !== undefined || query.limit !== undefined;
    const page = query.page ? Number(query.page) : 1;
    const limit = query.limit ? Number(query.limit) : 50;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let builder = adminSupabase
        .from("loan_applications")
        .select(`
            *,
            members(id, full_name, member_no, branch_id, user_id),
            loan_products(id, code, name),
            loan_approvals(id, approver_id, decision, created_at),
            loan_guarantors(id, member_id, guaranteed_amount, consent_status),
            collateral_items(id, collateral_type, valuation_amount)
        `, hasPagination ? { count: "exact" } : undefined)
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });

    if (query.status) builder = builder.eq("status", query.status);
    if (query.member_id) builder = builder.eq("member_id", query.member_id);
    if (query.branch_id) {
        assertBranchAccess({ auth: actor }, query.branch_id);
        builder = builder.eq("branch_id", query.branch_id);
    }
    if (query.product_id) builder = builder.eq("product_id", query.product_id);
    if (hasPagination) builder = builder.range(from, to);

    const { data, error, count } = await builder;

    if (error) {
        throw new AppError(500, "LOAN_APPLICATIONS_FETCH_FAILED", "Unable to load loan applications.", error);
    }

    const applications = (data || []).filter((application) => {
        if (actor.role === ROLES.MEMBER) {
            return application.members?.user_id === actor.user.id;
        }

        if ([ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER].includes(actor.role)) {
            return !application.branch_id || actor.branchIds.includes(application.branch_id);
        }

        return true;
    });

    return {
        data: applications,
        pagination: hasPagination
            ? {
                page,
                limit,
                total: count || 0
            }
            : null
    };
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
            rejected_by: null
        })
        .eq("tenant_id", tenantId)
        .eq("id", applicationId)
        .select("*")
        .single();

    if (error || !data) {
        throw new AppError(500, "LOAN_APPLICATION_SUBMIT_FAILED", "Unable to submit loan application.", error);
    }

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

    return getExpandedApplication(tenantId, applicationId);
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

    await replaceChildren(applicationId, tenantId, payload.guarantors, payload.collateral_items);

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

    const { data: existingApproval } = await adminSupabase
        .from("loan_approvals")
        .select("id")
        .eq("application_id", applicationId)
        .eq("approver_id", actor.user.id)
        .maybeSingle();

    if (existingApproval) {
        throw new AppError(400, "LOAN_APPLICATION_ALREADY_APPROVED", "You already recorded an approval for this application.");
    }

    const { error: approvalError } = await adminSupabase
        .from("loan_approvals")
        .insert({
            application_id: applicationId,
            tenant_id: tenantId,
            approver_id: actor.user.id,
            approval_level: existing.approval_count + 1,
            decision: "approved",
            notes: payload.notes || null
        });

    if (approvalError) {
        throw new AppError(500, "LOAN_APPLICATION_APPROVAL_LOG_FAILED", "Unable to record the loan approval.", approvalError);
    }

    const nextApprovalCount = existing.approval_count + 1;
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

    return getExpandedApplication(tenantId, applicationId);
}

async function rejectLoanApplication(actor, applicationId, payload) {
    if (actor.role !== ROLES.BRANCH_MANAGER) {
        throw new AppError(403, "FORBIDDEN", "Only branch managers can reject loan applications.");
    }

    const tenantId = actor.tenantId;
    const existing = await getExpandedApplication(tenantId, applicationId);

    if (!["submitted", "appraised", "approved"].includes(existing.status)) {
        throw new AppError(400, "LOAN_APPLICATION_NOT_REJECTABLE", "This application cannot be rejected in its current state.");
    }

    assertBranchAccess({ auth: actor }, existing.branch_id);

    if (existing.requested_by === actor.user.id) {
        throw new AppError(400, "MAKER_CHECKER_VIOLATION", "The application maker cannot reject the same application.");
    }

    const { error: approvalError } = await adminSupabase
        .from("loan_approvals")
        .insert({
            application_id: applicationId,
            tenant_id: tenantId,
            approver_id: actor.user.id,
            approval_level: existing.approval_count + 1,
            decision: "rejected",
            notes: payload.notes || payload.reason
        });

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
            disbursement_ready_at: null
        })
        .eq("tenant_id", tenantId)
        .eq("id", applicationId)
        .select("*")
        .single();

    if (error || !data) {
        throw new AppError(500, "LOAN_APPLICATION_REJECT_FAILED", "Unable to reject the loan application.", error);
    }

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

    return getExpandedApplication(tenantId, applicationId);
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

    assertBranchAccess({ auth: actor }, existing.branch_id);

    const disburseResult = await financeService.loanDisburse(
        actor,
        {
            tenant_id: tenantId,
            application_id: applicationId,
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

module.exports = {
    listLoanApplications,
    createLoanApplication,
    updateLoanApplication,
    submitLoanApplication,
    appraiseLoanApplication,
    approveLoanApplication,
    rejectLoanApplication,
    disburseLoanApplication
};
