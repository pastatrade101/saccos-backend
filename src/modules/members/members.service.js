const crypto = require("crypto");

const { adminSupabase } = require("../../config/supabase");
const AppError = require("../../utils/app-error");
const { assertPlanLimit } = require("../../services/subscription.service");
const { logAudit } = require("../../services/audit.service");
const { assertBranchAccess, assertTenantAccess } = require("../../services/user-context.service");
const { ensureBranchAssignments } = require("../../services/branch-assignment.service");
const { saveCredentialHandoff, getActiveCredentialByUser } = require("../../services/credential-handoff.service");

function generateTemporaryPassword() {
    const lowers = "abcdefghjkmnpqrstuvwxyz";
    const uppers = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    const numbers = "23456789";
    const symbols = "!@#$%^&*()-_=+";
    const alphabet = `${lowers}${uppers}${numbers}${symbols}`;
    const characters = [
        lowers[Math.floor(Math.random() * lowers.length)],
        uppers[Math.floor(Math.random() * uppers.length)],
        numbers[Math.floor(Math.random() * numbers.length)],
        symbols[Math.floor(Math.random() * symbols.length)]
    ];

    while (characters.length < 14) {
        characters.push(alphabet[Math.floor(Math.random() * alphabet.length)]);
    }

    return characters.sort(() => Math.random() - 0.5).join("");
}

async function listMembers(actor) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    let query = adminSupabase
        .from("members")
        .select("*")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });

    if (actor.role === "member") {
        query = query.eq("user_id", actor.user.id);
    } else if (!actor.isInternalOps && !["super_admin", "auditor"].includes(actor.role) && actor.branchIds.length) {
        query = query.in("branch_id", actor.branchIds);
    }

    const { data, error } = await query;

    if (error) {
        throw new AppError(500, "MEMBERS_LIST_FAILED", "Unable to load members.", error);
    }

    return data || [];
}

async function listMemberAccounts(actor, query = {}) {
    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    let accountQuery = adminSupabase
        .from("member_accounts")
        .select("*")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });

    if (actor.role === "member") {
        const { data: ownMember, error: ownMemberError } = await adminSupabase
            .from("members")
            .select("id")
            .eq("tenant_id", tenantId)
            .eq("user_id", actor.user.id)
            .is("deleted_at", null)
            .single();

        if (ownMemberError || !ownMember) {
            throw new AppError(404, "MEMBER_NOT_FOUND", "Linked member record was not found.");
        }

        accountQuery = accountQuery.eq("member_id", ownMember.id);
    } else if (!actor.isInternalOps && !["super_admin", "auditor"].includes(actor.role) && actor.branchIds.length) {
        accountQuery = accountQuery.in("branch_id", actor.branchIds);
    }

    if (query.product_type) {
        accountQuery = accountQuery.eq("product_type", query.product_type);
    }

    const { data, error } = await accountQuery;

    if (error) {
        throw new AppError(500, "MEMBER_ACCOUNTS_LIST_FAILED", "Unable to load member accounts.", error);
    }

    return data || [];
}

async function safeDeleteAuthUser(userId) {
    if (!userId) {
        return;
    }

    await adminSupabase.auth.admin.deleteUser(userId);
}

async function findAuthUserByEmail(email) {
    if (!email) {
        return null;
    }

    const { data, error } = await adminSupabase.auth.admin.listUsers({
        page: 1,
        perPage: 1000
    });

    if (error) {
        throw new AppError(500, "AUTH_USERS_LIST_FAILED", "Unable to look up auth users.", error);
    }

    return (data?.users || []).find((user) => user.email?.toLowerCase() === email.toLowerCase()) || null;
}

