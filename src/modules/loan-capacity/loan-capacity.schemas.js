const { z } = require("zod");

const uuid = z.string().uuid();
const money = z.coerce.number().min(0).multipleOf(0.01);
const percent = z.coerce.number().min(0).max(100);
const twoFactorFields = {
    two_factor_code: z.string().trim().regex(/^\d{6}$/).optional().nullable(),
    recovery_code: z.string().trim().min(6).max(20).optional().nullable()
};

const tenantScopedQuerySchema = z.object({
    tenant_id: uuid.optional()
});

const capacityQuerySchema = z.object({
    tenant_id: uuid.optional(),
    member_id: uuid,
    loan_product_id: uuid,
    branch_id: uuid
});

const loanProductPolicyParamSchema = z.object({
    loanProductId: uuid
});

const branchParamSchema = z.object({
    branchId: uuid
});

const dashboardQuerySchema = z.object({
    tenant_id: uuid.optional(),
    loan_product_id: uuid,
    days: z.coerce.number().int().min(7).max(90).optional()
});

const updateLoanProductPolicySchema = z.object({
    tenant_id: uuid.optional(),
    contribution_multiplier: z.coerce.number().min(0).optional(),
    max_loan_amount: money.optional(),
    min_loan_amount: money.optional(),
    liquidity_buffer_percent: percent.optional(),
    requires_guarantor: z.boolean().optional(),
    requires_collateral: z.boolean().optional(),
    ...twoFactorFields
}).refine(
    (value) => {
        if (typeof value.max_loan_amount === "number" && typeof value.min_loan_amount === "number") {
            return value.max_loan_amount >= value.min_loan_amount;
        }

        return true;
    },
    {
        message: "Maximum loan amount must be greater than or equal to minimum loan amount."
    }
);

const updateBranchLiquidityPolicySchema = z.object({
    tenant_id: uuid.optional(),
    max_lending_ratio: percent.optional(),
    minimum_liquidity_reserve: money.optional(),
    auto_loan_freeze_threshold: money.optional(),
    ...twoFactorFields
});

module.exports = {
    tenantScopedQuerySchema,
    capacityQuerySchema,
    loanProductPolicyParamSchema,
    branchParamSchema,
    dashboardQuerySchema,
    updateLoanProductPolicySchema,
    updateBranchLiquidityPolicySchema
};
