const { z } = require("zod");

const moneyAmount = z.coerce.number().positive().multipleOf(0.01);

const initiateMemberPaymentSchema = z.object({
    tenant_id: z.string().uuid().optional(),
    account_id: z.string().uuid(),
    amount: moneyAmount,
    provider: z.enum(["airtel", "vodacom", "tigo", "halopesa"]),
    msisdn: z.string().trim().min(9).max(20),
    description: z.string().trim().max(255).optional().nullable()
});

const paymentOrderParamSchema = z.object({
    id: z.string().uuid()
});

const paymentOrderListQuerySchema = z.object({
    tenant_id: z.string().uuid().optional(),
    branch_id: z.string().uuid().optional(),
    member_id: z.string().uuid().optional(),
    purpose: z.enum(["share_contribution", "savings_deposit"]).optional(),
    status: z.enum(["created", "pending", "paid", "failed", "expired", "posted"]).optional(),
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional()
});

module.exports = {
    initiateContributionPaymentSchema: initiateMemberPaymentSchema,
    initiateSavingsPaymentSchema: initiateMemberPaymentSchema,
    paymentOrderParamSchema,
    paymentOrderListQuerySchema
};
