const { z } = require("zod");

const signInSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    totp_code: z
        .string()
        .trim()
        .regex(/^\d{6}$/)
        .optional()
        .nullable(),
    recovery_code: z
        .string()
        .trim()
        .min(6)
        .max(20)
        .optional()
        .nullable()
});

const twoFactorCodeSchema = z.object({
    totp_code: z.string().trim().regex(/^\d{6}$/)
});

const validateTwoFactorSchema = z.object({
    totp_code: z.string().trim().regex(/^\d{6}$/).optional().nullable(),
    recovery_code: z.string().trim().min(6).max(20).optional().nullable()
}).refine(
    (value) => Boolean(value.totp_code || value.recovery_code),
    {
        message: "Provide an authenticator code or backup recovery code."
    }
);

const recoverySignInSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    recovery_code: z.string().trim().min(6).max(20)
});

const sendPasswordSetupLinkSchema = z.object({
    email: z.string().email()
});

const inviteUserSchema = z.object({
    tenant_id: z.string().uuid().optional(),
    email: z.string().email(),
    full_name: z.string().min(3).max(120),
    phone: z.string().min(7).max(30).optional().nullable(),
    role: z.enum([
        "super_admin",
        "branch_manager",
        "treasury_officer",
        "loan_officer",
        "teller",
        "auditor",
        "member"
    ]),
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

module.exports = {
    signInSchema,
    twoFactorCodeSchema,
    validateTwoFactorSchema,
    recoverySignInSchema,
    sendPasswordSetupLinkSchema,
    inviteUserSchema
};
