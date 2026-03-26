const express = require("express");

const auth = require("../../middleware/auth");
const authorize = require("../../middleware/authorize");
const validate = require("../../middleware/validate");
const { ROLES } = require("../../constants/roles");
const controller = require("./auth.controller");
const {
    inviteUserSchema,
    signInSchema,
    twoFactorCodeSchema,
    validateTwoFactorSchema,
    recoverySignInSchema,
    sendPasswordSetupLinkSchema
} = require("./auth.schemas");

const router = express.Router();

router.post("/signin", validate(signInSchema), controller.signIn);
router.post("/2fa/recovery", validate(recoverySignInSchema), controller.recoverWithBackupCode);
router.post("/2fa/setup", auth, controller.setupTwoFactor);
router.post("/2fa/verify", auth, validate(twoFactorCodeSchema), controller.verifyTwoFactor);
router.post("/2fa/validate", auth, validate(validateTwoFactorSchema), controller.validateTwoFactor);
router.post("/2fa/disable", auth, validate(validateTwoFactorSchema), controller.disableTwoFactor);
router.post("/2fa/backup-codes/regenerate", auth, validate(validateTwoFactorSchema), controller.regenerateBackupCodes);
router.post("/password-setup/link/send", validate(sendPasswordSetupLinkSchema), controller.sendPasswordSetupLink);
router.post(
    "/signup",
    auth,
    authorize([ROLES.SUPER_ADMIN]),
    validate(inviteUserSchema),
    controller.signUp
);

module.exports = router;
