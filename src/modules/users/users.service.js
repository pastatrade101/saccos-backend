const { adminSupabase } = require("../../config/supabase");
const AppError = require("../../utils/app-error");
const { assertPlanLimit } = require("../../services/subscription.service");
const { logAudit } = require("../../services/audit.service");
const { assertTenantAccess } = require("../../services/user-context.service");
const { inviteUser } = require("../auth/auth.service");
const { ROLES } = require("../../constants/roles");
const { getActiveCredentialByUser, clearCredentialByUser } = require("../../services/credential-handoff.service");

function assertUserProvisioningPermission(actor, targetRole) {
    if (actor.isInternalOps) {
        return;
    }

    if (actor.role === ROLES.SUPER_ADMIN) {
        if (targetRole !== ROLES.BRANCH_MANAGER) {
            throw new AppError(
                403,
                "USER_ROLE_NOT_ALLOWED",
                "Super admin can only provision branch managers."
            );
        }

        return;
    }

    if (actor.role === ROLES.BRANCH_MANAGER) {
        if (![ROLES.LOAN_OFFICER, ROLES.TELLER, ROLES.AUDITOR].includes(targetRole)) {
            throw new AppError(
                403,
                "USER_ROLE_NOT_ALLOWED",
                "Branch manager can only provision loan officers, tellers, and auditors."
            );
        }

        return;
    }

    throw new AppError(403, "FORBIDDEN", "You are not authorized to provision staff users.");
}

