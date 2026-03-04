import request from "supertest";
import { createClient } from "@supabase/supabase-js";

const app = require("../../src/app");

import { createMemberFixture, createPlatformAdminFixture, createStaffFixture, createSuperAdminFixture, createTenantFixture, openTellerSessionFixture } from "../helpers/factories";
import { queryOne } from "../helpers/db";

describe("API integration: RBAC and security", () => {
    it("blocks wrong roles and enforces validation errors", async () => {
        const platform = await createPlatformAdminFixture();
        const { tenant, branch } = await createTenantFixture({ actor: platform.actor, plan: "growth" });
        const superAdmin = await createSuperAdminFixture({
            platformActor: platform.actor,
            tenantId: tenant.id,
            branchId: branch.id
        });
        const branchManager = await createStaffFixture({
            actor: superAdmin.actor,
            tenantId: tenant.id,
            role: "branch_manager",
            branchIds: [branch.id]
        });
        const teller = await createStaffFixture({
            actor: branchManager.actor,
            tenantId: tenant.id,
            role: "teller",
            branchIds: [branch.id]
        });
        const auditor = await createStaffFixture({
            actor: branchManager.actor,
            tenantId: tenant.id,
            role: "auditor",
            branchIds: [branch.id]
        });
        const member = await createMemberFixture({
            actor: branchManager.actor,
            branchId: branch.id,
            tenantId: tenant.id
        });

        await openTellerSessionFixture({
            token: teller.token,
            branchId: branch.id
        });

        const tellerApproveDividend = await request(app)
            .post("/api/dividends/cycles/non-existent-id/approve")
            .set("Authorization", `Bearer ${teller.token}`)
            .send({ notes: "Nope" });

        expect(tellerApproveDividend.status).toBe(403);
        expect(tellerApproveDividend.body.error.code).toBe("FORBIDDEN");

        const auditorDeposit = await request(app)
            .post("/api/deposit")
            .set("Authorization", `Bearer ${auditor.token}`)
            .send({
                tenant_id: tenant.id,
                account_id: member.savingsAccountId,
                amount: 50000
            });

        expect(auditorDeposit.status).toBe(403);
        expect(auditorDeposit.body.error.code).toBe("FORBIDDEN");

        const invalidDeposit = await request(app)
            .post("/api/deposit")
            .set("Authorization", `Bearer ${teller.token}`)
            .send({
                tenant_id: tenant.id,
                account_id: member.savingsAccountId,
                amount: -1
            });

        expect(invalidDeposit.status).toBe(400);
    });

    it("blocks maker-checker violations on dividend approval", async () => {
        const platform = await createPlatformAdminFixture();
        const { tenant, branch } = await createTenantFixture({ actor: platform.actor, plan: "growth" });
        const superAdmin = await createSuperAdminFixture({
            platformActor: platform.actor,
            tenantId: tenant.id,
            branchId: branch.id
        });
        const branchManager = await createStaffFixture({
            actor: superAdmin.actor,
            tenantId: tenant.id,
            role: "branch_manager",
            branchIds: [branch.id]
        });
        const member = await createMemberFixture({
            actor: branchManager.actor,
            branchId: branch.id,
            tenantId: tenant.id
        });

        const shareContribution = await request(app)
            .post("/api/share-contribution")
            .set("Authorization", `Bearer ${superAdmin.token}`)
            .send({
                tenant_id: tenant.id,
                account_id: member.shareAccountId,
                amount: 100000,
                reference: "DIV-SEED-SHARES"
            });

        expect(shareContribution.status).toBe(201);

        const options = await request(app)
            .get("/api/dividends/options")
            .set("Authorization", `Bearer ${branchManager.token}`);

        const retainedEarnings = options.body.data.accounts.find((account: any) => account.system_tag === "retained_earnings");
        const dividendsPayable = options.body.data.accounts.find((account: any) => account.system_tag === "dividends_payable");
        const cashAccount = options.body.data.accounts.find((account: any) => account.system_tag === "cash_on_hand");

        const dividendCycle = await request(app)
            .post("/api/dividends/cycles")
            .set("Authorization", `Bearer ${branchManager.token}`)
            .send({
                tenant_id: tenant.id,
                branch_id: branch.id,
                period_label: "FY2026 RBAC",
                start_date: "2025-01-01",
                end_date: "2025-12-31",
                declaration_date: "2026-01-10",
                record_date: "2025-12-31",
                payment_date: "2026-01-15",
                required_checker_count: 1,
                components: [
                    {
                        type: "share_dividend",
                        basis_method: "end_balance",
                        distribution_mode: "rate",
                        rate_percent: 10,
                        retained_earnings_account_id: retainedEarnings.id,
                        dividends_payable_account_id: dividendsPayable.id,
                        payout_account_id: cashAccount.id,
                        eligibility_rules_json: {},
                        rounding_rules_json: {}
                    }
                ]
            });

        expect(dividendCycle.status).toBe(201);

        await request(app)
            .post(`/api/dividends/cycles/${dividendCycle.body.data.id}/freeze`)
            .set("Authorization", `Bearer ${branchManager.token}`)
            .send()
            .expect(200);

        await request(app)
            .post(`/api/dividends/cycles/${dividendCycle.body.data.id}/allocate`)
            .set("Authorization", `Bearer ${branchManager.token}`)
            .send()
            .expect(200);

        const approval = await request(app)
            .post(`/api/dividends/cycles/${dividendCycle.body.data.id}/approve`)
            .set("Authorization", `Bearer ${branchManager.token}`)
            .send({
                notes: "Maker cannot self-approve"
            });

        expect(approval.status).toBe(400);
        expect(approval.body.error.code).toBe("MAKER_CHECKER_VIOLATION");
    });

    it("prevents duplicate money posting with the same idempotency key", async () => {
        const platform = await createPlatformAdminFixture();
        const { tenant, branch } = await createTenantFixture({ actor: platform.actor, plan: "growth" });
        const superAdmin = await createSuperAdminFixture({
            platformActor: platform.actor,
            tenantId: tenant.id,
            branchId: branch.id
        });
        const branchManager = await createStaffFixture({
            actor: superAdmin.actor,
            tenantId: tenant.id,
            role: "branch_manager",
            branchIds: [branch.id]
        });
        const teller = await createStaffFixture({
            actor: branchManager.actor,
            tenantId: tenant.id,
            role: "teller",
            branchIds: [branch.id]
        });
        const member = await createMemberFixture({
            actor: branchManager.actor,
            branchId: branch.id,
            tenantId: tenant.id
        });

        await openTellerSessionFixture({
            token: teller.token,
            branchId: branch.id
        });

        const payload = {
            tenant_id: tenant.id,
            account_id: member.savingsAccountId,
            amount: 32000,
            reference: "IDEMPOTENT-DEP-001"
        };

        const first = await request(app)
            .post("/api/deposit")
            .set("Authorization", `Bearer ${teller.token}`)
            .set("Idempotency-Key", "deposit-idempotent-key")
            .send(payload);

        const second = await request(app)
            .post("/api/deposit")
            .set("Authorization", `Bearer ${teller.token}`)
            .set("Idempotency-Key", "deposit-idempotent-key")
            .send(payload);

        expect(first.status).toBe(201);
        expect(second.status).toBe(201);
        expect(second.body.data.journal_id).toBe(first.body.data.journal_id);

        const count = await queryOne<{ count: string }>(
            `
            select count(*)::text as count
            from public.journal_entries
            where tenant_id = $1
              and reference = $2
            `,
            [tenant.id, "IDEMPOTENT-DEP-001"]
        );

        expect(Number(count.count)).toBe(1);
    });

    it("enforces tenant isolation at the database RLS layer for authenticated tenant users", async () => {
        const platform = await createPlatformAdminFixture();
        const firstTenantBundle = await createTenantFixture({ actor: platform.actor, plan: "growth" });
        const secondTenantBundle = await createTenantFixture({ actor: platform.actor, plan: "growth" });

        const firstSuperAdmin = await createSuperAdminFixture({
            platformActor: platform.actor,
            tenantId: firstTenantBundle.tenant.id,
            branchId: firstTenantBundle.branch.id
        });
        const firstBranchManager = await createStaffFixture({
            actor: firstSuperAdmin.actor,
            tenantId: firstTenantBundle.tenant.id,
            role: "branch_manager",
            branchIds: [firstTenantBundle.branch.id]
        });
        const secondSuperAdmin = await createSuperAdminFixture({
            platformActor: platform.actor,
            tenantId: secondTenantBundle.tenant.id,
            branchId: secondTenantBundle.branch.id
        });
        const secondBranchManager = await createStaffFixture({
            actor: secondSuperAdmin.actor,
            tenantId: secondTenantBundle.tenant.id,
            role: "branch_manager",
            branchIds: [secondTenantBundle.branch.id]
        });

        await createMemberFixture({
            actor: firstBranchManager.actor,
            branchId: firstTenantBundle.branch.id,
            tenantId: firstTenantBundle.tenant.id,
            fullName: "Tenant A Member"
        });
        await createMemberFixture({
            actor: secondBranchManager.actor,
            branchId: secondTenantBundle.branch.id,
            tenantId: secondTenantBundle.tenant.id,
            fullName: "Tenant B Member"
        });

        const rlsClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
            auth: { autoRefreshToken: false, persistSession: false }
        });
        await rlsClient.auth.signInWithPassword({
            email: firstBranchManager.email,
            password: firstBranchManager.password
        });

        const { data, error } = await rlsClient
            .from("members")
            .select("id, tenant_id, full_name")
            .eq("tenant_id", secondTenantBundle.tenant.id);

        expect(error).toBeNull();
        expect(data || []).toHaveLength(0);
    });
});
