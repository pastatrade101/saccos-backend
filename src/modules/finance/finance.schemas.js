const { z } = require("zod");

const moneyAmount = z.coerce.number().positive().multipleOf(0.01);
const paginationSchema = {
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(50)
};

const depositSchema = z.object({
    tenant_id: z.string().uuid().optional(),
    account_id: z.string().uuid(),
    amount: moneyAmount,
    teller_id: z.string().uuid().optional(),
    reference: z.string().max(80).optional().nullable(),
    description: z.string().max(255).optional().nullable(),
    receipt_ids: z.array(z.string().uuid()).max(10).optional().default([])
});

const withdrawSchema = depositSchema.extend({
    approval_request_id: z.string().uuid().optional()
});
const shareContributionSchema = depositSchema;
const dividendAllocationSchema = z.object({
    tenant_id: z.string().uuid().optional(),
    account_id: z.string().uuid(),
    amount: moneyAmount,
    user_id: z.string().uuid().optional(),
    reference: z.string().max(80).optional().nullable(),
    description: z.string().max(255).optional().nullable()
});

const transferSchema = z.object({
    tenant_id: z.string().uuid().optional(),
    from_account: z.string().uuid(),
    to_account: z.string().uuid(),
    amount: moneyAmount,
    user_id: z.string().uuid().optional(),
    reference: z.string().max(80).optional().nullable(),
    description: z.string().max(255).optional().nullable()
});

const loanDisburseSchema = z.object({
    tenant_id: z.string().uuid().optional(),
    application_id: z.string().uuid().optional(),
    approval_request_id: z.string().uuid().optional(),
    member_id: z.string().uuid(),
    branch_id: z.string().uuid(),
    principal_amount: moneyAmount,
    annual_interest_rate: z.coerce.number().min(0).max(100),
    term_count: z.coerce.number().int().positive(),
    repayment_frequency: z.enum(["daily", "weekly", "monthly"]).default("monthly"),
    disbursed_by: z.string().uuid().optional(),
    reference: z.string().max(80).optional().nullable(),
    description: z.string().max(255).optional().nullable(),
    receipt_ids: z.array(z.string().uuid()).max(10).optional().default([])
});

const loanRepaySchema = z.object({
    tenant_id: z.string().uuid().optional(),
    loan_id: z.string().uuid(),
    amount: moneyAmount,
    user_id: z.string().uuid().optional(),
    reference: z.string().max(80).optional().nullable(),
    description: z.string().max(255).optional().nullable(),
    receipt_ids: z.array(z.string().uuid()).max(10).optional().default([])
});

const statementQuerySchema = z.object({
    tenant_id: z.string().uuid().optional(),
    member_id: z.string().uuid().optional(),
    account_id: z.string().uuid().optional(),
    from_date: z.string().date().optional(),
    to_date: z.string().date().optional(),
    ...paginationSchema
});

const loanQuerySchema = z.object({
    tenant_id: z.string().uuid().optional(),
    member_id: z.string().uuid().optional(),
    loan_id: z.string().uuid().optional(),
    branch_id: z.string().uuid().optional(),
    status: z.enum(["draft", "active", "closed", "in_arrears", "written_off"]).optional(),
    ...paginationSchema
});

const ledgerQuerySchema = z.object({
    tenant_id: z.string().uuid().optional(),
    from_date: z.string().date().optional(),
    to_date: z.string().date().optional(),
    account_id: z.string().uuid().optional(),
    ...paginationSchema
});

const accrualSchema = z.object({
    tenant_id: z.string().uuid().optional(),
    as_of_date: z.string().date().optional(),
    user_id: z.string().uuid().optional()
});

const closePeriodSchema = z.object({
    tenant_id: z.string().uuid().optional(),
    period_end_date: z.string().date(),
    user_id: z.string().uuid().optional()
});

module.exports = {
    depositSchema,
    withdrawSchema,
    shareContributionSchema,
    dividendAllocationSchema,
    transferSchema,
    loanDisburseSchema,
    loanRepaySchema,
    loanQuerySchema,
    statementQuerySchema,
    ledgerQuerySchema,
    accrualSchema,
    closePeriodSchema
};
