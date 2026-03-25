# API Examples

All protected endpoints require:

`Authorization: Bearer <supabase_access_token>`

Current deployment note:

- The active API is a single client workspace.
- Some requests and query parameters still use `tenant_id` because the underlying contracts and schema were inherited from the earlier SaaS version.
- In current usage, `tenant_id` refers to the one deployed workspace ID for this client.
- Platform provisioning endpoints are not part of the active mounted route surface and are omitted here.

## Auth

### `POST /api/auth/signin`

```json
{
  "email": "owner.demo@saccos.local",
  "password": "StrongPassword123!",
  "challenge_id": "optional-otp-challenge-id",
  "otp_code": "optional-6-digit-code"
}
```

When OTP is enabled and `challenge_id` / `otp_code` are missing, API returns:

```json
{
  "error": {
    "code": "OTP_REQUIRED",
    "message": "One-time verification code required.",
    "details": {
      "challenge_id": "2f9f3f13-3f74-4af5-ae75-08cbd4b4748f",
      "expires_at": "2026-03-07T12:30:00.000Z",
      "destination_hint": "2557******45",
      "resend_count": 0,
      "resend_remaining": 3
    }
  }
}
```

### `POST /api/auth/otp/send`

```json
{
  "email": "owner.demo@saccos.local",
  "password": "StrongPassword123!",
  "challenge_id": "optional-existing-challenge-id"
}
```

### `POST /api/auth/otp/verify`

```json
{
  "email": "owner.demo@saccos.local",
  "password": "StrongPassword123!",
  "challenge_id": "2f9f3f13-3f74-4af5-ae75-08cbd4b4748f",
  "otp_code": "123456"
}
```

### `POST /api/auth/signup`

```json
{
  "tenant_id": "11111111-1111-1111-1111-111111111111",
  "email": "branch.manager@saccos.local",
  "full_name": "Branch Manager",
  "phone": "+255700123456",
  "role": "branch_manager",
  "branch_ids": [
    "22222222-2222-2222-2222-222222222222"
  ],
  "send_invite": true
}
```

## Workspace Bootstrap and User Setup

### `POST /api/users/setup-super-admin`

```json
{
  "tenant_id": "11111111-1111-1111-1111-111111111111",
  "branch_id": "22222222-2222-2222-2222-222222222222",
  "email": "admin@ilborusaccos.co.tz",
  "full_name": "SACCOS Super Admin",
  "phone": "+255700000001",
  "invite": false,
  "password": "TempPass!2026"
}
```

Use this only for the initial bootstrap of the deployed workspace.

### `POST /api/users`

```json
{
  "email": "loan.officer@ilborusaccos.co.tz",
  "full_name": "Loan Officer",
  "phone": "+255700000010",
  "role": "loan_officer",
  "branch_ids": [
    "22222222-2222-2222-2222-222222222222"
  ],
  "send_invite": true
}
```

## Member Applications

### `POST /api/member-applications`

```json
{
  "branch_id": "22222222-2222-2222-2222-222222222222",
  "full_name": "Neema Michael",
  "phone": "+255712345678",
  "email": "neema.member@mail.local",
  "national_id": "19910101-12345-00001-12",
  "membership_fee_paid": 10000,
  "kyc_status": "pending"
}
```

### `POST /api/member-applications/:id/submit`

```json
{}
```

### `POST /api/member-applications/:id/approve`

```json
{}
```

## Members

### `POST /api/members`

```json
{
  "branch_id": "22222222-2222-2222-2222-222222222222",
  "full_name": "Mariam Joseph",
  "phone": "+255713333333",
  "email": "mariam.member@mail.local",
  "national_id": "19940202-54321-00009-08",
  "status": "active"
}
```

### `POST /api/members/:id/create-login`

```json
{
  "email": "mariam.member@mail.local",
  "password": "TempMember!2026"
}
```

## Loan Workflow

### `POST /api/loan-applications`

```json
{
  "member_id": "33333333-3333-3333-3333-333333333333",
  "product_id": "44444444-4444-4444-4444-444444444444",
  "purpose": "Working capital",
  "requested_amount": 3000000,
  "requested_term_count": 12,
  "requested_repayment_frequency": "monthly",
  "requested_interest_rate": 12
}
```

### `POST /api/loan-applications/:id/appraise`

