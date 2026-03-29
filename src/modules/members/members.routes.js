const express = require("express");

const auth = require("../../middleware/auth");
const authorize = require("../../middleware/authorize");
const validate = require("../../middleware/validate");
const { ROLES } = require("../../constants/roles");
const controller = require("./members.controller");
const {
    createMemberSchema,
    updateMemberSchema,
    updateOwnMemberProfileSchema,
    createMemberLoginSchema,
    provisionMemberAccountSchema,
    resetMemberPasswordSchema,
    bulkDeleteMembersSchema,
    listMembersQuerySchema,
    listMemberAccountsQuerySchema
} = require("./members.schemas");

const router = express.Router();

router.use(auth);

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
router.patch(
    "/me/profile-completion",
    authorize([ROLES.MEMBER], { allowInternalOps: false }),
    validate(updateOwnMemberProfileSchema),
    controller.updateOwnProfileCompletion
);
router.post(
    "/",
    authorize([ROLES.BRANCH_MANAGER], { allowInternalOps: false }),
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
    "/bulk-delete",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER], { allowInternalOps: false }),
    validate(bulkDeleteMembersSchema),
    controller.bulkDeleteMembers
);
router.post(
    "/:id/create-login",
    authorize([ROLES.BRANCH_MANAGER], { allowInternalOps: false }),
    validate(createMemberLoginSchema),
    controller.createMemberLogin
);
router.post(
    "/:id/accounts/provision",
    authorize([ROLES.BRANCH_MANAGER], { allowInternalOps: false }),
    validate(provisionMemberAccountSchema),
    controller.provisionMemberAccount
);
router.post(
    "/:id/reset-password",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER], { allowInternalOps: false }),
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
