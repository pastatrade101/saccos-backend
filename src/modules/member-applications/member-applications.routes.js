const express = require("express");

const auth = require("../../middleware/auth");
const authorize = require("../../middleware/authorize");
const idempotency = require("../../middleware/idempotency");
const requireSubscription = require("../../middleware/require-subscription");
const validate = require("../../middleware/validate");
const { ROLES } = require("../../constants/roles");
const controller = require("./member-applications.controller");
const schemas = require("./member-applications.schemas");

const router = express.Router();

router.use(auth, requireSubscription());

router.get(
    "/",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.AUDITOR], { allowInternalOps: false }),
    validate(schemas.listApplicationsQuerySchema, "query"),
    controller.listApplications
);
router.get(
    "/:id",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.AUDITOR], { allowInternalOps: false }),
    controller.getApplication
);
router.post(
    "/",
    authorize([ROLES.BRANCH_MANAGER], { allowInternalOps: false }),
    validate(schemas.createApplicationSchema),
    controller.createApplication
);
router.patch(
    "/:id",
    authorize([ROLES.BRANCH_MANAGER], { allowInternalOps: false }),
    validate(schemas.updateApplicationSchema),
    controller.updateApplication
);
router.post(
    "/:id/submit",
    authorize([ROLES.BRANCH_MANAGER], { allowInternalOps: false }),
    controller.submitApplication
);
router.post(
    "/:id/review",
    authorize([ROLES.BRANCH_MANAGER], { allowInternalOps: false }),
    validate(schemas.reviewApplicationSchema),
    controller.reviewApplication
);
router.post(
    "/:id/approve",
    authorize([ROLES.SUPER_ADMIN], { allowInternalOps: false }),
    idempotency,
    controller.approveApplication
);
router.post(
    "/:id/reject",
    authorize([ROLES.SUPER_ADMIN], { allowInternalOps: false }),
    validate(schemas.rejectApplicationSchema),
    controller.rejectApplication
);

module.exports = router;
