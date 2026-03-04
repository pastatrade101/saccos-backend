import request from "supertest";

const app = require("../../src/app");

import { createMemberFixture, createPlatformAdminFixture, createStaffFixture, createSuperAdminFixture, createTenantFixture, openTellerSessionFixture } from "../helpers/factories";
import { query } from "../helpers/db";

describe("API integration: receipt proof and reporting", () => {
    it("enforces receipt policy thresholds and lets auditors view attached receipts", async () => {
        const platform = await createPlatformAdminFixture();
        const { tenant, branch } = await createTenantFixture({ actor: platform.actor, plan: "growth" });
        const superAdmin = await createSuperAdminFixture({
            platformActor: platform.actor,
            tenantId: tenant.id,
            branchId: branch.id
        });
        const branchManager = await createStaffFixture({
            actor: superAdmin.actor,
            tenantId: tenant.id,
            role: "branch_manager",
            branchIds: [branch.id]
        });
        const teller = await createStaffFixture({
            actor: branchManager.actor,
            tenantId: tenant.id,
            role: "teller",
            branchIds: [branch.id]
        });
        const auditor = await createStaffFixture({
            actor: branchManager.actor,
            tenantId: tenant.id,
            role: "auditor",
            branchIds: [branch.id]
        });
        const member = await createMemberFixture({
            actor: branchManager.actor,
            branchId: branch.id,
            tenantId: tenant.id
        });

        await openTellerSessionFixture({
            token: teller.token,
            branchId: branch.id
        });

        await request(app)
            .put("/api/cash-control/receipt-policy")
            .set("Authorization", `Bearer ${branchManager.token}`)
            .send({
                branch_id: branch.id,
                receipt_required: true,
                required_threshold: 50000,
                max_receipts_per_tx: 2,
                allowed_mime_types: ["image/jpeg", "image/png", "application/pdf"],
                max_file_size_mb: 5,
                enforce_on_types: ["deposit", "withdraw", "loan_repay", "loan_disburse", "share_contribution"]
            })
            .expect(200);

        const missingReceipt = await request(app)
            .post("/api/deposit")
            .set("Authorization", `Bearer ${teller.token}`)
            .send({
                tenant_id: tenant.id,
                account_id: member.savingsAccountId,
                amount: 100000,
                reference: "RECEIPT-MISSING-001"
            });

        expect(missingReceipt.status).toBe(400);
        expect(missingReceipt.body.error.code).toBe("RECEIPT_REQUIRED");

        const initReceipt = await request(app)
            .post("/api/cash-control/receipts/init")
            .set("Authorization", `Bearer ${teller.token}`)
            .send({
                branch_id: branch.id,
                member_id: member.member.id,
                transaction_type: "deposit",
                file_name: "receipt-001.jpg",
                mime_type: "image/jpeg",
                file_size_bytes: 2048
            });

        expect(initReceipt.status).toBe(201);

        const confirmReceipt = await request(app)
            .post(`/api/cash-control/receipts/${initReceipt.body.data.receipt.id}/confirm`)
            .set("Authorization", `Bearer ${teller.token}`)
            .send({
                checksum_sha256: "checksum-001"
            });

        expect(confirmReceipt.status).toBe(200);

        const depositWithReceipt = await request(app)
            .post("/api/deposit")
            .set("Authorization", `Bearer ${teller.token}`)
            .send({
                tenant_id: tenant.id,
                account_id: member.savingsAccountId,
                amount: 100000,
                reference: "RECEIPT-OK-001",
                receipt_ids: [initReceipt.body.data.receipt.id]
            });

        expect(depositWithReceipt.status).toBe(201);

        const linkedReceipts = await request(app)
            .get(`/api/cash-control/journals/${depositWithReceipt.body.data.journal_id}/receipts`)
            .set("Authorization", `Bearer ${auditor.token}`);

        expect(linkedReceipts.status).toBe(200);
        expect(linkedReceipts.body.data).toHaveLength(1);

        const belowThreshold = await request(app)
            .post("/api/deposit")
            .set("Authorization", `Bearer ${teller.token}`)
            .send({
                tenant_id: tenant.id,
                account_id: member.savingsAccountId,
                amount: 40000,
                reference: "RECEIPT-NOT-REQUIRED-001"
            });

        expect(belowThreshold.status).toBe(201);
    });

    it("returns CSV exports for trial balance and PAR reports", async () => {
        const platform = await createPlatformAdminFixture();
        const { tenant, branch } = await createTenantFixture({ actor: platform.actor, plan: "growth" });
        const superAdmin = await createSuperAdminFixture({
            platformActor: platform.actor,
            tenantId: tenant.id,
            branchId: branch.id
        });
        const branchManager = await createStaffFixture({
            actor: superAdmin.actor,
            tenantId: tenant.id,
            role: "branch_manager",
            branchIds: [branch.id]
        });
        const loanOfficer = await createStaffFixture({
            actor: branchManager.actor,
            tenantId: tenant.id,
            role: "loan_officer",
            branchIds: [branch.id]
        });
        const member = await createMemberFixture({
            actor: branchManager.actor,
            branchId: branch.id,
            tenantId: tenant.id
        });

        const disbursement = await request(app)
            .post("/api/loan/disburse")
            .set("Authorization", `Bearer ${loanOfficer.token}`)
            .send({
                tenant_id: tenant.id,
                member_id: member.member.id,
                branch_id: branch.id,
                principal_amount: 600000,
                annual_interest_rate: 12,
                term_count: 6,
                repayment_frequency: "monthly",
                reference: "REPORT-LOAN-001"
            });

        expect(disbursement.status).toBe(201);

        await query(
            `
            update public.loan_schedules
               set due_date = current_date - interval '45 day',
                   status = 'overdue'
             where loan_id = $1
            `,
            [disbursement.body.data.loan_id]
        );

        const trialBalance = await request(app)
            .get("/api/reports/trial-balance/export")
            .set("Authorization", `Bearer ${superAdmin.token}`)
            .query({
                tenant_id: tenant.id,
                format: "csv"
            });

        expect(trialBalance.status).toBe(200);
        expect(trialBalance.headers["content-type"]).toContain("text/csv");
        expect(trialBalance.text).toContain("account_code");

        const par = await request(app)
            .get("/api/reports/par/export")
            .set("Authorization", `Bearer ${branchManager.token}`)
            .query({
                tenant_id: tenant.id,
                format: "csv",
                as_of_date: "2026-02-15"
            });

        expect(par.status).toBe(200);
        expect(par.headers["content-type"]).toContain("text/csv");
        expect(par.text).toContain("par_bucket");
    });
});
