const express = require("express");

const auth = require("../../middleware/auth");
const authorize = require("../../middleware/authorize");
const validate = require("../../middleware/validate");
const { ROLES } = require("../../constants/roles");
const controller = require("./auth.controller");
const {
    inviteUserSchema,
    signInSchema,
    sendOtpSchema,
    verifyOtpSchema,
    sendPasswordSetupLinkSchema
} = require("./auth.schemas");

const router = express.Router();

router.post("/signin", validate(signInSchema), controller.signIn);
router.post("/otp/send", validate(sendOtpSchema), controller.sendOtp);
router.post("/otp/verify", validate(verifyOtpSchema), controller.verifyOtp);
router.post("/password-setup/link/send", validate(sendPasswordSetupLinkSchema), controller.sendPasswordSetupLink);
router.post(
    "/signup",
    auth,
    authorize([ROLES.SUPER_ADMIN]),
    validate(inviteUserSchema),
    controller.signUp
);

module.exports = router;