async function getDefaultMemberProducts(tenantId) {
    const [{ data: savingsProduct, error: savingsError }, { data: shareProduct, error: shareError }] = await Promise.all([
        adminSupabase
            .from("savings_products")
            .select("id, code, name")
            .eq("tenant_id", tenantId)
            .eq("status", "active")
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle(),
        adminSupabase
            .from("share_products")
            .select("id, code, name")
            .eq("tenant_id", tenantId)
            .eq("status", "active")
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle()
    ]);

    if (savingsError) {
        throw new AppError(500, "SAVINGS_PRODUCT_LOOKUP_FAILED", "Unable to resolve savings product.", savingsError);
    }

    if (shareError) {
        throw new AppError(500, "SHARE_PRODUCT_LOOKUP_FAILED", "Unable to resolve share product.", shareError);
    }

    if (!savingsProduct || !shareProduct) {
        throw new AppError(
            500,
            "MEMBER_PRODUCTS_NOT_CONFIGURED",
            "Default savings and share products must be configured before onboarding members."
        );
    }

    return {
        savingsProduct,
        shareProduct
    };
}

async function appendMembershipStatusHistory({ tenantId, memberId, statusCode, changedBy, notes = null }) {
    const { error } = await adminSupabase.from("membership_status_history").insert({
        tenant_id: tenantId,
        member_id: memberId,
        status_code: statusCode,
        changed_by: changedBy,
        notes
    });

    if (error) {
        throw new AppError(
            500,
            "MEMBERSHIP_STATUS_HISTORY_WRITE_FAILED",
            "Unable to record membership status history.",
            error
        );
    }
}

async function ensureMemberAccounts({ tenantId, branchId, member }) {
    const { data: existingAccounts, error: existingAccountsError } = await adminSupabase
        .from("member_accounts")
        .select("id, product_type")
        .eq("tenant_id", tenantId)
        .eq("member_id", member.id)
        .is("deleted_at", null);

    if (existingAccountsError) {
        throw new AppError(500, "MEMBER_ACCOUNT_LOOKUP_FAILED", "Unable to verify member accounts.", existingAccountsError);
    }

    const existingByProduct = new Set((existingAccounts || []).map((account) => account.product_type));

    if (existingByProduct.has("savings") && existingByProduct.has("shares")) {
        return existingAccounts || [];
    }

    const { data: tenantSettings, error: settingsError } = await adminSupabase
        .from("tenant_settings")
        .select("default_member_savings_control_account_id")
        .eq("tenant_id", tenantId)
        .single();

    if (settingsError || !tenantSettings?.default_member_savings_control_account_id) {
        throw new AppError(
            500,
            "TENANT_SETTINGS_MISSING",
            "Tenant savings control account is not configured."
        );
    }

    const { data: shareControlAccount, error: shareControlError } = await adminSupabase
        .from("chart_of_accounts")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("system_tag", "member_share_capital_control")
        .is("deleted_at", null)
        .single();

    if (shareControlError || !shareControlAccount?.id) {
        throw new AppError(
            500,
            "SHARE_CONTROL_ACCOUNT_MISSING",
            "Tenant member share capital account is not configured."
        );
    }

    const { savingsProduct, shareProduct } = await getDefaultMemberProducts(tenantId);
    const accountRows = [];

    if (!existingByProduct.has("savings")) {
        accountRows.push({
            tenant_id: tenantId,
            member_id: member.id,
            branch_id: branchId,
            account_number: `SV-${crypto.randomInt(100000, 999999)}`,
            account_name: `${member.full_name} Savings`,
            product_type: "savings",
            savings_product_id: savingsProduct.id,
            status: "active",
            gl_account_id: tenantSettings.default_member_savings_control_account_id
        });
    }

    if (!existingByProduct.has("shares")) {
        accountRows.push({
            tenant_id: tenantId,
            member_id: member.id,
            branch_id: branchId,
            account_number: `SH-${crypto.randomInt(100000, 999999)}`,
            account_name: `${member.full_name} Share Capital`,
            product_type: "shares",
            share_product_id: shareProduct.id,
            status: "active",
            gl_account_id: shareControlAccount.id
        });
    }

    if (!accountRows.length) {
        return existingAccounts || [];
    }

    const { error: accountError } = await adminSupabase.from("member_accounts").insert(accountRows);

    if (accountError) {
        throw new AppError(500, "MEMBER_ACCOUNT_CREATE_FAILED", "Unable to create member account.", accountError);
    }

    return [
        ...(existingAccounts || []),
        ...accountRows
    ];
}