```json
{
  "recommended_amount": 2500000,
  "recommended_term_count": 10,
  "recommended_interest_rate": 12,
  "recommended_repayment_frequency": "monthly",
  "risk_rating": "medium",
  "appraisal_notes": "Meets product policy and current repayment capacity."
}
```

### `POST /api/loan-applications/:id/approve`

```json
{
  "notes": "Approved for disbursement."
}
```

### `POST /api/loan-applications/:id/disburse`

```json
{
  "reference": "DISB-2026-0001",
  "description": "Approved disbursement release",
  "receipt_ids": []
}
```

## Cash and Finance

### `POST /api/deposit`

```json
{
  "account_id": "55555555-5555-5555-5555-555555555555",
  "amount": 200000,
  "reference": "DEP-2026-0001",
  "description": "Counter cash deposit"
}
```

### `POST /api/withdraw`

```json
{
  "account_id": "55555555-5555-5555-5555-555555555555",
  "amount": 50000,
  "reference": "WDL-2026-0001",
  "description": "Member withdrawal"
}
```

### `POST /api/loan/repay`

```json
{
  "loan_id": "66666666-6666-6666-6666-666666666666",
  "amount": 320000,
  "reference": "LNPAY-2026-0001",
  "description": "Monthly repayment"
}
```

## CSV Import

### `POST /api/imports/members` (multipart form-data)

Fields:

- `file`: csv
- `create_portal_account`: `true|false`
- `default_branch_id`: optional

### `POST /api/imports/members/preview` (multipart form-data)

Fields:

- `file`: csv
- `create_portal_account`: `true|false`
- `default_branch_id`: optional

Returns parsed rows with validation errors so users can review before actual import.

### `GET /api/imports/members/:jobId/rows?status=failed&page=1&limit=25`

No body.

### `GET /api/imports/members/:jobId/credentials`

Returns signed URL for credentials export when available.

## Cash Control and Receipts

### `POST /api/cash-control/sessions/open`

```json
{
  "branch_id": "22222222-2222-2222-2222-222222222222",
  "opening_cash": 500000
}
```

### `PUT /api/cash-control/receipt-policy`

```json
{
  "branch_id": "22222222-2222-2222-2222-222222222222",
  "receipt_required": true,
  "required_threshold": 50000,
  "max_receipts_per_tx": 3,
  "max_file_size_mb": 5,
  "allowed_mime_types": [
    "image/jpeg",
    "image/png",
    "application/pdf"
  ],
  "enforce_on_types": [
    "deposit",
    "withdraw",
    "loan_disburse",
    "loan_repay"
  ]
}
```

## Reports

The current build still accepts `tenant_id` on some report routes for compatibility. Use the deployed workspace ID where required.

### `GET /api/reports/trial-balance/export?tenant_id=<workspace_uuid>&from_date=2026-01-01&to_date=2026-12-31`

### `GET /api/reports/loan-aging/export?tenant_id=<workspace_uuid>`

### `GET /api/reports/par/export?tenant_id=<workspace_uuid>`

### `GET /api/reports/loan-portfolio-summary/export?tenant_id=<workspace_uuid>&format=csv`

### `GET /api/reports/member-balances-summary/export?tenant_id=<workspace_uuid>&format=csv`

### `GET /api/reports/audit-exceptions/export?tenant_id=<workspace_uuid>&reason_code=HIGH_VALUE_TX&from_date=2026-01-01&to_date=2026-12-31&format=csv`

### `GET /api/reports/member-statements/export?tenant_id=<workspace_uuid>&member_id=<uuid>`

## Pagination (Operational Lists)

### `GET /api/members?page=1&limit=50&search=amina`

### `GET /api/members/accounts?page=1&limit=50&product_type=savings`

### `GET /api/loan-applications?page=1&limit=25&status=submitted`

### `GET /api/loan/portfolio?page=1&limit=50&status=active`

### `GET /api/loan/transactions?page=1&limit=50&loan_id=<uuid>`

## Auditor

### `GET /api/auditor/summary`

### `GET /api/auditor/exceptions?reason=HIGH_VALUE_TX&page=1&limit=20`

### `GET /api/auditor/journals/:id`

### `GET /api/auditor/audit-logs?action=LOAN_APPLICATION_APPROVED`
