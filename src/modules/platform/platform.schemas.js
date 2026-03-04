const { z } = require("zod");

const planParamSchema = z.object({
    planId: z.string().uuid()
});

const tenantParamSchema = z.object({
    tenantId: z.string().uuid()
});

const updatePlanFeaturesSchema = z.object({
    features: z.array(z.object({
        feature_key: z.string().min(1).max(120),
        feature_type: z.enum(["bool", "int", "string"]),
        bool_value: z.boolean().nullable().optional(),
        int_value: z.number().int().nullable().optional(),
        string_value: z.string().nullable().optional()
    })).min(1)
});

const assignSubscriptionSchema = z.object({
    plan_code: z.enum(["starter", "growth", "enterprise"]),
    status: z.enum(["active", "past_due", "suspended", "cancelled"]),
    start_at: z.string().datetime().optional(),
    expires_at: z.string().datetime().optional()
});

module.exports = {
    planParamSchema,
    tenantParamSchema,
    updatePlanFeaturesSchema,
    assignSubscriptionSchema
};
