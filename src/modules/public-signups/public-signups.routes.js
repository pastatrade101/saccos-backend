const express = require("express");

const validate = require("../../middleware/validate");
const controller = require("./public-signups.controller");
const { publicSignupSchema } = require("./public-signups.schemas");

const router = express.Router();

router.get("/branches", controller.listBranches);
router.get("/signup/branches", controller.listBranches);

router.post("/signup", validate(publicSignupSchema), controller.signup);

module.exports = router;
