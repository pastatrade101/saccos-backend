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
    phone: z.string().min(7).max(30).optional().nullable(),
    email: z.string().email().optional().nullable(),
    member_no: z.string().min(2).max(50).optional().nullable(),
    national_id: z.string().min(5).max(50).optional().nullable(),
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

module.exports = {
    createMemberSchema,
    updateMemberSchema,
    createMemberLoginSchema
};
