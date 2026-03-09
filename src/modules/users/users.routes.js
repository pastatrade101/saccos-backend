const express = require("express");

const auth = require("../../middleware/auth");
const authorize = require("../../middleware/authorize");
const enforceLimit = require("../../middleware/enforce-limit");
const requireSubscription = require("../../middleware/require-subscription");
const validate = require("../../middleware/validate");
const { ROLES } = require("../../constants/roles");
const controller = require("./users.controller");
const { createUserSchema, updateUserSchema, bootstrapSuperAdminSchema, listUsersQuerySchema } = require("./users.schemas");

const router = express.Router();

router.use(auth);

router.post(
    "/setup-super-admin",
    authorize([ROLES.SUPER_ADMIN]),
    requireSubscription(),
    validate(bootstrapSuperAdminSchema),
    controller.bootstrapSuperAdmin
);
router.get(
    "/",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.AUDITOR], { allowInternalOps: false }),
    requireSubscription(),
    validate(listUsersQuerySchema, "query"),
    controller.listUsers
);
router.post(
    "/",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER], { allowInternalOps: false }),
    requireSubscription(),
    enforceLimit("max_users", null, { tableName: "user_profiles" }),
    validate(createUserSchema),
    controller.createUser
);
router.patch(
    "/:id",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER], { allowInternalOps: false }),
    requireSubscription(),
    validate(updateUserSchema),
    controller.updateUser
);
router.get(
    "/:id/temporary-credential",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER], { allowInternalOps: false }),
    requireSubscription(),
    controller.temporaryCredential
);
router.post(
    "/me/password-changed",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER, ROLES.AUDITOR, ROLES.MEMBER]),
    controller.passwordChanged
);
router.get("/me", authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER, ROLES.AUDITOR, ROLES.MEMBER]), controller.me);

module.exports = router;
