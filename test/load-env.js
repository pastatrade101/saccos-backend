const path = require("path");
const dotenv = require("dotenv");

dotenv.config({
    path: process.env.DOTENV_CONFIG_PATH || path.resolve(process.cwd(), ".env.test")
});
