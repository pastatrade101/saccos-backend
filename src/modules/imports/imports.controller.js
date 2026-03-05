const asyncHandler = require("../../utils/async-handler");
const service = require("./imports.service");

exports.importMembers = asyncHandler(async (req, res) => {
    if (!req.file?.buffer) {
        return res.status(400).json({
            error: {
                code: "IMPORT_FILE_REQUIRED",
                message: "CSV file is required."
            }
        });
    }

    const result = await service.processMemberImport({
        actor: req.auth,
        fileBuffer: req.file.buffer,
        options: req.validated.body,
        requestMeta: {
            ip: req.ip,
            userAgent: req.get("user-agent") || null
        }
    });

    res.status(202).json({ data: result });
});

exports.previewMembers = asyncHandler(async (req, res) => {
    if (!req.file?.buffer) {
        return res.status(400).json({
            error: {
                code: "IMPORT_FILE_REQUIRED",
                message: "CSV file is required."
            }
        });
    }

    const result = await service.previewMemberImport({
        actor: req.auth,
        fileBuffer: req.file.buffer,
        options: req.validated.body
    });

    res.json({ data: result });
});

exports.getImportJob = asyncHandler(async (req, res) => {
    const job = await service.getImportJob(req.auth, req.params.jobId);
    res.json({ data: job });
});

exports.listImportRows = asyncHandler(async (req, res) => {
    const rows = await service.listImportRows(req.auth, req.params.jobId, req.validated.query);
    res.json({ data: rows });
});

exports.downloadFailuresCsv = asyncHandler(async (req, res) => {
    const csv = await service.getFailuresCsv(req.auth, req.params.jobId);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="member-import-${req.params.jobId}-failures.csv"`);
    res.send(csv);
});

exports.getCredentialsDownloadUrl = asyncHandler(async (req, res) => {
    const signedUrl = await service.getCredentialsDownloadUrl(req.auth, req.params.jobId);
    res.json({ data: { signed_url: signedUrl } });
});
