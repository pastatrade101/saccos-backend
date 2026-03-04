const { z } = require("zod");

const createTenantSchema = z.object({
    name: z.string().min(3).max(160),
    registration_number: z.string().min(3).max(80),
    status: z.enum(["active", "inactive", "suspended"]).default("active"),
    plan: z.enum(["starter", "growth", "enterprise"]).default("starter"),
    subscription_status: z.enum(["active", "past_due", "cancelled"]).default("active"),
    start_at: z.string().datetime().optional(),
    expires_at: z.string().datetime().optional(),
    grace_period_until: z.string().datetime().optional()
});

const updateTenantSchema = createTenantSchema.partial().omit({
    plan: true,
    subscription_status: true,
    start_at: true,
    expires_at: true,
    grace_period_until: true
});

module.exports = {
    createTenantSchema,
    updateTenantSchema
};
