const { z } = require("zod");

const tanzaniaPhoneSchema = z
    .string()
    .trim()
    .regex(/^(\+?255|0)?[67]\d{8}$/, "Use a valid Tanzania phone (06/07 local or +2556/+2557).");

const identityCodeSchema = z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{5,50}$/, "Use 5-50 letters, numbers, or hyphens.");

const loginProvisionSchema = z.object({
    create_login: z.boolean().default(false),
    send_invite: z.boolean().default(true),
    password: z.string().min(8).max(128).optional().nullable()
});

const memberSchemaFields = {
    tenant_id: z.string().uuid().optional(),
    branch_id: z.string().uuid(),
    first_name: z.string().trim().min(2).max(80).optional().nullable(),
    middle_name: z.string().trim().max(80).optional().nullable(),
    last_name: z.string().trim().min(2).max(80).optional().nullable(),
    full_name: z.string().trim().min(3).max(120).optional().nullable(),
    date_of_birth: z.string().date().optional().nullable(),
    dob: z.string().date().optional().nullable(),
    phone_number: tanzaniaPhoneSchema.optional().nullable(),
    phone: tanzaniaPhoneSchema.optional().nullable(),
    email: z.string().email().optional().nullable(),
    gender: z.enum(["male", "female", "other"]).optional().nullable(),
    member_no: z.string().min(2).max(50).optional().nullable(),
    nin: identityCodeSchema.optional().nullable(),
    tin_number: identityCodeSchema.optional().nullable(),
    national_id: z.string().min(5).max(50).optional().nullable(),
    address: z.string().trim().min(3).max(200).optional().nullable(),
    address_line1: z.string().min(3).max(200).optional().nullable(),
    address_line2: z.string().max(200).optional().nullable(),
    city: z.string().max(120).optional().nullable(),
    state: z.string().max(120).optional().nullable(),
    country: z.string().max(120).optional().nullable(),
    postal_code: z.string().max(30).optional().nullable(),
    nida_no: identityCodeSchema.optional().nullable(),
    tin_no: identityCodeSchema.optional().nullable(),
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
    const hasFullName = Boolean(value.full_name?.trim());
    const hasSplitName = Boolean(value.first_name?.trim() && value.last_name?.trim());

    if (!hasFullName && !hasSplitName) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Provide full_name or both first_name and last_name.",
            path: ["full_name"]
        });
    }

    if (value.login?.create_login && !value.email) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Email is required when creating a member login.",
            path: ["email"]
        });
    }

    if (value.login?.create_login && value.login?.send_invite && !(value.phone || value.phone_number)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Phone is required when sending an SMS setup link.",
            path: ["phone"]
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
    cursor: z.string().datetime({ offset: true }).optional(),
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
