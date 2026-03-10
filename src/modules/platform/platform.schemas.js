const { z } = require("zod");

const planParamSchema = z.object({
    planId: z.string().uuid()
});

const listPlansQuerySchema = z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(50)
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

const deleteTenantSchema = z.object({
    confirm_name: z.string().min(1).max(255)
});

const listPlatformTenantsQuerySchema = z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(50),
    search: z.string().trim().min(1).max(120).optional(),
    status: z.string().trim().min(1).max(60).optional()
});

const platformMetricsQuerySchema = z.object({
    tenant_id: z.string().uuid().optional(),
    window_minutes: z.coerce.number().int().positive().max(1440).default(60)
});

const platformTenantMetricsQuerySchema = z.object({
    tenant_id: z.string().uuid().optional(),
    window_minutes: z.coerce.number().int().positive().max(1440).default(60),
    sort_by: z.enum(["traffic", "errors", "latency"]).default("traffic"),
    sort_dir: z.enum(["asc", "desc"]).default("desc")
});

const platformErrorsQuerySchema = z.object({
    tenant_id: z.string().uuid().optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20)
});

const platformSlowEndpointsQuerySchema = z.object({
    tenant_id: z.string().uuid().optional(),
    window_minutes: z.coerce.number().int().positive().max(1440).default(60),
    limit: z.coerce.number().int().positive().max(100).default(10)
});

module.exports = {
    planParamSchema,
    listPlansQuerySchema,
    tenantParamSchema,
    listPlatformTenantsQuerySchema,
    platformMetricsQuerySchema,
    platformTenantMetricsQuerySchema,
    platformErrorsQuerySchema,
    platformSlowEndpointsQuerySchema,
    updatePlanFeaturesSchema,
    assignSubscriptionSchema,
    deleteTenantSchema
};
