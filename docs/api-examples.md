# API Examples

All protected endpoints require:

`Authorization: Bearer <supabase_access_token>`

## Auth

### `POST /api/auth/signin`

```json
{
  "email": "owner.demo@saccos.local",
  "password": "StrongPassword123!"
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

## Platform

### `GET /api/platform/tenants`

No body.

### `POST /api/platform/tenants/:tenantId/subscription`

```json
{
  "plan_code": "growth",
  "status": "active",
  "start_at": "2026-01-01T00:00:00.000Z",
  "expires_at": "2026-12-31T23:59:59.000Z"
}
```

### `PATCH /api/platform/plans/:planId/features`

```json
{
  "features": [
    {
      "feature_key": "max_members",
      "feature_type": "int",
      "int_value": 10000
    },
    {
      "feature_key": "dividends_enabled",
      "feature_type": "bool",
      "bool_value": true
    }
  ]
}
```

## Tenant and User Setup

### `POST /api/tenants`

```json
{
  "name": "Ilboru Traders SACCOS",
  "registration_number": "TZ-SACCOS-2026-001",
  "status": "active",
  "plan": "growth",
  "subscription_status": "active",
  "start_at": "2026-01-01T00:00:00.000Z",
  "expires_at": "2026-12-31T23:59:59.000Z"
}
```

### `POST /api/users/setup-super-admin`

```json
{
  "tenant_id": "11111111-1111-1111-1111-111111111111",
  "branch_id": "22222222-2222-2222-2222-222222222222",
  "email": "admin@ilborusaccos.co.tz",
  "full_name": "Tenant Super Admin",
  "phone": "+255700000001",
  "invite": false,
  "password": "TempPass!2026"
}
```

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

### `GET /api/reports/trial-balance/export?tenant_id=<uuid>&from=2026-01-01&to=2026-12-31`

### `GET /api/reports/loan-aging/export?tenant_id=<uuid>`

### `GET /api/reports/par/export?tenant_id=<uuid>`

### `GET /api/reports/member-statements/export?tenant_id=<uuid>&member_id=<uuid>`

## Auditor

### `GET /api/auditor/summary`

### `GET /api/auditor/exceptions?reason=HIGH_VALUE_TX&page=1&limit=20`

### `GET /api/auditor/journals/:id`

### `GET /api/auditor/audit-logs?action=LOAN_APPLICATION_APPROVED`
