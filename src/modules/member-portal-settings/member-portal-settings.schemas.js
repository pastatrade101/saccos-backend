const { z } = require("zod");

const uuid = z.string().uuid();

const paymentControlsQuerySchema = z.object({
    tenant_id: uuid.optional()
});

const updatePaymentControlsSchema = z.object({
    tenant_id: uuid.optional(),
    share_contribution_enabled: z.boolean().optional(),
    savings_deposit_enabled: z.boolean().optional(),
    loan_repayment_enabled: z.boolean().optional()
}).refine(
    (value) =>
        typeof value.share_contribution_enabled === "boolean"
        || typeof value.savings_deposit_enabled === "boolean"
        || typeof value.loan_repayment_enabled === "boolean",
    {
        message: "At least one member portal payment control must be provided."
    }
);

module.exports = {
    paymentControlsQuerySchema,
    updatePaymentControlsSchema
};
