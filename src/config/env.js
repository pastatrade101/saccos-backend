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
    SUPABASE_AUTH_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(8000),
    SUPABASE_AUTH_RETRY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(2),
    SUPABASE_AUTH_RETRY_BASE_MS: z.coerce.number().int().positive().default(120),
    SUPABASE_AUTH_RETRY_MAX_MS: z.coerce.number().int().positive().default(700),
    JWT_SECRET: z.string().min(16).optional(),
    RECEIPTS_BUCKET: z.string().default("receipts"),
    IMPORTS_BUCKET: z.string().default("imports"),
    AUDIT_EVIDENCE_BUCKET: z.string().optional(),
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
    TWO_FACTOR_ISSUER: z.string().min(2).default("SACCO Control"),
    TWO_FACTOR_ENCRYPTION_KEY: z.string().min(16).optional(),
    TWO_FACTOR_BACKUP_CODE_PEPPER: z.string().min(16).optional(),
    TWO_FACTOR_STEP_UP_TTL_MINUTES: z.coerce.number().int().positive().default(15),
    TWO_FACTOR_MAX_FAILED_ATTEMPTS: z.coerce.number().int().positive().default(5),
    TWO_FACTOR_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),
    BRANCH_ALERT_SMS_ENABLED: z
        .string()
        .optional()
        .transform((value) => parseBooleanEnv(value, true)),
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
    SCHEMA_CHECK_ENABLED: z
        .string()
        .optional()
        .transform((value) => parseBooleanEnv(value, true)),
    SCHEMA_CHECK_STRICT: z
        .string()
        .optional()
        .transform((value) => parseBooleanEnv(value, isProductionEnv)),
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
    REPAYMENT_REMINDER_SCHEDULER_ENABLED: z
        .string()
        .optional()
        .transform((value) => parseBooleanEnv(value, false)),
    REPAYMENT_REMINDER_INTERVAL_MS: z.coerce.number().int().positive().default(3600000),
    REPAYMENT_REMINDER_MAX_TENANTS_PER_RUN: z.coerce.number().int().positive().default(200),
    REPAYMENT_REMINDER_MAX_SCHEDULES_PER_TENANT: z.coerce.number().int().positive().default(500),
    REPAYMENT_REMINDER_DUE_SOON_DAYS: z.coerce.number().int().positive().default(1),
    CREDIT_RISK_GUARANTOR_MAX_COMMITMENT_RATIO: z.coerce.number().positive().max(1).default(0.8),
    CREDIT_RISK_GUARANTOR_MIN_AVAILABLE_AMOUNT: z.coerce.number().nonnegative().default(0),
    SNIPPE_ENABLED: z
        .string()
        .optional()
        .transform((value) => parseBooleanEnv(value, false)),
    SNIPPE_API_KEY: z.string().optional(),
    SNIPPE_BASE_URL: z.string().url().default("https://api.snippe.sh"),
    SNIPPE_CURRENCY: z.string().default("TZS"),
    SNIPPE_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
    SNIPPE_INTENT_TTL_SECONDS: z.coerce.number().int().positive().default(14400),
    SNIPPE_WEBHOOK_SECRET: z.string().optional(),
    SNIPPE_WEBHOOK_URL: z.string().url().optional(),
    SNIPPE_SOURCE_LABEL: z.string().default("saccos_member_portal"),
    SNIPPE_WEBHOOK_DEBUG_ALLOW_INVALID: z
        .string()
        .optional()
        .transform((value) => parseBooleanEnv(value, false)),
    AZAMPAY_ENABLED: z
        .string()
        .optional()
        .transform((value) => parseBooleanEnv(value, false)),
    AZAMPAY_APP_NAME: z.string().optional(),
    AZAMPAY_CLIENT_ID: z.string().optional(),
    AZAMPAY_CLIENT_SECRET: z.string().optional(),
    AZAMPAY_AUTH_URL: z.string().url().default("https://authenticator-sandbox.azampay.co.tz/AppRegistration/GenerateToken"),
    AZAMPAY_CHECKOUT_URL: z.string().url().default("https://sandbox.azampay.co.tz/azampay/mno/checkout"),
    AZAMPAY_CURRENCY: z.string().default("TZS"),
    AZAMPAY_AUTH_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),
    AZAMPAY_CHECKOUT_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
    AZAMPAY_TOKEN_TTL_MS: z.coerce.number().int().positive().default(240000),
    AZAMPAY_INTENT_TTL_SECONDS: z.coerce.number().int().positive().default(300),
    AZAMPAY_SOURCE_LABEL: z.string().default("saccos_member_portal"),
    SSL_ENABLED: z
        .string()
        .optional()
        .transform((value) => parseBooleanEnv(value, false)),
    LOG_LEVEL: z.string().default("info"),
    SINGLE_TENANT_ID: z.string().uuid().optional()
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
    supabaseAuthTimeoutMs: env.SUPABASE_AUTH_TIMEOUT_MS,
    supabaseAuthRetryMaxAttempts: env.SUPABASE_AUTH_RETRY_MAX_ATTEMPTS,
    supabaseAuthRetryBaseMs: env.SUPABASE_AUTH_RETRY_BASE_MS,
    supabaseAuthRetryMaxMs: env.SUPABASE_AUTH_RETRY_MAX_MS,
    jwtSecret: env.JWT_SECRET || "",
    receiptsBucket: env.RECEIPTS_BUCKET,
    importsBucket: env.IMPORTS_BUCKET,
    auditEvidenceBucket: env.AUDIT_EVIDENCE_BUCKET || env.RECEIPTS_BUCKET,
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
    twoFactorIssuer: env.TWO_FACTOR_ISSUER,
    twoFactorEncryptionKey: env.TWO_FACTOR_ENCRYPTION_KEY || env.TEMP_PASSWORD_ENCRYPTION_KEY || env.SUPABASE_SERVICE_ROLE_KEY,
    twoFactorBackupCodePepper: env.TWO_FACTOR_BACKUP_CODE_PEPPER || env.SUPABASE_SERVICE_ROLE_KEY,
    twoFactorStepUpTtlMinutes: env.TWO_FACTOR_STEP_UP_TTL_MINUTES,
    twoFactorMaxFailedAttempts: env.TWO_FACTOR_MAX_FAILED_ATTEMPTS,
    twoFactorLockoutMinutes: env.TWO_FACTOR_LOCKOUT_MINUTES,
    branchAlertSmsEnabled: env.BRANCH_ALERT_SMS_ENABLED,
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
    schemaCheckEnabled: env.SCHEMA_CHECK_ENABLED,
    schemaCheckStrict: env.SCHEMA_CHECK_STRICT,
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
    repaymentReminderSchedulerEnabled: env.REPAYMENT_REMINDER_SCHEDULER_ENABLED,
    repaymentReminderIntervalMs: env.REPAYMENT_REMINDER_INTERVAL_MS,
    repaymentReminderMaxTenantsPerRun: env.REPAYMENT_REMINDER_MAX_TENANTS_PER_RUN,
    repaymentReminderMaxSchedulesPerTenant: env.REPAYMENT_REMINDER_MAX_SCHEDULES_PER_TENANT,
    repaymentReminderDueSoonDays: env.REPAYMENT_REMINDER_DUE_SOON_DAYS,
    creditRiskGuarantorMaxCommitmentRatio: env.CREDIT_RISK_GUARANTOR_MAX_COMMITMENT_RATIO,
    creditRiskGuarantorMinAvailableAmount: env.CREDIT_RISK_GUARANTOR_MIN_AVAILABLE_AMOUNT,
    snippeEnabled: env.SNIPPE_ENABLED,
    snippeApiKey: env.SNIPPE_API_KEY || "",
    snippeBaseUrl: env.SNIPPE_BASE_URL,
    snippeCurrency: env.SNIPPE_CURRENCY,
    snippeTimeoutMs: env.SNIPPE_TIMEOUT_MS,
    snippeIntentTtlSeconds: env.SNIPPE_INTENT_TTL_SECONDS,
    snippeWebhookSecret: env.SNIPPE_WEBHOOK_SECRET || "",
    snippeWebhookUrl: env.SNIPPE_WEBHOOK_URL || "",
    snippeSourceLabel: env.SNIPPE_SOURCE_LABEL,
    snippeWebhookDebugAllowInvalid: env.SNIPPE_WEBHOOK_DEBUG_ALLOW_INVALID,
    azamPayEnabled: env.AZAMPAY_ENABLED,
    azamPayAppName: env.AZAMPAY_APP_NAME || "",
    azamPayClientId: env.AZAMPAY_CLIENT_ID || "",
    azamPayClientSecret: env.AZAMPAY_CLIENT_SECRET || "",
    azamPayAuthUrl: env.AZAMPAY_AUTH_URL,
    azamPayCheckoutUrl: env.AZAMPAY_CHECKOUT_URL,
    azamPayCurrency: env.AZAMPAY_CURRENCY,
    azamPayAuthTimeoutMs: env.AZAMPAY_AUTH_TIMEOUT_MS,
    azamPayCheckoutTimeoutMs: env.AZAMPAY_CHECKOUT_TIMEOUT_MS,
    azamPayTokenTtlMs: env.AZAMPAY_TOKEN_TTL_MS,
    azamPayIntentTtlSeconds: env.AZAMPAY_INTENT_TTL_SECONDS,
    azamPaySourceLabel: env.AZAMPAY_SOURCE_LABEL,
    sslEnabled: env.SSL_ENABLED,
    logLevel: env.LOG_LEVEL,
    singleTenantId: env.SINGLE_TENANT_ID || null
};
