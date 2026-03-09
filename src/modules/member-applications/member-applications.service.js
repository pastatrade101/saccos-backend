const crypto = require("crypto");

const { adminSupabase } = require("../../config/supabase");
const AppError = require("../../utils/app-error");
const { assertBranchAccess, assertTenantAccess } = require("../../services/user-context.service");
const { logAudit } = require("../../services/audit.service");
const membersService = require("../members/members.service");

function generateApplicationNumber() {
    return `APP-${new Date().getFullYear()}-${crypto.randomInt(100000, 999999)}`;
}

function normalizeText(value) {
    return (value || "").trim().toLowerCase();
}

async function findRecoverableApprovedMember(application) {
    const fullName = normalizeText(application.full_name);

    const searchers = [
        async () => {
            const { data, error } = await adminSupabase
                .from("members")
                .select("*")
                .eq("tenant_id", application.tenant_id)
                .eq("approved_application_id", application.id)
                .is("deleted_at", null)
                .maybeSingle();

            if (error) {
                throw new AppError(500, "MEMBER_LOOKUP_FAILED", "Unable to recover approved member.", error);
            }

            return data;
        },
        async () => {
            if (!application.member_no) {
                return null;
            }

            const { data, error } = await adminSupabase
                .from("members")
                .select("*")
                .eq("tenant_id", application.tenant_id)
                .eq("member_no", application.member_no)
                .is("deleted_at", null)
                .maybeSingle();

            if (error) {
                throw new AppError(500, "MEMBER_LOOKUP_FAILED", "Unable to recover approved member.", error);
            }

            return data;
        },
        async () => {
            if (!application.national_id) {
                return null;
            }

            const { data, error } = await adminSupabase
                .from("members")
                .select("*")
                .eq("tenant_id", application.tenant_id)
                .eq("national_id", application.national_id)
                .is("deleted_at", null)
                .maybeSingle();

            if (error) {
                throw new AppError(500, "MEMBER_LOOKUP_FAILED", "Unable to recover approved member.", error);
            }

            return data;
        },
        async () => {
            if (!application.email) {
                return null;
            }

            const { data, error } = await adminSupabase
                .from("members")
                .select("*")
                .eq("tenant_id", application.tenant_id)
                .eq("email", application.email)
                .is("deleted_at", null)
                .maybeSingle();

            if (error) {
                throw new AppError(500, "MEMBER_LOOKUP_FAILED", "Unable to recover approved member.", error);
            }

            return data;
        }
    ];

    for (const search of searchers) {
        const candidate = await search();

        if (candidate && normalizeText(candidate.full_name) === fullName) {
            return candidate;
        }
    }

    return null;
}

async function ensureApprovalMembershipFeePosted(actor, application, memberId) {
    if (!(application.membership_fee_paid > 0)) {
        return;
    }

    const reference = `APPROVAL-${application.application_no}`;
    const { data: existingJournal, error: journalLookupError } = await adminSupabase
        .from("journal_entries")
        .select("id")
        .eq("tenant_id", application.tenant_id)
        .eq("reference", reference)
        .eq("source_type", "membership_fee")
        .maybeSingle();

    if (journalLookupError) {
        throw new AppError(
            500,
            "MEMBERSHIP_FEE_LOOKUP_FAILED",
            "Unable to verify existing membership fee posting.",
            journalLookupError
        );
    }

    if (existingJournal) {
        return;
    }

    const { error: membershipFeeError } = await adminSupabase.rpc("post_membership_fee", {
        p_tenant_id: application.tenant_id,
        p_member_id: memberId,
        p_branch_id: application.branch_id,
        p_amount: application.membership_fee_paid,
        p_user_id: actor.user.id,
        p_reference: reference,
        p_description: "Membership fee collected during member approval",
        p_entry_date: new Date().toISOString().slice(0, 10)
    });

    if (membershipFeeError) {
        throw new AppError(
            500,
            "MEMBERSHIP_FEE_POST_FAILED",
            "Unable to post membership fee for the approved application.",
            membershipFeeError
        );
    }
}

async function getApplication(actor, applicationId) {
    const { data, error } = await adminSupabase
        .from("member_applications")
        .select("*")
        .eq("id", applicationId)
        .is("deleted_at", null)
        .single();

    if (error || !data) {
        throw new AppError(404, "MEMBER_APPLICATION_NOT_FOUND", "Member application was not found.");
    }

    assertTenantAccess({ auth: actor }, data.tenant_id);
    assertBranchAccess({ auth: actor }, data.branch_id);

    return data;
}

async function listApplications(actor, query = {}) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const page = Number(query.page || 1);
    const limit = Math.min(Number(query.limit || 50), 100);
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let request = adminSupabase
        .from("member_applications")
        .select("*", { count: "exact" })
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .range(from, to);

    if (!actor.isInternalOps && actor.branchIds.length && !["super_admin", "auditor"].includes(actor.role)) {
        request = request.in("branch_id", actor.branchIds);
    }

    if (query.status) {
        request = request.eq("status", query.status);
    }

    if (query.branch_id) {
        assertBranchAccess({ auth: actor }, query.branch_id);
        request = request.eq("branch_id", query.branch_id);
    }

    if (query.search) {
        const escaped = query.search.replace(/[%_]/g, "\\$&");
        request = request.or(
            `application_no.ilike.%${escaped}%,full_name.ilike.%${escaped}%,phone.ilike.%${escaped}%,email.ilike.%${escaped}%,member_no.ilike.%${escaped}%`
        );
    }

    const { data, error, count } = await request;

    if (error) {
        throw new AppError(500, "MEMBER_APPLICATIONS_LIST_FAILED", "Unable to load member applications.", error);
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

async function createApplication(actor, payload) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);
    assertBranchAccess({ auth: actor }, payload.branch_id);

    const { data, error } = await adminSupabase
        .from("member_applications")
        .insert({
            tenant_id: tenantId,
            application_no: generateApplicationNumber(),
            branch_id: payload.branch_id,
            status: "draft",
            created_by: actor.user.id,
            ...payload
        })
        .select("*")
        .single();

    if (error) {
        throw new AppError(500, "MEMBER_APPLICATION_CREATE_FAILED", "Unable to create member application.", error);
    }

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "member_applications",
        action: "MEMBER_APPLICATION_CREATED",
        entityType: "member_application",
        entityId: data.id,
        afterData: data
    });

    return data;
}

