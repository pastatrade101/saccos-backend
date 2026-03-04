const express = require("express");

const auth = require("../../middleware/auth");
const authorize = require("../../middleware/authorize");
const requireFeature = require("../../middleware/require-feature");
const requireSubscription = require("../../middleware/require-subscription");
const validate = require("../../middleware/validate");
const { ROLES } = require("../../constants/roles");
const controller = require("./loan-applications.controller");
const schemas = require("./loan-applications.schemas");

const router = express.Router();

router.use(auth, requireSubscription(), requireFeature("loans_enabled"));

router.get(
    "/",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER, ROLES.AUDITOR, ROLES.MEMBER], { allowInternalOps: false }),
    validate(schemas.loanApplicationQuerySchema, "query"),
    controller.list
);

router.post(
    "/",
    authorize([ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER, ROLES.MEMBER], { allowInternalOps: false }),
    validate(schemas.createLoanApplicationSchema),
    controller.create
);

router.patch(
    "/:id",
    authorize([ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER, ROLES.MEMBER], { allowInternalOps: false }),
    validate(schemas.updateLoanApplicationSchema),
    controller.update
);

router.post(
    "/:id/submit",
    authorize([ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER, ROLES.MEMBER], { allowInternalOps: false }),
    controller.submit
);

router.post(
    "/:id/appraise",
    authorize([ROLES.LOAN_OFFICER], { allowInternalOps: false }),
    validate(schemas.appraiseLoanApplicationSchema),
    controller.appraise
);

router.post(
    "/:id/approve",
    authorize([ROLES.BRANCH_MANAGER], { allowInternalOps: false }),
    validate(schemas.approveLoanApplicationSchema),
    controller.approve
);

router.post(
    "/:id/reject",
    authorize([ROLES.BRANCH_MANAGER], { allowInternalOps: false }),
    validate(schemas.rejectLoanApplicationSchema),
    controller.reject
);

router.post(
    "/:id/disburse",
    authorize([ROLES.LOAN_OFFICER, ROLES.TELLER], { allowInternalOps: false }),
    validate(schemas.disburseApprovedLoanSchema),
    controller.disburse
);

module.exports = router;
