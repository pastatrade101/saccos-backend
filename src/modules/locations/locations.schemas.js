const { z } = require("zod");

const listDistrictsQuerySchema = z.object({
    region_id: z.string().uuid()
});

const listWardsQuerySchema = z.object({
    district_id: z.string().uuid()
});

const listVillagesQuerySchema = z.object({
    ward_id: z.string().uuid(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(500).default(100),
    search: z.string().trim().min(1).max(120).optional()
});

module.exports = {
    listDistrictsQuerySchema,
    listWardsQuerySchema,
    listVillagesQuerySchema
};
