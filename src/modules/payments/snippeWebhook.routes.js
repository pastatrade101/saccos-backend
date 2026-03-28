const express = require("express");

const controller = require("./snippeWebhook.controller");

const router = express.Router();

router.post("/snippe", controller.handleSnippeWebhook);

module.exports = router;
