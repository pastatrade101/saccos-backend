const { z } = require("zod");

const createBranchSchema = z.object({
    tenant_id: z.string().uuid().optional(),
    name: z.string().min(2).max(120),
    code: z.string().min(2).max(20),
    address_line1: z.string().min(2).max(160),
    address_line2: z.string().max(160).optional().nullable(),
    city: z.string().min(2).max(80),
    state: z.string().min(2).max(80),
    country: z.string().min(2).max(80)
});

const listBranchesQuerySchema = z.object({
    tenant_id: z.string().uuid().optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(50)
});

module.exports = {
    createBranchSchema,
    listBranchesQuerySchema
};
