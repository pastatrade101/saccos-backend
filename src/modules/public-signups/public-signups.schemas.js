const { z } = require("zod");
const { ALL_NEXT_OF_KIN_RELATIONSHIPS } = require("../../constants/next-of-kin");

const NATIONAL_ID_DIGITS = 20;
const PASSWORD_SPECIAL_PATTERN = /[^A-Za-z0-9]/;
const MINIMUM_SIGNUP_AGE_YEARS = 18;
const TANZANIA_PHONE_PATTERN = /^255[67]\d{8}$/;

function normalizeNationalId(value) {
    return String(value || "")
        .replace(/\D/g, "")
        .slice(0, NATIONAL_ID_DIGITS);
}

function normalizePhone(value) {
    const digits = String(value || "").replace(/\D/g, "");

    if (digits.startsWith("255")) {
        return digits.slice(0, 12);
    }

    if (digits.startsWith("0")) {
        return `255${digits.slice(1, 10)}`.slice(0, 12);
    }

    if ((digits.startsWith("6") || digits.startsWith("7")) && digits.length <= 9) {
        return `255${digits}`.slice(0, 12);
    }

    return digits.slice(0, 12);
}

function calculateAgeYears(value) {
    if (!value) {
        return 0;
    }

    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        return 0;
    }

    const today = new Date();
    let age = today.getUTCFullYear() - date.getUTCFullYear();
    const monthDelta = today.getUTCMonth() - date.getUTCMonth();

    if (monthDelta < 0 || (monthDelta === 0 && today.getUTCDate() < date.getUTCDate())) {
        age -= 1;
    }

    return age;
}

const publicSignupSchema = z.object({
    branch_id: z.string().uuid(),
    first_name: z.string().trim().min(1).max(80),
    last_name: z.string().trim().min(1).max(80),
    gender: z.enum(["male", "female", "other"]),
    marital_status: z.enum(["single", "married", "divorced", "widowed"]),
    occupation: z.string().trim().min(2).max(120),
    employer_name: z.string().trim().max(160).optional().nullable(),
    phone: z.string().trim().refine((value) => TANZANIA_PHONE_PATTERN.test(normalizePhone(value))),
    email: z.string().trim().email(),
    password: z.string()
        .min(8)
        .max(128)
        .regex(/[A-Z]/)
        .regex(/[a-z]/)
        .regex(/\d/)
        .regex(PASSWORD_SPECIAL_PATTERN),
    national_id: z.string().trim().refine((value) => normalizeNationalId(value).length === NATIONAL_ID_DIGITS),
    date_of_birth: z.string().date(),
    region_id: z.string().uuid().optional().nullable(),
    district_id: z.string().uuid().optional().nullable(),
    ward_id: z.string().uuid().optional().nullable(),
    village_id: z.string().uuid().optional().nullable(),
    region: z.string().trim().min(2).max(120).optional().nullable(),
    district: z.string().trim().min(2).max(120).optional().nullable(),
    ward: z.string().trim().min(2).max(120).optional().nullable(),
    street_or_village: z.string().trim().min(2).max(160).optional().nullable(),
    residential_address: z.string().trim().min(5).max(240),
    next_of_kin_name: z.string().trim().min(3).max(120),
    relationship: z.enum(ALL_NEXT_OF_KIN_RELATIONSHIPS),
    next_of_kin_phone: z.string().trim().refine((value) => TANZANIA_PHONE_PATTERN.test(normalizePhone(value))),
    next_of_kin_address: z.string().trim().min(5).max(240),
    membership_type: z.enum(["individual", "group", "company"]),
    initial_share_amount: z.coerce.number().positive(),
    monthly_savings_commitment: z.coerce.number().positive(),
    terms_accepted: z.literal(true),
    data_processing_consent: z.literal(true)
}).superRefine((value, ctx) => {
    if (calculateAgeYears(value.date_of_birth) < MINIMUM_SIGNUP_AGE_YEARS) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Applicant must be at least 18 years old.",
            path: ["date_of_birth"]
        });
    }

    const hierarchyIds = [value.region_id, value.district_id, value.ward_id].filter(Boolean);
    const locationNames = [value.region, value.district, value.ward].filter(Boolean);

    if (hierarchyIds.length > 0 && hierarchyIds.length < 3) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Select region, district, and ward.",
            path: ["region_id"]
        });
    }

    if (hierarchyIds.length === 0 && locationNames.length < 3) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Select the full residential location hierarchy.",
            path: ["region_id"]
        });
    }
});

module.exports = {
    publicSignupSchema,
    normalizeNationalId,
    normalizePhone
};
