const express = require("express");

const auth = require("../../middleware/auth");
const authorize = require("../../middleware/authorize");
const requireSubscription = require("../../middleware/require-subscription");
const validate = require("../../middleware/validate");
const { ROLES } = require("../../constants/roles");
const controller = require("./auth.controller");
const { inviteUserSchema, signInSchema } = require("./auth.schemas");

const router = express.Router();

router.post("/signin", validate(signInSchema), controller.signIn);
router.post(
    "/signup",
    auth,
    requireSubscription(),
    authorize([ROLES.SUPER_ADMIN]),
    validate(inviteUserSchema),
    controller.signUp
);

module.exports = router;
