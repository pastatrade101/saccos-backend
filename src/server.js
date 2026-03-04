require("dotenv").config();

const http = require("http");

const app = require("./app");
const env = require("./config/env");

const server = http.createServer(app);

server.listen(env.port, () => {
    console.log(`SACCOS backend listening on port ${env.port}`);
});

function shutdown(signal) {
    console.log(`Received ${signal}, shutting down gracefully.`);
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
