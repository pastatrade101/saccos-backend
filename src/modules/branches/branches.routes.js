const express = require("express");

const auth = require("../../middleware/auth");
const authorize = require("../../middleware/authorize");
const enforceLimit = require("../../middleware/enforce-limit");
const requireSubscription = require("../../middleware/require-subscription");
const validate = require("../../middleware/validate");
const { ROLES } = require("../../constants/roles");
const controller = require("./branches.controller");
const { createBranchSchema } = require("./branches.schemas");

const router = express.Router();

router.use(auth, requireSubscription());

router.get(
    "/",
    authorize([
        ROLES.SUPER_ADMIN,
        ROLES.BRANCH_MANAGER,
        ROLES.LOAN_OFFICER,
        ROLES.TELLER,
        ROLES.AUDITOR
    ]),
    controller.listBranches
);
router.post(
    "/",
    authorize([ROLES.SUPER_ADMIN]),
    enforceLimit("max_branches", null, { tableName: "branches" }),
    validate(createBranchSchema),
    controller.createBranch
);

module.exports = router;
