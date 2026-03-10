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

router.post(
    "/default-detection/run",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER]),
    validate(schemas.runDefaultDetectionSchema),
    controller.runDefaultDetection
);

router.get(
    "/guarantor-exposures",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER, ROLES.AUDITOR]),
    validate(schemas.listGuarantorExposuresQuerySchema, "query"),
    controller.listGuarantorExposures
);

router.post(
    "/guarantor-exposures/recompute",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER]),
    validate(schemas.recomputeGuarantorExposuresSchema),
    controller.recomputeGuarantorExposures
);

router.get(
    "/guarantor-claims",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER, ROLES.AUDITOR], { allowInternalOps: false }),
    validate(schemas.listGuarantorClaimsQuerySchema, "query"),
    controller.listGuarantorClaims
);

router.get(
    "/guarantor-claims/:claimId",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER, ROLES.AUDITOR], { allowInternalOps: false }),
    validate(schemas.guarantorClaimParamSchema, "params"),
    validate(schemas.tenantScopedLookupQuerySchema, "query"),
    controller.getGuarantorClaim
);

router.post(
    "/guarantor-claims",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER], { allowInternalOps: false }),
    validate(schemas.createGuarantorClaimSchema),
    controller.createGuarantorClaim
);

router.post(
    "/guarantor-claims/:claimId/submit",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER], { allowInternalOps: false }),
    validate(schemas.guarantorClaimParamSchema, "params"),
    validate(schemas.submitGuarantorClaimSchema),
    controller.submitGuarantorClaim
);

router.post(
    "/guarantor-claims/:claimId/approve",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER], { allowInternalOps: false }),
    validate(schemas.guarantorClaimParamSchema, "params"),
    validate(schemas.approveGuarantorClaimSchema),
    controller.approveGuarantorClaim
);

router.post(
    "/guarantor-claims/:claimId/reject",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER], { allowInternalOps: false }),
    validate(schemas.guarantorClaimParamSchema, "params"),
    validate(schemas.rejectGuarantorClaimSchema),
    controller.rejectGuarantorClaim
);

router.post(
    "/guarantor-claims/:claimId/post",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER], { allowInternalOps: false }),
    validate(schemas.guarantorClaimParamSchema, "params"),
    validate(schemas.postGuarantorClaimSchema),
    controller.postGuarantorClaim
);

router.post(
    "/guarantor-claims/:claimId/settle",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER], { allowInternalOps: false }),
    validate(schemas.guarantorClaimParamSchema, "params"),
    validate(schemas.settleGuarantorClaimSchema),
    controller.settleGuarantorClaim
);

router.post(
    "/guarantor-claims/:claimId/waive",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER], { allowInternalOps: false }),
    validate(schemas.guarantorClaimParamSchema, "params"),
    validate(schemas.waiveGuarantorClaimSchema),
    controller.waiveGuarantorClaim
);

module.exports = router;
