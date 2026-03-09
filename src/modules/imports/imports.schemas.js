const { z } = require("zod");

const booleanish = z.preprocess((value) => {
    if (typeof value === "boolean") {
        return value;
    }

    if (typeof value === "string") {
        return value === "true" || value === "1" || value === "on";
    }

    return false;
}, z.boolean());

const positiveInt = z.preprocess((value) => {
    if (value === undefined || value === null || value === "") {
        return undefined;
    }

    return Number(value);
}, z.number().int().positive().optional());

const startMemberImportSchema = z.object({
    create_portal_account: booleanish.default(false),
    update_existing_only: booleanish.default(false),
    default_branch_id: z.string().uuid().optional().nullable()
});

const listImportRowsQuerySchema = z.object({
    status: z.enum(["success", "failed"]).optional(),
    page: positiveInt.default(1),
    limit: positiveInt.default(25).refine((value) => value <= 100, {
        message: "limit must be less than or equal to 100"
    })
});

module.exports = {
    startMemberImportSchema,
    listImportRowsQuerySchema
};
