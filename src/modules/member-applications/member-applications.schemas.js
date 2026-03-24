const { z } = require("zod");

const baseFields = {
    branch_id: z.string().uuid(),
    full_name: z.string().trim().min(3).max(120),
    dob: z.string().date().optional().nullable(),
    phone: z.string().trim().min(7).max(30).optional().nullable(),
    email: z.string().email().optional().nullable(),
    address_line1: z.string().trim().min(3).max(200).optional().nullable(),
    address_line2: z.string().trim().max(200).optional().nullable(),
    city: z.string().trim().max(120).optional().nullable(),
    state: z.string().trim().max(120).optional().nullable(),
    country: z.string().trim().max(120).optional().nullable(),
    postal_code: z.string().trim().max(30).optional().nullable(),
    nida_no: z.string().trim().min(5).max(50).optional().nullable(),
    tin_no: z.string().trim().min(5).max(50).optional().nullable(),
    next_of_kin_name: z.string().trim().min(3).max(120).optional().nullable(),
    next_of_kin_phone: z.string().trim().min(7).max(30).optional().nullable(),
    next_of_kin_relationship: z.string().trim().min(2).max(80).optional().nullable(),
    employer: z.string().trim().min(2).max(160).optional().nullable(),
    member_no: z.string().trim().min(2).max(50).optional().nullable(),
    national_id: z.string().trim().min(5).max(50).optional().nullable(),
    notes: z.string().trim().max(1000).optional().nullable(),
    kyc_status: z.enum(["pending", "verified", "rejected", "waived"]).default("pending"),
    kyc_reason: z.string().trim().max(500).optional().nullable(),
    membership_fee_amount: z.coerce.number().min(0).default(0),
    membership_fee_paid: z.coerce.number().min(0).default(0)
};

const baseSchema = z.object(baseFields);

const createApplicationSchema = baseSchema.superRefine((value, ctx) => {
    if (value.membership_fee_paid > value.membership_fee_amount) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Paid membership fee cannot exceed the configured amount.",
            path: ["membership_fee_paid"]
        });
    }
});

const listApplicationsQuerySchema = z.object({
    status: z.enum([
        "draft",
        "submitted",
        "under_review",
        "reviewed",
        "approved",
        "approved_pending_payment",
        "active",
        "rejected",
        "cancelled"
    ]).optional(),
    branch_id: z.string().uuid().optional(),
    search: z.string().trim().min(1).max(120).optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(50)
});

module.exports = {
    listApplicationsQuerySchema,
    createApplicationSchema,
    updateApplicationSchema: z.object(baseFields).partial(),
    reviewApplicationSchema: z.object({
        notes: z.string().trim().max(500).optional().nullable(),
        kyc_status: z.enum(["pending", "verified", "rejected", "waived"]).optional(),
        kyc_reason: z.string().trim().max(500).optional().nullable()
    }),
    rejectApplicationSchema: z.object({
        reason: z.string().trim().min(3).max(500)
    })
};
