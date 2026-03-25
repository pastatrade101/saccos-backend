const express = require("express");

const auth = require("../../middleware/auth");
const authorize = require("../../middleware/authorize");
const validate = require("../../middleware/validate");
const { ROLES } = require("../../constants/roles");
const controller = require("./loan-capacity.controller");
const schemas = require("./loan-capacity.schemas");

const router = express.Router();

router.use(auth);

router.get(
    "/capacity",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER, ROLES.AUDITOR, ROLES.MEMBER], { allowInternalOps: false }),
    validate(schemas.capacityQuerySchema, "query"),
    controller.getBorrowLimit
);

router.get(
    "/products/:loanProductId/policy",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER, ROLES.AUDITOR], { allowInternalOps: false }),
    validate(schemas.loanProductPolicyParamSchema, "params"),
    validate(schemas.tenantScopedQuerySchema, "query"),
    controller.getLoanProductPolicy
);

router.patch(
    "/products/:loanProductId/policy",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER], { allowInternalOps: false }),
    validate(schemas.loanProductPolicyParamSchema, "params"),
    validate(schemas.updateLoanProductPolicySchema),
    controller.updateLoanProductPolicy
);

router.get(
    "/branches/:branchId/liquidity-policy",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER, ROLES.AUDITOR], { allowInternalOps: false }),
    validate(schemas.branchParamSchema, "params"),
    validate(schemas.tenantScopedQuerySchema, "query"),
    controller.getBranchLiquidityPolicy
);

router.patch(
    "/branches/:branchId/liquidity-policy",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER], { allowInternalOps: false }),
    validate(schemas.branchParamSchema, "params"),
    validate(schemas.updateBranchLiquidityPolicySchema),
    controller.updateBranchLiquidityPolicy
);

router.get(
    "/branches/:branchId/fund-pool",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER, ROLES.AUDITOR], { allowInternalOps: false }),
    validate(schemas.branchParamSchema, "params"),
    validate(schemas.tenantScopedQuerySchema, "query"),
    controller.getBranchFundPool
);

router.get(
    "/branches/:branchId/dashboard",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.AUDITOR], { allowInternalOps: false }),
    validate(schemas.branchParamSchema, "params"),
    validate(schemas.dashboardQuerySchema, "query"),
    controller.getBranchDashboard
);

module.exports = router;
