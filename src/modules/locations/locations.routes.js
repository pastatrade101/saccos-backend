const express = require("express");

const validate = require("../../middleware/validate");
const controller = require("./locations.controller");
const {
    listDistrictsQuerySchema,
    listVillagesQuerySchema,
    listWardsQuerySchema
} = require("./locations.schemas");

const router = express.Router();

router.get("/regions", controller.listRegions);
router.get("/districts", validate(listDistrictsQuerySchema, "query"), controller.listDistricts);
router.get("/wards", validate(listWardsQuerySchema, "query"), controller.listWards);
router.get("/villages", validate(listVillagesQuerySchema, "query"), controller.listVillages);

module.exports = router;
