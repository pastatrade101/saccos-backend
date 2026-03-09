const express = require("express");

const auth = require("../../middleware/auth");
const authorize = require("../../middleware/authorize");
const { ROLES } = require("../../constants/roles");
const controller = require("./observability.controller");

const router = express.Router();

router.use(auth, authorize([ROLES.PLATFORM_ADMIN, ROLES.SUPER_ADMIN]));

router.get("/summary", controller.summary);
router.get("/tenants", controller.tenants);
router.get("/slos", controller.slos);
router.post("/reset", controller.reset);

module.exports = router;