async function updateApplication(actor, applicationId, payload) {
    const before = await getApplication(actor, applicationId);

    if (["approved", "cancelled"].includes(before.status)) {
        throw new AppError(409, "MEMBER_APPLICATION_LOCKED", "This application can no longer be edited.");
    }

    if (payload.branch_id) {
        assertBranchAccess({ auth: actor }, payload.branch_id);
    }

    const { data, error } = await adminSupabase
        .from("member_applications")
        .update({
            ...payload,
            ...(before.status === "rejected"
                ? {
                    status: "draft",
                    rejected_by: null,
                    rejected_at: null,
                    rejection_reason: null
                }
                : {})
        })
        .eq("id", applicationId)
        .select("*")
        .single();

    if (error) {
        throw new AppError(500, "MEMBER_APPLICATION_UPDATE_FAILED", "Unable to update member application.", error);
    }

    await logAudit({
        tenantId: before.tenant_id,
        actorUserId: actor.user.id,
        table: "member_applications",
        action: "MEMBER_APPLICATION_UPDATED",
        entityType: "member_application",
        entityId: applicationId,
        beforeData: before,
        afterData: data
    });

    return data;
}

async function updateStatus(actor, applicationId, status, extra = {}) {
    const before = await getApplication(actor, applicationId);

    const payload = {
        status,
        ...extra
    };

    const { data, error } = await adminSupabase
        .from("member_applications")
        .update(payload)
        .eq("id", applicationId)
        .select("*")
        .single();

    if (error) {
        throw new AppError(500, "MEMBER_APPLICATION_STATUS_FAILED", "Unable to update application status.", error);
    }

    await logAudit({
        tenantId: before.tenant_id,
        actorUserId: actor.user.id,
        table: "member_applications",
        action: `MEMBER_APPLICATION_${status.toUpperCase()}`,
        entityType: "member_application",
        entityId: applicationId,
        beforeData: before,
        afterData: data
    });

    return data;
}

async function submitApplication(actor, applicationId) {
    return updateStatus(actor, applicationId, "submitted");
}

async function reviewApplication(actor, applicationId, payload) {
    return updateStatus(actor, applicationId, "under_review", {
        reviewed_by: actor.user.id,
        reviewed_at: new Date().toISOString(),
        kyc_status: payload.kyc_status,
        kyc_reason: payload.kyc_reason,
        notes: payload.notes
    });
}

async function approveApplication(actor, applicationId) {
    const application = await getApplication(actor, applicationId);

    if (actor.role !== "super_admin") {
        throw new AppError(403, "FORBIDDEN", "Only a tenant super admin can approve member applications.");
    }

    if (application.approved_member_id) {
        throw new AppError(409, "MEMBER_APPLICATION_ALREADY_APPROVED", "This application has already been approved.");
    }

    let approvedMember = await findRecoverableApprovedMember(application);

    if (!approvedMember) {
        const created = await membersService.createMember(actor, {
            branch_id: application.branch_id,
            full_name: application.full_name,
            dob: application.dob,
            phone: application.phone,
            email: application.email,
            member_no: application.member_no,
            national_id: application.national_id,
            address_line1: application.address_line1,
            address_line2: application.address_line2,
            city: application.city,
            state: application.state,
            country: application.country,
            postal_code: application.postal_code,
            nida_no: application.nida_no,
            tin_no: application.tin_no,
            next_of_kin_name: application.next_of_kin_name,
            next_of_kin_phone: application.next_of_kin_phone,
            next_of_kin_relationship: application.next_of_kin_relationship,
            employer: application.employer,
            kyc_status: application.kyc_status,
            kyc_reason: application.kyc_reason,
            notes: application.notes,
            status: "active"
        });

        approvedMember = created.member;
    } else {
        await membersService.ensureMemberAccounts({
            tenantId: application.tenant_id,
            branchId: application.branch_id,
            member: approvedMember
        });
    }

    await ensureApprovalMembershipFeePosted(actor, application, approvedMember.id);

    const approvedApplication = await updateStatus(actor, applicationId, "approved", {
        approved_by: actor.user.id,
        approved_at: new Date().toISOString(),
        approved_member_id: approvedMember.id
    });

    const { error: memberLinkError } = await adminSupabase
        .from("members")
        .update({
            approved_application_id: applicationId
        })
        .eq("id", approvedMember.id);

    if (memberLinkError) {
        throw new AppError(500, "MEMBER_APPLICATION_LINK_FAILED", "Unable to link approved member to the application.", memberLinkError);
    }

    return {
        application: approvedApplication,
        member: approvedMember
    };
}

async function rejectApplication(actor, applicationId, reason) {
    if (actor.role !== "super_admin") {
        throw new AppError(403, "FORBIDDEN", "Only a tenant super admin can reject member applications.");
    }

    return updateStatus(actor, applicationId, "rejected", {
        rejected_by: actor.user.id,
        rejected_at: new Date().toISOString(),
        rejection_reason: reason
    });
}

module.exports = {
    listApplications,
    getApplication,
    createApplication,
    updateApplication,
    submitApplication,
    reviewApplication,
    approveApplication,
    rejectApplication
};
