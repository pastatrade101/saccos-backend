const asyncHandler = require("../../utils/async-handler");
const authService = require("./auth.service");

exports.signIn = asyncHandler(async (req, res) => {
    const result = await authService.signIn(req.validated.body);
    res.json(result);
});

exports.sendOtp = asyncHandler(async (req, res) => {
    const result = await authService.sendSignInOtp(req.validated.body);
    res.json(result);
});

exports.verifyOtp = asyncHandler(async (req, res) => {
    const result = await authService.verifySignInOtp(req.validated.body);
    res.json(result);
});

exports.signUp = asyncHandler(async (req, res) => {
    const result = await authService.inviteUser({
        actor: req.auth,
        payload: req.validated.body
    });

    res.status(201).json(result);
});
