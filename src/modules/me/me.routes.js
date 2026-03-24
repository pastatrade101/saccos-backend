const express = require("express");

const auth = require("../../middleware/auth");
const authorize = require("../../middleware/authorize");
const { ROLES } = require("../../constants/roles");
const controller = require("./me.controller");

const router = express.Router();

router.get("/subscription", auth.optional, controller.subscription);

router.use(
    auth,
    authorize([
        ROLES.PLATFORM_ADMIN,
        ROLES.SUPER_ADMIN,
        ROLES.BRANCH_MANAGER,
        ROLES.LOAN_OFFICER,
        ROLES.TELLER,
        ROLES.AUDITOR,
        ROLES.MEMBER
    ])
);

module.exports = router;
