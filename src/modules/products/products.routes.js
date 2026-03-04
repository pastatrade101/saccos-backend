const express = require("express");

const auth = require("../../middleware/auth");
const authorize = require("../../middleware/authorize");
const requireSubscription = require("../../middleware/require-subscription");
const validate = require("../../middleware/validate");
const { ROLES } = require("../../constants/roles");
const controller = require("./products.controller");
const schemas = require("./products.schemas");

const router = express.Router();

router.use(auth, requireSubscription());

router.get(
    "/bootstrap",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER, ROLES.AUDITOR], { allowInternalOps: false }),
    controller.bootstrap
);

router.get(
    "/savings",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER, ROLES.AUDITOR], { allowInternalOps: false }),
    controller.listSavingsProducts
);
router.get(
    "/loans",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER, ROLES.AUDITOR, ROLES.MEMBER], { allowInternalOps: false }),
    controller.listLoanProducts
);
router.post(
    "/loans",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER], { allowInternalOps: false }),
    validate(schemas.loanProductSchema),
    controller.createLoanProduct
);
router.patch(
    "/loans/:id",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER], { allowInternalOps: false }),
    validate(schemas.updateLoanProductSchema),
    controller.updateLoanProduct
);
router.post(
    "/savings",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER], { allowInternalOps: false }),
    validate(schemas.savingsProductSchema),
    controller.createSavingsProduct
);
router.patch(
    "/savings/:id",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER], { allowInternalOps: false }),
    validate(schemas.updateSavingsProductSchema),
    controller.updateSavingsProduct
);

router.get(
    "/shares",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER, ROLES.AUDITOR], { allowInternalOps: false }),
    controller.listShareProducts
);
router.post(
    "/shares",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER], { allowInternalOps: false }),
    validate(schemas.shareProductSchema),
    controller.createShareProduct
);
router.patch(
    "/shares/:id",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER], { allowInternalOps: false }),
    validate(schemas.updateShareProductSchema),
    controller.updateShareProduct
);

router.get(
    "/fees",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER, ROLES.AUDITOR], { allowInternalOps: false }),
    controller.listFeeRules
);
router.post(
    "/fees",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER], { allowInternalOps: false }),
    validate(schemas.feeRuleSchema),
    controller.createFeeRule
);
router.patch(
    "/fees/:id",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER], { allowInternalOps: false }),
    validate(schemas.updateFeeRuleSchema),
    controller.updateFeeRule
);

router.get(
    "/penalties",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER, ROLES.AUDITOR], { allowInternalOps: false }),
    controller.listPenaltyRules
);
router.post(
    "/penalties",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER], { allowInternalOps: false }),
    validate(schemas.penaltyRuleSchema),
    controller.createPenaltyRule
);
router.patch(
    "/penalties/:id",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER], { allowInternalOps: false }),
    validate(schemas.updatePenaltyRuleSchema),
    controller.updatePenaltyRule
);

router.get(
    "/posting-rules",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER, ROLES.AUDITOR], { allowInternalOps: false }),
    controller.listPostingRules
);
router.post(
    "/posting-rules",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER], { allowInternalOps: false }),
    validate(schemas.postingRuleSchema),
    controller.createPostingRule
);
router.patch(
    "/posting-rules/:id",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER], { allowInternalOps: false }),
    validate(schemas.updatePostingRuleSchema),
    controller.updatePostingRule
);

module.exports = router;
