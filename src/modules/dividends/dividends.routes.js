const express = require("express");

const auth = require("../../middleware/auth");
const authorize = require("../../middleware/authorize");
const idempotency = require("../../middleware/idempotency");
const validate = require("../../middleware/validate");
const { ROLES } = require("../../constants/roles");
const controller = require("./dividends.controller");
const {
    approvalSchema,
    createCycleSchema,
    cycleParamSchema,
    cycleQuerySchema,
    paymentSchema,
    updateCycleSchema
} = require("./dividends.schemas");

const router = express.Router();

router.use(auth);

router.get("/options", authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.AUDITOR], { allowInternalOps: false }), controller.getOptions);
router.get("/cycles", authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.AUDITOR], { allowInternalOps: false }), validate(cycleQuerySchema, "query"), controller.listCycles);
router.get("/cycles/:id", authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.AUDITOR], { allowInternalOps: false }), validate(cycleParamSchema, "params"), controller.getCycle);
router.post("/cycles", authorize([ROLES.BRANCH_MANAGER], { allowInternalOps: false }), validate(createCycleSchema), controller.createCycle);
router.patch("/cycles/:id", authorize([ROLES.BRANCH_MANAGER], { allowInternalOps: false }), validate(cycleParamSchema, "params"), validate(updateCycleSchema), controller.updateCycle);
router.post("/cycles/:id/freeze", authorize([ROLES.BRANCH_MANAGER], { allowInternalOps: false }), validate(cycleParamSchema, "params"), controller.freezeCycle);
router.post("/cycles/:id/allocate", authorize([ROLES.BRANCH_MANAGER], { allowInternalOps: false }), validate(cycleParamSchema, "params"), controller.allocateCycle);
router.post("/cycles/:id/submit", authorize([ROLES.BRANCH_MANAGER], { allowInternalOps: false }), validate(cycleParamSchema, "params"), controller.submitCycle);
router.post("/cycles/:id/approve", authorize([ROLES.SUPER_ADMIN], { allowInternalOps: false }), validate(cycleParamSchema, "params"), validate(approvalSchema), idempotency, controller.approveCycle);
router.post("/cycles/:id/reject", authorize([ROLES.SUPER_ADMIN], { allowInternalOps: false }), validate(cycleParamSchema, "params"), validate(approvalSchema), controller.rejectCycle);
router.post("/cycles/:id/pay", authorize([ROLES.SUPER_ADMIN], { allowInternalOps: false }), validate(cycleParamSchema, "params"), validate(paymentSchema), idempotency, controller.payCycle);
router.post("/cycles/:id/close", authorize([ROLES.SUPER_ADMIN], { allowInternalOps: false }), validate(cycleParamSchema, "params"), idempotency, controller.closeCycle);

module.exports = router;
