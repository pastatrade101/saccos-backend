const asyncHandler = require("../../utils/async-handler");
const userService = require("./users.service");
const { getSubscriptionStatus } = require("../../services/subscription.service");

exports.listUsers = asyncHandler(async (req, res) => {
    const users = await userService.listUsers(req.auth, req.validated.query);
    res.json({
        data: users,
        pagination: users.pagination
    });
});

exports.createUser = asyncHandler(async (req, res) => {
    const user = await userService.createUser(req.auth, req.validated.body);
    res.status(201).json({ data: user });
});

exports.updateUser = asyncHandler(async (req, res) => {
    const user = await userService.updateUser(req.auth, req.params.id, req.validated.body);
    res.json({ data: user });
});

exports.bootstrapSuperAdmin = asyncHandler(async (req, res) => {
    const profile = await userService.bootstrapSuperAdmin(req.auth, req.validated.body);
    res.status(201).json({ data: profile });
});

exports.me = asyncHandler(async (req, res) => {
    if (!req.auth) {
        res.set({
            "Cache-Control": "no-store, no-cache, must-revalidate, private",
            Pragma: "no-cache",
            Expires: "0",
            Vary: "Authorization"
        });

        return res.json({
            data: {
                user: null,
                profile: null,
                branch_ids: [],
                tenant: null,
                branches: [],
                subscription: null
            }
        });
    }

    const tenantId = req.tenantId || req.query?.tenant_id || req.auth.tenantId || null;
    const me = await userService.getMe(req.auth, tenantId);
    const subscription = tenantId ? await getSubscriptionStatus(tenantId) : null;

    res.set({
        "Cache-Control": "no-store, no-cache, must-revalidate, private",
        Pragma: "no-cache",
        Expires: "0",
        Vary: "Authorization"
    });

    res.json({
        data: {
            user: me.user,
            profile: me.profile,
            branch_ids: me.branch_ids,
            tenant: me.tenant,
            branches: me.branches,
            subscription
        }
    });
});

exports.passwordChanged = asyncHandler(async (req, res) => {
    const result = await userService.markPasswordChanged(req.auth);
    res.json({ data: result });
});

exports.temporaryCredential = asyncHandler(async (req, res) => {
    const result = await userService.getUserTemporaryCredential(req.auth, req.params.id);
    res.json({ data: result });
});
