const express = require("express");

const auth = require("../../middleware/auth");
const authorize = require("../../middleware/authorize");
const validate = require("../../middleware/validate");
const { ROLES } = require("../../constants/roles");
const controller = require("./notifications.controller");
const schemas = require("./notifications.schemas");

const router = express.Router();

router.use(auth);
router.use(authorize([
    ROLES.SUPER_ADMIN,
    ROLES.BRANCH_MANAGER,
    ROLES.LOAN_OFFICER,
    ROLES.TELLER,
    ROLES.AUDITOR,
    ROLES.MEMBER
]));

router.get(
    "/",
    validate(schemas.listNotificationsQuerySchema, "query"),
    controller.listNotifications
);

router.get(
    "/preferences",
    validate(schemas.listNotificationPreferencesQuerySchema, "query"),
    controller.listNotificationPreferences
);

router.patch(
    "/preferences/:eventType",
    validate(schemas.updateNotificationPreferenceParamSchema, "params"),
    validate(schemas.updateNotificationPreferenceSchema),
    controller.updateNotificationPreference
);

router.patch(
    "/read-all",
    validate(schemas.markAllReadSchema),
    controller.markAllNotificationsRead
);

router.patch(
    "/archive-read",
    validate(schemas.archiveReadNotificationsSchema),
    controller.archiveReadNotifications
);

router.patch(
    "/:notificationId/read",
    validate(schemas.notificationParamSchema, "params"),
    controller.markNotificationRead
);

router.patch(
    "/:notificationId/archive",
    validate(schemas.notificationParamSchema, "params"),
    controller.archiveNotification
);

module.exports = router;
