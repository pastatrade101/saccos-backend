const express = require("express");

const auth = require("../../middleware/auth");
const authorize = require("../../middleware/authorize");
const validate = require("../../middleware/validate");
const { ROLES } = require("../../constants/roles");
const controller = require("./member-portal-settings.controller");
const schemas = require("./member-portal-settings.schemas");

const router = express.Router();

router.use(auth);

router.get(
    "/payment-controls",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.TREASURY_OFFICER, ROLES.LOAN_OFFICER, ROLES.TELLER, ROLES.AUDITOR, ROLES.MEMBER], { allowInternalOps: false }),
    validate(schemas.paymentControlsQuerySchema, "query"),
    controller.getPaymentControls
);

router.patch(
    "/payment-controls",
    authorize([ROLES.SUPER_ADMIN], { allowInternalOps: false }),
    validate(schemas.updatePaymentControlsSchema),
    controller.updatePaymentControls
);

module.exports = router;
