const express = require("express");

const auth = require("../../middleware/auth");
const authorize = require("../../middleware/authorize");
const validate = require("../../middleware/validate");
const { ROLES } = require("../../constants/roles");
const controller = require("./platform.controller");
const {
    assignSubscriptionSchema,
    deleteTenantSchema,
    platformErrorsQuerySchema,
    platformMetricsQuerySchema,
    platformSlowEndpointsQuerySchema,
    platformTenantMetricsQuerySchema,
    listPlansQuerySchema,
    listPlatformTenantsQuerySchema,
    planParamSchema,
    tenantParamSchema,
    updatePlanFeaturesSchema
} = require("./platform.schemas");

const router = express.Router();

router.use(auth, authorize([ROLES.PLATFORM_ADMIN, ROLES.PLATFORM_OWNER]));

router.get("/plans", validate(listPlansQuerySchema, "query"), controller.listPlans);
router.patch("/plans/:planId/features", validate(planParamSchema, "params"), validate(updatePlanFeaturesSchema), controller.updatePlanFeatures);
router.get("/tenants", validate(listPlatformTenantsQuerySchema, "query"), controller.listTenants);
router.post("/tenants/:tenantId/subscription", validate(tenantParamSchema, "params"), validate(assignSubscriptionSchema), controller.assignSubscription);
router.delete("/tenants/:tenantId", validate(tenantParamSchema, "params"), validate(deleteTenantSchema), controller.deleteTenant);
router.get("/metrics/system", validate(platformMetricsQuerySchema, "query"), controller.systemMetrics);
router.get("/metrics/tenants", validate(platformTenantMetricsQuerySchema, "query"), controller.tenantMetrics);
router.get("/metrics/infrastructure", validate(platformMetricsQuerySchema, "query"), controller.infrastructureMetrics);
router.get("/metrics/slow-endpoints", validate(platformSlowEndpointsQuerySchema, "query"), controller.slowEndpoints);
router.get("/errors", validate(platformErrorsQuerySchema, "query"), controller.platformErrors);

module.exports = router;
