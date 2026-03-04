const express = require("express");

const authRoutes = require("../modules/auth/auth.routes");
const meRoutes = require("../modules/me/me.routes");
const tenantRoutes = require("../modules/tenants/tenants.routes");
const branchRoutes = require("../modules/branches/branches.routes");
const userRoutes = require("../modules/users/users.routes");
const memberRoutes = require("../modules/members/members.routes");
const importRoutes = require("../modules/imports/imports.routes");
const financeRoutes = require("../modules/finance/finance.routes");
const dividendRoutes = require("../modules/dividends/dividends.routes");
const platformRoutes = require("../modules/platform/platform.routes");
const auditorRoutes = require("../modules/auditor/auditor.routes");
const reportRoutes = require("../modules/reports/reports.routes");

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
router.use("/imports", importRoutes);
router.use("/", financeRoutes);
router.use("/dividends", dividendRoutes);
router.use("/auditor", auditorRoutes);
router.use("/reports", reportRoutes);

module.exports = router;
