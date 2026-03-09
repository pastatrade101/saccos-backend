const { z } = require("zod");

const money = z.coerce.number().min(0).multipleOf(0.01);

const sessionQuerySchema = z.object({
    date: z.string().date().optional(),
    branch_id: z.string().uuid().optional(),
    teller_user_id: z.string().uuid().optional(),
    status: z.enum(["open", "closed_pending_review", "reviewed"]).optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(50)
});

const openSessionSchema = z.object({
    branch_id: z.string().uuid().optional(),
    opening_cash: money,
    notes: z.string().max(500).optional().nullable()
});

const closeSessionSchema = z.object({
    closing_cash: money,
    notes: z.string().max(500).optional().nullable()
});

const reviewSessionSchema = z.object({
    review_notes: z.string().max(500).optional().nullable()
});

const receiptPolicySchema = z.object({
    branch_id: z.string().uuid().optional().nullable(),
    receipt_required: z.boolean(),
    required_threshold: money,
    max_receipts_per_tx: z.coerce.number().int().min(1).max(10),
    allowed_mime_types: z.array(z.string().min(3)).min(1),
    max_file_size_mb: z.coerce.number().int().min(1).max(50),
    enforce_on_types: z.array(z.enum(["deposit", "withdraw", "loan_repay", "loan_disburse", "share_contribution"])).min(1)
});

const receiptInitSchema = z.object({
    branch_id: z.string().uuid(),
    member_id: z.string().uuid().optional().nullable(),
    transaction_type: z.enum(["deposit", "withdraw", "loan_repay", "loan_disburse", "share_contribution"]),
    file_name: z.string().min(3).max(255),
    mime_type: z.string().min(3).max(120),
    file_size_bytes: z.coerce.number().int().positive()
});

const receiptConfirmSchema = z.object({
    checksum_sha256: z.string().max(128).optional().nullable()
});

const summaryQuerySchema = z.object({
    date: z.string().date().optional(),
    branch_id: z.string().uuid().optional(),
    teller_user_id: z.string().uuid().optional()
});

module.exports = {
    sessionQuerySchema,
    openSessionSchema,
    closeSessionSchema,
    reviewSessionSchema,
    receiptPolicySchema,
    receiptInitSchema,
    receiptConfirmSchema,
    summaryQuerySchema
};
