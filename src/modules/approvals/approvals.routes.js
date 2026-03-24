const express = require("express");

const auth = require("../../middleware/auth");
const authorize = require("../../middleware/authorize");
const validate = require("../../middleware/validate");
const { ROLES } = require("../../constants/roles");
const controller = require("./approvals.controller");
const schemas = require("./approvals.schemas");

const router = express.Router();

router.use(auth);

router.get(
    "/policies",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER, ROLES.AUDITOR], { allowInternalOps: false }),
    validate(schemas.listApprovalPoliciesQuerySchema, "query"),
    controller.listPolicies
);

router.patch(
    "/policies/:operationKey",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER], { allowInternalOps: false }),
    validate(schemas.approvalPolicyParamSchema, "params"),
    validate(schemas.updateApprovalPolicySchema),
    controller.updatePolicy
);

router.get(
    "/requests",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER, ROLES.AUDITOR], { allowInternalOps: false }),
    validate(schemas.listApprovalRequestsQuerySchema, "query"),
    controller.listRequests
);

router.get(
    "/requests/:requestId",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER, ROLES.AUDITOR], { allowInternalOps: false }),
    validate(schemas.approvalRequestParamSchema, "params"),
    validate(schemas.tenantScopedLookupQuerySchema, "query"),
    controller.getRequest
);

router.post(
    "/requests/:requestId/approve",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER], { allowInternalOps: false }),
    validate(schemas.approvalRequestParamSchema, "params"),
    validate(schemas.approveRequestSchema),
    controller.approveRequest
);

router.post(
    "/requests/:requestId/reject",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER], { allowInternalOps: false }),
    validate(schemas.approvalRequestParamSchema, "params"),
    validate(schemas.rejectRequestSchema),
    controller.rejectRequest
);

module.exports = router;
