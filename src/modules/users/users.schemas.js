const { z } = require("zod");

const tanzaniaPhoneRegex = /^(?:\+?255|0)?[67]\d{8}$/;

const createUserSchema = z.object({
    tenant_id: z.string().uuid().optional(),
    email: z.string().email(),
    full_name: z.string().min(3).max(120),
    phone: z.string().min(7).max(30).optional().nullable(),
    role: z.enum(["super_admin", "branch_manager", "treasury_officer", "loan_officer", "teller", "auditor"]),
    branch_ids: z.array(z.string().uuid()).default([]),
    send_invite: z.boolean().default(true),
    password: z.string().min(8).max(128).optional().nullable()
}).superRefine((value, ctx) => {
    if (value.send_invite && !value.phone) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Phone is required when invite mode is enabled (SMS setup link).",
            path: ["phone"]
        });
    }

    if (value.send_invite && value.phone && !tanzaniaPhoneRegex.test(value.phone.trim())) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Use a valid Tanzania phone (06/07 local or +2556/+2557).",
            path: ["phone"]
        });
    }

    if (!value.send_invite && value.password && value.password.length < 8) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Password must be at least 8 characters.",
            path: ["password"]
        });
    }
});

const updateUserSchema = z.object({
    full_name: z.string().min(3).max(120).optional(),
    phone: z.string().min(7).max(30).nullable().optional(),
    role: z.enum(["super_admin", "branch_manager", "treasury_officer", "loan_officer", "teller", "auditor"]).optional(),
    is_active: z.boolean().optional(),
    branch_ids: z.array(z.string().uuid()).optional()
});

const bootstrapSuperAdminSchema = z.object({
    tenant_id: z.string().uuid(),
    branch_id: z.string().uuid().optional().nullable(),
    email: z.string().email(),
    full_name: z.string().min(3).max(120),
    phone: z.string().min(7).max(30).nullable().optional(),
    send_invite: z.boolean().default(true),
    password: z.string().min(8).max(128).optional().nullable()
}).superRefine((value, ctx) => {
    if (!value.send_invite && value.password && value.password.length < 8) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Password must be at least 8 characters.",
            path: ["password"]
        });
    }
});

const listUsersQuerySchema = z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(50)
});

module.exports = {
    listUsersQuerySchema,
    createUserSchema,
    updateUserSchema,
    bootstrapSuperAdminSchema
};