async function provisionMemberLogin(actor, member, payload) {
    const email = payload.email || member.email;

    if (!email) {
        throw new AppError(400, "MEMBER_EMAIL_REQUIRED", "Member email is required to create a login.");
    }

    const branchId = payload.branch_id || member.branch_id;
    const mustChangePassword = Boolean(payload.must_change_password);
    const temporaryPassword = !payload.send_invite && !payload.password
        ? generateTemporaryPassword()
        : null;
    const linkExistingAuthUser = async (authUser) => {
        const authUserId = authUser.id;
        const { data: existingLinkedMember, error: existingLinkedMemberError } = await adminSupabase
            .from("members")
            .select("id, full_name")
            .eq("tenant_id", member.tenant_id)
            .eq("user_id", authUserId)
            .is("deleted_at", null)
            .maybeSingle();

        if (existingLinkedMemberError) {
            throw new AppError(500, "MEMBER_LINK_LOOKUP_FAILED", "Unable to verify existing member login link.", existingLinkedMemberError);
        }

        if (existingLinkedMember && existingLinkedMember.id !== member.id) {
            throw new AppError(
                409,
                "MEMBER_LOGIN_EMAIL_IN_USE",
                `This email is already linked to member ${existingLinkedMember.full_name}.`
            );
        }

        const profilePayload = {
            user_id: authUserId,
            tenant_id: member.tenant_id,
            branch_id: branchId,
            full_name: member.full_name,
            phone: member.phone || null,
            role: "member",
            member_id: member.id,
            must_change_password: mustChangePassword,
            first_login_at: mustChangePassword ? null : payload.first_login_at || null,
            is_active: true
        };

        const { data: profile, error: profileError } = await adminSupabase
            .from("user_profiles")
            .upsert(profilePayload, { onConflict: "user_id" })
            .select("*")
            .single();

        if (profileError) {
            throw new AppError(500, "MEMBER_PROFILE_CREATE_FAILED", "Unable to create member profile.", profileError);
        }

        const { data: updatedMember, error: updateError } = await adminSupabase
            .from("members")
            .update({
                user_id: authUserId,
                email
            })
            .eq("id", member.id)
            .select("*")
            .single();

        if (updateError) {
            throw new AppError(500, "MEMBER_LINK_FAILED", "Unable to link member to existing login account.", updateError);
        }

        const authUserUpdatePayload = {
            email,
            user_metadata: {
                full_name: member.full_name,
                phone: member.phone
            },
            app_metadata: {
                ...(authUser.app_metadata || {}),
                tenant_id: member.tenant_id,
                role: "member",
                member_id: member.id
            }
        };

        if (!payload.send_invite) {
            authUserUpdatePayload.password = payload.password || temporaryPassword;
            authUserUpdatePayload.email_confirm = true;
        }

        const { error: authError } = await adminSupabase.auth.admin.updateUserById(authUserId, authUserUpdatePayload);

        if (authError) {
            throw new AppError(500, "MEMBER_AUTH_SYNC_FAILED", "Unable to sync existing member login.", authError);
        }

        await ensureBranchAssignments({
            tenantId: member.tenant_id,
            userId: authUserId,
            branchIds: [member.branch_id]
        });

        if (!payload.send_invite && (temporaryPassword || payload.password)) {
            await saveCredentialHandoff({
                tenantId: member.tenant_id,
                userId: authUserId,
                memberId: member.id,
                email,
                password: temporaryPassword || payload.password,
                createdBy: actor.user.id
            });
        }

        return {
            member: updatedMember,
            profile,
            user: {
                id: authUserId,
                email
            },
            already_exists: true,
            temporary_password: temporaryPassword || (await getActiveCredentialByUser({
                tenantId: member.tenant_id,
                userId: authUserId
            }))?.temporary_password || null
        };
    };

    if (member.user_id) {
        const { data: existingProfile, error: existingProfileError } = await adminSupabase
            .from("user_profiles")
            .select("must_change_password, first_login_at")
            .eq("user_id", member.user_id)
            .maybeSingle();

        if (existingProfileError) {
            throw new AppError(500, "MEMBER_PROFILE_LOOKUP_FAILED", "Unable to load existing member profile.", existingProfileError);
        }

        const profilePayload = {
            user_id: member.user_id,
            tenant_id: member.tenant_id,
            branch_id: branchId,
            full_name: member.full_name,
            phone: member.phone || null,
            role: "member",
            member_id: member.id,
            must_change_password: existingProfile?.must_change_password ?? false,
            first_login_at: existingProfile?.first_login_at ?? (payload.first_login_at || null),
            is_active: true
        };

        const { data: profile, error: profileError } = await adminSupabase
            .from("user_profiles")
            .upsert(profilePayload, { onConflict: "user_id" })
            .select("*")
            .single();

        if (profileError) {
            throw new AppError(500, "MEMBER_PROFILE_CREATE_FAILED", "Unable to update member profile.", profileError);
        }

        const { data: updatedMember, error: updateError } = await adminSupabase
            .from("members")
            .update({
                user_id: member.user_id,
                email
            })
            .eq("id", member.id)
            .select("*")
            .single();

        if (updateError) {
            throw new AppError(500, "MEMBER_LINK_FAILED", "Unable to update member login link.", updateError);
        }

        const { error: authError } = await adminSupabase.auth.admin.updateUserById(member.user_id, {
            email,
            user_metadata: {
                full_name: member.full_name,
                phone: member.phone
            },
            app_metadata: {
                tenant_id: member.tenant_id,
                role: "member",
                member_id: member.id
            }
        });

        if (authError) {
            throw new AppError(500, "MEMBER_AUTH_SYNC_FAILED", "Unable to sync existing member login.", authError);
        }

        return {
            member: updatedMember,
            profile,
            user: {
                id: member.user_id,
                email
            },
            already_exists: true,
            temporary_password: (await getActiveCredentialByUser({
                tenantId: member.tenant_id,
                userId: member.user_id
            }))?.temporary_password || null
        };
    }

    const authOperation = payload.send_invite
        ? adminSupabase.auth.admin.inviteUserByEmail(email, {
            data: {
                full_name: member.full_name,
                phone: member.phone,
                tenant_id: member.tenant_id,
                role: "member",
                member_id: member.id
            }
        })
        : adminSupabase.auth.admin.createUser({
            email,
            password: payload.password || temporaryPassword,
            email_confirm: true,
            user_metadata: {
                full_name: member.full_name,
                phone: member.phone
            },
            app_metadata: {
                tenant_id: member.tenant_id,
                role: "member",
                member_id: member.id
            }
        });

    let { data: authData, error: authError } = await authOperation;

    if (authError && /already been registered|already exists|duplicate/i.test(authError.message || "")) {
        const existingAuthUser = await findAuthUserByEmail(email);

        if (existingAuthUser) {
            return linkExistingAuthUser(existingAuthUser);
        }
    }

    if (authError || !authData?.user) {
        throw new AppError(500, "MEMBER_LOGIN_CREATE_FAILED", "Unable to create member login.", authError);
    }

    const authUserId = authData.user.id;

    try {
        const profilePayload = {
            user_id: authUserId,
            tenant_id: member.tenant_id,
            branch_id: branchId,
            full_name: member.full_name,
            phone: member.phone || null,
            role: "member",
            member_id: member.id,
            must_change_password: mustChangePassword,
            first_login_at: mustChangePassword ? null : payload.first_login_at || null,
            is_active: true
        };

        const { data: profile, error: profileError } = await adminSupabase
            .from("user_profiles")
            .upsert(profilePayload, { onConflict: "user_id" })
            .select("*")
            .single();

        if (profileError) {
            throw new AppError(500, "MEMBER_PROFILE_CREATE_FAILED", "Unable to create member profile.", profileError);
        }

        const { data: updatedMember, error: updateError } = await adminSupabase
            .from("members")
            .update({
                user_id: authUserId,
                email
            })
            .eq("id", member.id)
            .select("*")
            .single();

        if (updateError) {
            throw new AppError(500, "MEMBER_LINK_FAILED", "Unable to link member to login account.", updateError);
        }

        await ensureBranchAssignments({
            tenantId: member.tenant_id,
            userId: authUserId,
            branchIds: [member.branch_id]
        });

        if (!payload.send_invite && (temporaryPassword || payload.password)) {
            await saveCredentialHandoff({
                tenantId: member.tenant_id,
                userId: authUserId,
                memberId: member.id,
                email,
                password: temporaryPassword || payload.password,
                createdBy: actor.user.id
            });
        }

        return {
            member: updatedMember,
            profile,
            user: {
                id: authUserId,
                email: authData.user.email
            },
            temporary_password: temporaryPassword
        };
    } catch (error) {
        await safeDeleteAuthUser(authUserId);
        throw error;
    }
}

