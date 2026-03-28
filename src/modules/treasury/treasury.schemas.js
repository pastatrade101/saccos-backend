const { z } = require("zod");

const uuid = z.string().uuid();
const money = z.coerce.number().min(0).multipleOf(0.01);
const units = z.coerce.number().positive();
const twoFactorFields = {
    two_factor_code: z.string().trim().regex(/^\d{6}$/).optional().nullable(),
    recovery_code: z.string().trim().min(6).max(20).optional().nullable()
};

const tenantScopedQuerySchema = z.object({
    tenant_id: uuid.optional()
});

const orderStatusSchema = z.enum([
    "draft",
    "pending_review",
    "pending_approval",
    "approved",
    "rejected",
    "executed",
    "cancelled"
]);

const transactionTypeSchema = z.enum([
    "buy",
    "sell",
    "dividend",
    "interest"
]);

const incomeTypeSchema = z.enum([
    "dividend",
    "interest",
    "capital_gain"
]);

const assetIdParamSchema = z.object({
    assetId: uuid
});

const orderIdParamSchema = z.object({
    orderId: uuid
});

const listPortfolioQuerySchema = tenantScopedQuerySchema;

const listAssetsQuerySchema = tenantScopedQuerySchema;

const listOrdersQuerySchema = z.object({
    tenant_id: uuid.optional(),
    status: orderStatusSchema.optional(),
    asset_id: uuid.optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(25)
});

const listTransactionsQuerySchema = z.object({
    tenant_id: uuid.optional(),
    asset_id: uuid.optional(),
    transaction_type: transactionTypeSchema.optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(25)
});

const listIncomeQuerySchema = z.object({
    tenant_id: uuid.optional(),
    asset_id: uuid.optional(),
    income_type: incomeTypeSchema.optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(25)
});

const listAuditLogQuerySchema = z.object({
    tenant_id: uuid.optional(),
    action: z.string().trim().max(120).optional(),
    entity_type: z.string().trim().max(120).optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(25)
});

const createAssetSchema = z.object({
    tenant_id: uuid.optional(),
    asset_name: z.string().trim().min(2).max(120),
    asset_type: z.string().trim().min(2).max(80),
    symbol: z.string().trim().min(1).max(30).optional().nullable(),
    market: z.string().trim().min(2).max(80).optional().nullable(),
    currency: z.string().trim().min(3).max(10).optional(),
    status: z.enum(["active", "inactive"]).optional(),
    asset_account_id: uuid.optional().nullable(),
    income_account_id: uuid.optional().nullable()
});

const updatePolicySchema = z.object({
    tenant_id: uuid.optional(),
    liquidity_reserve_ratio: z.coerce.number().positive().optional(),
    minimum_liquidity_reserve: money.optional(),
    minimum_cash_buffer: money.optional(),
    loan_liquidity_protection_ratio: z.coerce.number().min(0).max(100).optional(),
    max_asset_allocation_percent: z.coerce.number().positive().optional().nullable(),
    max_single_asset_percent: z.coerce.number().positive().optional().nullable(),
    max_single_order_amount: money.optional().nullable(),
    approval_threshold: money.optional().nullable(),
    settlement_account_id: uuid.optional().nullable(),
    investment_control_account_id: uuid.optional().nullable(),
    investment_income_account_id: uuid.optional().nullable(),
    valuation_update_frequency_days: z.coerce.number().int().min(1).max(365).optional(),
    change_reason: z.string().trim().min(8).max(500),
    ...twoFactorFields
}).superRefine((value, context) => {
    const normalizedReserveRatio = value.liquidity_reserve_ratio == null
        ? null
        : (Number(value.liquidity_reserve_ratio) <= 1 ? Number(value.liquidity_reserve_ratio) * 100 : Number(value.liquidity_reserve_ratio));

    if (normalizedReserveRatio != null && (normalizedReserveRatio < 10 || normalizedReserveRatio > 80)) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["liquidity_reserve_ratio"],
            message: "Liquidity reserve ratio must be between 10% and 80%."
        });
    }

    const normalizedAssetAllocation = value.max_asset_allocation_percent == null
        ? null
        : (Number(value.max_asset_allocation_percent) <= 1 ? Number(value.max_asset_allocation_percent) * 100 : Number(value.max_asset_allocation_percent));

    if (normalizedAssetAllocation != null && (normalizedAssetAllocation < 10 || normalizedAssetAllocation > 100)) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["max_asset_allocation_percent"],
            message: "Maximum asset allocation must be between 10% and 100%."
        });
    }

    const normalizedSingleAsset = value.max_single_asset_percent == null
        ? null
        : (Number(value.max_single_asset_percent) <= 1 ? Number(value.max_single_asset_percent) * 100 : Number(value.max_single_asset_percent));

    if (normalizedSingleAsset != null && normalizedAssetAllocation != null && normalizedSingleAsset > normalizedAssetAllocation) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["max_single_asset_percent"],
            message: "Maximum single asset concentration cannot exceed the maximum asset allocation."
        });
    }
});

const createOrderSchema = z.object({
    tenant_id: uuid.optional(),
    branch_id: uuid.optional().nullable(),
    asset_id: uuid,
    order_type: z.enum(["buy", "sell"]),
    units,
    unit_price: money,
    total_amount: money.optional(),
    order_date: z.string().date().optional(),
    reference: z.string().trim().min(4).max(80).optional().nullable(),
    notes: z.string().trim().max(1000).optional().nullable()
});

const reviewOrderSchema = z.object({
    tenant_id: uuid.optional(),
    decision: z.enum(["approved", "rejected"]),
    reason: z.string().trim().min(3).max(255).optional().nullable(),
    notes: z.string().trim().max(1000).optional().nullable()
}).superRefine((value, context) => {
    if (value.decision === "rejected" && !value.reason) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["reason"],
            message: "Reason is required when rejecting a treasury order."
        });
    }
});

const executeOrderSchema = z.object({
    tenant_id: uuid.optional(),
    transaction_date: z.string().date().optional(),
    reference: z.string().trim().min(4).max(80).optional().nullable(),
    ...twoFactorFields
});

const recordIncomeSchema = z.object({
    tenant_id: uuid.optional(),
    asset_id: uuid,
    income_type: incomeTypeSchema,
    amount: money,
    received_date: z.string().date().optional(),
    description: z.string().trim().max(500).optional().nullable(),
    reference: z.string().trim().min(4).max(80).optional().nullable()
});

const updateValuationSchema = z.object({
    tenant_id: uuid.optional(),
    current_price: money,
    valued_at: z.string().datetime().optional().nullable()
});

module.exports = {
    tenantScopedQuerySchema,
    listAssetsQuerySchema,
    listPortfolioQuerySchema,
    listOrdersQuerySchema,
    listTransactionsQuerySchema,
    listIncomeQuerySchema,
    listAuditLogQuerySchema,
    assetIdParamSchema,
    orderIdParamSchema,
    createAssetSchema,
    updatePolicySchema,
    createOrderSchema,
    reviewOrderSchema,
    executeOrderSchema,
    recordIncomeSchema,
    updateValuationSchema
};
