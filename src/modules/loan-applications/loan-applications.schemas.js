const { z } = require("zod");

const uuid = z.string().uuid();
const money = z.coerce.number().positive().multipleOf(0.01);

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
    external_reference: z.string().max(80).optional().nullable(),
    purpose: z.string().trim().min(3).max(500),
    requested_amount: money,
    requested_term_count: z.coerce.number().int().positive(),
    requested_repayment_frequency: z.enum(["daily", "weekly", "monthly"]).default("monthly"),
    requested_interest_rate: z.coerce.number().min(0).max(100).optional().nullable(),
    guarantors: z.array(guarantorSchema).max(10).optional().default([]),
    collateral_items: z.array(collateralSchema).max(10).optional().default([])
});

const updateLoanApplicationSchema = createLoanApplicationSchema.partial();

const appraiseLoanApplicationSchema = z.object({
    recommended_amount: money,
    recommended_term_count: z.coerce.number().int().positive(),
    recommended_interest_rate: z.coerce.number().min(0).max(100),
    recommended_repayment_frequency: z.enum(["daily", "weekly", "monthly"]).default("monthly"),
    risk_rating: z.enum(["low", "medium", "high"]).default("medium"),
    appraisal_notes: z.string().trim().min(3).max(1000),
    guarantors: z.array(guarantorSchema).max(10).optional().default([]),
    collateral_items: z.array(collateralSchema).max(10).optional().default([])
});

const approveLoanApplicationSchema = z.object({
    notes: z.string().trim().min(3).max(1000).optional().nullable()
});

const rejectLoanApplicationSchema = z.object({
    reason: z.string().trim().min(3).max(1000),
    notes: z.string().trim().min(3).max(1000).optional().nullable()
});

const disburseApprovedLoanSchema = z.object({
    reference: z.string().max(80).optional().nullable(),
    description: z.string().max(255).optional().nullable(),
    approval_request_id: uuid.optional(),
    receipt_ids: z.array(z.string().uuid()).max(10).optional().default([])
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

module.exports = {
    createLoanApplicationSchema,
    updateLoanApplicationSchema,
    appraiseLoanApplicationSchema,
    approveLoanApplicationSchema,
    rejectLoanApplicationSchema,
    disburseApprovedLoanSchema,
    loanApplicationQuerySchema
};
