const { z } = require("zod");

const envSchema = z.object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(5000),
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
    SSL_ENABLED: z
        .string()
        .optional()
        .transform((value) => value === "true"),
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
    apiPrefix: env.API_PREFIX,
    bodyLimit: env.BODY_LIMIT,
    corsOrigins: env.CORS_ORIGINS
        ? env.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean)
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
    sslEnabled: env.SSL_ENABLED,
    logLevel: env.LOG_LEVEL
};