async function listUsers(actor, query = {}) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const page = Number(query.page || 1);
    const limit = Math.min(Number(query.limit || 50), 100);
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let request = adminSupabase
        .from("user_profiles")
        .select("*", { count: "exact" })
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .order("full_name", { ascending: true })
        .range(from, to);

    if (!actor.isInternalOps && !["super_admin", "auditor"].includes(actor.role) && actor.branchIds.length) {
        const { data: assignmentRows, error: assignmentsError } = await adminSupabase
            .from("branch_staff_assignments")
            .select("user_id")
            .in("branch_id", actor.branchIds)
            .is("deleted_at", null);

        if (assignmentsError) {
            throw new AppError(500, "USER_ASSIGNMENTS_FETCH_FAILED", "Unable to load user assignments.");
        }

        const userIds = [...new Set((assignmentRows || []).map((row) => row.user_id))];
        request = userIds.length ? request.in("user_id", userIds) : request.eq("user_id", actor.user.id);
    }

    const { data, error, count } = await request;

    if (error) {
        throw new AppError(500, "USERS_LIST_FAILED", "Unable to load users.", error);
    }

    const profiles = data || [];
    const userIds = profiles.map((profile) => profile.user_id);

    let branchAssignments = [];
    if (userIds.length) {
        const { data: assignmentRows, error: assignmentError } = await adminSupabase
            .from("branch_staff_assignments")
            .select("user_id, branch_id, branches(id, name)")
            .eq("tenant_id", tenantId)
            .in("user_id", userIds)
            .is("deleted_at", null);

        if (assignmentError) {
            throw new AppError(500, "USER_BRANCH_ASSIGNMENTS_FETCH_FAILED", "Unable to load branch assignments.", assignmentError);
        }

        branchAssignments = assignmentRows || [];
    }

    const branchMap = new Map();
    branchAssignments.forEach((assignment) => {
        const existing = branchMap.get(assignment.user_id) || [];
        const branch = Array.isArray(assignment.branches) ? assignment.branches[0] : assignment.branches;

        if (branch?.name) {
            existing.push({
                id: branch.id,
                name: branch.name
            });
        }

        branchMap.set(assignment.user_id, existing);
    });

    let authUsersById = new Map();
    if (userIds.length) {
        const { data: authUsersResult, error: authUsersError } = await adminSupabase.auth.admin.listUsers({
            page: 1,
            perPage: 1000
        });

        if (authUsersError) {
            throw new AppError(500, "AUTH_USERS_LIST_FAILED", "Unable to load auth users.", authUsersError);
        }

        authUsersById = new Map(
            (authUsersResult?.users || [])
                .filter((user) => userIds.includes(user.id))
                .map((user) => [user.id, user])
        );
    }

    const enrichedUsers = profiles.map((profile) => {
        const authUser = authUsersById.get(profile.user_id);
        const branches = branchMap.get(profile.user_id) || [];

        return {
            id: profile.user_id,
            user_id: profile.user_id,
            full_name: profile.full_name,
            email: authUser?.email || null,
            phone: profile.phone || null,
            role: profile.role,
            branch_id: branches[0]?.id || null,
            branch_name: branches.length ? branches.map((branch) => branch.name).join(", ") : "Unassigned",
            is_active: profile.is_active,
            last_login_at: authUser?.last_sign_in_at || null,
            invited_at: authUser?.invited_at || null,
            email_confirmed_at: authUser?.email_confirmed_at || null,
            created_at: profile.created_at,
            branch_ids: branches.map((branch) => branch.id),
            has_temporary_password: Boolean(profile.must_change_password)
        };
    });

    const roleCounts = {
        super_admin: enrichedUsers.filter((user) => user.role === ROLES.SUPER_ADMIN).length,
        branch_manager: enrichedUsers.filter((user) => user.role === ROLES.BRANCH_MANAGER).length,
        loan_officer: enrichedUsers.filter((user) => user.role === ROLES.LOAN_OFFICER).length,
        teller: enrichedUsers.filter((user) => user.role === ROLES.TELLER).length,
        auditor: enrichedUsers.filter((user) => user.role === ROLES.AUDITOR).length
    };

    const totals = {
        total_staff: enrichedUsers.length,
        active_access: enrichedUsers.filter((user) => user.is_active).length,
        administrators: roleCounts.super_admin,
        managers: roleCounts.branch_manager,
        operators: roleCounts.loan_officer + roleCounts.teller,
        inactive_users: enrichedUsers.filter((user) => !user.is_active).length,
        pending_invites: enrichedUsers.filter(
            (user) => Boolean(user.invited_at) && !user.last_login_at && !user.email_confirmed_at
        ).length
    };

    const conflictRoleSets = [
        [ROLES.TELLER, ROLES.AUDITOR],
        [ROLES.LOAN_OFFICER, ROLES.AUDITOR],
        [ROLES.SUPER_ADMIN, ROLES.AUDITOR]
    ];

    const conflicts = enrichedUsers.flatMap((user) => {
        const detected = conflictRoleSets.filter((rule) => rule.includes(user.role));
        if (!detected.length) {
            return [];
        }

        return [];
    });

    return {
        totals,
        roleCounts,
        users: enrichedUsers,
        conflicts,
        pagination: {
            page,
            limit,
            total: count || 0
        }
    };
}

async function createUser(actor, payload) {
    const tenantId = payload.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);
    await assertPlanLimit(tenantId, "staffUsers", "user_profiles");
    assertUserProvisioningPermission(actor, payload.role);

    return inviteUser({
        actor,
        payload: {
            ...payload,
            tenant_id: tenantId,
            invite_via_sms: Boolean(payload.send_invite)
        }
    });
}

