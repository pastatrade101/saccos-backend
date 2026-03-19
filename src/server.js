require("dotenv").config();

const http = require("http");

const app = require("./app");
const env = require("./config/env");
const { startDefaultDetectionScheduler } = require("./modules/credit-risk/default-detection.scheduler");
const { startApiMetricsCollector } = require("./services/api-metrics-collector.service");
const { assertRequiredSchemaCapabilities } = require("./services/schema-capabilities.service");

const server = http.createServer(app);

server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
        console.error(`Port ${env.port} is already in use. Stop the existing process or change PORT.`);
    } else if (error.code === "EACCES" || error.code === "EPERM") {
        console.error(`Cannot bind to ${env.host}:${env.port}. Check HOST/PORT permissions or use another port.`);
    } else {
        console.error("HTTP server failed to start:", error);
    }

    process.exit(1);
});

let stopDefaultDetectionScheduler = () => {};
let stopApiMetricsCollector = async () => {};

function shutdown(signal) {
    console.log(`Received ${signal}, shutting down gracefully.`);
    stopDefaultDetectionScheduler();
    Promise.resolve(stopApiMetricsCollector())
        .catch((error) => {
            console.error("Error while flushing API metrics collector", error);
        })
        .finally(() => {
            server.close((error) => {
                if (error) {
                    console.error("Error while shutting down HTTP server", error);
                    process.exit(1);
                }

                process.exit(0);
            });
        });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

async function startServer() {
    const schemaStatus = await assertRequiredSchemaCapabilities({ context: "api" });

    if (!schemaStatus.ok) {
        console.warn(
            "[schema-check] API startup continuing with missing capabilities because strict mode is disabled:",
            schemaStatus.failures.map((failure) => `${failure.kind}:${failure.name}`).join(", ")
        );
    }

    server.listen(env.port, env.host, () => {
        console.log(`SACCOS backend listening on http://${env.host}:${env.port}`);
        console.log(`OTP sign-in enforcement: ${env.otpRequiredOnSignIn ? "ENABLED" : "DISABLED"}`);
        console.log(
            `[schema-check] api ${schemaStatus.ok ? "passed" : "failed"} (strict=${env.schemaCheckStrict ? "true" : "false"})`
        );
    });

    stopDefaultDetectionScheduler = startDefaultDetectionScheduler();
    stopApiMetricsCollector = startApiMetricsCollector();
}

startServer().catch((error) => {
    console.error("Backend startup failed:", error);
    process.exit(1);
});
