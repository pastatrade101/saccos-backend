// eslint-disable-next-line @typescript-eslint/no-var-requires
const postingRuleService = require("../../src/services/posting-rule.service");

import { createTenantFixture } from "../helpers/factories";
import { query } from "../helpers/db";

describe("database procedures: tenant default seeding", () => {
    it("seeds core chart of accounts and posting rules for a new tenant", async () => {
        const { tenant } = await createTenantFixture();

        const accounts = await query<{ system_tag: string }>(
            `
            select system_tag
            from public.chart_of_accounts
            where tenant_id = $1
              and deleted_at is null
            `,
            [tenant.id]
        );

        const systemTags = accounts.rows.map((row) => row.system_tag);

        expect(systemTags).toEqual(
            expect.arrayContaining([
                "cash_on_hand",
                "member_savings_control",
                "member_share_capital_control",
                "loan_portfolio",
                "interest_receivable",
                "loan_interest_income",
                "retained_earnings",
                "dividends_payable"
            ])
        );

        await expect(postingRuleService.assertPostingRuleConfigured(tenant.id, "deposit")).resolves.toBeUndefined();
        await expect(postingRuleService.assertPostingRuleConfigured(tenant.id, "withdrawal")).resolves.toBeUndefined();
        await expect(postingRuleService.assertPostingRuleConfigured(tenant.id, "membership_fee")).resolves.toBeUndefined();
        await expect(postingRuleService.assertPostingRuleConfigured(tenant.id, "loan_disburse")).resolves.toBeUndefined();
        await expect(postingRuleService.assertPostingRuleConfigured(tenant.id, "loan_repay_principal")).resolves.toBeUndefined();
        await expect(postingRuleService.assertPostingRuleConfigured(tenant.id, "dividend_pay_cash")).resolves.toBeUndefined();
    });
});
