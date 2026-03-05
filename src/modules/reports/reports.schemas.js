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

const exportSchema = z.object({
    tenant_id: z.string().uuid().optional(),
    branch_id: z.string().uuid().optional(),
    member_id: z.string().uuid().optional(),
    account_id: z.string().uuid().optional(),
    reason_code: exceptionReasonEnum.optional(),
    status: z.string().max(64).optional(),
    as_of_date: z.string().date().optional(),
    from_date: z.string().date().optional(),
    to_date: z.string().date().optional(),
    format: formatEnum
});

module.exports = {
    exportSchema
};
