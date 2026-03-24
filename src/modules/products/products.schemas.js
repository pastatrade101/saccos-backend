const { z } = require("zod");

const uuid = z.string().uuid();
const optionalString = z.string().trim().min(1).max(500).optional().nullable();

const savingsProductSchema = z.object({
    code: z.string().trim().min(2).max(40),
    name: z.string().trim().min(3).max(120),
    is_compulsory: z.boolean().default(true),
    is_default: z.boolean().default(false),
    min_opening_balance: z.coerce.number().min(0).default(0),
    min_balance: z.coerce.number().min(0).default(0),
    maximum_account_balance: z.coerce.number().min(0).optional().nullable(),
    withdrawal_notice_days: z.coerce.number().int().min(0).default(0),
    allow_withdrawals: z.boolean().default(true),
    annual_interest_rate: z.coerce.number().min(0).max(100).default(0),
    interest_calculation_method: z
        .enum(["daily_balance", "average_balance", "monthly_balance"])
        .default("daily_balance"),
    interest_expense_account_id: uuid,
    withdrawal_fee_type: z.enum(["flat", "percentage"]).default("flat"),
    withdrawal_fee_amount: z.coerce.number().min(0).optional().nullable(),
    withdrawal_fee_percent: z.coerce.number().min(0).max(100).optional().nullable(),
    minimum_withdrawal_amount: z.coerce.number().min(0).optional().nullable(),
    maximum_withdrawal_amount: z.coerce.number().min(0).optional().nullable(),
    dormant_after_days: z.coerce.number().int().min(0).optional().nullable(),
    account_opening_fee: z.coerce.number().min(0).optional().nullable(),
    status: z.enum(["active", "inactive"]).default("active"),
    liability_account_id: uuid,
    fee_income_account_id: uuid.optional().nullable()
});

const shareProductSchema = z.object({
    code: z.string().trim().min(2).max(40),
    name: z.string().trim().min(3).max(120),
    is_compulsory: z.boolean().default(true),
    is_default: z.boolean().default(false),
    minimum_shares: z.coerce.number().min(0).default(0),
    maximum_shares: z.coerce.number().min(0).optional().nullable(),
    allow_refund: z.boolean().default(false),
    status: z.enum(["active", "inactive"]).default("active"),
    equity_account_id: uuid,
    fee_income_account_id: uuid.optional().nullable()
});

const loanProductSchema = z.object({
    code: z.string().trim().min(2).max(40),
    name: z.string().trim().min(3).max(120),
    description: optionalString,
    interest_method: z.enum(["reducing_balance", "flat"]).default("reducing_balance"),
    annual_interest_rate: z.coerce.number().min(0).max(100).default(18),
    min_amount: z.coerce.number().min(0).default(0),
    max_amount: z.coerce.number().min(0).optional().nullable(),
    min_term_count: z.coerce.number().int().positive().default(1),
    max_term_count: z.coerce.number().int().positive().optional().nullable(),
    insurance_rate: z.coerce.number().min(0).default(0),
    required_guarantors_count: z.coerce.number().int().min(0).default(0),
    repayment_frequency: z.enum(["daily", "weekly", "monthly", "bi_weekly", "quarterly"]).default("monthly"),
    term_unit: z.enum(["months", "weeks"]).default("months"),
    processing_fee_type: z.enum(["flat", "percentage"]).default("flat"),
    processing_fee_amount: z.coerce.number().min(0).optional().nullable(),
    processing_fee_percent: z.coerce.number().min(0).max(100).optional().nullable(),
    eligibility_rules_json: z.record(z.string(), z.any()).optional().default({}),
    processing_fee_rule_id: uuid.optional().nullable(),
    penalty_rule_id: uuid.optional().nullable(),
    receivable_account_id: uuid,
    interest_income_account_id: uuid,
    fee_income_account_id: uuid.optional().nullable(),
    penalty_income_account_id: uuid.optional().nullable(),
    maximum_loan_multiple: z.coerce.number().min(0).default(3),
    minimum_membership_duration_months: z.coerce.number().int().min(0).default(0),
    allow_early_repayment: z.boolean().default(true),
    early_settlement_fee_percent: z.coerce.number().min(0).max(100).optional().nullable(),
    is_default: z.boolean().default(false),
    status: z.enum(["active", "inactive"]).default("active")
});

const feeRuleSchema = z.object({
    code: z.string().trim().min(2).max(60),
    name: z.string().trim().min(3).max(120),
    fee_type: z.enum(["membership_fee", "withdrawal_fee", "loan_processing_fee", "other"]),
    calculation_method: z.enum(["flat", "percentage", "percentage_per_period"]),
    flat_amount: z.coerce.number().min(0).default(0),
    percentage_value: z.coerce.number().min(0).default(0),
    is_active: z.boolean().default(true),
    income_account_id: uuid
});

const penaltyRuleSchema = z.object({
    code: z.string().trim().min(2).max(60),
    name: z.string().trim().min(3).max(120),
    penalty_type: z.enum(["late_repayment", "arrears", "other"]),
    calculation_method: z.enum(["flat", "percentage", "percentage_per_period"]),
    flat_amount: z.coerce.number().min(0).default(0),
    percentage_value: z.coerce.number().min(0).default(0),
    is_active: z.boolean().default(true),
    income_account_id: uuid
});

const postingRuleSchema = z.object({
    operation_code: z.string().trim().min(2).max(80),
    scope: z.enum(["general", "savings", "shares", "loans", "dividends", "membership"]).default("general"),
    description: optionalString,
    debit_account_id: uuid,
    credit_account_id: uuid,
    is_active: z.boolean().default(true),
    metadata: z.record(z.string(), z.any()).optional().default({})
});

const listProductsQuerySchema = z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(50)
});

module.exports = {
    listProductsQuerySchema,
    savingsProductSchema,
    updateSavingsProductSchema: savingsProductSchema.partial(),
    loanProductSchema,
    updateLoanProductSchema: loanProductSchema.partial(),
    shareProductSchema,
    updateShareProductSchema: shareProductSchema.partial(),
    feeRuleSchema,
    updateFeeRuleSchema: feeRuleSchema.partial(),
    penaltyRuleSchema,
    updatePenaltyRuleSchema: penaltyRuleSchema.partial(),
    postingRuleSchema,
    updatePostingRuleSchema: postingRuleSchema.partial()
};
