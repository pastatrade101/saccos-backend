const asyncHandler = require("../../utils/async-handler");
const AppError = require("../../utils/app-error");
const env = require("../../config/env");
const authService = require("./auth.service");

function assertHttps(req) {
    if (env.nodeEnv !== "production") {
        return;
    }

    if (req.secure || req.get("x-forwarded-proto") === "https") {
        return;
    }

    throw new AppError(400, "HTTPS_REQUIRED", "Two-factor authentication requires HTTPS.");
}

exports.signIn = asyncHandler(async (req, res) => {
    assertHttps(req);
    const result = await authService.signIn(req.validated.body);
    res.json(result);
});

exports.setupTwoFactor = asyncHandler(async (req, res) => {
    assertHttps(req);
    const result = await authService.setupTwoFactor(req.auth);
    res.json(result);
});

exports.verifyTwoFactor = asyncHandler(async (req, res) => {
    assertHttps(req);
    const result = await authService.verifyTwoFactorSetup(req.auth, req.validated.body.totp_code);
    res.json(result);
});

exports.validateTwoFactor = asyncHandler(async (req, res) => {
    assertHttps(req);
    const result = await authService.validateTwoFactor(req.auth, req.validated.body);
    res.json(result);
});

exports.recoverWithBackupCode = asyncHandler(async (req, res) => {
    assertHttps(req);
    const result = await authService.recoverWithBackupCode(req.validated.body);
    res.json(result);
});

exports.disableTwoFactor = asyncHandler(async (req, res) => {
    assertHttps(req);
    const result = await authService.disableTwoFactor(req.auth, req.validated.body);
    res.json(result);
});

exports.regenerateBackupCodes = asyncHandler(async (req, res) => {
    assertHttps(req);
    const result = await authService.regenerateBackupCodes(req.auth, req.validated.body);
    res.json(result);
});

exports.sendPasswordSetupLink = asyncHandler(async (req, res) => {
    const result = await authService.sendPasswordSetupLink(req.validated.body);
    res.json(result);
});

exports.signUp = asyncHandler(async (req, res) => {
    const result = await authService.inviteUser({
        actor: req.auth,
        payload: req.validated.body
    });

    res.status(201).json(result);
});
