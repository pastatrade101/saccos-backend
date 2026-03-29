const express = require("express");
const multer = require("multer");

const validate = require("../../middleware/validate");
const AppError = require("../../utils/app-error");
const controller = require("./public-signups.controller");
const { publicSignupSchema } = require("./public-signups.schemas");

const router = express.Router();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024
    },
    fileFilter(req, file, cb) {
        const allowedMimeTypes = new Set(["image/jpeg", "image/png", "application/pdf"]);

        if (allowedMimeTypes.has(file.mimetype)) {
            cb(null, true);
            return;
        }

        cb(new AppError(
            400,
            "PUBLIC_SIGNUP_DOCUMENT_INVALID",
            "Only JPG, PNG, or PDF documents are allowed for membership onboarding."
        ));
    }
});

function handleSignupUploads(req, res, next) {
    upload.fields([
        { name: "upload_national_id", maxCount: 1 },
        { name: "upload_passport_photo", maxCount: 1 }
    ])(req, res, (error) => {
        if (!error) {
            next();
            return;
        }

        if (error.code === "LIMIT_FILE_SIZE") {
            next(new AppError(
                400,
                "PUBLIC_SIGNUP_DOCUMENT_TOO_LARGE",
                "Each onboarding document must be 5MB or smaller."
            ));
            return;
        }

        next(error);
    });
}

function parseSignupPayload(req, res, next) {
    if (typeof req.body?.payload === "string") {
        try {
            req.body = JSON.parse(req.body.payload);
        } catch (error) {
            next(new AppError(400, "PUBLIC_SIGNUP_PAYLOAD_INVALID", "Signup payload is not valid JSON."));
            return;
        }
    }

    next();
}

router.get("/branches", controller.listBranches);
router.get("/signup/branches", controller.listBranches);

router.post("/signup", handleSignupUploads, parseSignupPayload, validate(publicSignupSchema), controller.signup);

module.exports = router;
