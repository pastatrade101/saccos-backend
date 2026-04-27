const express = require("express");

const authRoutes = require("../modules/auth/auth.routes");
const meRoutes = require("../modules/me/me.routes");
const branchRoutes = require("../modules/branches/branches.routes");
const userRoutes = require("../modules/users/users.routes");
const memberRoutes = require("../modules/members/members.routes");
const memberApplicationRoutes = require("../modules/member-applications/member-applications.routes");
const loanApplicationRoutes = require("../modules/loan-applications/loan-applications.routes");
const importRoutes = require("../modules/imports/imports.routes");
const financeRoutes = require("../modules/finance/finance.routes");
const cashControlRoutes = require("../modules/cash-control/cash-control.routes");
const dividendRoutes = require("../modules/dividends/dividends.routes");
const productRoutes = require("../modules/products/products.routes");
const loanCapacityRoutes = require("../modules/loan-capacity/loan-capacity.routes");
const treasuryRoutes = require("../modules/treasury/treasury.routes");
const auditorRoutes = require("../modules/auditor/auditor.routes");
const reportRoutes = require("../modules/reports/reports.routes");
const observabilityRoutes = require("../modules/observability/observability.routes");
const creditRiskRoutes = require("../modules/credit-risk/credit-risk.routes");
const approvalRoutes = require("../modules/approvals/approvals.routes");
const notificationSettingsRoutes = require("../modules/notification-settings/notification-settings.routes");
const notificationRoutes = require("../modules/notifications/notifications.routes");
const memberPortalSettingsRoutes = require("../modules/member-portal-settings/member-portal-settings.routes");
const memberPaymentRoutes = require("../modules/member-payments/member-payments.routes");
const locationRoutes = require("../modules/locations/locations.routes");
const { getSchemaCapabilityStatus } = require("../services/schema-capabilities.service");

const router = express.Router();

router.get("/health", (req, res) => {
    const schema = getSchemaCapabilityStatus("api");

    res.json({
        status: schema.ok === false ? "degraded" : "ok",
        timestamp: new Date().toISOString(),
        schema
    });
});

router.use("/auth", authRoutes);
router.use("/me", meRoutes);
router.use("/branches", branchRoutes);
router.use("/users", userRoutes);
router.use("/members", memberRoutes);
router.use("/member-applications", memberApplicationRoutes);
router.use("/loan-applications", loanApplicationRoutes);
router.use("/imports", importRoutes);
router.use("/products", productRoutes);
router.use("/loans", loanCapacityRoutes);
router.use("/v1/loans", loanCapacityRoutes);
router.use("/treasury", treasuryRoutes);
router.use("/cash-control", cashControlRoutes);
router.use("/dividends", dividendRoutes);
router.use("/auditor", auditorRoutes);
router.use("/reports", reportRoutes);
router.use("/observability", observabilityRoutes);
router.use("/credit-risk", creditRiskRoutes);
router.use("/approvals", approvalRoutes);
router.use("/notification-settings", notificationSettingsRoutes);
router.use("/notifications", notificationRoutes);
router.use("/member-portal-settings", memberPortalSettingsRoutes);
router.use("/member-payments", memberPaymentRoutes);
router.use("/locations", locationRoutes);
router.use("/", financeRoutes);

module.exports = router;
