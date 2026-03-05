const express = require("express");

const auth = require("../../middleware/auth");
const authorize = require("../../middleware/authorize");
const enforceLimit = require("../../middleware/enforce-limit");
const requireSubscription = require("../../middleware/require-subscription");
const validate = require("../../middleware/validate");
const { ROLES } = require("../../constants/roles");
const controller = require("./members.controller");
const {
    createMemberSchema,
    updateMemberSchema,
    createMemberLoginSchema,
    resetMemberPasswordSchema,
    listMembersQuerySchema,
    listMemberAccountsQuerySchema
} = require("./members.schemas");

const router = express.Router();

router.use(auth, requireSubscription());

router.get(
    "/",
    authorize([
        ROLES.SUPER_ADMIN,
        ROLES.BRANCH_MANAGER,
        ROLES.LOAN_OFFICER,
        ROLES.TELLER,
        ROLES.AUDITOR,
        ROLES.MEMBER
    ], { allowInternalOps: false }),
    validate(listMembersQuerySchema, "query"),
    controller.listMembers
);
router.get(
    "/accounts",
    authorize([
        ROLES.SUPER_ADMIN,
        ROLES.BRANCH_MANAGER,
        ROLES.LOAN_OFFICER,
        ROLES.TELLER,
        ROLES.AUDITOR,
        ROLES.MEMBER
    ], { allowInternalOps: false }),
    validate(listMemberAccountsQuerySchema, "query"),
    controller.listMemberAccounts
);
router.post(
    "/",
    authorize([ROLES.BRANCH_MANAGER], { allowInternalOps: false }),
    enforceLimit("max_members", null, { tableName: "members" }),
    validate(createMemberSchema),
    controller.createMember
);
router.get(
    "/:id",
    authorize([
        ROLES.SUPER_ADMIN,
        ROLES.BRANCH_MANAGER,
        ROLES.LOAN_OFFICER,
        ROLES.TELLER,
        ROLES.AUDITOR,
        ROLES.MEMBER
    ], { allowInternalOps: false }),
    controller.getMember
);
router.patch(
    "/:id",
    authorize([ROLES.BRANCH_MANAGER], { allowInternalOps: false }),
    validate(updateMemberSchema),
    controller.updateMember
);
router.post(
    "/:id/create-login",
    authorize([ROLES.BRANCH_MANAGER], { allowInternalOps: false }),
    validate(createMemberLoginSchema),
    controller.createMemberLogin
);
router.post(
    "/:id/reset-password",
    authorize([ROLES.SUPER_ADMIN], { allowInternalOps: false }),
    validate(resetMemberPasswordSchema),
    controller.resetMemberPassword
);
router.get(
    "/:id/temporary-credential",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER], { allowInternalOps: false }),
    controller.getTemporaryCredential
);
router.delete(
    "/:id",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER], { allowInternalOps: false }),
    controller.deleteMember
);

module.exports = router;