async function createMember(actor, payload) {
    const tenantId = payload.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);
    assertBranchAccess({ auth: actor }, payload.branch_id);
    await assertPlanLimit(tenantId, "members", "members");

    const { data: member, error } = await adminSupabase
        .from("members")
        .insert({
            tenant_id: tenantId,
            branch_id: payload.branch_id,
            full_name: payload.full_name,
            dob: payload.dob || null,
            phone: payload.phone || null,
            email: payload.email || null,
            member_no: payload.member_no || null,
            national_id: payload.national_id || null,
            address_line1: payload.address_line1 || null,
            address_line2: payload.address_line2 || null,
            city: payload.city || null,
            state: payload.state || null,
            country: payload.country || null,
            postal_code: payload.postal_code || null,
            nida_no: payload.nida_no || null,
            tin_no: payload.tin_no || null,
            next_of_kin_name: payload.next_of_kin_name || null,
            next_of_kin_phone: payload.next_of_kin_phone || null,
            next_of_kin_relationship: payload.next_of_kin_relationship || null,
            employer: payload.employer || null,
            kyc_status: payload.kyc_status || "pending",
            kyc_reason: payload.kyc_reason || null,
            notes: payload.notes || null,
            status: payload.status,
            user_id: payload.user_id || null
        })
        .select("*")
        .single();

    if (error) {
        throw new AppError(500, "MEMBER_CREATE_FAILED", "Unable to create member.", error);
    }

    await ensureMemberAccounts({
        tenantId,
        branchId: payload.branch_id,
        member
    });
    await appendMembershipStatusHistory({
        tenantId,
        memberId: member.id,
        statusCode: payload.status || "active",
        changedBy: actor.user.id,
        notes: "Member onboarded directly."
    });

    let createdMember = member;
    let loginResult = null;

    try {
        if (payload.login?.create_login) {
            loginResult = await provisionMemberLogin(actor, member, {
                email: payload.email || null,
                send_invite: payload.login.send_invite,
                password: payload.login.send_invite ? null : payload.login.password,
                branch_id: payload.branch_id,
                must_change_password: Boolean(!payload.login.send_invite)
            });
            createdMember = loginResult.member;
        }
    } catch (error) {
        await adminSupabase
            .from("member_accounts")
            .delete()
            .eq("tenant_id", tenantId)
            .eq("member_id", member.id);
        await adminSupabase
            .from("members")
            .delete()
            .eq("tenant_id", tenantId)
            .eq("id", member.id);
        throw error;
    }

    await logAudit({
        tenantId,
        userId: actor.user.id,
        table: "members",
        action: payload.login?.create_login ? "create_member_with_login" : "create_member",
        afterData: createdMember
    });

    return {
        member: createdMember,
        login: loginResult
    };
}

