const express = require("express");

const auth = require("../../middleware/auth");
const authorize = require("../../middleware/authorize");
const requireFeature = require("../../middleware/require-feature");
const requireSubscription = require("../../middleware/require-subscription");
const validate = require("../../middleware/validate");
const { ROLES } = require("../../constants/roles");
const controller = require("./notification-settings.controller");
const schemas = require("./notification-settings.schemas");

const router = express.Router();

router.use(auth, requireSubscription(), requireFeature("sms_trigger_controls_enabled"));

router.get(
    "/sms-triggers",
    authorize([ROLES.SUPER_ADMIN], { allowInternalOps: false }),
    validate(schemas.listSmsTriggersQuerySchema, "query"),
    controller.listSmsTriggers
);

router.patch(
    "/sms-triggers/:eventType",
    authorize([ROLES.SUPER_ADMIN], { allowInternalOps: false }),
    validate(schemas.smsTriggerParamSchema, "params"),
    validate(schemas.updateSmsTriggerSchema),
    controller.updateSmsTrigger
);

module.exports = router;
