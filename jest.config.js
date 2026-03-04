module.exports = {
    testEnvironment: "node",
    transform: {
        "^.+\\.tsx?$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.test.json" }]
    },
    roots: ["<rootDir>/test"],
    testMatch: ["**/*.test.ts"],
    setupFiles: ["<rootDir>/test/load-env.js"],
    setupFilesAfterEnv: ["<rootDir>/test/setup.ts"],
    moduleFileExtensions: ["ts", "js", "json"],
    testTimeout: 180000,
    maxWorkers: 1
};
