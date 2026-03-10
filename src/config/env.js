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
    SUPABASE_FETCH_RETRY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(8).default(3),
    SUPABASE_FETCH_RETRY_BASE_MS: z.coerce.number().int().positive().default(100),
    SUPABASE_FETCH_RETRY_MAX_MS: z.coerce.number().int().positive().default(1000),
    JWT_SECRET: z.string().min(16).optional(),
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
    IDEMPOTENCY_IN_PROGRESS_TTL_MS: z.coerce.number().int().nonnegative().default(300000),
    PASSWORD_SETUP_REDIRECT_URL: z.string().url().optional(),
    MEMBER_IMPORT_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(3),
    MEMBER_IMPORT_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900000),
    AUTH_USER_CREATE_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(50),
    AUTH_USER_CREATE_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900000),
    REPORT_BRAND_NAME: z.string().min(1).default("SACCOS System"),
    REPORT_BRAND_SUBTITLE: z.string().min(1).default("Official Financial Report"),
    REPORT_BRAND_LOGO_PATH: z.string().optional(),
    OBSERVABILITY_ENABLED: z
        .string()
        .optional()
        .transform((value) => parseBooleanEnv(value, true)),
    OBSERVABILITY_SAMPLE_LIMIT: z.coerce.number().int().positive().default(500),
    METRICS_BEARER_TOKEN: z.string().min(8).optional(),
    SLO_LIST_ENDPOINT_P95_MS: z.coerce.number().positive().default(400),
    SLO_HEAVY_REPORT_P95_MS: z.coerce.number().positive().default(2000),
    SLO_ERROR_RATE_PCT: z.coerce.number().nonnegative().default(1),
    CREDIT_RISK_DEFAULT_DPD_THRESHOLD: z.coerce.number().int().positive().default(30),
    CREDIT_RISK_DEFAULT_DETECTION_SCHEDULER_ENABLED: z
        .string()
        .optional()
        .transform((value) => parseBooleanEnv(value, false)),
    CREDIT_RISK_DEFAULT_DETECTION_INTERVAL_MS: z.coerce.number().int().positive().default(900000),
    CREDIT_RISK_DEFAULT_DETECTION_MAX_TENANTS_PER_RUN: z.coerce.number().int().positive().default(200),
    CREDIT_RISK_DEFAULT_DETECTION_MAX_LOANS_PER_TENANT: z.coerce.number().int().positive().default(500),
    CREDIT_RISK_GUARANTOR_MAX_COMMITMENT_RATIO: z.coerce.number().positive().max(1).default(0.8),
    CREDIT_RISK_GUARANTOR_MIN_AVAILABLE_AMOUNT: z.coerce.number().nonnegative().default(0),
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
    supabaseFetchRetryMaxAttempts: env.SUPABASE_FETCH_RETRY_MAX_ATTEMPTS,
    supabaseFetchRetryBaseMs: env.SUPABASE_FETCH_RETRY_BASE_MS,
    supabaseFetchRetryMaxMs: env.SUPABASE_FETCH_RETRY_MAX_MS,
    jwtSecret: env.JWT_SECRET || "",
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
    idempotencyInProgressTtlMs: env.IDEMPOTENCY_IN_PROGRESS_TTL_MS,
    passwordSetupRedirectUrl: env.PASSWORD_SETUP_REDIRECT_URL || "",
    memberImportRateLimitMax: env.MEMBER_IMPORT_RATE_LIMIT_MAX,
    memberImportRateLimitWindowMs: env.MEMBER_IMPORT_RATE_LIMIT_WINDOW_MS,
    authUserCreateRateLimitMax: env.AUTH_USER_CREATE_RATE_LIMIT_MAX,
    authUserCreateRateLimitWindowMs: env.AUTH_USER_CREATE_RATE_LIMIT_WINDOW_MS,
    reportBrandName: env.REPORT_BRAND_NAME,
    reportBrandSubtitle: env.REPORT_BRAND_SUBTITLE,
    reportBrandLogoPath: env.REPORT_BRAND_LOGO_PATH || "",
    observabilityEnabled: env.OBSERVABILITY_ENABLED,
    observabilitySampleLimit: env.OBSERVABILITY_SAMPLE_LIMIT,
    metricsBearerToken: env.METRICS_BEARER_TOKEN || "",
    sloListEndpointP95Ms: env.SLO_LIST_ENDPOINT_P95_MS,
    sloHeavyReportP95Ms: env.SLO_HEAVY_REPORT_P95_MS,
    sloErrorRatePct: env.SLO_ERROR_RATE_PCT,
    creditRiskDefaultDpdThreshold: env.CREDIT_RISK_DEFAULT_DPD_THRESHOLD,
    creditRiskDefaultDetectionSchedulerEnabled: env.CREDIT_RISK_DEFAULT_DETECTION_SCHEDULER_ENABLED,
    creditRiskDefaultDetectionIntervalMs: env.CREDIT_RISK_DEFAULT_DETECTION_INTERVAL_MS,
    creditRiskDefaultDetectionMaxTenantsPerRun: env.CREDIT_RISK_DEFAULT_DETECTION_MAX_TENANTS_PER_RUN,
    creditRiskDefaultDetectionMaxLoansPerTenant: env.CREDIT_RISK_DEFAULT_DETECTION_MAX_LOANS_PER_TENANT,
    creditRiskGuarantorMaxCommitmentRatio: env.CREDIT_RISK_GUARANTOR_MAX_COMMITMENT_RATIO,
    creditRiskGuarantorMinAvailableAmount: env.CREDIT_RISK_GUARANTOR_MIN_AVAILABLE_AMOUNT,
    sslEnabled: env.SSL_ENABLED,
    logLevel: env.LOG_LEVEL
};
