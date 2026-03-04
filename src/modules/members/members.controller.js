const asyncHandler = require("../../utils/async-handler");
const memberService = require("./members.service");

function applyNoStore(res) {
    res.set({
        "Cache-Control": "no-store, no-cache, must-revalidate, private",
        Pragma: "no-cache",
        Expires: "0",
        Vary: "Authorization"
    });
}

exports.listMembers = asyncHandler(async (req, res) => {
    const members = await memberService.listMembers(req.auth);
    applyNoStore(res);
    res.json({ data: members });
});

exports.listMemberAccounts = asyncHandler(async (req, res) => {
    const accounts = await memberService.listMemberAccounts(req.auth, req.query);
    applyNoStore(res);
    res.json({ data: accounts });
});

exports.createMember = asyncHandler(async (req, res) => {
    const result = await memberService.createMember(req.auth, req.validated.body);
    res.status(201).json({ data: result });
});

exports.getMember = asyncHandler(async (req, res) => {
    const member = await memberService.getMember(req.auth, req.params.id);
    applyNoStore(res);
    res.json({ data: member });
});

exports.updateMember = asyncHandler(async (req, res) => {
    const member = await memberService.updateMember(req.auth, req.params.id, req.validated.body);
    res.json({ data: member });
});

exports.deleteMember = asyncHandler(async (req, res) => {
    const member = await memberService.deleteMember(req.auth, req.params.id);
    res.json({ data: member });
});

exports.createMemberLogin = asyncHandler(async (req, res) => {
    const result = await memberService.createMemberLogin(req.auth, req.params.id, req.validated.body);
    res.status(201).json({ data: result });
});

exports.getTemporaryCredential = asyncHandler(async (req, res) => {
    const result = await memberService.getMemberTemporaryCredential(req.auth, req.params.id);
    res.json({ data: result });
});
