const express = require("express");

const auth = require("../../middleware/auth");
const authorize = require("../../middleware/authorize");
const requireFeature = require("../../middleware/require-feature");
const requireSubscription = require("../../middleware/require-subscription");
const validate = require("../../middleware/validate");
const { ROLES } = require("../../constants/roles");
const controller = require("./credit-risk.controller");
const schemas = require("./credit-risk.schemas");

const router = express.Router();

router.use(auth, requireSubscription(), requireFeature("loans_enabled"));

router.get(
    "/default-cases",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER, ROLES.AUDITOR], { allowInternalOps: false }),
    validate(schemas.listDefaultCasesQuerySchema, "query"),
    controller.listDefaultCases
);

router.get(
    "/default-cases/:id",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER, ROLES.AUDITOR], { allowInternalOps: false }),
    validate(schemas.defaultCaseParamSchema, "params"),
    validate(schemas.tenantScopedLookupQuerySchema, "query"),
    controller.getDefaultCase
);

router.post(
    "/default-cases",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER], { allowInternalOps: false }),
    validate(schemas.createDefaultCaseSchema),
    controller.createDefaultCase
);

router.post(
    "/default-cases/:id/transition",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER], { allowInternalOps: false }),
    validate(schemas.defaultCaseParamSchema, "params"),
    validate(schemas.transitionDefaultCaseSchema),
    controller.transitionDefaultCase
);

router.get(
    "/collection-actions",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER, ROLES.AUDITOR], { allowInternalOps: false }),
    validate(schemas.listCollectionActionsQuerySchema, "query"),
    controller.listCollectionActions
);

router.post(
    "/collection-actions",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER], { allowInternalOps: false }),
    validate(schemas.createCollectionActionSchema),
    controller.createCollectionAction
);

router.patch(
    "/collection-actions/:actionId",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER], { allowInternalOps: false }),
    validate(schemas.collectionActionParamSchema, "params"),
    validate(schemas.updateCollectionActionSchema),
    controller.updateCollectionAction
);

router.post(
    "/collection-actions/:actionId/complete",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER], { allowInternalOps: false }),
    validate(schemas.collectionActionParamSchema, "params"),
    validate(schemas.completeCollectionActionSchema),
    controller.completeCollectionAction
);

router.post(
    "/collection-actions/:actionId/escalate",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER], { allowInternalOps: false }),
    validate(schemas.collectionActionParamSchema, "params"),
    validate(schemas.escalateCollectionActionSchema),
    controller.escalateCollectionAction
);

module.exports = router;
