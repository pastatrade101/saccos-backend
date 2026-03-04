import AccountBalanceWalletRoundedIcon from "@mui/icons-material/AccountBalanceWalletRounded";
import CallMadeRoundedIcon from "@mui/icons-material/CallMadeRounded";
import CallReceivedRoundedIcon from "@mui/icons-material/CallReceivedRounded";
import PaidRoundedIcon from "@mui/icons-material/PaidRounded";
import SavingsRoundedIcon from "@mui/icons-material/SavingsRounded";
import WalletRoundedIcon from "@mui/icons-material/WalletRounded";
import {
    Alert,
    Box,
    Button,
    Card,
    CardContent,
    Chip,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Grid,
    Pagination,
    Stack,
    TextField,
    Typography
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

import { useAuth } from "../auth/AuthProvider";
import { ConfirmModal } from "../components/ConfirmModal";
import { DataTable, type Column } from "../components/DataTable";
import { SearchableSelect } from "../components/SearchableSelect";
import { useToast } from "../components/Toast";
import { api, getApiErrorMessage } from "../lib/api";
import {
    endpoints,
    type CashRequest,
    type CashResponse,
    type MemberAccountsResponse,
    type MembersResponse,
    type ShareContributionResponse,
    type StatementsResponse
} from "../lib/endpoints";
import type { Member, MemberAccount, StatementRow } from "../types/api";
import { formatCurrency, formatDate } from "../utils/format";

const actionSchema = z.object({
    account_id: z.string().uuid("Select an account."),
    amount: z.coerce.number().positive("Amount must be greater than zero."),
    reference: z.string().max(80).optional().or(z.literal("")),
    description: z.string().max(255).optional().or(z.literal(""))
});

type CashValues = z.infer<typeof actionSchema>;
type ActionType = "deposit" | "withdraw" | "share_contribution";
type PendingAction = { type: ActionType; values: CashValues } | null;

function MetricCard({
    title,
    value,
    helper,
    icon
}: {
    title: string;
    value: string;
    helper: string;
    icon: React.ReactNode;
}) {
    return (
        <Card
            variant="outlined"
            sx={{
                height: "100%",
                borderRadius: 2,
                borderColor: alpha("#0f172a", 0.08),
                boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)"
            }}
        >
            <CardContent>
                <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={2}>
                    <Box>
                        <Typography variant="overline" color="text.secondary">
                            {title}
                        </Typography>
                        <Typography variant="h5" sx={{ mt: 0.5 }}>
                            {value}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                            {helper}
                        </Typography>
                    </Box>
                    <Box
                        sx={{
                            width: 44,
                            height: 44,
                            borderRadius: 2,
                            display: "grid",
                            placeItems: "center",
                            bgcolor: "action.hover",
                            color: "text.primary"
                        }}
                    >
                        {icon}
                    </Box>
                </Stack>
            </CardContent>
        </Card>
    );
}

