const { z } = require("zod");

const formatEnum = z.enum(["csv", "pdf"]).default("csv");
const exceptionReasonEnum = z.enum([
    "HIGH_VALUE_TX",
    "BACKDATED_ENTRY",
    "REVERSAL",
    "OUT_OF_HOURS_POSTING",
    "MAKER_CHECKER_VIOLATION",
    "CASH_VARIANCE",
    "MANUAL_JOURNAL"
]);
const asyncExportSchema = z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((value) => {
        if (typeof value === "undefined") {
            return false;
        }

        if (typeof value === "boolean") {
            return value;
        }

        const normalized = String(value).trim().toLowerCase();
        return ["1", "true", "yes", "on"].includes(normalized);
    });

const optionalBooleanSchema = z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((value) => {
        if (typeof value === "undefined") {
            return undefined;
        }

        if (typeof value === "boolean") {
            return value;
        }

        const normalized = String(value).trim().toLowerCase();
        return ["1", "true", "yes", "on"].includes(normalized);
    });

const exportSchema = z.object({
    tenant_id: z.string().uuid().optional(),
    branch_id: z.string().uuid().optional(),
    member_id: z.string().uuid().optional(),
    account_id: z.string().uuid().optional(),
    reason_code: exceptionReasonEnum.optional(),
    status: z.string().max(64).optional(),
    as_of_date: z.string().date().optional(),
    compare_as_of_date: z.string().date().optional(),
    from_date: z.string().date().optional(),
    to_date: z.string().date().optional(),
    compare_from_date: z.string().date().optional(),
    compare_to_date: z.string().date().optional(),
    include_zero_balances: optionalBooleanSchema,
    format: formatEnum,
    async: asyncExportSchema
});

const chargeRevenueSummarySchema = z.object({
    tenant_id: z.string().uuid().optional(),
    branch_id: z.string().uuid().optional(),
    from_date: z.string().date().optional(),
    to_date: z.string().date().optional()
});

const exportJobParamSchema = z.object({
    jobId: z.string().uuid()
});

const exportJobsQuerySchema = z.object({
    report_key: z.string().max(120).optional(),
    status: z.enum(["pending", "processing", "completed", "failed"]).optional(),
    limit: z.coerce.number().int().positive().max(50).default(10)
});

module.exports = {
    exportSchema,
    chargeRevenueSummarySchema,
    exportJobParamSchema,
    exportJobsQuerySchema
};
