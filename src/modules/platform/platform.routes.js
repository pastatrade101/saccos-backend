const express = require("express");

const auth = require("../../middleware/auth");
const authorize = require("../../middleware/authorize");
const validate = require("../../middleware/validate");
const { ROLES } = require("../../constants/roles");
const controller = require("./platform.controller");
const {
    assignSubscriptionSchema,
    deleteTenantSchema,
    listPlansQuerySchema,
    listPlatformTenantsQuerySchema,
    planParamSchema,
    tenantParamSchema,
    updatePlanFeaturesSchema
} = require("./platform.schemas");

const router = express.Router();

router.use(auth, authorize([ROLES.PLATFORM_ADMIN]));

router.get("/plans", validate(listPlansQuerySchema, "query"), controller.listPlans);
router.patch("/plans/:planId/features", validate(planParamSchema, "params"), validate(updatePlanFeaturesSchema), controller.updatePlanFeatures);
router.get("/tenants", validate(listPlatformTenantsQuerySchema, "query"), controller.listTenants);
router.post("/tenants/:tenantId/subscription", validate(tenantParamSchema, "params"), validate(assignSubscriptionSchema), controller.assignSubscription);
router.delete("/tenants/:tenantId", validate(tenantParamSchema, "params"), validate(deleteTenantSchema), controller.deleteTenant);

module.exports = router;
