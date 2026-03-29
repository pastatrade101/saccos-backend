const asyncHandler = require("../../utils/async-handler");
const service = require("./locations.service");

exports.listRegions = asyncHandler(async (req, res) => {
    const data = await service.getRegions();
    res.json({ data });
});

exports.listDistricts = asyncHandler(async (req, res) => {
    const data = await service.getDistricts(req.validated.query.region_id);
    res.json({ data });
});

exports.listWards = asyncHandler(async (req, res) => {
    const data = await service.getWards(req.validated.query.district_id);
    res.json({ data });
});

exports.listVillages = asyncHandler(async (req, res) => {
    const result = await service.getVillages({
        wardId: req.validated.query.ward_id,
        page: req.validated.query.page,
        limit: req.validated.query.limit,
        search: req.validated.query.search
    });
    res.json({ data: result });
});
