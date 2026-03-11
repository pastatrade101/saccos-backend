const { z } = require("zod");

const { SMS_TRIGGER_EVENT_TYPES } = require("./notification-settings.constants");

const uuid = z.string().uuid();
const smsTriggerEventTypeSchema = z.enum(SMS_TRIGGER_EVENT_TYPES);

const listSmsTriggersQuerySchema = z.object({
    tenant_id: uuid.optional()
});

const smsTriggerParamSchema = z.object({
    eventType: smsTriggerEventTypeSchema
});

const updateSmsTriggerSchema = z.object({
    tenant_id: uuid.optional(),
    enabled: z.boolean()
});

module.exports = {
    smsTriggerEventTypeSchema,
    listSmsTriggersQuerySchema,
    smsTriggerParamSchema,
    updateSmsTriggerSchema
};
