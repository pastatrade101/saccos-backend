const { z } = require("zod");
const { NOTIFICATION_PREFERENCE_EVENT_TYPES } = require("./notifications.constants");

const uuid = z.string().uuid();
const booleanQuery = z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((value) => value === true || value === "true" || value === "1");

const listNotificationsQuerySchema = z.object({
    tenant_id: uuid.optional(),
    status: z.enum(["all", "unread", "read", "archived"]).default("all"),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    recent_only: booleanQuery.default(false)
});

const notificationParamSchema = z.object({
    notificationId: uuid
});

const markAllReadSchema = z.object({
    tenant_id: uuid.optional()
});

const listNotificationPreferencesQuerySchema = z.object({
    tenant_id: uuid.optional()
});

const updateNotificationPreferenceParamSchema = z.object({
    eventType: z.enum(NOTIFICATION_PREFERENCE_EVENT_TYPES)
});

const updateNotificationPreferenceSchema = z.object({
    tenant_id: uuid.optional(),
    in_app_enabled: z.boolean().optional(),
    sms_enabled: z.boolean().optional(),
    toast_enabled: z.boolean().optional()
}).refine(
    (value) => value.in_app_enabled !== undefined || value.sms_enabled !== undefined || value.toast_enabled !== undefined,
    { message: "At least one preference value must be provided." }
);

const archiveReadNotificationsSchema = z.object({
    tenant_id: uuid.optional()
});

module.exports = {
    listNotificationsQuerySchema,
    notificationParamSchema,
    markAllReadSchema,
    listNotificationPreferencesQuerySchema,
    updateNotificationPreferenceParamSchema,
    updateNotificationPreferenceSchema,
    archiveReadNotificationsSchema
};
