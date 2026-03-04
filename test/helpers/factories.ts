const app = require("../../src/app");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const tenantsService = require("../../src/modules/tenants/tenants.service");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const usersService = require("../../src/modules/users/users.service");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const branchesService = require("../../src/modules/branches/branches.service");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const membersService = require("../../src/modules/members/members.service");
import request from "supertest";

import { query, queryOne } from "./db";
import { createAuthUser, getAuthUserById, signInForToken } from "./supabaseAdmin";
import { trackTenant, trackUser } from "./state";

type AuthActor = {
    user: { id: string; email?: string | null };
    profile: any;
    branchIds: string[];
    isInternalOps: boolean;
    tenantId: string | null;
    role: string | null;
};

function uniqueText(prefix: string) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function buildActorForUser(userId: string): Promise<AuthActor> {
    const authUser = await getAuthUserById(userId);
    const profileRow = await query(
        `select * from public.user_profiles where user_id = $1 and deleted_at is null`,
        [userId]
    );
    const branchRows = await query<{ branch_id: string }>(
        `select branch_id from public.branch_staff_assignments where user_id = $1 and deleted_at is null`,
        [userId]
    );

    const profile = profileRow.rows[0] || null;
    const isInternalOps =
        authUser.app_metadata?.platform_role === "internal_ops" ||
        authUser.app_metadata?.platform_role === "platform_admin" ||
        profile?.role === "platform_admin";

    return {
        user: {
            id: authUser.id,
            email: authUser.email
        },
        profile,
        branchIds: branchRows.rows.map((row) => row.branch_id),
        isInternalOps,
        tenantId: profile?.tenant_id || null,
        role: profile?.role || null
    };
}

export async function createPlatformAdminFixture(label = "platform-admin") {
    const email = `${uniqueText(label)}@example.test`;
    const authUser = await createAuthUser({
        email,
        appMetadata: {
            platform_role: "platform_admin"
        }
    });

    return {
        ...authUser,
        token: await signInForToken(authUser.email, authUser.password),
        actor: await buildActorForUser(authUser.id)
    };
}

export async function createTenantFixture(params?: {
    actor?: AuthActor;
    name?: string;
    registrationNumber?: string;
    plan?: "starter" | "growth" | "enterprise";
}) {
    const platform = params?.actor ? null : await createPlatformAdminFixture();
    const actor = params?.actor || platform!.actor;
    const tenant = await tenantsService.createTenant(actor, {
        name: params?.name || uniqueText(process.env.TEST_TENANT_NAME || "Test Tenant"),
        registration_number: params?.registrationNumber || uniqueText("REG"),
        status: "active",
        plan: params?.plan || "growth",
        subscription_status: "active",
        start_at: "2026-01-01T00:00:00.000Z",
        expires_at: "2027-01-01T00:00:00.000Z"
    });

    trackTenant(tenant.id);

    const branch = await queryOne<{ id: string; name: string; code: string }>(
        `
        select id, name, code
        from public.branches
        where tenant_id = $1 and deleted_at is null
        order by created_at asc
        limit 1
        `,
        [tenant.id]
    );

    return {
        platform,
        tenant,
        branch
    };
}

export async function createExtraBranchFixture(params: {
    actor: AuthActor;
    tenantId: string;
    name?: string;
    code?: string;
}) {
    return branchesService.createBranch(params.actor, {
        tenant_id: params.tenantId,
        name: params.name || uniqueText("Test Branch"),
        code: params.code || uniqueText("BR").slice(0, 10).toUpperCase(),
        address_line1: "Audit Street",
        address_line2: null,
        city: "Dar es Salaam",
        state: "Dar es Salaam",
        country: "Tanzania"
    });
}

export async function createSuperAdminFixture(params: {
    platformActor: AuthActor;
    tenantId: string;
    branchId: string;
    password?: string;
}) {
    const email = `${uniqueText("super-admin")}@example.test`;
    const password = params.password || "TestPass123!";
    const result = await usersService.bootstrapSuperAdmin(params.platformActor, {
        tenant_id: params.tenantId,
        branch_id: params.branchId,
        email,
        full_name: "Tenant Super Admin",
        phone: "+255700000001",
        send_invite: false,
        password
    });

    trackUser(result.user.id, email);

    return {
        email,
        password,
        user: result.user,
        profile: result.profile,
        token: await signInForToken(email, password),
        actor: await buildActorForUser(result.user.id)
    };
}

export async function createStaffFixture(params: {
    actor: AuthActor;
    tenantId: string;
    role: "branch_manager" | "loan_officer" | "teller" | "auditor";
    branchIds: string[];
    password?: string;
    fullName?: string;
}) {
    const email = `${uniqueText(params.role)}@example.test`;
    const password = params.password || "TestPass123!";
    const result = await usersService.createUser(params.actor, {
        tenant_id: params.tenantId,
        email,
        full_name: params.fullName || params.role.replace("_", " "),
        phone: "+255700000002",
        role: params.role,
        branch_ids: params.branchIds,
        send_invite: false,
        password
    });

    trackUser(result.user.id, email);

    return {
        email,
        password,
        user: result.user,
        profile: result.profile,
        token: await signInForToken(email, password),
        actor: await buildActorForUser(result.user.id)
    };
}

export async function createMemberFixture(params: {
    actor: AuthActor;
    branchId: string;
    tenantId: string;
    fullName?: string;
    withLogin?: boolean;
}) {
    const fullName = params.fullName || `Member ${uniqueText("name")}`;
    const email = `${uniqueText("member")}@example.test`;
    const result = await membersService.createMember(params.actor, {
        tenant_id: params.tenantId,
        branch_id: params.branchId,
        full_name: fullName,
        phone: "+255711111111",
        email,
        member_no: uniqueText("MBR").toUpperCase(),
        national_id: uniqueText("NIDA").toUpperCase(),
        address_line1: "Test Address",
        city: "Arusha",
        state: "Arusha",
        country: "Tanzania",
        status: "active",
        kyc_status: "verified",
        login: params.withLogin
            ? {
                create_login: true,
                send_invite: false,
                password: "MemberPass123!"
            }
            : undefined
    });

    if (result.login?.user?.id) {
        trackUser(result.login.user.id, email);
    }

    const accounts = await query<{
        id: string;
        product_type: string;
    }>(
        `
        select id, product_type
        from public.member_accounts
        where member_id = $1
          and deleted_at is null
        order by created_at asc
        `,
        [result.member.id]
    );

    return {
        member: result.member,
        login: result.login || null,
        savingsAccountId: accounts.rows.find((row) => row.product_type === "savings")?.id,
        shareAccountId: accounts.rows.find((row) => row.product_type === "shares")?.id
    };
}

export async function openTellerSessionFixture(params: {
    token: string;
    branchId: string;
    openingCash?: number;
}) {
    const response = await request(app)
        .post("/api/cash-control/sessions/open")
        .set("Authorization", `Bearer ${params.token}`)
        .send({
            branch_id: params.branchId,
            opening_cash: params.openingCash || 500000,
            notes: "Test opening session"
        });

    if (response.status !== 201) {
        throw new Error(`Unable to open teller session: ${JSON.stringify(response.body)}`);
    }

    return response.body.data;
}
