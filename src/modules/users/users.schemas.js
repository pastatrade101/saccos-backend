const { z } = require("zod");

const createUserSchema = z.object({
    tenant_id: z.string().uuid().optional(),
    email: z.string().email(),
    full_name: z.string().min(3).max(120),
    phone: z.string().min(7).max(30).optional().nullable(),
    role: z.enum(["super_admin", "branch_manager", "loan_officer", "teller", "auditor"]),
    branch_ids: z.array(z.string().uuid()).default([]),
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

const updateUserSchema = z.object({
    full_name: z.string().min(3).max(120).optional(),
    phone: z.string().min(7).max(30).nullable().optional(),
    role: z.enum(["super_admin", "branch_manager", "loan_officer", "teller", "auditor"]).optional(),
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

module.exports = {
    createUserSchema,
    updateUserSchema,
    bootstrapSuperAdminSchema
};
