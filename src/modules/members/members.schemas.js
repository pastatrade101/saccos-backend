const { z } = require("zod");

const loginProvisionSchema = z.object({
    create_login: z.boolean().default(false),
    send_invite: z.boolean().default(true),
    password: z.string().min(8).max(128).optional().nullable()
});

const memberSchemaFields = {
    tenant_id: z.string().uuid().optional(),
    branch_id: z.string().uuid(),
    full_name: z.string().min(3).max(120),
    dob: z.string().date().optional().nullable(),
    phone: z.string().min(7).max(30).optional().nullable(),
    email: z.string().email().optional().nullable(),
    member_no: z.string().min(2).max(50).optional().nullable(),
    national_id: z.string().min(5).max(50).optional().nullable(),
    address_line1: z.string().min(3).max(200).optional().nullable(),
    address_line2: z.string().max(200).optional().nullable(),
    city: z.string().max(120).optional().nullable(),
    state: z.string().max(120).optional().nullable(),
    country: z.string().max(120).optional().nullable(),
    postal_code: z.string().max(30).optional().nullable(),
    nida_no: z.string().min(5).max(50).optional().nullable(),
    tin_no: z.string().min(5).max(50).optional().nullable(),
    next_of_kin_name: z.string().min(3).max(120).optional().nullable(),
    next_of_kin_phone: z.string().min(7).max(30).optional().nullable(),
    next_of_kin_relationship: z.string().min(2).max(80).optional().nullable(),
    employer: z.string().min(2).max(160).optional().nullable(),
    kyc_status: z.enum(["pending", "verified", "rejected", "waived"]).optional(),
    kyc_reason: z.string().max(500).optional().nullable(),
    notes: z.string().max(500).optional().nullable(),
    status: z.enum(["active", "suspended", "exited"]).default("active"),
    user_id: z.string().uuid().optional().nullable(),
    login: loginProvisionSchema.optional()
};

const createMemberSchema = z.object(memberSchemaFields).superRefine((value, ctx) => {
    if (value.login?.create_login && !value.email) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Email is required when creating a member login.",
            path: ["email"]
        });
    }
});

const updateMemberSchema = z.object(memberSchemaFields).partial().omit({
    tenant_id: true,
    user_id: true,
    login: true
});

const createMemberLoginSchema = z.object({
    email: z.string().email().optional().nullable(),
    send_invite: z.boolean().default(true),
    password: z.string().min(8).max(128).optional().nullable()
});

const resetMemberPasswordSchema = z.object({
    password: z.string().min(8).max(128).optional().nullable()
});

const bulkDeleteMembersSchema = z.object({
    member_ids: z.array(z.string().uuid()).min(1).max(200)
});

const paginationSchema = {
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(50)
};

const listMembersQuerySchema = z.object({
    tenant_id: z.string().uuid().optional(),
    branch_id: z.string().uuid().optional(),
    status: z.enum(["active", "suspended", "exited"]).optional(),
    search: z.string().min(1).max(120).optional(),
    ...paginationSchema
});

const listMemberAccountsQuerySchema = z.object({
    tenant_id: z.string().uuid().optional(),
    branch_id: z.string().uuid().optional(),
    member_id: z.string().uuid().optional(),
    product_type: z.enum(["savings", "shares", "fixed_deposit"]).optional(),
    status: z.enum(["active", "dormant", "closed"]).optional(),
    search: z.string().min(1).max(120).optional(),
    ...paginationSchema
});

module.exports = {
    createMemberSchema,
    updateMemberSchema,
    createMemberLoginSchema,
    resetMemberPasswordSchema,
    bulkDeleteMembersSchema,
    listMembersQuerySchema,
    listMemberAccountsQuerySchema
};
