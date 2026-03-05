const express = require("express");
const multer = require("multer");

const auth = require("../../middleware/auth");
const authorize = require("../../middleware/authorize");
const requireSubscription = require("../../middleware/require-subscription");
const validate = require("../../middleware/validate");
const rateLimit = require("../../middleware/rate-limit");
const env = require("../../config/env");
const { ROLES } = require("../../constants/roles");
const controller = require("./imports.controller");
const { startMemberImportSchema, listImportRowsQuerySchema } = require("./imports.schemas");

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024
    }
});

const router = express.Router();

router.use(auth, requireSubscription());

router.post(
    "/members/preview",
    authorize([ROLES.BRANCH_MANAGER], { allowInternalOps: false }),
    upload.single("file"),
    validate(startMemberImportSchema),
    controller.previewMembers
);

router.post(
    "/members",
    authorize([ROLES.BRANCH_MANAGER], { allowInternalOps: false }),
    rateLimit({
        max: env.memberImportRateLimitMax,
        windowMs: env.memberImportRateLimitWindowMs,
        code: "IMPORT_RATE_LIMITED",
        message: "Too many member import attempts. Try again later.",
        keyResolver: (req) => `member-import:${req.auth.user.id}`
    }),
    upload.single("file"),
    validate(startMemberImportSchema),
    controller.importMembers
);

router.get(
    "/members/:jobId",
    authorize([ROLES.BRANCH_MANAGER], { allowInternalOps: false }),
    controller.getImportJob
);

router.get(
    "/members/:jobId/rows",
    authorize([ROLES.BRANCH_MANAGER], { allowInternalOps: false }),
    validate(listImportRowsQuerySchema, "query"),
    controller.listImportRows
);

router.get(
    "/members/:jobId/failures.csv",
    authorize([ROLES.BRANCH_MANAGER], { allowInternalOps: false }),
    controller.downloadFailuresCsv
);

router.get(
    "/members/:jobId/credentials",
    authorize([ROLES.BRANCH_MANAGER], { allowInternalOps: false }),
    controller.getCredentialsDownloadUrl
);

module.exports = router;
