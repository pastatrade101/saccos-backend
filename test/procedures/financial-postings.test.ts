import { assertJournalBalanced } from "../helpers/assertions";
import { createMemberFixture, createPlatformAdminFixture, createStaffFixture, createSuperAdminFixture, createTenantFixture } from "../helpers/factories";
import { queryOne } from "../helpers/db";

describe("database procedures: deposits, withdrawals, and loans", () => {
    it("posts balanced deposit and withdrawal journal entries directly through SQL procedures", async () => {
        const platform = await createPlatformAdminFixture();
        const { tenant, branch } = await createTenantFixture({ actor: platform.actor });
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

        const deposit = await queryOne<{ result: any }>(
            `select public.deposit($1, $2, $3, $4, $5, $6) as result`,
            [tenant.id, member.savingsAccountId, 100000, teller.user.id, "DEP-TEST-001", "Procedure deposit test"]
        );

        expect(deposit.result.success).toBe(true);
        await assertJournalBalanced(deposit.result.journal_id);

        const withdrawal = await queryOne<{ result: any }>(
            `select public.withdraw($1, $2, $3, $4, $5, $6) as result`,
            [tenant.id, member.savingsAccountId, 25000, teller.user.id, "WDL-TEST-001", "Procedure withdrawal test"]
        );

        expect(withdrawal.result.success).toBe(true);
        await assertJournalBalanced(withdrawal.result.journal_id);

        const balance = await queryOne<{ available_balance: string }>(
            `select available_balance::text from public.member_accounts where id = $1`,
            [member.savingsAccountId]
        );

        expect(Number(balance.available_balance)).toBeCloseTo(75000, 2);
    });

    it("disburses and repays a loan through SQL procedures with balanced journals and updated balances", async () => {
        const platform = await createPlatformAdminFixture();
        const { tenant, branch } = await createTenantFixture({ actor: platform.actor });
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
        const loanOfficer = await createStaffFixture({
            actor: branchManager.actor,
            tenantId: tenant.id,
            role: "loan_officer",
            branchIds: [branch.id]
        });
        const member = await createMemberFixture({
            actor: branchManager.actor,
            branchId: branch.id,
            tenantId: tenant.id
        });

        const disbursement = await queryOne<{ result: any }>(
            `select public.loan_disburse($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) as result`,
            [
                tenant.id,
                member.member.id,
                branch.id,
                1200000,
                12,
                12,
                "monthly",
                loanOfficer.user.id,
                "LN-DISB-001",
                "Procedure loan disbursement"
            ]
        );

        expect(disbursement.result.success).toBe(true);
        await assertJournalBalanced(disbursement.result.journal_id);

        const repayment = await queryOne<{ result: any }>(
            `select public.loan_repayment($1, $2, $3, $4, $5, $6) as result`,
            [
                tenant.id,
                disbursement.result.loan_id,
                150000,
                loanOfficer.user.id,
                "LN-REPAY-001",
                "Procedure loan repayment"
            ]
        );

        expect(repayment.result.success).toBe(true);
        await assertJournalBalanced(repayment.result.journal_id);

        const loanBalance = await queryOne<{ outstanding_principal: string }>(
            `select outstanding_principal::text from public.loans where id = $1`,
            [disbursement.result.loan_id]
        );

        expect(Number(loanBalance.outstanding_principal)).toBeLessThan(1200000);
    });
});