async function updateUser(actor, userId, payload) {
    const { data: before, error: beforeError } = await adminSupabase
        .from("user_profiles")
        .select("*")
        .eq("user_id", userId)
        .is("deleted_at", null)
        .single();

    if (beforeError || !before) {
        throw new AppError(404, "USER_NOT_FOUND", "User was not found.");
    }

    assertTenantAccess({ auth: actor }, before.tenant_id);

    if (payload.role !== undefined) {
        assertUserProvisioningPermission(actor, payload.role);
    } else if (!actor.isInternalOps) {
        assertUserProvisioningPermission(actor, before.role);
    }

    const updatePayload = {};

    if (payload.full_name !== undefined) {
        updatePayload.full_name = payload.full_name;
    }

    if (payload.phone !== undefined) {
        updatePayload.phone = payload.phone;
    }

    if (payload.role !== undefined) {
        updatePayload.role = payload.role;
    }

    if (payload.is_active !== undefined) {
        updatePayload.is_active = payload.is_active;
    }

    const { data: updated, error } = await adminSupabase
        .from("user_profiles")
        .update(updatePayload)
        .eq("user_id", userId)
        .select("*")
        .single();

    if (error) {
        throw new AppError(500, "USER_UPDATE_FAILED", "Unable to update user.", error);
    }

    if (Array.isArray(payload.branch_ids)) {
        const { error: deleteError } = await adminSupabase
            .from("branch_staff_assignments")
            .delete()
            .eq("user_id", userId)
            .eq("tenant_id", before.tenant_id);

        if (deleteError) {
            throw new AppError(500, "BRANCH_ASSIGNMENT_RESET_FAILED", "Unable to reset branch assignments.");
        }

        if (payload.branch_ids.length) {
            const { error: assignmentError } = await adminSupabase.from("branch_staff_assignments").insert(
                payload.branch_ids.map((branchId) => ({
                    tenant_id: before.tenant_id,
                    branch_id: branchId,
                    user_id: userId
                }))
            );

            if (assignmentError) {
                throw new AppError(
                    500,
                    "BRANCH_ASSIGNMENT_CREATE_FAILED",
                    "Unable to create branch assignments.",
                    assignmentError
                );
            }
        }
    }

    await logAudit({
        tenantId: before.tenant_id,
        userId: actor.user.id,
        table: "user_profiles",
        action: "update_user",
        beforeData: before,
        afterData: updated
    });

    return updated;
}

async function bootstrapSuperAdmin(actor, payload) {
    const tenantId = payload.tenant_id;
    assertTenantAccess({ auth: actor }, tenantId);

    const { data: tenant, error: tenantError } = await adminSupabase
        .from("tenants")
        .select("id")
        .eq("id", tenantId)
        .is("deleted_at", null)
        .single();

    if (tenantError || !tenant) {
        throw new AppError(404, "TENANT_NOT_FOUND", "Tenant was not found.");
    }

    let branch = null;

    if (payload.branch_id) {
        const { data: branchData, error: branchError } = await adminSupabase
            .from("branches")
            .select("id, tenant_id")
            .eq("id", payload.branch_id)
            .is("deleted_at", null)
            .single();

        if (branchError || !branchData || branchData.tenant_id !== tenantId) {
            throw new AppError(404, "BRANCH_NOT_FOUND", "Branch was not found for this tenant.");
        }

        branch = branchData;
    } else {
        const { data: defaultBranch, error: defaultBranchError } = await adminSupabase
            .from("branches")
            .select("id, tenant_id")
            .eq("tenant_id", tenantId)
            .is("deleted_at", null)
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle();

        if (defaultBranchError || !defaultBranch) {
            throw new AppError(404, "BRANCH_NOT_FOUND", "No active branch is available for this tenant.");
        }

        branch = defaultBranch;
    }

    const createdUser = await inviteUser({
        actor,
        payload: {
            tenant_id: tenantId,
            email: payload.email,
            full_name: payload.full_name,
            phone: payload.phone || null,
            role: "super_admin",
            branch_ids: [branch.id],
            send_invite: payload.send_invite,
            password: payload.send_invite ? null : payload.password || null
        }
    });

    await logAudit({
        tenantId,
        userId: actor.user.id,
        table: "user_profiles",
        action: "bootstrap_super_admin",
        beforeData: null,
        afterData: {
            user_id: createdUser.user?.id || null,
            email: createdUser.user?.email || payload.email,
            profile: createdUser.profile,
            branch_id: branch.id
        }
    });

    return {
        ...createdUser,
        branch_id: branch.id
    };
}

