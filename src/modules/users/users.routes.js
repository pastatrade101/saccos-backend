const express = require("express");

const auth = require("../../middleware/auth");
const authorize = require("../../middleware/authorize");
const validate = require("../../middleware/validate");
const { ROLES } = require("../../constants/roles");
const controller = require("./users.controller");
const { createUserSchema, updateUserSchema, bootstrapSuperAdminSchema, listUsersQuerySchema } = require("./users.schemas");

const router = express.Router();

router.get("/me", auth.optional, controller.me);

router.use(auth);

router.post(
    "/setup-super-admin",
    authorize([ROLES.SUPER_ADMIN]),
    validate(bootstrapSuperAdminSchema),
    controller.bootstrapSuperAdmin
);
router.get(
    "/",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.AUDITOR], { allowInternalOps: false }),
    validate(listUsersQuerySchema, "query"),
    controller.listUsers
);
router.post(
    "/",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER], { allowInternalOps: false }),
    validate(createUserSchema),
    controller.createUser
);
router.patch(
    "/:id",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER], { allowInternalOps: false }),
    validate(updateUserSchema),
    controller.updateUser
);
router.get(
    "/:id/temporary-credential",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER], { allowInternalOps: false }),
    controller.temporaryCredential
);
router.post(
    "/me/password-changed",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER, ROLES.AUDITOR, ROLES.MEMBER]),
    controller.passwordChanged
);

module.exports = router;
