const { z } = require("zod");

const componentSchema = z.object({
    type: z.enum(["share_dividend", "savings_interest_bonus", "patronage_refund"]),
    basis_method: z.enum([
        "end_balance",
        "average_daily_balance",
        "average_monthly_balance",
        "minimum_balance",
        "total_interest_paid",
        "total_fees_paid",
        "transaction_volume"
    ]),
    distribution_mode: z.enum(["rate", "fixed_pool"]),
    rate_percent: z.coerce.number().min(0).max(100).optional().nullable(),
    pool_amount: z.coerce.number().min(0).optional().nullable(),
    retained_earnings_account_id: z.string().uuid(),
    dividends_payable_account_id: z.string().uuid(),
    payout_account_id: z.string().uuid().optional().nullable(),
    reserve_account_id: z.string().uuid().optional().nullable(),
    eligibility_rules_json: z.record(z.string(), z.any()).default({}),
    rounding_rules_json: z.record(z.string(), z.any()).default({})
}).superRefine((value, ctx) => {
    if (value.distribution_mode === "rate" && (value.rate_percent === null || value.rate_percent === undefined)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Rate percent is required for RATE distribution.",
            path: ["rate_percent"]
        });
    }

    if (value.distribution_mode === "fixed_pool" && (value.pool_amount === null || value.pool_amount === undefined)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Pool amount is required for FIXED POOL distribution.",
            path: ["pool_amount"]
        });
    }
});

const createCycleSchema = z.object({
    tenant_id: z.string().uuid().optional(),
    branch_id: z.string().uuid().optional().nullable(),
    period_label: z.string().min(3).max(60),
    start_date: z.string().date(),
    end_date: z.string().date(),
    declaration_date: z.string().date(),
    record_date: z.string().date().optional().nullable(),
    payment_date: z.string().date().optional().nullable(),
    required_checker_count: z.coerce.number().int().min(1).max(5).default(1),
    components: z.array(componentSchema).min(1).max(6)
});

const updateCycleSchema = createCycleSchema.omit({
    tenant_id: true
}).partial();

const cycleQuerySchema = z.object({
    tenant_id: z.string().uuid().optional(),
    status: z.enum(["draft", "frozen", "allocated", "approved", "paid", "closed"]).optional()
});

const cycleParamSchema = z.object({
    id: z.string().uuid()
});

const approvalSchema = z.object({
    notes: z.string().max(500).optional().nullable(),
    signature_hash: z.string().max(255).optional().nullable()
});

const paymentSchema = z.object({
    payment_method: z.enum(["cash", "bank", "mobile_money", "reinvest_to_shares"]),
    reference: z.string().max(80).optional().nullable(),
    description: z.string().max(255).optional().nullable()
});

module.exports = {
    createCycleSchema,
    updateCycleSchema,
    cycleQuerySchema,
    cycleParamSchema,
    approvalSchema,
    paymentSchema
};
