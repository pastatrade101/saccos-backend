const express = require("express");

const auth = require("../../middleware/auth");
const authorize = require("../../middleware/authorize");
const validate = require("../../middleware/validate");
const { ROLES } = require("../../constants/roles");
const controller = require("./tenants.controller");
const { createTenantSchema, updateTenantSchema } = require("./tenants.schemas");

const router = express.Router();

router.use(auth);

router.get("/", authorize([ROLES.SUPER_ADMIN]), controller.listTenants);
router.post("/", authorize([ROLES.SUPER_ADMIN]), validate(createTenantSchema), controller.createTenant);
router.get("/:id", authorize([ROLES.SUPER_ADMIN]), controller.getTenant);
router.patch("/:id", authorize([ROLES.SUPER_ADMIN]), validate(updateTenantSchema), controller.updateTenant);

module.exports = router;
