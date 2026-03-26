const { z } = require("zod");

const uuid = z.string().uuid();
const twoFactorFields = {
    two_factor_code: z.string().trim().regex(/^\d{6}$/).optional().nullable(),
    recovery_code: z.string().trim().min(6).max(20).optional().nullable()
};

const operationKeySchema = z.enum([
    "finance.withdraw",
    "finance.loan_disburse"
]);

const approvalRequestStatusSchema = z.enum([
    "pending",
    "approved",
    "rejected",
    "executed",
    "expired",
    "cancelled"
]);

const listApprovalPoliciesQuerySchema = z.object({
    tenant_id: uuid.optional()
});

const approvalPolicyParamSchema = z.object({
    operationKey: operationKeySchema
});

const updateApprovalPolicySchema = z.object({
    tenant_id: uuid.optional(),
    enabled: z.boolean().optional(),
    threshold_amount: z.coerce.number().min(0).multipleOf(0.01).optional(),
    required_checker_count: z.coerce.number().int().min(1).max(5).optional(),
    allowed_maker_roles: z.array(z.string().min(2).max(50)).min(1).max(10).optional(),
    allowed_checker_roles: z.array(z.string().min(2).max(50)).min(1).max(10).optional(),
    sla_minutes: z.coerce.number().int().min(5).max(10080).optional(),
    ...twoFactorFields
});

const listApprovalRequestsQuerySchema = z.object({
    tenant_id: uuid.optional(),
    branch_id: uuid.optional(),
    operation_key: operationKeySchema.optional(),
    status: approvalRequestStatusSchema.optional(),
    maker_user_id: uuid.optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(50)
});

const approvalRequestParamSchema = z.object({
    requestId: uuid
});

const tenantScopedLookupQuerySchema = z.object({
    tenant_id: uuid.optional()
});

const approveRequestSchema = z.object({
    tenant_id: uuid.optional(),
    notes: z.string().trim().max(1000).optional().nullable(),
    ...twoFactorFields
});

const rejectRequestSchema = z.object({
    tenant_id: uuid.optional(),
    reason: z.string().trim().min(3).max(255),
    notes: z.string().trim().max(1000).optional().nullable(),
    ...twoFactorFields
});

module.exports = {
    operationKeySchema,
    approvalRequestStatusSchema,
    listApprovalPoliciesQuerySchema,
    approvalPolicyParamSchema,
    updateApprovalPolicySchema,
    listApprovalRequestsQuerySchema,
    approvalRequestParamSchema,
    tenantScopedLookupQuerySchema,
    approveRequestSchema,
    rejectRequestSchema
};
