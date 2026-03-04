const express = require("express");

const auth = require("../../middleware/auth");
const authorize = require("../../middleware/authorize");
const requireFeature = require("../../middleware/require-feature");
const requireSubscription = require("../../middleware/require-subscription");
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

router.use(auth, requireSubscription());

router.get("/options", authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.AUDITOR], { allowInternalOps: false }), requireFeature("dividends_enabled"), controller.getOptions);
router.get("/cycles", authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.AUDITOR], { allowInternalOps: false }), requireFeature("dividends_enabled"), validate(cycleQuerySchema, "query"), controller.listCycles);
router.get("/cycles/:id", authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.AUDITOR], { allowInternalOps: false }), requireFeature("dividends_enabled"), validate(cycleParamSchema, "params"), controller.getCycle);
router.post("/cycles", authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER], { allowInternalOps: false }), requireFeature("dividends_enabled"), validate(createCycleSchema), controller.createCycle);
router.patch("/cycles/:id", authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER], { allowInternalOps: false }), requireFeature("dividends_enabled"), validate(cycleParamSchema, "params"), validate(updateCycleSchema), controller.updateCycle);
router.post("/cycles/:id/freeze", authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER], { allowInternalOps: false }), requireFeature("dividends_enabled"), validate(cycleParamSchema, "params"), controller.freezeCycle);
router.post("/cycles/:id/allocate", authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER], { allowInternalOps: false }), requireFeature("dividends_enabled"), validate(cycleParamSchema, "params"), controller.allocateCycle);
router.post("/cycles/:id/approve", authorize([ROLES.BRANCH_MANAGER], { allowInternalOps: false }), requireFeature("dividends_enabled"), validate(cycleParamSchema, "params"), validate(approvalSchema), controller.approveCycle);
router.post("/cycles/:id/reject", authorize([ROLES.BRANCH_MANAGER], { allowInternalOps: false }), requireFeature("dividends_enabled"), validate(cycleParamSchema, "params"), validate(approvalSchema), controller.rejectCycle);
router.post("/cycles/:id/pay", authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER], { allowInternalOps: false }), requireFeature("dividends_enabled"), validate(cycleParamSchema, "params"), validate(paymentSchema), controller.payCycle);
router.post("/cycles/:id/close", authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER], { allowInternalOps: false }), requireFeature("dividends_enabled"), validate(cycleParamSchema, "params"), controller.closeCycle);

module.exports = router;