async function getMe(actor, tenantContextId = null) {
    let tenant = null;
    let branches = [];
    const effectiveTenantId = actor.isInternalOps && tenantContextId
        ? tenantContextId
        : actor.profile?.tenant_id || null;

    if (effectiveTenantId) {
        const { data: tenantData, error: tenantError } = await adminSupabase
            .from("tenants")
            .select("id, name")
            .eq("id", effectiveTenantId)
            .is("deleted_at", null)
            .maybeSingle();

        if (tenantError) {
            throw new AppError(500, "ME_TENANT_FETCH_FAILED", "Unable to load tenant profile.", tenantError);
        }

        tenant = tenantData || null;
    }

    if (actor.isInternalOps && effectiveTenantId) {
        const { data: branchRows, error: branchError } = await adminSupabase
            .from("branches")
            .select("id, name, code")
            .eq("tenant_id", effectiveTenantId)
            .is("deleted_at", null)
            .order("name", { ascending: true });

        if (branchError) {
            throw new AppError(500, "ME_BRANCH_FETCH_FAILED", "Unable to load branch profile.", branchError);
        }

        branches = branchRows || [];
    } else if (actor.branchIds?.length) {
        const { data: branchRows, error: branchError } = await adminSupabase
            .from("branches")
            .select("id, name, code")
            .in("id", actor.branchIds)
            .is("deleted_at", null);

        if (branchError) {
            throw new AppError(500, "ME_BRANCH_FETCH_FAILED", "Unable to load branch profile.", branchError);
        }

        branches = branchRows || [];
    }

    return {
        user: actor.user,
        profile: actor.profile,
        branch_ids: actor.branchIds,
        tenant,
        branches
    };
}

async function markPasswordChanged(actor) {
    if (!actor.profile) {
        throw new AppError(403, "PROFILE_NOT_FOUND", "User profile is not provisioned.");
    }

    const { data, error } = await adminSupabase
        .from("user_profiles")
        .update({
            must_change_password: false,
            first_login_at: new Date().toISOString()
        })
        .eq("user_id", actor.user.id)
        .eq("tenant_id", actor.profile.tenant_id)
        .select("*")
        .single();

    if (error || !data) {
        throw new AppError(500, "PASSWORD_CHANGE_ACK_FAILED", "Unable to mark password change.", error);
    }

    await logAudit({
        tenantId: actor.profile.tenant_id,
        actorUserId: actor.user.id,
        table: "user_profiles",
        entityType: "user_profile",
        entityId: actor.user.id,
        action: "PASSWORD_CHANGED_FIRST_LOGIN",
        afterData: {
            user_id: actor.user.id,
            must_change_password: false,
            first_login_at: data.first_login_at
        }
    });

    await clearCredentialByUser({
        tenantId: actor.profile.tenant_id,
        userId: actor.user.id,
        clearedBy: actor.user.id
    });

    return {
        user_id: actor.user.id,
        must_change_password: false,
        first_login_at: data.first_login_at
    };
}

async function getUserTemporaryCredential(actor, userId) {
    const { data: profile, error } = await adminSupabase
        .from("user_profiles")
        .select("user_id, tenant_id, role")
        .eq("user_id", userId)
        .is("deleted_at", null)
        .single();

    if (error || !profile) {
        throw new AppError(404, "USER_NOT_FOUND", "User was not found.");
    }

    assertTenantAccess({ auth: actor }, profile.tenant_id);

    if (!actor.isInternalOps) {
        if (actor.role === ROLES.SUPER_ADMIN && profile.role !== ROLES.BRANCH_MANAGER) {
            throw new AppError(403, "FORBIDDEN", "Super admin can only view branch manager temporary credentials.");
        }

        if (actor.role === ROLES.BRANCH_MANAGER && ![ROLES.LOAN_OFFICER, ROLES.TELLER, ROLES.AUDITOR].includes(profile.role)) {
            throw new AppError(403, "FORBIDDEN", "Branch manager can only view managed staff temporary credentials.");
        }
    }

    const handoff = await getActiveCredentialByUser({
        tenantId: profile.tenant_id,
        userId
    });

    if (!handoff) {
        throw new AppError(404, "TEMPORARY_CREDENTIAL_NOT_FOUND", "No active temporary credential is available for this user.");
    }

    return handoff;
}

module.exports = {
    listUsers,
    createUser,
    updateUser,
    bootstrapSuperAdmin,
    getMe,
    markPasswordChanged,
    getUserTemporaryCredential
};
