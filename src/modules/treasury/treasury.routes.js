const express = require("express");

const auth = require("../../middleware/auth");
const authorize = require("../../middleware/authorize");
const idempotency = require("../../middleware/idempotency");
const validate = require("../../middleware/validate");
const { ROLES } = require("../../constants/roles");
const controller = require("./treasury.controller");
const schemas = require("./treasury.schemas");

const router = express.Router();

router.use(auth);

router.get(
    "/overview",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.TREASURY_OFFICER, ROLES.AUDITOR], { allowInternalOps: false }),
    validate(schemas.tenantScopedQuerySchema, "query"),
    controller.getOverview
);

router.get(
    "/liquidity",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.TREASURY_OFFICER, ROLES.AUDITOR], { allowInternalOps: false }),
    validate(schemas.tenantScopedQuerySchema, "query"),
    controller.getLiquidityOverview
);

router.get(
    "/policy",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.TREASURY_OFFICER, ROLES.AUDITOR], { allowInternalOps: false }),
    validate(schemas.tenantScopedQuerySchema, "query"),
    controller.getPolicy
);

router.get(
    "/audit-log",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.TREASURY_OFFICER, ROLES.AUDITOR], { allowInternalOps: false }),
    validate(schemas.listAuditLogQuerySchema, "query"),
    controller.getAuditLog
);

router.patch(
    "/policy",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER], { allowInternalOps: false }),
    validate(schemas.updatePolicySchema),
    controller.updatePolicy
);

router.get(
    "/assets",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.TREASURY_OFFICER, ROLES.AUDITOR], { allowInternalOps: false }),
    validate(schemas.listAssetsQuerySchema, "query"),
    controller.listAssets
);

router.post(
    "/assets",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.TREASURY_OFFICER], { allowInternalOps: false }),
    validate(schemas.createAssetSchema),
    idempotency,
    controller.createAsset
);

router.get(
    "/portfolio",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.TREASURY_OFFICER, ROLES.AUDITOR], { allowInternalOps: false }),
    validate(schemas.listPortfolioQuerySchema, "query"),
    controller.getPortfolio
);

router.patch(
    "/portfolio/:assetId/valuation",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.TREASURY_OFFICER], { allowInternalOps: false }),
    validate(schemas.assetIdParamSchema, "params"),
    validate(schemas.updateValuationSchema),
    controller.updateValuation
);

router.get(
    "/orders",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.TREASURY_OFFICER, ROLES.AUDITOR], { allowInternalOps: false }),
    validate(schemas.listOrdersQuerySchema, "query"),
    controller.listOrders
);

router.post(
    "/orders",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.TREASURY_OFFICER], { allowInternalOps: false }),
    validate(schemas.createOrderSchema),
    idempotency,
    controller.createOrder
);

router.post(
    "/orders/:orderId/review",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER], { allowInternalOps: false }),
    validate(schemas.orderIdParamSchema, "params"),
    validate(schemas.reviewOrderSchema),
    controller.reviewOrder
);

router.post(
    "/orders/:orderId/execute",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER], { allowInternalOps: false }),
    validate(schemas.orderIdParamSchema, "params"),
    validate(schemas.executeOrderSchema),
    idempotency,
    controller.executeOrder
);

router.get(
    "/transactions",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.TREASURY_OFFICER, ROLES.AUDITOR], { allowInternalOps: false }),
    validate(schemas.listTransactionsQuerySchema, "query"),
    controller.listTransactions
);

router.get(
    "/income",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.TREASURY_OFFICER, ROLES.AUDITOR], { allowInternalOps: false }),
    validate(schemas.listIncomeQuerySchema, "query"),
    controller.listIncome
);

router.post(
    "/income",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.TREASURY_OFFICER], { allowInternalOps: false }),
    validate(schemas.recordIncomeSchema),
    idempotency,
    controller.recordIncome
);

module.exports = router;
