import request from "supertest";

const app = require("../../src/app");

import { createMemberFixture, createPlatformAdminFixture, createStaffFixture, createSuperAdminFixture, createTenantFixture } from "../helpers/factories";
import { queryOne } from "../helpers/db";

describe("API integration: tenant isolation", () => {
    it("blocks a tenant user from reading another tenant's member resource and leaves foreign data unchanged", async () => {
        const platform = await createPlatformAdminFixture();
        const firstTenant = await createTenantFixture({ actor: platform.actor, plan: "growth" });
        const secondTenant = await createTenantFixture({ actor: platform.actor, plan: "growth" });

        const firstSuperAdmin = await createSuperAdminFixture({
            platformActor: platform.actor,
            tenantId: firstTenant.tenant.id,
            branchId: firstTenant.branch.id
        });
        const firstBranchManager = await createStaffFixture({
            actor: firstSuperAdmin.actor,
            tenantId: firstTenant.tenant.id,
            role: "branch_manager",
            branchIds: [firstTenant.branch.id]
        });

        const secondSuperAdmin = await createSuperAdminFixture({
            platformActor: platform.actor,
            tenantId: secondTenant.tenant.id,
            branchId: secondTenant.branch.id
        });
        const secondBranchManager = await createStaffFixture({
            actor: secondSuperAdmin.actor,
            tenantId: secondTenant.tenant.id,
            role: "branch_manager",
            branchIds: [secondTenant.branch.id]
        });

        const foreignMember = await createMemberFixture({
            actor: secondBranchManager.actor,
            branchId: secondTenant.branch.id,
            tenantId: secondTenant.tenant.id,
            fullName: "Foreign Tenant Member"
        });

        const before = await queryOne<{ count: string }>(
            `select count(*)::text as count from public.members where tenant_id = $1 and id = $2`,
            [secondTenant.tenant.id, foreignMember.member.id]
        );

        const response = await request(app)
            .get(`/api/members/${foreignMember.member.id}`)
            .set("Authorization", `Bearer ${firstBranchManager.token}`);

        expect([403, 404]).toContain(response.status);

        const after = await queryOne<{ count: string }>(
            `select count(*)::text as count from public.members where tenant_id = $1 and id = $2`,
            [secondTenant.tenant.id, foreignMember.member.id]
        );

        expect(after.count).toBe(before.count);
    });
});
