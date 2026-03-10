const express = require("express");

const authRoutes = require("../modules/auth/auth.routes");
const meRoutes = require("../modules/me/me.routes");
const tenantRoutes = require("../modules/tenants/tenants.routes");
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
const platformRoutes = require("../modules/platform/platform.routes");
const auditorRoutes = require("../modules/auditor/auditor.routes");
const reportRoutes = require("../modules/reports/reports.routes");
const observabilityRoutes = require("../modules/observability/observability.routes");
const creditRiskRoutes = require("../modules/credit-risk/credit-risk.routes");
const approvalRoutes = require("../modules/approvals/approvals.routes");

const router = express.Router();

router.get("/health", (req, res) => {
    res.json({
        status: "ok",
        timestamp: new Date().toISOString()
    });
});

router.use("/auth", authRoutes);
router.use("/me", meRoutes);
router.use("/platform", platformRoutes);
router.use("/tenants", tenantRoutes);
router.use("/branches", branchRoutes);
router.use("/users", userRoutes);
router.use("/members", memberRoutes);
router.use("/member-applications", memberApplicationRoutes);
router.use("/loan-applications", loanApplicationRoutes);
router.use("/imports", importRoutes);
router.use("/products", productRoutes);
router.use("/cash-control", cashControlRoutes);
router.use("/", financeRoutes);
router.use("/dividends", dividendRoutes);
router.use("/auditor", auditorRoutes);
router.use("/reports", reportRoutes);
router.use("/observability", observabilityRoutes);
router.use("/credit-risk", creditRiskRoutes);
router.use("/approvals", approvalRoutes);

module.exports = router;
