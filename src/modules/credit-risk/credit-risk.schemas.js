const { z } = require("zod");

const uuid = z.string().uuid();

const defaultCaseStatusSchema = z.enum([
    "delinquent",
    "in_recovery",
    "claim_ready",
    "restructured",
    "written_off",
    "recovered"
]);

const collectionActionTypeSchema = z.enum([
    "call",
    "visit",
    "notice",
    "legal_warning",
    "settlement_offer"
]);

const collectionActionStatusSchema = z.enum([
    "open",
    "completed",
    "overdue",
    "cancelled"
]);

const collectionOutcomeCodeSchema = z.enum([
    "promised_to_pay",
    "partial_paid",
    "no_contact",
    "refused",
    "escalate"
]);

const guarantorClaimStatusSchema = z.enum([
    "draft",
    "submitted",
    "approved",
    "posted",
    "partial_settled",
    "settled",
    "waived"
]);

const paginationSchema = {
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(50)
};

const defaultCaseParamSchema = z.object({
    id: uuid
});

const collectionActionParamSchema = z.object({
    actionId: uuid
});

const guarantorClaimParamSchema = z.object({
    claimId: uuid
});

const tenantScopedLookupQuerySchema = z.object({
    tenant_id: uuid.optional()
});

const listDefaultCasesQuerySchema = z.object({
    tenant_id: uuid.optional(),
    branch_id: uuid.optional(),
    member_id: uuid.optional(),
    loan_id: uuid.optional(),
    status: defaultCaseStatusSchema.optional(),
    ...paginationSchema
});

const createDefaultCaseSchema = z.object({
    tenant_id: uuid.optional(),
    loan_id: uuid,
    dpd_days: z.coerce.number().int().min(0).default(0),
    reason_code: z.string().trim().min(2).max(80),
    notes: z.string().trim().max(1000).optional().nullable()
});

const transitionDefaultCaseSchema = z.object({
    to_status: defaultCaseStatusSchema,
    reason_code: z.string().trim().min(2).max(80),
    notes: z.string().trim().max(1000).optional().nullable()
});

const listCollectionActionsQuerySchema = z.object({
    tenant_id: uuid.optional(),
    default_case_id: uuid.optional(),
    branch_id: uuid.optional(),
    loan_id: uuid.optional(),
    owner_user_id: uuid.optional(),
    status: collectionActionStatusSchema.optional(),
    action_type: collectionActionTypeSchema.optional(),
    due_from: z.string().datetime({ offset: true }).optional(),
    due_to: z.string().datetime({ offset: true }).optional(),
    ...paginationSchema
});

const createCollectionActionSchema = z.object({
    tenant_id: uuid.optional(),
    default_case_id: uuid,
    action_type: collectionActionTypeSchema,
    owner_user_id: uuid.optional().nullable(),
    due_at: z.string().datetime({ offset: true }),
    priority: z.coerce.number().int().min(1).max(5).default(3),
    notes: z.string().trim().max(1000).optional().nullable()
});

const updateCollectionActionSchema = z.object({
    owner_user_id: uuid.optional().nullable(),
    due_at: z.string().datetime({ offset: true }).optional(),
    priority: z.coerce.number().int().min(1).max(5).optional(),
    notes: z.string().trim().max(1000).optional().nullable()
});

const completeCollectionActionSchema = z.object({
    outcome_code: collectionOutcomeCodeSchema,
    notes: z.string().trim().max(1000).optional().nullable()
});

const escalateCollectionActionSchema = z.object({
    escalation_reason: z.string().trim().min(3).max(255),
    notes: z.string().trim().max(1000).optional().nullable()
});

const runDefaultDetectionSchema = z.object({
    tenant_id: uuid.optional(),
    branch_id: uuid.optional(),
    dry_run: z.boolean().optional().default(false),
    max_loans: z.coerce.number().int().positive().max(5000).optional().default(500)
});

const listGuarantorExposuresQuerySchema = z.object({
    tenant_id: uuid.optional(),
    guarantor_member_id: uuid.optional(),
    branch_id: uuid.optional(),
    ...paginationSchema
});

const recomputeGuarantorExposuresSchema = z.object({
    tenant_id: uuid.optional(),
    member_ids: z.array(uuid).max(500).optional().default([]),
    dry_run: z.boolean().optional().default(false)
});

const listGuarantorClaimsQuerySchema = z.object({
    tenant_id: uuid.optional(),
    default_case_id: uuid.optional(),
    loan_id: uuid.optional(),
    guarantor_member_id: uuid.optional(),
    branch_id: uuid.optional(),
    status: guarantorClaimStatusSchema.optional(),
    ...paginationSchema
});

const createGuarantorClaimSchema = z.object({
    tenant_id: uuid.optional(),
    default_case_id: uuid,
    guarantor_member_id: uuid,
    claim_amount: z.coerce.number().positive(),
    claim_reference: z.string().trim().max(120).optional().nullable(),
    notes: z.string().trim().max(1000).optional().nullable()
});

const submitGuarantorClaimSchema = z.object({
    claim_reference: z.string().trim().max(120).optional().nullable(),
    notes: z.string().trim().max(1000).optional().nullable()
});

const approveGuarantorClaimSchema = z.object({
    approval_request_id: uuid.optional().nullable(),
    notes: z.string().trim().max(1000).optional().nullable()
});

const rejectGuarantorClaimSchema = z.object({
    reason_code: z.string().trim().min(2).max(80),
    notes: z.string().trim().max(1000).optional().nullable()
});

const postGuarantorClaimSchema = z.object({
    posted_journal_id: uuid.optional().nullable(),
    notes: z.string().trim().max(1000).optional().nullable()
});

const settleGuarantorClaimSchema = z.object({
    settled_amount: z.coerce.number().positive(),
    reference: z.string().trim().max(120).optional().nullable(),
    notes: z.string().trim().max(1000).optional().nullable()
});

const waiveGuarantorClaimSchema = z.object({
    reason_code: z.string().trim().min(2).max(80),
    notes: z.string().trim().max(1000).optional().nullable()
});

module.exports = {
    defaultCaseParamSchema,
    collectionActionParamSchema,
    guarantorClaimParamSchema,
    tenantScopedLookupQuerySchema,
    listDefaultCasesQuerySchema,
    createDefaultCaseSchema,
    transitionDefaultCaseSchema,
    listCollectionActionsQuerySchema,
    createCollectionActionSchema,
    updateCollectionActionSchema,
    completeCollectionActionSchema,
    escalateCollectionActionSchema,
    runDefaultDetectionSchema,
    listGuarantorExposuresQuerySchema,
    recomputeGuarantorExposuresSchema,
    listGuarantorClaimsQuerySchema,
    createGuarantorClaimSchema,
    submitGuarantorClaimSchema,
    approveGuarantorClaimSchema,
    rejectGuarantorClaimSchema,
    postGuarantorClaimSchema,
    settleGuarantorClaimSchema,
    waiveGuarantorClaimSchema
};
