import { cleanupTestData } from "./helpers/db";

beforeAll(() => {
    if (process.env.NODE_ENV !== "test") {
        throw new Error("Tests must run with NODE_ENV=test.");
    }

    jest.setTimeout(180000);
});

afterAll(async () => {
    await cleanupTestData();
});
