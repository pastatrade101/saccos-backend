# API Examples

All protected requests require `Authorization: Bearer <supabase_access_token>`.

## POST /api/auth/signin

```json
{
  "email": "admin@saccos.example",
  "password": "SuperStrongPassword123!"
}
```

## POST /api/auth/signup

```json
{
  "tenant_id": "0a3fd8f8-5c1d-4a16-a0ce-d1241b0c4662",
  "email": "teller@saccos.example",
  "full_name": "Main Branch Teller",
  "phone": "+256700000001",
  "role": "teller",
  "branch_ids": ["18232021-18b5-4907-b32c-4df17ce27526"],
  "send_invite": true
}
```

## POST /api/tenants

```json
{
  "name": "Demo Farmers SACCOS",
  "registration_number": "SAC-2026-001",
  "status": "active",
  "plan": "growth",
  "subscription_status": "active",
  "start_at": "2026-03-03T00:00:00.000Z",
  "expires_at": "2026-04-02T23:59:59.000Z"
}
```

## POST /api/branches

```json
{
  "name": "Main Branch",
  "code": "HQ",
  "address_line1": "Plot 1 Main Street",
  "address_line2": "Level 2",
  "city": "Kampala",
  "state": "Central",
  "country": "UG"
}
```

## POST /api/users

```json
{
  "email": "manager@saccos.example",
  "full_name": "Branch Manager",
  "phone": "+256700000002",
  "role": "branch_manager",
  "branch_ids": ["18232021-18b5-4907-b32c-4df17ce27526"],
  "send_invite": true
}
```

## POST /api/members

```json
{
  "branch_id": "18232021-18b5-4907-b32c-4df17ce27526",
  "full_name": "Jane Member",
  "phone": "+256700000010",
  "email": "jane.member@example.com",
  "national_id": "CM1234567890",
  "status": "active"
}
```

## POST /api/deposit

```json
{
  "account_id": "4a3bf1ab-f602-410f-a7dd-6dc2c3d73bd8",
  "amount": 150000,
  "reference": "DEP-0001",
  "description": "Counter savings deposit"
}
```

## POST /api/withdraw

```json
{
  "account_id": "4a3bf1ab-f602-410f-a7dd-6dc2c3d73bd8",
  "amount": 50000,
  "reference": "WDL-0001",
  "description": "Member withdrawal"
}
```

## POST /api/loan/disburse

```json
{
  "member_id": "d924a532-606a-4a42-a3b7-f277822d1c5c",
  "branch_id": "18232021-18b5-4907-b32c-4df17ce27526",
  "principal_amount": 2500000,
  "annual_interest_rate": 18,
  "term_count": 12,
  "repayment_frequency": "monthly",
  "reference": "LN-APP-2026-0001",
  "description": "Agriculture loan disbursement"
}
```

## POST /api/loan/repay

```json
{
  "loan_id": "2cce0f91-f83b-46bc-b2d9-bbe590d9aeba",
  "amount": 250000,
  "reference": "LNR-0001",
  "description": "Monthly loan repayment"
}
```

## GET /api/statements

```json
{
  "account_id": "4a3bf1ab-f602-410f-a7dd-6dc2c3d73bd8",
  "from_date": "2026-01-01",
  "to_date": "2026-03-31"
}
```

## GET /api/ledger

```json
{
  "from_date": "2026-03-01",
  "to_date": "2026-03-31"
}
```

## GET /api/reports/trial-balance/export

Query string:

```text
/api/reports/trial-balance/export?format=csv
```

## GET /api/reports/member-statements/export

Query string:

```text
/api/reports/member-statements/export?account_id=4a3bf1ab-f602-410f-a7dd-6dc2c3d73bd8&from_date=2026-01-01&to_date=2026-03-31&format=pdf
```
