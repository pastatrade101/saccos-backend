const env = require("../config/env");
const AppError = require("../utils/app-error");

async function sendOtpSms({ to, text, reference }) {
    const authorizationHeader = env.otpSmsAuthorization
        ? env.otpSmsAuthorization
        : env.otpSmsBasicUsername && env.otpSmsBasicPassword
            ? `Basic ${Buffer.from(
                `${env.otpSmsBasicUsername}:${env.otpSmsBasicPassword}`
            ).toString("base64")}`
            : "";

    if (!authorizationHeader) {
        throw new AppError(
            500,
            "OTP_SMS_CONFIG_MISSING",
            "OTP SMS authorization is not configured."
        );
    }

    let response;
    let payload = null;

    try {
        response = await fetch(env.otpSmsUrl, {
            method: "POST",
            headers: {
                Authorization: authorizationHeader,
                "Content-Type": "application/json",
                Accept: "application/json"
            },
            body: JSON.stringify({
                from: env.otpSmsFrom,
                to,
                text,
                reference
            })
        });
    } catch (error) {
        throw new AppError(
            502,
            "OTP_SMS_REQUEST_FAILED",
            "Unable to reach SMS gateway.",
            { message: error instanceof Error ? error.message : "Request failed." }
        );
    }

    const contentType = response.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
        try {
            payload = await response.json();
        } catch {
            payload = null;
        }
    }

    if (!response.ok) {
        throw new AppError(
            502,
            "OTP_SMS_DELIVERY_FAILED",
            (payload && typeof payload.message === "string" && payload.message) ||
                "SMS gateway rejected OTP delivery request.",
            payload || { status: response.status }
        );
    }

    if (payload && payload.success === false) {
        throw new AppError(
            502,
            "OTP_SMS_DELIVERY_FAILED",
            payload.message || "SMS gateway reported delivery failure.",
            payload
        );
    }

    if (payload && Array.isArray(payload.messages)) {
        const failedMessage = payload.messages.find((item) => {
            const groupName = item?.status?.groupName;
            return typeof groupName === "string" && groupName.toUpperCase() === "REJECTED";
        });

        if (failedMessage) {
            throw new AppError(
                502,
                "OTP_SMS_DELIVERY_FAILED",
                failedMessage?.status?.description || "SMS gateway rejected message delivery.",
                payload
            );
        }

        return payload;
    }

    return payload || { success: true };
}

module.exports = {
    sendOtpSms
};
