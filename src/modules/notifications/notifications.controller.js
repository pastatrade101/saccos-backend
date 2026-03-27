const asyncHandler = require("../../utils/async-handler");
const service = require("./notifications.service");

const listNotifications = asyncHandler(async (req, res) => {
    const data = await service.listNotifications(req.auth, req.validated?.query || req.query);
    res.json({ data });
});

const listNotificationPreferences = asyncHandler(async (req, res) => {
    const data = await service.listNotificationPreferences(req.auth, req.validated?.query || req.query);
    res.json({ data });
});

const updateNotificationPreference = asyncHandler(async (req, res) => {
    const data = await service.updateNotificationPreference(
        req.auth,
        req.validated?.params?.eventType || req.params.eventType,
        req.validated?.body || req.body || {}
    );
    res.json({ data });
});

const markNotificationRead = asyncHandler(async (req, res) => {
    const data = await service.markNotificationRead(req.auth, req.validated?.params?.notificationId || req.params.notificationId);
    res.json({ data });
});

const markAllNotificationsRead = asyncHandler(async (req, res) => {
    const data = await service.markAllNotificationsRead(req.auth, req.validated?.body || req.body || {});
    res.json({ data });
});

const archiveNotification = asyncHandler(async (req, res) => {
    const data = await service.archiveNotification(req.auth, req.validated?.params?.notificationId || req.params.notificationId);
    res.json({ data });
});

const archiveReadNotifications = asyncHandler(async (req, res) => {
    const data = await service.archiveReadNotifications(req.auth, req.validated?.body || req.body || {});
    res.json({ data });
});

module.exports = {
    listNotifications,
    listNotificationPreferences,
    updateNotificationPreference,
    markNotificationRead,
    markAllNotificationsRead,
    archiveNotification,
    archiveReadNotifications
};
