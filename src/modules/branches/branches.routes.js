const express = require("express");

const auth = require("../../middleware/auth");
const authorize = require("../../middleware/authorize");
const validate = require("../../middleware/validate");
const { ROLES } = require("../../constants/roles");
const controller = require("./branches.controller");
const { createBranchSchema, listBranchesQuerySchema } = require("./branches.schemas");

const router = express.Router();

router.use(auth);

router.get(
    "/",
    authorize([
        ROLES.SUPER_ADMIN,
        ROLES.BRANCH_MANAGER,
        ROLES.LOAN_OFFICER,
        ROLES.TELLER,
        ROLES.AUDITOR
    ]),
    validate(listBranchesQuerySchema, "query"),
    controller.listBranches
);
router.post(
    "/",
    authorize([ROLES.SUPER_ADMIN]),
    validate(createBranchSchema),
    controller.createBranch
);

module.exports = router;
