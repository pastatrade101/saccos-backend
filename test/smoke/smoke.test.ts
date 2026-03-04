import request from "supertest";

const app = require("../../src/app");

import { signInForToken } from "../helpers/supabaseAdmin";
import { query, queryOne } from "../helpers/db";
import { createPlatformAdminFixture } from "../helpers/factories";

describe("smoke test: production happy path", () => {
    it("runs through tenant setup, staff provisioning, member onboarding, cash, loans, dividends, and exports", async () => {
        const platform = await createPlatformAdminFixture();

        const createTenant = await request(app)
            .post("/api/tenants")
            .set("Authorization", `Bearer ${platform.token}`)
            .send({
                name: `Smoke Tenant ${Date.now()}`,
                registration_number: `SMOKE-${Date.now()}`,
                plan: "growth",
                subscription_status: "active",
                status: "active",
                start_at: "2026-01-01T00:00:00.000Z",
                expires_at: "2027-01-01T00:00:00.000Z"
            });

        expect(createTenant.status).toBe(201);
        const tenantId = createTenant.body.data.id as string;

        const headOfficeBranch = await queryOne<{ id: string }>(
            `select id from public.branches where tenant_id = $1 order by created_at asc limit 1`,
            [tenantId]
        );

        const createSuperAdmin = await request(app)
            .post("/api/users/setup-super-admin")
            .set("Authorization", `Bearer ${platform.token}`)
            .send({
                tenant_id: tenantId,
                branch_id: headOfficeBranch.id,
                email: `super-admin-${Date.now()}@example.test`,
                full_name: "Smoke Super Admin",
                phone: "+255700000050",
                send_invite: false,
                password: "SmokePass123!"
            });

        expect(createSuperAdmin.status).toBe(201);
        const superAdminEmail = createSuperAdmin.body.data.user.email;
        const superAdminToken = await signInForToken(superAdminEmail, "SmokePass123!");

        const createBranch = await request(app)
            .post("/api/branches")
            .set("Authorization", `Bearer ${superAdminToken}`)
            .send({
                tenant_id: tenantId,
                name: "Smoke Operations Branch",
                code: `SMK${String(Date.now()).slice(-4)}`,
                address_line1: "Operations Street",
                city: "Dar es Salaam",
                state: "Dar es Salaam",
                country: "Tanzania"
            });

        expect(createBranch.status).toBe(201);
        const branchId = createBranch.body.data.id as string;

        const createBranchManager = await request(app)
            .post("/api/users")
            .set("Authorization", `Bearer ${superAdminToken}`)
            .send({
                tenant_id: tenantId,
                email: `branch-manager-${Date.now()}@example.test`,
                full_name: "Smoke Branch Manager",
                phone: "+255700000051",
                role: "branch_manager",
                branch_ids: [branchId],
                send_invite: false,
                password: "SmokePass123!"
            });

        expect(createBranchManager.status).toBe(201);

        const branchManagerToken = await signInForToken(createBranchManager.body.data.user.email, "SmokePass123!");

        const createTeller = await request(app)
            .post("/api/users")
            .set("Authorization", `Bearer ${branchManagerToken}`)
            .send({
                tenant_id: tenantId,
                email: `teller-${Date.now()}@example.test`,
                full_name: "Smoke Teller",
                phone: "+255700000052",
                role: "teller",
                branch_ids: [branchId],
                send_invite: false,
                password: "SmokePass123!"
            });
        const createLoanOfficer = await request(app)
            .post("/api/users")
            .set("Authorization", `Bearer ${branchManagerToken}`)
            .send({
                tenant_id: tenantId,
                email: `loan-officer-${Date.now()}@example.test`,
                full_name: "Smoke Loan Officer",
                phone: "+255700000053",
                role: "loan_officer",
                branch_ids: [branchId],
                send_invite: false,
                password: "SmokePass123!"
            });
        const createAuditor = await request(app)
            .post("/api/users")
            .set("Authorization", `Bearer ${branchManagerToken}`)
            .send({
                tenant_id: tenantId,
                email: `auditor-${Date.now()}@example.test`,
                full_name: "Smoke Auditor",
                phone: "+255700000054",
                role: "auditor",
                branch_ids: [branchId],
                send_invite: false,
                password: "SmokePass123!"
            });

        expect(createTeller.status).toBe(201);
        expect(createLoanOfficer.status).toBe(201);
        expect(createAuditor.status).toBe(201);

        const tellerToken = await signInForToken(createTeller.body.data.user.email, "SmokePass123!");
        const loanOfficerToken = await signInForToken(createLoanOfficer.body.data.user.email, "SmokePass123!");
        const auditorToken = await signInForToken(createAuditor.body.data.user.email, "SmokePass123!");

        const createMember = await request(app)
            .post("/api/members")
            .set("Authorization", `Bearer ${branchManagerToken}`)
            .send({
                tenant_id: tenantId,
                branch_id: branchId,
                full_name: "Smoke Member",
                phone: "+255711111120",
                email: `member-${Date.now()}@example.test`,
                member_no: `SMK-MBR-${Date.now()}`,
                national_id: `NIDA-${Date.now()}`,
                address_line1: "Member Street",
                city: "Moshi",
                state: "Kilimanjaro",
                country: "Tanzania",
                status: "active",
                kyc_status: "verified"
            });

        expect(createMember.status).toBe(201);
        const memberId = createMember.body.data.member.id as string;

        const accounts = await request(app)
            .get("/api/members/accounts")
            .set("Authorization", `Bearer ${branchManagerToken}`);

        const savingsAccount = accounts.body.data.find((account: any) => account.member_id === memberId && account.product_type === "savings");
        const shareAccount = accounts.body.data.find((account: any) => account.member_id === memberId && account.product_type === "shares");

        expect(savingsAccount).toBeTruthy();
        expect(shareAccount).toBeTruthy();

        const openSession = await request(app)
            .post("/api/cash-control/sessions/open")
            .set("Authorization", `Bearer ${tellerToken}`)
            .send({
                branch_id: branchId,
                opening_cash: 1000000
            });

        expect(openSession.status).toBe(201);

        const deposit = await request(app)
            .post("/api/deposit")
            .set("Authorization", `Bearer ${tellerToken}`)
            .send({
                tenant_id: tenantId,
                account_id: savingsAccount.id,
                amount: 250000,
                reference: "SMOKE-DEP-001"
            });

        expect(deposit.status).toBe(201);

        const withdrawal = await request(app)
            .post("/api/withdraw")
            .set("Authorization", `Bearer ${tellerToken}`)
            .send({
                tenant_id: tenantId,
                account_id: savingsAccount.id,
                amount: 50000,
                reference: "SMOKE-WDL-001"
            });

        expect(withdrawal.status).toBe(201);

        const shareContribution = await request(app)
            .post("/api/share-contribution")
            .set("Authorization", `Bearer ${superAdminToken}`)
            .send({
                tenant_id: tenantId,
                account_id: shareAccount.id,
                amount: 150000,
                reference: "SMOKE-SHARE-001"
            });

        expect(shareContribution.status).toBe(201);

        const disburseLoan = await request(app)
            .post("/api/loan/disburse")
            .set("Authorization", `Bearer ${loanOfficerToken}`)
            .send({
                tenant_id: tenantId,
                member_id: memberId,
                branch_id: branchId,
                principal_amount: 800000,
                annual_interest_rate: 12,
                term_count: 6,
                repayment_frequency: "monthly",
                reference: "SMOKE-LOAN-001"
            });

        expect(disburseLoan.status).toBe(201);
        const loanId = disburseLoan.body.data.loan_id as string;

        const repayLoan = await request(app)
            .post("/api/loan/repay")
            .set("Authorization", `Bearer ${tellerToken}`)
            .send({
                tenant_id: tenantId,
                loan_id: loanId,
                amount: 120000,
                reference: "SMOKE-REPAY-001"
            });

        expect(repayLoan.status).toBe(201);

        const checker = await request(app)
            .post("/api/users")
            .set("Authorization", `Bearer ${superAdminToken}`)
            .send({
                tenant_id: tenantId,
                email: `checker-${Date.now()}@example.test`,
                full_name: "Smoke Dividend Checker",
                phone: "+255700000055",
                role: "branch_manager",
                branch_ids: [branchId],
                send_invite: false,
                password: "SmokePass123!"
            });

        expect(checker.status).toBe(201);
        const checkerToken = await signInForToken(checker.body.data.user.email, "SmokePass123!");

        const dividendOptions = await request(app)
            .get("/api/dividends/options")
            .set("Authorization", `Bearer ${branchManagerToken}`);

        const retainedEarnings = dividendOptions.body.data.accounts.find((account: any) => account.system_tag === "retained_earnings");
        const dividendsPayable = dividendOptions.body.data.accounts.find((account: any) => account.system_tag === "dividends_payable");
        const cashAccount = dividendOptions.body.data.accounts.find((account: any) => account.system_tag === "cash_on_hand");

        const createCycle = await request(app)
            .post("/api/dividends/cycles")
            .set("Authorization", `Bearer ${branchManagerToken}`)
            .send({
                tenant_id: tenantId,
                branch_id: branchId,
                period_label: `FY2026 Smoke ${Date.now()}`,
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

        expect(createCycle.status).toBe(201);
        const cycleId = createCycle.body.data.id as string;

        await request(app)
            .post(`/api/dividends/cycles/${cycleId}/freeze`)
            .set("Authorization", `Bearer ${branchManagerToken}`)
            .send()
            .expect(200);
        await request(app)
            .post(`/api/dividends/cycles/${cycleId}/allocate`)
            .set("Authorization", `Bearer ${branchManagerToken}`)
            .send()
            .expect(200);
        await request(app)
            .post(`/api/dividends/cycles/${cycleId}/approve`)
            .set("Authorization", `Bearer ${checkerToken}`)
            .send({ notes: "Checker approval" })
            .expect(200);
        await request(app)
            .post(`/api/dividends/cycles/${cycleId}/pay`)
            .set("Authorization", `Bearer ${branchManagerToken}`)
            .send({
                payment_method: "cash",
                reference: "SMOKE-DIV-PAY-001"
            })
            .expect(200);

        const exportReport = await request(app)
            .get("/api/reports/trial-balance/export")
            .set("Authorization", `Bearer ${auditorToken}`)
            .query({
                tenant_id: tenantId,
                format: "csv"
            });

        expect(exportReport.status).toBe(200);
        expect(exportReport.text).toContain("account_code");

        const loanRecords = await query(
            `select id from public.loans where tenant_id = $1 and id = $2`,
            [tenantId, loanId]
        );
        expect(loanRecords.rows).toHaveLength(1);
    });
});
