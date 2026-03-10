require("dotenv").config();

const http = require("http");

const app = require("./app");
const env = require("./config/env");
const { startDefaultDetectionScheduler } = require("./modules/credit-risk/default-detection.scheduler");

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

server.listen(env.port, env.host, () => {
    console.log(`SACCOS backend listening on http://${env.host}:${env.port}`);
    console.log(`OTP sign-in enforcement: ${env.otpRequiredOnSignIn ? "ENABLED" : "DISABLED"}`);
});

const stopDefaultDetectionScheduler = startDefaultDetectionScheduler();

function shutdown(signal) {
    console.log(`Received ${signal}, shutting down gracefully.`);
    stopDefaultDetectionScheduler();
    server.close((error) => {
        if (error) {
            console.error("Error while shutting down HTTP server", error);
            process.exit(1);
        }

        process.exit(0);
    });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
