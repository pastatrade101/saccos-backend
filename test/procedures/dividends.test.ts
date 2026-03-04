// eslint-disable-next-line @typescript-eslint/no-var-requires
const dividendsService = require("../../src/modules/dividends/dividends.service");

import { assertJournalBalanced } from "../helpers/assertions";
import { buildActorForUser, createMemberFixture, createPlatformAdminFixture, createStaffFixture, createSuperAdminFixture, createTenantFixture } from "../helpers/factories";
import { queryOne } from "../helpers/db";

describe("database procedures: dividend approval and payment", () => {
    it("approves and pays an allocated dividend cycle with balanced journals", async () => {
        const platform = await createPlatformAdminFixture();
        const { tenant, branch } = await createTenantFixture({ actor: platform.actor, plan: "growth" });
        const superAdmin = await createSuperAdminFixture({
            platformActor: platform.actor,
            tenantId: tenant.id,
            branchId: branch.id
        });
        const maker = await createStaffFixture({
            actor: superAdmin.actor,
            tenantId: tenant.id,
            role: "branch_manager",
            branchIds: [branch.id],
            fullName: "Dividend Maker"
        });
        const checker = await createStaffFixture({
            actor: superAdmin.actor,
            tenantId: tenant.id,
            role: "branch_manager",
            branchIds: [branch.id],
            fullName: "Dividend Checker"
        });
        const member = await createMemberFixture({
            actor: maker.actor,
            branchId: branch.id,
            tenantId: tenant.id
        });

        await queryOne<{ result: any }>(
            `select public.share_contribution($1, $2, $3, $4, $5, $6) as result`,
            [tenant.id, member.shareAccountId, 250000, maker.user.id, "SHARE-001", "Seed share capital"]
        );

        const accounts = await queryOne<{
            retained_earnings_account_id: string;
            dividends_payable_account_id: string;
            payout_account_id: string;
        }>(
            `
            select
                (select id from public.chart_of_accounts where tenant_id = $1 and system_tag = 'retained_earnings' and deleted_at is null limit 1) as retained_earnings_account_id,
                (select id from public.chart_of_accounts where tenant_id = $1 and system_tag = 'dividends_payable' and deleted_at is null limit 1) as dividends_payable_account_id,
                (select default_cash_account_id from public.tenant_settings where tenant_id = $1) as payout_account_id
            `,
            [tenant.id]
        );

        const cycle = await dividendsService.createCycle(maker.actor, {
            tenant_id: tenant.id,
            branch_id: branch.id,
            period_label: "FY2026 Test",
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
                    retained_earnings_account_id: accounts.retained_earnings_account_id,
                    dividends_payable_account_id: accounts.dividends_payable_account_id,
                    payout_account_id: accounts.payout_account_id,
                    eligibility_rules_json: {},
                    rounding_rules_json: {}
                }
            ]
        });

        await dividendsService.freezeCycle(maker.actor, cycle.id);
        await dividendsService.allocateCycle(maker.actor, cycle.id);

        const approval = await queryOne<{ result: any }>(
            `select public.approve_dividend_cycle($1, $2, $3, $4) as result`,
            [cycle.id, checker.user.id, "Checker approval", "sig-checker"]
        );

        expect(approval.result.success).toBe(true);
        await assertJournalBalanced(approval.result.journal_id);

        const payment = await queryOne<{ result: any }>(
            `select public.pay_dividend_cycle($1, $2, $3, $4, $5) as result`,
            [cycle.id, "cash", checker.user.id, "DIV-PAY-001", "Dividend payment batch"]
        );

        expect(payment.result.success).toBe(true);
        await assertJournalBalanced(payment.result.journal_id);

        const updatedCycle = await dividendsService.getCycle(await buildActorForUser(checker.user.id), cycle.id);
        expect(updatedCycle.cycle.status).toBe("paid");
    });
});
