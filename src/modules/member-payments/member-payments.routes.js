const express = require("express");

const auth = require("../../middleware/auth");
const authorize = require("../../middleware/authorize");
const idempotency = require("../../middleware/idempotency");
const validate = require("../../middleware/validate");
const { ROLES } = require("../../constants/roles");
const controller = require("./member-payments.controller");
const {
    initiateContributionPaymentSchema,
    initiateSavingsPaymentSchema,
    initiateMembershipFeePaymentSchema,
    initiateLoanRepaymentPaymentSchema,
    paymentOrderListQuerySchema,
    paymentOrderParamSchema
} = require("./member-payments.schemas");

const router = express.Router();

router.get("/azam/callback", controller.handleAzamCallback);
router.post(
    "/azam/callback",
    express.urlencoded({ extended: false }),
    express.json({ limit: "256kb" }),
    controller.handleAzamCallback
);

router.use(auth);

router.post(
    "/contributions/initiate",
    authorize([ROLES.MEMBER], { allowInternalOps: false }),
    validate(initiateContributionPaymentSchema),
    idempotency,
    controller.initiateContributionPayment
);

router.post(
    "/savings/initiate",
    authorize([ROLES.MEMBER], { allowInternalOps: false }),
    validate(initiateSavingsPaymentSchema),
    idempotency,
    controller.initiateSavingsPayment
);

router.post(
    "/membership-fee/initiate",
    authorize([ROLES.MEMBER], { allowInternalOps: false }),
    validate(initiateMembershipFeePaymentSchema),
    idempotency,
    controller.initiateMembershipFeePayment
);

router.post(
    "/loan-repayments/initiate",
    authorize([ROLES.MEMBER], { allowInternalOps: false }),
    validate(initiateLoanRepaymentPaymentSchema),
    idempotency,
    controller.initiateLoanRepaymentPayment
);

router.get(
    "/orders",
    authorize([ROLES.MEMBER, ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER, ROLES.AUDITOR], { allowInternalOps: false }),
    validate(paymentOrderListQuerySchema, "query"),
    controller.listPaymentOrders
);

router.get(
    "/orders/:id/status",
    authorize([ROLES.MEMBER, ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER, ROLES.AUDITOR], { allowInternalOps: false }),
    validate(paymentOrderParamSchema, "params"),
    controller.getPaymentOrderStatus
);

router.post(
    "/orders/:id/reconcile",
    authorize([ROLES.MEMBER, ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER, ROLES.AUDITOR], { allowInternalOps: false }),
    validate(paymentOrderParamSchema, "params"),
    idempotency,
    controller.reconcilePaymentOrder
);

module.exports = router;
