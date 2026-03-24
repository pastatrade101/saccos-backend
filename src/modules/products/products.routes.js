const express = require("express");

const auth = require("../../middleware/auth");
const authorize = require("../../middleware/authorize");
const validate = require("../../middleware/validate");
const { ROLES } = require("../../constants/roles");
const controller = require("./products.controller");
const schemas = require("./products.schemas");

const router = express.Router();
const PRODUCT_MANAGER_ROLES = [ROLES.BRANCH_MANAGER, ROLES.SUPER_ADMIN, ROLES.PLATFORM_ADMIN, ROLES.PLATFORM_OWNER];

router.use(auth);

router.get(
    "/bootstrap",
    authorize(PRODUCT_MANAGER_ROLES, { allowInternalOps: false }),
    controller.bootstrap
);

router.get(
    "/savings",
    authorize(PRODUCT_MANAGER_ROLES, { allowInternalOps: false }),
    validate(schemas.listProductsQuerySchema, "query"),
    controller.listSavingsProducts
);
router.get(
    "/loans",
    authorize([ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER, ROLES.AUDITOR, ROLES.MEMBER], { allowInternalOps: false }),
    validate(schemas.listProductsQuerySchema, "query"),
    controller.listLoanProducts
);
router.post(
    "/loans",
    authorize(PRODUCT_MANAGER_ROLES, { allowInternalOps: false }),
    validate(schemas.loanProductSchema),
    controller.createLoanProduct
);
router.patch(
    "/loans/:id",
    authorize(PRODUCT_MANAGER_ROLES, { allowInternalOps: false }),
    validate(schemas.updateLoanProductSchema),
    controller.updateLoanProduct
);
router.post(
    "/savings",
    authorize(PRODUCT_MANAGER_ROLES, { allowInternalOps: false }),
    validate(schemas.savingsProductSchema),
    controller.createSavingsProduct
);
router.patch(
    "/savings/:id",
    authorize(PRODUCT_MANAGER_ROLES, { allowInternalOps: false }),
    validate(schemas.updateSavingsProductSchema),
    controller.updateSavingsProduct
);

router.get(
    "/shares",
    authorize(PRODUCT_MANAGER_ROLES, { allowInternalOps: false }),
    validate(schemas.listProductsQuerySchema, "query"),
    controller.listShareProducts
);
router.post(
    "/shares",
    authorize(PRODUCT_MANAGER_ROLES, { allowInternalOps: false }),
    validate(schemas.shareProductSchema),
    controller.createShareProduct
);
router.patch(
    "/shares/:id",
    authorize(PRODUCT_MANAGER_ROLES, { allowInternalOps: false }),
    validate(schemas.updateShareProductSchema),
    controller.updateShareProduct
);

router.get(
    "/fees",
    authorize(PRODUCT_MANAGER_ROLES, { allowInternalOps: false }),
    validate(schemas.listProductsQuerySchema, "query"),
    controller.listFeeRules
);
router.post(
    "/fees",
    authorize(PRODUCT_MANAGER_ROLES, { allowInternalOps: false }),
    validate(schemas.feeRuleSchema),
    controller.createFeeRule
);
router.patch(
    "/fees/:id",
    authorize(PRODUCT_MANAGER_ROLES, { allowInternalOps: false }),
    validate(schemas.updateFeeRuleSchema),
    controller.updateFeeRule
);

router.get(
    "/penalties",
    authorize(PRODUCT_MANAGER_ROLES, { allowInternalOps: false }),
    validate(schemas.listProductsQuerySchema, "query"),
    controller.listPenaltyRules
);
router.post(
    "/penalties",
    authorize(PRODUCT_MANAGER_ROLES, { allowInternalOps: false }),
    validate(schemas.penaltyRuleSchema),
    controller.createPenaltyRule
);
router.patch(
    "/penalties/:id",
    authorize(PRODUCT_MANAGER_ROLES, { allowInternalOps: false }),
    validate(schemas.updatePenaltyRuleSchema),
    controller.updatePenaltyRule
);

router.get(
    "/posting-rules",
    authorize(PRODUCT_MANAGER_ROLES, { allowInternalOps: false }),
    validate(schemas.listProductsQuerySchema, "query"),
    controller.listPostingRules
);
router.post(
    "/posting-rules",
    authorize(PRODUCT_MANAGER_ROLES, { allowInternalOps: false }),
    validate(schemas.postingRuleSchema),
    controller.createPostingRule
);
router.patch(
    "/posting-rules/:id",
    authorize(PRODUCT_MANAGER_ROLES, { allowInternalOps: false }),
    validate(schemas.updatePostingRuleSchema),
    controller.updatePostingRule
);

module.exports = router;
