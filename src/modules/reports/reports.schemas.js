const { z } = require("zod");

const formatEnum = z.enum(["csv", "pdf"]).default("csv");

const exportSchema = z.object({
    tenant_id: z.string().uuid().optional(),
    member_id: z.string().uuid().optional(),
    account_id: z.string().uuid().optional(),
    as_of_date: z.string().date().optional(),
    from_date: z.string().date().optional(),
    to_date: z.string().date().optional(),
    format: formatEnum
});

module.exports = {
    exportSchema
};
