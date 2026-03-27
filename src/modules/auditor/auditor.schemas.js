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

const caseKeyParamsSchema = z.object({
    caseKey: z.string().min(8).max(120)
});

const evidenceIdParamsSchema = z.object({
    evidenceId: z.string().uuid()
});

const exceptionContextFields = {
    reason_code: z.enum([
        "HIGH_VALUE_TX",
        "BACKDATED_ENTRY",
        "REVERSAL",
        "OUT_OF_HOURS_POSTING",
        "MAKER_CHECKER_VIOLATION",
        "CASH_VARIANCE",
        "MANUAL_JOURNAL"
    ]),
    journal_id: z.string().uuid().nullable().optional(),
    branch_id: z.string().uuid().nullable().optional(),
    user_id: z.string().uuid().nullable().optional(),
    reference: z.string().max(120).nullable().optional()
};

const caseDetailQuerySchema = z.object({
    reason_code: exceptionContextFields.reason_code.optional(),
    journal_id: exceptionContextFields.journal_id,
    branch_id: exceptionContextFields.branch_id,
    user_id: exceptionContextFields.user_id,
    reference: exceptionContextFields.reference
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

const updateCaseSchema = z.object({
    status: z.enum(["open", "under_review", "resolved", "waived"]).optional(),
    notes: z.string().max(4000).nullable().optional(),
    assignee_user_id: z.string().uuid().nullable().optional(),
    ...exceptionContextFields
});

const createCaseCommentSchema = z.object({
    body: z.string().trim().min(1).max(4000),
    ...exceptionContextFields
});

const initCaseEvidenceUploadSchema = z.object({
    file_name: z.string().trim().min(1).max(255),
    mime_type: z.string().trim().min(1).max(120),
    file_size_bytes: z.coerce.number().int().positive().max(50 * 1024 * 1024),
    ...exceptionContextFields
});

const confirmCaseEvidenceUploadSchema = z.object({
    checksum_sha256: z.string().trim().regex(/^[a-fA-F0-9]{64}$/).optional()
});

const riskSummaryQuerySchema = z.object({
    ...dateRangeSchema,
    limit: z.coerce.number().int().positive().max(20).default(5)
});

const exceptionTrendsQuerySchema = z.object({
    ...dateRangeSchema,
    days: z.coerce.number().int().positive().max(60).optional()
});

const workstationOverviewQuerySchema = z.object({
    ...dateRangeSchema,
    limit: z.coerce.number().int().positive().max(10).default(5)
});

module.exports = {
    summaryQuerySchema,
    exceptionsQuerySchema,
    journalsQuerySchema,
    journalDetailParamsSchema,
    caseKeyParamsSchema,
    evidenceIdParamsSchema,
    caseDetailQuerySchema,
    auditLogsQuerySchema,
    auditorReportQuerySchema,
    updateCaseSchema,
    createCaseCommentSchema,
    initCaseEvidenceUploadSchema,
    confirmCaseEvidenceUploadSchema,
    riskSummaryQuerySchema,
    exceptionTrendsQuerySchema,
    workstationOverviewQuerySchema
};
