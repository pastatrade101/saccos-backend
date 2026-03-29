const { z } = require("zod");
const { ALL_NEXT_OF_KIN_RELATIONSHIPS } = require("../../constants/next-of-kin");

const tanzaniaPhoneSchema = z
    .string()
    .trim()
    .regex(/^(\+?255|0)?[67]\d{8}$/, "Use a valid Tanzania phone (06/07 local or +2556/+2557).");

const identityCodeSchema = z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{5,50}$/, "Use 5-50 letters, numbers, or hyphens.");

const maritalStatusSchema = z.enum(["single", "married", "divorced", "widowed"]);
const membershipTypeSchema = z.enum(["individual", "group", "company"]);
const nextOfKinRelationshipSchema = z.enum(ALL_NEXT_OF_KIN_RELATIONSHIPS).or(z.string().trim().min(2).max(80));

function validateLocationHierarchyIds(value, ctx) {
    const fields = [value.region_id, value.district_id, value.ward_id];
    const presentCount = fields.filter((entry) => entry !== undefined && entry !== null && String(entry).trim() !== "").length;

    if (presentCount > 0 && presentCount < 3) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Region, district, and ward must all be selected together.",
            path: ["region_id"]
        });
    }

    if ((value.village_id !== undefined && value.village_id !== null && String(value.village_id).trim() !== "") && presentCount < 3) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Village or mtaa cannot be selected without region, district, and ward.",
            path: ["village_id"]
        });
    }
}

function isAdultDate(value) {
    if (!value) {
        return true;
    }

    const today = new Date();
    const dob = new Date(`${value}T00:00:00`);
    const minimumBirthDate = new Date(today.getFullYear() - 18, today.getMonth(), today.getDate());

    return dob <= minimumBirthDate;
}

const loginProvisionSchema = z.object({
    create_login: z.boolean().default(false),
    send_invite: z.boolean().default(true),
    password: z.string().min(8).max(128).optional().nullable()
});

const memberSchemaFields = {
    tenant_id: z.string().uuid().optional(),
    branch_id: z.string().uuid(),
    savings_product_id: z.string().uuid().optional().nullable(),
    share_product_id: z.string().uuid().optional().nullable(),
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
    marital_status: maritalStatusSchema.optional().nullable(),
    occupation: z.string().trim().min(2).max(160).optional().nullable(),
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
    region: z.string().trim().min(2).max(120).optional().nullable(),
    district: z.string().trim().min(2).max(120).optional().nullable(),
    ward: z.string().trim().min(2).max(120).optional().nullable(),
    street_or_village: z.string().trim().min(2).max(160).optional().nullable(),
    residential_address: z.string().trim().min(3).max(255).optional().nullable(),
    region_id: z.string().uuid().optional().nullable(),
    district_id: z.string().uuid().optional().nullable(),
    ward_id: z.string().uuid().optional().nullable(),
    village_id: z.string().uuid().optional().nullable(),
    nida_no: identityCodeSchema.optional().nullable(),
    tin_no: identityCodeSchema.optional().nullable(),
    next_of_kin_name: z.string().min(3).max(120).optional().nullable(),
    next_of_kin_phone: z.string().min(7).max(30).optional().nullable(),
    next_of_kin_relationship: nextOfKinRelationshipSchema.optional().nullable(),
    next_of_kin_address: z.string().trim().min(3).max(255).optional().nullable(),
    employer: z.string().min(2).max(160).optional().nullable(),
    membership_type: membershipTypeSchema.optional().nullable(),
    initial_share_amount: z.coerce.number().min(0).optional().nullable(),
    monthly_savings_commitment: z.coerce.number().min(0).optional().nullable(),
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

    validateLocationHierarchyIds(value, ctx);
});

const updateOwnMemberProfileSchema = z.object({
    full_name: z.string().trim().min(3).max(120).optional().nullable(),
    dob: z.string().date().optional().nullable(),
    phone: tanzaniaPhoneSchema.optional().nullable(),
    email: z.string().email().optional().nullable(),
    gender: z.enum(["male", "female", "other"]).optional().nullable(),
    marital_status: maritalStatusSchema.optional().nullable(),
    occupation: z.string().trim().min(2).max(160).optional().nullable(),
    employer: z.string().trim().min(2).max(160).optional().nullable(),
    national_id: z.string().trim().min(5).max(50).optional().nullable(),
    nida_no: identityCodeSchema.optional().nullable(),
    tin_no: identityCodeSchema.optional().nullable(),
    address_line1: z.string().trim().min(3).max(200).optional().nullable(),
    address_line2: z.string().trim().max(200).optional().nullable(),
    city: z.string().trim().max(120).optional().nullable(),
    state: z.string().trim().max(120).optional().nullable(),
    country: z.string().trim().max(120).optional().nullable(),
    postal_code: z.string().trim().max(30).optional().nullable(),
    region: z.string().trim().min(2).max(120).optional().nullable(),
    district: z.string().trim().min(2).max(120).optional().nullable(),
    ward: z.string().trim().min(2).max(120).optional().nullable(),
    street_or_village: z.string().trim().min(2).max(160).optional().nullable(),
    residential_address: z.string().trim().min(3).max(255).optional().nullable(),
    next_of_kin_name: z.string().trim().min(3).max(120).optional().nullable(),
    next_of_kin_phone: z.string().trim().min(7).max(30).optional().nullable(),
    next_of_kin_relationship: nextOfKinRelationshipSchema.optional().nullable(),
    next_of_kin_address: z.string().trim().min(3).max(255).optional().nullable()
}).superRefine((value, ctx) => {
    if (value.dob && !isAdultDate(value.dob)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Member must be at least 18 years old.",
            path: ["dob"]
        });
    }

    validateLocationHierarchyIds(value, ctx);
});

const updateMemberSchema = z.object(memberSchemaFields).partial().omit({
    tenant_id: true,
    user_id: true,
    login: true
}).superRefine(validateLocationHierarchyIds);

const createMemberLoginSchema = z.object({
    email: z.string().email().optional().nullable(),
    send_invite: z.boolean().default(true),
    password: z.string().min(8).max(128).optional().nullable()
});

const provisionMemberAccountSchema = z.object({
    branch_id: z.string().uuid().optional().nullable(),
    product_type: z.enum(["savings", "shares", "fixed_deposit"]),
    savings_product_id: z.string().uuid().optional().nullable(),
    share_product_id: z.string().uuid().optional().nullable(),
    account_name: z.string().trim().min(3).max(120).optional().nullable()
}).superRefine((value, ctx) => {
    if (value.product_type === "savings" && !value.savings_product_id) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Select a savings product for the new savings account.",
            path: ["savings_product_id"]
        });
    }

    if (value.product_type === "shares" && !value.share_product_id) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Select a share product for the new share capital account.",
            path: ["share_product_id"]
        });
    }
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
    updateOwnMemberProfileSchema,
    createMemberLoginSchema,
    provisionMemberAccountSchema,
    resetMemberPasswordSchema,
    bulkDeleteMembersSchema,
    listMembersQuerySchema,
    listMemberAccountsQuerySchema
};
