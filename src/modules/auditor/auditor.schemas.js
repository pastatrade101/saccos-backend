const { z } = require("zod");

const pagingSchema = {
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20)
};

const dateRangeSchema = {
    from: z.string().date().optional(),
    to: z.string().date().optional()
};

const summaryQuerySchema = z.object({
    ...dateRangeSchema
});

const exceptionsQuerySchema = z.object({
    ...dateRangeSchema,
    reason: z.enum([
        "HIGH_VALUE_TX",
        "BACKDATED_ENTRY",
        "REVERSAL",
        "OUT_OF_HOURS_POSTING",
        "MAKER_CHECKER_VIOLATION",
        "CASH_VARIANCE",
        "MANUAL_JOURNAL"
    ]).optional(),
    ...pagingSchema
});

const journalsQuerySchema = z.object({
    ...dateRangeSchema,
    search: z.string().max(120).optional(),
    ...pagingSchema
});

const journalDetailParamsSchema = z.object({
    id: z.string().uuid()
});

const auditLogsQuerySchema = z.object({
    ...dateRangeSchema,
    action: z.string().max(120).optional(),
    entity_type: z.string().max(120).optional(),
    actor_user_id: z.string().uuid().optional(),
    ...pagingSchema
});

const auditorReportQuerySchema = z.object({
    ...dateRangeSchema,
    asOf: z.string().date().optional(),
    periodId: z.string().uuid().optional()
});

module.exports = {
    summaryQuerySchema,
    exceptionsQuerySchema,
    journalsQuerySchema,
    journalDetailParamsSchema,
    auditLogsQuerySchema,
    auditorReportQuerySchema
};
