const { z } = require("zod");
const { normalizeOrigin } = require("../utils/cors");

const isProductionEnv = String(process.env.NODE_ENV || "").trim().toLowerCase() === "production";

function parseBooleanEnv(value, defaultValue = false) {
    if (typeof value === "undefined" || value === null) {
        return defaultValue;
    }

    let normalized = String(value).trim();

    if (!normalized) {
        return defaultValue;
    }

    if (
        (normalized.startsWith("\"") && normalized.endsWith("\""))
        || (normalized.startsWith("'") && normalized.endsWith("'"))
    ) {
        normalized = normalized.slice(1, -1).trim();
    }

    const commentIndex = normalized.indexOf("#");
    if (commentIndex >= 0) {
        normalized = normalized.slice(0, commentIndex).trim();
    }

    return ["true", "1", "yes", "on"].includes(normalized.toLowerCase());
}

const envSchema = z.object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(5000),
    HOST: z.string().default("127.0.0.1"),
    API_PREFIX: z.string().default("/api"),
    BODY_LIMIT: z.string().default("1mb"),
    CORS_ORIGINS: z.string().optional(),
    SUPABASE_URL: z.string().url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
    SUPABASE_ANON_KEY: z.string().min(20),
    RECEIPTS_BUCKET: z.string().default("receipts"),
    IMPORTS_BUCKET: z.string().default("imports"),
    TEMP_PASSWORD_ENCRYPTION_KEY: z.string().min(16).optional(),
    SUBSCRIPTION_DEFAULT_GRACE_DAYS: z.coerce.number().int().nonnegative().default(7),
    HIGH_VALUE_THRESHOLD_TZS: z.coerce.number().positive().default(2000000),
    OUT_OF_HOURS_START: z.string().default("18:00"),
    OUT_OF_HOURS_END: z.string().default("07:00"),
    OTP_REQUIRED_ON_SIGNIN: z
        .string()
        .optional()
        .transform((value) => parseBooleanEnv(value, isProductionEnv)),
    OTP_CODE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
    OTP_MAX_VERIFY_ATTEMPTS: z.coerce.number().int().positive().default(5),
    OTP_SEND_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
    OTP_SEND_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900000),
    OTP_RESEND_MAX: z.coerce.number().int().nonnegative().default(3),
    OTP_SMS_URL: z.string().url().default("https://messaging-service.co.tz/api/sms/v1/text/single"),
    OTP_SMS_FROM: z.string().min(1).max(20).default("N-SMS"),
    OTP_SMS_AUTHORIZATION: z.string().min(1).optional(),
    OTP_SMS_BASIC_USERNAME: z.string().min(1).optional(),
    OTP_SMS_BASIC_PASSWORD: z.string().min(1).optional(),
    OTP_HASH_SECRET: z.string().min(16).optional(),
    SSL_ENABLED: z
        .string()
        .optional()
        .transform((value) => parseBooleanEnv(value, false)),
    LOG_LEVEL: z.string().default("info")
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
    const details = parsedEnv.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ");

    throw new Error(`Invalid environment configuration: ${details}`);
}

const env = parsedEnv.data;

module.exports = {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    host: env.HOST,
    apiPrefix: env.API_PREFIX,
    bodyLimit: env.BODY_LIMIT,
    corsOrigins: env.CORS_ORIGINS
        ? env.CORS_ORIGINS.split(",").map((origin) => normalizeOrigin(origin)).filter(Boolean)
        : [],
    supabaseUrl: env.SUPABASE_URL,
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    supabaseAnonKey: env.SUPABASE_ANON_KEY,
    receiptsBucket: env.RECEIPTS_BUCKET,
    importsBucket: env.IMPORTS_BUCKET,
    tempPasswordEncryptionKey: env.TEMP_PASSWORD_ENCRYPTION_KEY || env.SUPABASE_SERVICE_ROLE_KEY,
    defaultGraceDays: env.SUBSCRIPTION_DEFAULT_GRACE_DAYS,
    highValueThresholdTzs: env.HIGH_VALUE_THRESHOLD_TZS,
    outOfHoursStart: env.OUT_OF_HOURS_START,
    outOfHoursEnd: env.OUT_OF_HOURS_END,
    otpRequiredOnSignIn: env.OTP_REQUIRED_ON_SIGNIN,
    otpCodeTtlSeconds: env.OTP_CODE_TTL_SECONDS,
    otpMaxVerifyAttempts: env.OTP_MAX_VERIFY_ATTEMPTS,
    otpSendRateLimitMax: env.OTP_SEND_RATE_LIMIT_MAX,
    otpSendRateLimitWindowMs: env.OTP_SEND_RATE_LIMIT_WINDOW_MS,
    otpResendMax: env.OTP_RESEND_MAX,
    otpSmsUrl: env.OTP_SMS_URL,
    otpSmsFrom: env.OTP_SMS_FROM,
    otpSmsAuthorization: env.OTP_SMS_AUTHORIZATION || "",
    otpSmsBasicUsername: env.OTP_SMS_BASIC_USERNAME || "",
    otpSmsBasicPassword: env.OTP_SMS_BASIC_PASSWORD || "",
    otpHashSecret: env.OTP_HASH_SECRET || env.SUPABASE_SERVICE_ROLE_KEY,
    sslEnabled: env.SSL_ENABLED,
    logLevel: env.LOG_LEVEL
};
