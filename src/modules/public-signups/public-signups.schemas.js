const { z } = require("zod");

const NATIONAL_ID_DIGITS = 20;
const PASSWORD_SPECIAL_PATTERN = /[^A-Za-z0-9]/;

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

const publicSignupSchema = z.object({
    branch_id: z.string().uuid(),
    first_name: z.string().trim().min(1).max(80),
    last_name: z.string().trim().min(1).max(80),
    phone: z.string().trim().refine((value) => /^255[67]\d{8}$/.test(normalizePhone(value))),
    email: z.string().trim().email(),
    password: z.string()
        .min(8)
        .max(128)
        .regex(/[A-Z]/)
        .regex(/[a-z]/)
        .regex(/\d/)
        .regex(PASSWORD_SPECIAL_PATTERN),
    national_id: z.string().trim().refine((value) => normalizeNationalId(value).length === NATIONAL_ID_DIGITS),
    date_of_birth: z.string().date()
});

module.exports = {
    publicSignupSchema
};