async function getMember(actor, memberId) {
    const { data, error } = await adminSupabase
        .from("members")
        .select("*")
        .eq("id", memberId)
        .is("deleted_at", null)
        .single();

    if (error || !data) {
        throw new AppError(404, "MEMBER_NOT_FOUND", "Member was not found.");
    }

    assertTenantAccess({ auth: actor }, data.tenant_id);

    if (actor.role === "member" && data.user_id !== actor.user.id) {
        throw new AppError(403, "FORBIDDEN", "Members can only access their own record.");
    }

    assertBranchAccess({ auth: actor }, data.branch_id);
    return data;
}

async function updateMember(actor, memberId, payload) {
    const before = await getMember(actor, memberId);

    if (payload.branch_id) {
        assertBranchAccess({ auth: actor }, payload.branch_id);
    }

    const { data: updated, error } = await adminSupabase
        .from("members")
        .update(payload)
        .eq("id", memberId)
        .select("*")
        .single();

    if (error) {
        throw new AppError(500, "MEMBER_UPDATE_FAILED", "Unable to update member.", error);
    }

    if (payload.status && payload.status !== before.status) {
        await appendMembershipStatusHistory({
            tenantId: before.tenant_id,
            memberId,
            statusCode: payload.status,
            changedBy: actor.user.id,
            notes: "Membership status updated from member maintenance."
        });
    }

    if (updated.user_id) {
        const { error: profileError } = await adminSupabase
            .from("user_profiles")
            .update({
                branch_id: updated.branch_id,
                full_name: updated.full_name,
                phone: updated.phone || null,
                member_id: updated.id
            })
            .eq("user_id", updated.user_id);

        if (profileError) {
            throw new AppError(500, "MEMBER_PROFILE_SYNC_FAILED", "Unable to sync linked member profile.", profileError);
        }

        const { error: authError } = await adminSupabase.auth.admin.updateUserById(updated.user_id, {
            email: updated.email || undefined,
            user_metadata: {
                full_name: updated.full_name,
                phone: updated.phone
            },
            app_metadata: {
                tenant_id: updated.tenant_id,
                role: "member",
                member_id: updated.id
            }
        });

        if (authError) {
            throw new AppError(500, "MEMBER_AUTH_SYNC_FAILED", "Unable to sync linked member login.", authError);
        }

        await ensureBranchAssignments({
            tenantId: updated.tenant_id,
            userId: updated.user_id,
            branchIds: [updated.branch_id]
        });
    }

    await logAudit({
        tenantId: before.tenant_id,
        userId: actor.user.id,
        table: "members",
        action: "update_member",
        beforeData: before,
        afterData: updated
    });

    return updated;
}

