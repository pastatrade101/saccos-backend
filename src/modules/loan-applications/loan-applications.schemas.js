const { z } = require("zod");

const uuid = z.string().uuid();
const money = z.coerce.number().positive().multipleOf(0.01);
const repaymentFrequency = z.enum(["daily", "weekly", "monthly"]);
const loanPurposePattern = /^[A-Za-z0-9\s,.]+$/;
const referencePattern = /^[A-Za-z0-9_-]+$/;
const twoFactorFields = {
    two_factor_code: z.string().trim().regex(/^\d{6}$/).optional().nullable(),
    recovery_code: z.string().trim().min(6).max(20).optional().nullable()
};

const guarantorSchema = z.object({
    member_id: uuid,
    guaranteed_amount: z.coerce.number().min(0).multipleOf(0.01).default(0),
    notes: z.string().max(255).optional().nullable()
});

const collateralSchema = z.object({
    collateral_type: z.string().trim().min(2).max(80),
    description: z.string().trim().min(3).max(255),
    valuation_amount: z.coerce.number().min(0).multipleOf(0.01).default(0),
    lien_reference: z.string().max(120).optional().nullable(),
    documents_json: z.array(z.string()).optional().default([])
});

const createLoanApplicationSchema = z.object({
    tenant_id: uuid.optional(),
    branch_id: uuid.optional(),
    member_id: uuid.optional(),
    product_id: uuid,
    external_reference: z.string().trim().max(100).regex(referencePattern, "Reference may contain only letters, numbers, dashes, and underscores.").optional().nullable(),
    purpose: z.string().trim().min(20).max(500).regex(loanPurposePattern, "Loan purpose may contain only letters, numbers, spaces, commas, and periods."),
    requested_amount: money.min(10000),
    requested_term_count: z.coerce.number().int().positive(),
    requested_repayment_frequency: repaymentFrequency.default("monthly"),
    requested_interest_rate: z.coerce.number().min(0).max(100).optional().nullable(),
    guarantors: z.array(guarantorSchema).max(10).optional().default([]),
    collateral_items: z.array(collateralSchema).max(10).optional().default([])
});

const updateLoanApplicationSchema = createLoanApplicationSchema.partial();

const appraiseLoanApplicationSchema = z.object({
    recommended_amount: money,
    recommended_term_count: z.coerce.number().int().positive(),
    recommended_interest_rate: z.coerce.number().min(0).max(100),
    recommended_repayment_frequency: repaymentFrequency.default("monthly"),
    risk_rating: z.enum(["low", "medium", "high"]).default("medium"),
    appraisal_notes: z.string().trim().min(3).max(1000),
    guarantors: z.array(guarantorSchema).max(10).optional(),
    collateral_items: z.array(collateralSchema).max(10).optional()
});

const approveLoanApplicationSchema = z.object({
    notes: z.string().trim().min(3).max(1000).optional().nullable(),
    ...twoFactorFields
});

const rejectLoanApplicationSchema = z.object({
    reason: z.string().trim().min(3).max(1000),
    notes: z.string().trim().min(3).max(1000).optional().nullable()
});

const disburseApprovedLoanSchema = z.object({
    reference: z.string().max(80).optional().nullable(),
    description: z.string().max(255).optional().nullable(),
    disbursement_channel: z.enum(["cash", "mobile_money"]).optional().default("cash"),
    recipient_msisdn: z.string().trim().min(9).max(20).optional().nullable(),
    approval_request_id: uuid.optional(),
    receipt_ids: z.array(z.string().uuid()).max(10).optional().default([]),
    ...twoFactorFields
});

const loanDisbursementOrderParamSchema = z.object({
    orderId: uuid
});

const loanApplicationParamSchema = z.object({
    id: uuid
});

const loanApplicationQuerySchema = z.object({
    tenant_id: uuid.optional(),
    status: z.enum(["draft", "submitted", "appraised", "approved", "rejected", "disbursed", "cancelled"]).optional(),
    member_id: uuid.optional(),
    branch_id: uuid.optional(),
    product_id: uuid.optional(),
    cursor: z.string().datetime({ offset: true }).optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(50)
});

const guarantorRequestsQuerySchema = z.object({
    tenant_id: uuid.optional(),
    status: z.enum(["pending", "accepted", "rejected"]).optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(50)
});

const guarantorConsentSchema = z.object({
    tenant_id: uuid.optional(),
    decision: z.enum(["accepted", "rejected"]),
    notes: z.string().trim().min(2).max(255).optional().nullable()
});

module.exports = {
    createLoanApplicationSchema,
    updateLoanApplicationSchema,
    appraiseLoanApplicationSchema,
    approveLoanApplicationSchema,
    rejectLoanApplicationSchema,
    disburseApprovedLoanSchema,
    loanApplicationParamSchema,
    loanDisbursementOrderParamSchema,
    loanApplicationQuerySchema,
    guarantorRequestsQuerySchema,
    guarantorConsentSchema
};
