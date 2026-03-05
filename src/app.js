const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const env = require("./config/env");
const routes = require("./routes");
const errorHandler = require("./middleware/error-handler");
const notFoundHandler = require("./middleware/not-found");
const requestContext = require("./middleware/request-context");
const { isOriginAllowed } = require("./utils/cors");

const app = express();

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(requestContext);
app.use(
    helmet({
        crossOriginResourcePolicy: false
    })
);
app.use(
    cors({
        origin(origin, callback) {
            if (isOriginAllowed(origin, env.corsOrigins)) {
                return callback(null, true);
            }
            return callback(new Error(`Origin not allowed by CORS: ${origin}`));
        },
        credentials: true
    })
);
app.use(express.json({ limit: env.bodyLimit }));
app.use(express.urlencoded({ extended: false, limit: env.bodyLimit }));
app.use(
    morgan(env.nodeEnv === "production" ? "combined" : "dev", {
        skip: (req) => req.path === "/health" || req.path === `${env.apiPrefix}/health`
    })
);

app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || "1.0.0"
    });
});

app.use(env.apiPrefix, routes);
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