async function deleteMember(actor, memberId) {
    const before = await getMember(actor, memberId);

    const payload = {
        status: "exited",
        deleted_at: new Date().toISOString(),
        deleted_by: actor.user.id
    };

    const { data: updated, error } = await adminSupabase
        .from("members")
        .update(payload)
        .eq("id", memberId)
        .select("*")
        .single();

    if (error) {
        throw new AppError(500, "MEMBER_DELETE_FAILED", "Unable to soft delete member.", error);
    }

    await logAudit({
        tenantId: before.tenant_id,
        userId: actor.user.id,
        table: "members",
        action: "delete_member",
        beforeData: before,
        afterData: updated
    });

    return updated;
}

async function createMemberLogin(actor, memberId, payload) {
    const member = await getMember(actor, memberId);
    const result = await provisionMemberLogin(actor, member, {
        ...payload,
        branch_id: member.branch_id,
        must_change_password: Boolean(!payload.send_invite)
    });

    await logAudit({
        tenantId: member.tenant_id,
        userId: actor.user.id,
        table: "members",
        action: "create_member_login",
        beforeData: member,
        afterData: result.member
    });

    return result;
}

async function getMemberTemporaryCredential(actor, memberId) {
    const member = await getMember(actor, memberId);

    if (!member.user_id) {
        throw new AppError(404, "MEMBER_LOGIN_NOT_FOUND", "This member does not have a linked login.");
    }

    const handoff = await getActiveCredentialByUser({
        tenantId: member.tenant_id,
        userId: member.user_id
    });

    if (!handoff) {
        throw new AppError(404, "TEMPORARY_CREDENTIAL_NOT_FOUND", "No active temporary credential is available for this member.");
    }

    return {
        ...handoff,
        member_id: member.id,
        full_name: member.full_name
    };
}

module.exports = {
    listMembers,
    listMemberAccounts,
    createMember,
    getMember,
    updateMember,
    deleteMember,
    createMemberLogin,
    ensureMemberAccounts,
    provisionMemberLogin,
    getMemberTemporaryCredential
};