export function CashPage() {
    const theme = useTheme();
    const { pushToast } = useToast();
    const { selectedTenantId, selectedTenantName, subscriptionInactive } = useAuth();
    const [members, setMembers] = useState<Member[]>([]);
    const [accounts, setAccounts] = useState<MemberAccount[]>([]);
    const [transactions, setTransactions] = useState<StatementRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false);
    const [pendingAction, setPendingAction] = useState<PendingAction>(null);
    const [actionDialog, setActionDialog] = useState<ActionType | null>(null);
    const [page, setPage] = useState(1);
    const pageSize = 10;

    const defaultAccountId = localStorage.getItem("saccos:selectedAccountId") || "";

    const depositForm = useForm<CashValues>({
        resolver: zodResolver(actionSchema),
        defaultValues: {
            account_id: defaultAccountId,
            amount: 0,
            reference: "",
            description: ""
        }
    });

    const withdrawForm = useForm<CashValues>({
        resolver: zodResolver(actionSchema),
        defaultValues: {
            account_id: defaultAccountId,
            amount: 0,
            reference: "",
            description: ""
        }
    });

    const shareForm = useForm<CashValues>({
        resolver: zodResolver(actionSchema),
        defaultValues: {
            account_id: "",
            amount: 0,
            reference: "",
            description: ""
        }
    });

    const loadCashData = async () => {
        if (!selectedTenantId) {
            setLoading(false);
            return;
        }

        setLoading(true);

        try {
            const [{ data: membersResponse }, statementsResponse, { data: accountsResponse }] = await Promise.all([
                api.get<MembersResponse>(endpoints.members.list()),
                api.get<StatementsResponse>(endpoints.finance.statements(), {
                    params: { tenant_id: selectedTenantId }
                }),
                api.get<MemberAccountsResponse>(endpoints.members.accounts(), {
                    params: { tenant_id: selectedTenantId }
                })
            ]);

            setMembers(membersResponse.data);
            setTransactions((statementsResponse.data.data || []).slice(0, 40));
            setAccounts(accountsResponse.data || []);
        } catch (error) {
            pushToast({
                type: "error",
                title: "Unable to load cash desk",
                message: getApiErrorMessage(error)
            });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadCashData();
    }, [selectedTenantId]);

    const accountOptions = useMemo(
        () =>
            accounts.map((account) => {
                const member = members.find((entry) => entry.id === account.member_id);

                return {
                    value: account.id,
                    label: `${account.account_number} - ${member?.full_name || "Unknown member"}`,
                    secondary: `${account.product_type} • Balance ${formatCurrency(account.available_balance)}`
                };
            }),
        [accounts, members]
    );

    const savingsAccountOptions = useMemo(
        () => accountOptions.filter((option) => option.secondary.toLowerCase().includes("savings")),
        [accountOptions]
    );
    const shareAccountOptions = useMemo(
        () => accountOptions.filter((option) => option.secondary.toLowerCase().includes("shares")),
        [accountOptions]
    );

    const todayDepositTotal = useMemo(
        () =>
            transactions
                .filter((entry) => entry.transaction_type === "deposit")
                .reduce((sum, entry) => sum + entry.amount, 0),
        [transactions]
    );
    const todayWithdrawalTotal = useMemo(
        () =>
            transactions
                .filter((entry) => entry.transaction_type === "withdrawal")
                .reduce((sum, entry) => sum + entry.amount, 0),
        [transactions]
    );
    const visibleMembersWithActivity = useMemo(() => new Set(transactions.map((item) => item.member_id)).size, [transactions]);

    const transactionColumns: Column<StatementRow>[] = [
        { key: "date", header: "Date", render: (row) => formatDate(row.transaction_date) },
        { key: "member", header: "Member", render: (row) => row.member_name },
        { key: "type", header: "Type", render: (row) => row.transaction_type },
        { key: "amount", header: "Amount", render: (row) => formatCurrency(row.amount) },
        { key: "balance", header: "Balance", render: (row) => formatCurrency(row.running_balance) },
        { key: "reference", header: "Reference", render: (row) => row.reference || "N/A" }
    ];

    const totalPages = Math.max(1, Math.ceil(transactions.length / pageSize));
    const paginatedTransactions = useMemo(
        () => transactions.slice((page - 1) * pageSize, page * pageSize),
        [page, transactions]
    );

    const handleSubmit = (type: ActionType, values: CashValues) => {
        setPendingAction({ type, values });
    };

    const confirmAction = async () => {
        if (!pendingAction) {
            return;
        }

        setProcessing(true);

        try {
            const payload: CashRequest = {
                tenant_id: selectedTenantId || undefined,
                account_id: pendingAction.values.account_id,
                amount: pendingAction.values.amount,
                reference: pendingAction.values.reference || null,
                description: pendingAction.values.description || null
            };

            const endpoint =
                pendingAction.type === "deposit"
                    ? endpoints.finance.deposit()
                    : pendingAction.type === "withdraw"
                        ? endpoints.finance.withdraw()
                        : endpoints.finance.shareContribution();

            const { data } = await api.post<CashResponse | ShareContributionResponse>(endpoint, payload);
            pushToast({
                type: "success",
                title:
                    pendingAction.type === "deposit"
                        ? "Deposit posted"
                        : pendingAction.type === "withdraw"
                            ? "Withdrawal posted"
                            : "Share contribution posted",
                message: data.data.journal_id
                    ? `Journal ${data.data.journal_id} posted successfully.`
                    : data.data.message
            });

            setPendingAction(null);
            setActionDialog(null);
            depositForm.reset({ account_id: payload.account_id, amount: 0, reference: "", description: "" });
            withdrawForm.reset({ account_id: payload.account_id, amount: 0, reference: "", description: "" });
            shareForm.reset({ account_id: "", amount: 0, reference: "", description: "" });
            await loadCashData();
        } catch (error) {
            pushToast({
                type: "error",
                title: "Cash transaction failed",
                message: getApiErrorMessage(error)
            });
        } finally {
            setProcessing(false);
        }
    };

    const selectedAccount = accounts.find((account) => account.id === pendingAction?.values.account_id);
    const selectedMember = members.find((member) => member.id === selectedAccount?.member_id);

    const currentForm =
        actionDialog === "deposit"
            ? depositForm
            : actionDialog === "withdraw"
                ? withdrawForm
                : shareForm;
    const currentActionOptions = actionDialog === "share_contribution" ? shareAccountOptions : savingsAccountOptions;
    const currentActionValue = currentForm.watch("account_id");
    const currentActionAccount = accounts.find((account) => account.id === currentActionValue);
    const currentActionMember = members.find((member) => member.id === currentActionAccount?.member_id);

    const dialogTitle =
        actionDialog === "deposit"
            ? "Start Deposit"
            : actionDialog === "withdraw"
                ? "Start Withdrawal"
                : "Post Share Contribution";

    return (
        <Stack spacing={3}>
            <Card
                variant="outlined"
                sx={{
                    borderRadius: 2,
                    overflow: "hidden",
                    background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.12)}, ${alpha(theme.palette.success.main, 0.06)} 58%, ${alpha(theme.palette.background.paper, 0.96)})`
                }}
            >
                <CardContent>
                    <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={2}>
                        <Box>
                            <Typography variant="h5">Cash Desk</Typography>
                            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75, maxWidth: 780 }}>
                                Handle counter deposits, withdrawals, and share capital contributions from a cleaner teller workspace with confirmation before posting.
                            </Typography>
                        </Box>
                        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
                            <Chip label={selectedTenantName || "Tenant workspace"} variant="outlined" />
                            <Chip label="Teller Cash Operations" color="success" />
                        </Stack>
                    </Stack>
                </CardContent>
            </Card>

            <Grid container spacing={2}>
                <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
                    <MetricCard
                        title="Tracked Accounts"
                        value={String(accounts.length)}
                        helper="Savings and share accounts visible to this workspace."
                        icon={<WalletRoundedIcon fontSize="small" />}
                    />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
                    <MetricCard
                        title="Members with Activity"
                        value={String(visibleMembersWithActivity)}
                        helper="Members with recent posted cash movements."
                        icon={<AccountBalanceWalletRoundedIcon fontSize="small" />}
                    />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
                    <MetricCard
                        title="Deposit Intake"
                        value={formatCurrency(todayDepositTotal)}
                        helper="Visible posted deposits in the current desk view."
                        icon={<CallReceivedRoundedIcon fontSize="small" />}
                    />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
                    <MetricCard
                        title="Withdrawal Outflow"
                        value={formatCurrency(todayWithdrawalTotal)}
                        helper="Visible posted withdrawals in the current desk view."
                        icon={<CallMadeRoundedIcon fontSize="small" />}
                    />
                </Grid>
            </Grid>

            {subscriptionInactive ? (
                <Alert severity="warning" variant="outlined">
                    Subscription inactive. Cash operations are visible for review only until the tenant subscription is renewed.
                </Alert>
            ) : null}

            <Grid container spacing={2}>
                <Grid size={{ xs: 12, xl: 7 }}>
                    <Card
                        variant="outlined"
                        sx={{
                            height: "100%",
                            borderRadius: 2,
                            background: `linear-gradient(180deg, ${alpha(theme.palette.background.paper, 0.98)}, ${alpha(theme.palette.primary.main, 0.035)})`
                        }}
                    >
                        <CardContent>
                            <Stack spacing={2.5}>
                                <Box>
                                    <Typography variant="h6">Cash Operations</Typography>
                                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                                        Start the cash action you need, complete the details in the modal, then confirm the posting before it hits the ledger.
                                    </Typography>
                                </Box>

                                <Grid container spacing={2}>
                                    <Grid size={{ xs: 12, md: 4 }}>
                                        <Card variant="outlined" sx={{ borderRadius: 2, height: "100%" }}>
                                            <CardContent>
                                                <Stack spacing={2}>
                                                    <Box>
                                                        <Typography variant="subtitle1">Deposit</Typography>
                                                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                                                            Post member savings deposits with teller confirmation.
                                                        </Typography>
                                                    </Box>
                                                    <Button
                                                        variant="contained"
                                                        startIcon={<CallReceivedRoundedIcon />}
                                                        onClick={() => setActionDialog("deposit")}
                                                        disabled={subscriptionInactive}
                                                        fullWidth
                                                    >
                                                        Start Deposit
                                                    </Button>
                                                </Stack>
                                            </CardContent>
                                        </Card>
                                    </Grid>
                                    <Grid size={{ xs: 12, md: 4 }}>
                                        <Card variant="outlined" sx={{ borderRadius: 2, height: "100%" }}>
                                            <CardContent>
                                                <Stack spacing={2}>
                                                    <Box>
                                                        <Typography variant="subtitle1">Withdraw</Typography>
                                                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                                                            Validate savings balance and post controlled withdrawals.
                                                        </Typography>
                                                    </Box>
                                                    <Button
                                                        variant="contained"
                                                        color="error"
                                                        startIcon={<CallMadeRoundedIcon />}
                                                        onClick={() => setActionDialog("withdraw")}
                                                        disabled={subscriptionInactive}
                                                        fullWidth
                                                    >
                                                        Start Withdrawal
                                                    </Button>
                                                </Stack>
                                            </CardContent>
                                        </Card>
                                    </Grid>
                                    <Grid size={{ xs: 12, md: 4 }}>
                                        <Card variant="outlined" sx={{ borderRadius: 2, height: "100%" }}>
                                            <CardContent>
                                                <Stack spacing={2}>
                                                    <Box>
                                                        <Typography variant="subtitle1">Share Capital</Typography>
                                                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                                                            Record member share contributions into the share ledger.
                                                        </Typography>
                                                    </Box>
                                                    <Button
                                                        variant="outlined"
                                                        startIcon={<SavingsRoundedIcon />}
                                                        onClick={() => setActionDialog("share_contribution")}
                                                        disabled={subscriptionInactive}
                                                        fullWidth
                                                    >
                                                        Start Contribution
                                                    </Button>
                                                </Stack>
                                            </CardContent>
                                        </Card>
                                    </Grid>
                                </Grid>
                            </Stack>
                        </CardContent>
                    </Card>
                </Grid>

                <Grid size={{ xs: 12, xl: 5 }}>
                    <Card
                        variant="outlined"
                        sx={{
                            height: "100%",
                            borderRadius: 2,
                            background: `linear-gradient(180deg, ${alpha(theme.palette.background.paper, 0.98)}, ${alpha(theme.palette.success.main, 0.035)})`
                        }}
                    >
                        <CardContent>
                            <Stack spacing={2}>
                                <Box>
                                    <Typography variant="h6">Desk Guidance</Typography>
                                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                                        Keep member cash activity disciplined. Always choose the right savings or share account, confirm the reference, and post only after reviewing the summary.
                                    </Typography>
                                </Box>

                                <Grid container spacing={1.5}>
                                    {[
                                        ["Deposit rule", "Savings account only, then confirm before posting"],
                                        ["Withdrawal rule", "Member balance must remain sufficient"],
                                        ["Share capital", "Use member share account, not savings account"],
                                        ["Posting control", "Every action is reviewed in a confirmation step"]
                                    ].map(([label, value]) => (
                                        <Grid key={label} size={{ xs: 12, sm: 6 }}>
                                            <Box
                                                sx={{
                                                    p: 1.5,
                                                    border: `1px solid ${theme.palette.divider}`,
                                                    borderRadius: 2,
                                                    bgcolor: alpha(theme.palette.background.default, 0.5),
                                                    minHeight: 108
                                                }}
                                            >
                                                <Typography variant="caption" color="text.secondary">
                                                    {label}
                                                </Typography>
                                                <Typography variant="body2" sx={{ mt: 0.5, fontWeight: 600 }}>
                                                    {value}
                                                </Typography>
                                            </Box>
                                        </Grid>
                                    ))}
                                </Grid>
                            </Stack>
                        </CardContent>
                    </Card>
                </Grid>
            </Grid>

            <Card
                variant="outlined"
                sx={{
                    borderRadius: 2,
                    boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)"
                }}
            >
                <CardContent>
                    <Stack
                        direction={{ xs: "column", md: "row" }}
                        justifyContent="space-between"
                        alignItems={{ xs: "flex-start", md: "center" }}
                        spacing={1.5}
                        sx={{ mb: 2 }}
                    >
                        <Box>
                            <Typography variant="h6">Recent Cash Transactions</Typography>
                            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                                Review the latest posted teller activity across visible accounts.
                            </Typography>
                        </Box>
                    </Stack>

                    {loading ? (
                        <Box className="empty-state">Loading cash movements...</Box>
                    ) : (
                        <Stack spacing={2}>
                            <DataTable rows={paginatedTransactions} columns={transactionColumns} emptyMessage="No cash transactions yet." />
                            {transactions.length > pageSize ? (
                                <Stack direction="row" justifyContent="flex-end">
                                    <Pagination
                                        count={totalPages}
                                        page={page}
                                        onChange={(_, value) => setPage(value)}
                                        color="primary"
                                    />
                                </Stack>
                            ) : null}
                        </Stack>
                    )}
                </CardContent>
            </Card>

            <Dialog
                open={Boolean(actionDialog)}
                onClose={processing ? undefined : () => setActionDialog(null)}
                maxWidth="sm"
                fullWidth
            >
                <DialogTitle>{dialogTitle}</DialogTitle>
                <DialogContent dividers>
                    <Stack spacing={2.5} sx={{ pt: 0.5 }}>
                        <Typography variant="body2" color="text.secondary">
                            {actionDialog === "deposit"
                                ? "Select the member savings account, enter the amount, and review before posting."
                                : actionDialog === "withdraw"
                                    ? "Choose the member savings account and confirm the withdrawal details before posting."
                                    : "Choose the member share account and capture the contribution details before posting."}
                        </Typography>

                        <Box
                            component="form"
                            id="cash-action-form"
                            onSubmit={
                                actionDialog === "deposit"
                                    ? depositForm.handleSubmit((values) => handleSubmit("deposit", values))
                                    : actionDialog === "withdraw"
                                        ? withdrawForm.handleSubmit((values) => handleSubmit("withdraw", values))
                                        : shareForm.handleSubmit((values) => handleSubmit("share_contribution", values))
                            }
                            sx={{ display: "grid", gap: 2 }}
                        >
                            <Box>
                                <Typography variant="caption" color="text.secondary">
                                    Account
                                </Typography>
                                <Box sx={{ mt: 0.75 }}>
                                    <SearchableSelect
                                        value={currentForm.watch("account_id")}
                                        options={currentActionOptions}
                                        onChange={(value) => currentForm.setValue("account_id", value, { shouldValidate: true })}
                                    />
                                </Box>
                                {currentForm.formState.errors.account_id ? (
                                    <Typography variant="caption" color="error" sx={{ mt: 0.75, display: "block" }}>
                                        {currentForm.formState.errors.account_id.message}
                                    </Typography>
                                ) : null}
                            </Box>

                            {currentActionAccount ? (
                                <Grid container spacing={1.5}>
                                    <Grid size={{ xs: 12, sm: 6 }}>
                                        <Box
                                            sx={{
                                                p: 1.5,
                                                border: `1px solid ${theme.palette.divider}`,
                                                borderRadius: 2,
                                                bgcolor: alpha(theme.palette.background.default, 0.45)
                                            }}
                                        >
                                            <Typography variant="caption" color="text.secondary">
                                                Member
                                            </Typography>
                                            <Typography variant="body2" sx={{ mt: 0.5, fontWeight: 600 }}>
                                                {currentActionMember?.full_name || "Unknown member"}
                                            </Typography>
                                        </Box>
                                    </Grid>
                                    <Grid size={{ xs: 12, sm: 6 }}>
                                        <Box
                                            sx={{
                                                p: 1.5,
                                                border: `1px solid ${theme.palette.divider}`,
                                                borderRadius: 2,
                                                bgcolor: alpha(theme.palette.background.default, 0.45)
                                            }}
                                        >
                                            <Typography variant="caption" color="text.secondary">
                                                Current Balance
                                            </Typography>
                                            <Typography variant="body2" sx={{ mt: 0.5, fontWeight: 600 }}>
                                                {formatCurrency(currentActionAccount.available_balance)}
                                            </Typography>
                                        </Box>
                                    </Grid>
                                </Grid>
                            ) : null}

                            <Grid container spacing={2}>
                                <Grid size={{ xs: 12, md: 6 }}>
                                    <TextField
                                        label="Amount"
                                        type="number"
                                        fullWidth
                                        inputProps={{ step: "0.01" }}
                                        {...currentForm.register("amount")}
                                        error={Boolean(currentForm.formState.errors.amount)}
                                        helperText={currentForm.formState.errors.amount?.message}
                                    />
                                </Grid>
                                <Grid size={{ xs: 12, md: 6 }}>
                                    <TextField
                                        label="Reference"
                                        fullWidth
                                        placeholder={
                                            actionDialog === "deposit"
                                                ? "DEP-0001"
                                                : actionDialog === "withdraw"
                                                    ? "WDL-0001"
                                                    : "SHR-0001"
                                        }
                                        {...currentForm.register("reference")}
                                        error={Boolean(currentForm.formState.errors.reference)}
                                        helperText={currentForm.formState.errors.reference?.message}
                                    />
                                </Grid>
                            </Grid>

                            <TextField
                                label="Notes"
                                fullWidth
                                multiline
                                minRows={3}
                                placeholder={
                                    actionDialog === "deposit"
                                        ? "Counter savings deposit"
                                        : actionDialog === "withdraw"
                                            ? "Member withdrawal"
                                            : "Monthly share capital contribution"
                                }
                                {...currentForm.register("description")}
                                error={Boolean(currentForm.formState.errors.description)}
                                helperText={currentForm.formState.errors.description?.message}
                            />
                        </Box>
                    </Stack>
                </DialogContent>
                <DialogActions sx={{ px: 3, py: 2 }}>
                    <Button onClick={() => setActionDialog(null)} disabled={processing} color="inherit">
                        Cancel
                    </Button>
                    <Button form="cash-action-form" type="submit" variant="contained" disabled={processing || subscriptionInactive}>
                        Review
                    </Button>
                </DialogActions>
            </Dialog>

            <ConfirmModal
                open={Boolean(pendingAction)}
                title={
                    pendingAction?.type === "deposit"
                        ? "Confirm Deposit"
                        : pendingAction?.type === "withdraw"
                            ? "Confirm Withdrawal"
                            : "Confirm Share Contribution"
                }
                summary={
                    <Stack spacing={1.25}>
                        <Box sx={{ display: "flex", justifyContent: "space-between", gap: 2 }}>
                            <Typography variant="body2" color="text.secondary">Member</Typography>
                            <Typography variant="body2" fontWeight={600}>{selectedMember?.full_name || "Unknown"}</Typography>
                        </Box>
                        <Box sx={{ display: "flex", justifyContent: "space-between", gap: 2 }}>
                            <Typography variant="body2" color="text.secondary">Account</Typography>
                            <Typography variant="body2" fontWeight={600}>{selectedAccount?.account_number || "Unknown"}</Typography>
                        </Box>
                        <Box sx={{ display: "flex", justifyContent: "space-between", gap: 2 }}>
                            <Typography variant="body2" color="text.secondary">Amount</Typography>
                            <Typography variant="body2" fontWeight={600}>{formatCurrency(pendingAction?.values.amount)}</Typography>
                        </Box>
                        <Box sx={{ display: "flex", justifyContent: "space-between", gap: 2 }}>
                            <Typography variant="body2" color="text.secondary">Reference</Typography>
                            <Typography variant="body2" fontWeight={600}>{pendingAction?.values.reference || "N/A"}</Typography>
                        </Box>
                    </Stack>
                }
                confirmLabel={
                    pendingAction?.type === "deposit"
                        ? "Post Deposit"
                        : pendingAction?.type === "withdraw"
                            ? "Post Withdrawal"
                            : "Post Share Contribution"
                }
                loading={processing}
                onCancel={() => setPendingAction(null)}
                onConfirm={() => void confirmAction()}
            />
        </Stack>
    );
}
