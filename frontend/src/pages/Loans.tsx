import AccountBalanceRoundedIcon from "@mui/icons-material/AccountBalanceRounded";
import CalendarMonthRoundedIcon from "@mui/icons-material/CalendarMonthRounded";
import CreditScoreRoundedIcon from "@mui/icons-material/CreditScoreRounded";
import PaymentsRoundedIcon from "@mui/icons-material/PaymentsRounded";
import PriceCheckRoundedIcon from "@mui/icons-material/PriceCheckRounded";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import {
    Alert,
    Avatar,
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
    MenuItem,
    Pagination,
    Stack,
    TextField,
    Typography
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
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
    type LoanDisburseRequest,
    type LoansResponse,
    type LoanSchedulesResponse,
    type LoanTransactionsResponse,
    type LoanRepaymentRequest,
    type MembersResponse
} from "../lib/endpoints";
import type { Loan, LoanSchedule, LoanTransaction, Member } from "../types/api";
import { formatCurrency, formatDate } from "../utils/format";

const disburseSchema = z.object({
    member_id: z.string().uuid("Select a member."),
    principal_amount: z.coerce.number().positive("Principal amount is required."),
    annual_interest_rate: z.coerce.number().min(0).max(100),
    term_count: z.coerce.number().int().positive("Term is required."),
    repayment_frequency: z.enum(["daily", "weekly", "monthly"]).default("monthly"),
    reference: z.string().max(80).optional().or(z.literal("")),
    description: z.string().max(255).optional().or(z.literal("")),
    disbursement_date: z.string().min(1, "Disbursement date is required.")
});

const repaySchema = z.object({
    loan_id: z.string().uuid("Select a loan."),
    amount: z.coerce.number().positive("Repayment amount is required."),
    reference: z.string().max(80).optional().or(z.literal("")),
    description: z.string().max(255).optional().or(z.literal("")),
    payment_date: z.string().min(1, "Payment date is required.")
});

type DisburseValues = z.infer<typeof disburseSchema>;
type RepayValues = z.infer<typeof repaySchema>;
type PendingLoanAction =
    | { type: "disburse"; values: DisburseValues }
    | { type: "repay"; values: RepayValues }
    | null;

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
        <Card variant="outlined" sx={{ height: "100%" }}>
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
                    <Avatar
                        variant="rounded"
                        sx={{
                            width: 42,
                            height: 42,
                            borderRadius: 2,
                            bgcolor: "action.hover",
                            color: "text.primary"
                        }}
                    >
                        {icon}
                    </Avatar>
                </Stack>
            </CardContent>
        </Card>
    );
}

export function LoansPage() {
    const theme = useTheme();
    const navigate = useNavigate();
    const { pushToast } = useToast();
    const { selectedTenantId, selectedTenantName, selectedBranchId, subscriptionInactive } = useAuth();
    const [members, setMembers] = useState<Member[]>([]);
    const [loans, setLoans] = useState<Loan[]>([]);
    const [schedules, setSchedules] = useState<LoanSchedule[]>([]);
    const [transactions, setTransactions] = useState<LoanTransaction[]>([]);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false);
    const [pendingAction, setPendingAction] = useState<PendingLoanAction>(null);
    const [showDisburseModal, setShowDisburseModal] = useState(false);
    const [showRepayModal, setShowRepayModal] = useState(false);
    const [page, setPage] = useState(1);
    const pageSize = 8;

    const selectedMemberId = localStorage.getItem("saccos:selectedMemberId") || "";

    const disburseForm = useForm<DisburseValues>({
        resolver: zodResolver(disburseSchema),
        defaultValues: {
            member_id: selectedMemberId,
            principal_amount: 0,
            annual_interest_rate: 18,
            term_count: 12,
            repayment_frequency: "monthly",
            reference: "",
            description: "",
            disbursement_date: new Date().toISOString().slice(0, 10)
        }
    });

    const repayForm = useForm<RepayValues>({
        resolver: zodResolver(repaySchema),
        defaultValues: {
            loan_id: "",
            amount: 0,
            reference: "",
            description: "",
            payment_date: new Date().toISOString().slice(0, 10)
        }
    });

    const loadLoans = async () => {
        if (!selectedTenantId) {
            setLoading(false);
            return;
        }

        setLoading(true);

        try {
            const [{ data: membersResponse }, { data: loansResponse }, { data: schedulesResponse }, { data: transactionsResponse }] = await Promise.all([
                api.get<MembersResponse>(endpoints.members.list()),
                api.get<LoansResponse>(endpoints.finance.loanPortfolio(), {
                    params: { tenant_id: selectedTenantId }
                }),
                api.get<LoanSchedulesResponse>(endpoints.finance.loanSchedules(), {
                    params: { tenant_id: selectedTenantId }
                }),
                api.get<LoanTransactionsResponse>(endpoints.finance.loanTransactions(), {
                    params: { tenant_id: selectedTenantId }
                })
            ]);

            setMembers(membersResponse.data);
            setLoans(loansResponse.data || []);
            setSchedules((schedulesResponse.data || []).filter((schedule) => ["pending", "partial", "overdue"].includes(schedule.status)));
            setTransactions(transactionsResponse.data || []);
        } catch (error) {
            pushToast({
                type: "error",
                title: "Unable to load loans",
                message: getApiErrorMessage(error)
            });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadLoans();
    }, [selectedTenantId]);

    const memberOptions = useMemo(
        () =>
            members.map((member) => ({
                value: member.id,
                label: member.full_name,
                secondary: member.phone || undefined
            })),
        [members]
    );

    const loanOptions = useMemo(
        () =>
            loans.map((loan) => {
                const member = members.find((entry) => entry.id === loan.member_id);

                return {
                    value: loan.id,
                    label: `${loan.loan_number} - ${member?.full_name || "Unknown member"}`,
                    secondary: `Outstanding ${formatCurrency(loan.outstanding_principal + loan.accrued_interest)}`
                };
            }),
        [loans, members]
    );

    const nextDueByLoan = useMemo(() => {
        const map = new Map<string, string>();
        schedules.forEach((schedule) => {
            if (!map.has(schedule.loan_id)) {
                map.set(schedule.loan_id, schedule.due_date);
            }
        });
        return map;
    }, [schedules]);

    const metrics = useMemo(() => {
        const activeLoans = loans.filter((loan) => loan.status === "active");
        const arrearsLoans = loans.filter((loan) => loan.status === "in_arrears");
        const outstandingPrincipal = loans.reduce((sum, loan) => sum + loan.outstanding_principal, 0);
        const accruedInterest = loans.reduce((sum, loan) => sum + loan.accrued_interest, 0);

        return {
            totalLoans: loans.length,
            activeLoans: activeLoans.length,
            arrearsLoans: arrearsLoans.length,
            outstandingPrincipal,
            accruedInterest,
            nextDueCount: schedules.filter((schedule) => schedule.status === "overdue").length
        };
    }, [loans, schedules]);

    const handleDisburse = disburseForm.handleSubmit((values) => setPendingAction({ type: "disburse", values }));
    const handleRepay = repayForm.handleSubmit((values) => setPendingAction({ type: "repay", values }));

    const confirmAction = async () => {
        if (!pendingAction) {
            return;
        }

        setProcessing(true);

        try {
            if (pendingAction.type === "disburse") {
                const payload: LoanDisburseRequest = {
                    tenant_id: selectedTenantId || undefined,
                    branch_id: selectedBranchId || "",
                    member_id: pendingAction.values.member_id,
                    principal_amount: pendingAction.values.principal_amount,
                    annual_interest_rate: pendingAction.values.annual_interest_rate,
                    term_count: pendingAction.values.term_count,
                    repayment_frequency: pendingAction.values.repayment_frequency,
                    reference: pendingAction.values.reference || null,
                    description:
                        `${pendingAction.values.description || "Loan disbursement"} | UI date ${pendingAction.values.disbursement_date}`
                };

                const { data } = await api.post(endpoints.finance.loanDisburse(), payload);
                pushToast({
                    type: "success",
                    title: "Loan disbursed",
                    message: data.data.loan_number || data.data.message
                });
                setShowDisburseModal(false);
            } else {
                const payload: LoanRepaymentRequest = {
                    tenant_id: selectedTenantId || undefined,
                    loan_id: pendingAction.values.loan_id,
                    amount: pendingAction.values.amount,
                    reference: pendingAction.values.reference || null,
                    description:
                        `${pendingAction.values.description || "Loan repayment"} | UI date ${pendingAction.values.payment_date}`
                };

                await api.post(endpoints.finance.loanRepay(), payload);
                pushToast({
                    type: "success",
                    title: "Loan repayment posted",
                    message: "The repayment has been posted successfully."
                });
                setShowRepayModal(false);
            }

            setPendingAction(null);
            await loadLoans();
        } catch (error) {
            pushToast({
                type: "error",
                title: "Loan action failed",
                message: getApiErrorMessage(error)
            });
        } finally {
            setProcessing(false);
        }
    };

    const loanColumns: Column<Loan>[] = [
        {
            key: "loan",
            header: "Loan",
            render: (row) => {
                const member = members.find((entry) => entry.id === row.member_id);

                return (
                    <Stack spacing={0.25}>
                        <Button
                            variant="text"
                            color="inherit"
                            onClick={() => navigate(`/loans/${row.id}`)}
                            sx={{
                                p: 0,
                                minWidth: 0,
                                justifyContent: "flex-start",
                                fontWeight: 700
                            }}
                        >
                            {row.loan_number}
                        </Button>
                        <Typography variant="caption" color="text.secondary">
                            {member?.full_name || "Unknown member"}
                        </Typography>
                    </Stack>
                );
            }
        },
        {
            key: "status",
            header: "Status",
            render: (row) => (
                <Chip
                    size="small"
                    label={row.status}
                    color={row.status === "active" ? "success" : row.status === "in_arrears" ? "warning" : "default"}
                    variant={row.status === "active" ? "filled" : "outlined"}
                />
            )
        },
        {
            key: "principal",
            header: "Outstanding",
            render: (row) => formatCurrency(row.outstanding_principal)
        },
        {
            key: "interest",
            header: "Accrued Interest",
            render: (row) => formatCurrency(row.accrued_interest)
        },
        {
            key: "frequency",
            header: "Frequency",
            render: (row) => row.repayment_frequency
        },
        {
            key: "nextDue",
            header: "Next Due",
            render: (row) => formatDate(nextDueByLoan.get(row.id) || null)
        }
    ];

    const transactionColumns: Column<LoanTransaction>[] = [
        { key: "created", header: "Date", render: (row) => formatDate(row.created_at) },
        {
            key: "loan",
            header: "Loan",
            render: (row) => loans.find((loan) => loan.id === row.loan_id)?.loan_number || row.loan_id
        },
        {
            key: "type",
            header: "Type",
            render: (row) => row.transaction_type === "loan_repayment" ? "Repayment" : row.transaction_type === "loan_disbursement" ? "Disbursement" : "Interest Accrual"
        },
        { key: "amount", header: "Amount", render: (row) => formatCurrency(row.amount) },
        { key: "principal", header: "Principal", render: (row) => formatCurrency(row.principal_component) },
        { key: "interest", header: "Interest", render: (row) => formatCurrency(row.interest_component) },
        { key: "reference", header: "Reference", render: (row) => row.reference || "N/A" }
    ];

    const totalPages = Math.max(1, Math.ceil(loans.length / pageSize));
    const paginatedLoans = useMemo(
        () => loans.slice((page - 1) * pageSize, page * pageSize),
        [loans, page]
    );

    useEffect(() => {
        setPage(1);
    }, [loans.length]);

    const pendingMember =
        pendingAction?.type === "disburse"
            ? members.find((member) => member.id === pendingAction.values.member_id)
            : null;
    const pendingLoan =
        pendingAction?.type === "repay"
            ? loans.find((loan) => loan.id === pendingAction.values.loan_id)
            : null;

    return (
        <Stack spacing={3}>
            <Card
                variant="outlined"
                sx={{
                    background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.08)}, ${alpha(theme.palette.background.paper, 0.92)})`
                }}
            >
                <CardContent>
                    <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={2}>
                        <Box>
                            <Typography variant="h5">Loan Operations</Typography>
                            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75, maxWidth: 760 }}>
                                Control disbursement and repayment workflows with clear portfolio visibility, arrears signals, and review checkpoints before posting.
                            </Typography>
                        </Box>
                        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                            <Button
                                variant="contained"
                                startIcon={<CreditScoreRoundedIcon />}
                                onClick={() => setShowDisburseModal(true)}
                                disabled={subscriptionInactive}
                            >
                                Loan Disbursement
                            </Button>
                            <Button
                                variant="outlined"
                                color="inherit"
                                startIcon={<PaymentsRoundedIcon />}
                                onClick={() => setShowRepayModal(true)}
                                disabled={subscriptionInactive}
                            >
                                Loan Repayment
                            </Button>
                            <Chip label={selectedTenantName || "Tenant workspace"} variant="outlined" />
                            <Chip
                                label={subscriptionInactive ? "Subscription blocked" : "Transactional window open"}
                                color={subscriptionInactive ? "warning" : "success"}
                                variant="outlined"
                            />
                        </Stack>
                    </Stack>
                </CardContent>
            </Card>

            {subscriptionInactive ? (
                <Alert severity="warning" variant="outlined">
                    Loan disbursement and repayment are blocked while the tenant subscription is inactive.
                </Alert>
            ) : null}

            <Grid container spacing={2}>
                <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
                    <MetricCard
                        title="Loan Accounts"
                        value={String(metrics.totalLoans)}
                        helper="Visible loans in this tenant."
                        icon={<CreditScoreRoundedIcon fontSize="small" />}
                    />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
                    <MetricCard
                        title="Outstanding Principal"
                        value={formatCurrency(metrics.outstandingPrincipal)}
                        helper="Current principal still on book."
                        icon={<AccountBalanceRoundedIcon fontSize="small" />}
                    />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
                    <MetricCard
                        title="Accrued Interest"
                        value={formatCurrency(metrics.accruedInterest)}
                        helper="Recognized but not yet collected."
                        icon={<PriceCheckRoundedIcon fontSize="small" />}
                    />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
                    <MetricCard
                        title="Arrears Signals"
                        value={String(metrics.arrearsLoans)}
                        helper={`${metrics.nextDueCount} schedule items currently overdue.`}
                        icon={<WarningAmberRoundedIcon fontSize="small" />}
                    />
                </Grid>
            </Grid>

            <Card variant="outlined">
                <CardContent>
                    <Grid container spacing={2}>
                        <Grid size={{ xs: 12, md: 6 }}>
                            <Box
                                sx={{
                                    p: 2,
                                    border: `1px solid ${theme.palette.divider}`,
                                    borderRadius: 2,
                                    height: "100%"
                                }}
                            >
                                <Typography variant="subtitle1">Disbursement Workflow</Typography>
                                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                                    Launch a guided disbursement flow with borrower, pricing, and tenure controls.
                                </Typography>
                            </Box>
                        </Grid>
                        <Grid size={{ xs: 12, md: 6 }}>
                            <Box
                                sx={{
                                    p: 2,
                                    border: `1px solid ${theme.palette.divider}`,
                                    borderRadius: 2,
                                    height: "100%"
                                }}
                            >
                                <Typography variant="subtitle1">Repayment Workflow</Typography>
                                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                                    Launch repayment posting with loan search, amount confirmation, and reference capture.
                                </Typography>
                            </Box>
                        </Grid>
                    </Grid>
                </CardContent>
            </Card>

            <Card variant="outlined">
                <CardContent>
                    <Stack
                        direction={{ xs: "column", md: "row" }}
                        justifyContent="space-between"
                        alignItems={{ xs: "flex-start", md: "center" }}
                        spacing={1.5}
                        sx={{ mb: 2 }}
                    >
                        <Box>
                            <Typography variant="h6">Loan Activity</Typography>
                            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                                Disbursements, repayments, and accruals posted against visible loans.
                            </Typography>
                        </Box>
                        <Chip label={`${transactions.length} tracked entries`} variant="outlined" />
                    </Stack>

                    {loading ? (
                        <Box className="empty-state">Loading loan activity...</Box>
                    ) : (
                        <DataTable rows={transactions.slice(0, 12)} columns={transactionColumns} emptyMessage="No loan activity recorded yet." />
                    )}
                </CardContent>
            </Card>

            <Card variant="outlined">
                <CardContent>
                    <Stack
                        direction={{ xs: "column", md: "row" }}
                        justifyContent="space-between"
                        alignItems={{ xs: "flex-start", md: "center" }}
                        spacing={1.5}
                        sx={{ mb: 2 }}
                    >
                        <Box>
                            <Typography variant="h6">Loan Portfolio</Typography>
                            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                                Review loan status, exposure, interest, and the next visible due date across the current tenant.
                            </Typography>
                        </Box>
                        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                            <Chip icon={<PaymentsRoundedIcon />} label={`${metrics.activeLoans} active`} variant="outlined" />
                            <Chip
                                icon={<CalendarMonthRoundedIcon />}
                                label={`${metrics.nextDueCount} overdue schedules`}
                                color={metrics.nextDueCount ? "warning" : "default"}
                                variant="outlined"
                            />
                        </Stack>
                    </Stack>

                    {loading ? (
                        <Box className="empty-state">Loading loan portfolio...</Box>
                    ) : (
                        <Stack spacing={2}>
                            <DataTable rows={paginatedLoans} columns={loanColumns} emptyMessage="No loans disbursed yet." />
                            {totalPages > 1 ? (
                                <Stack direction="row" justifyContent="flex-end">
                                    <Pagination
                                        color="primary"
                                        count={totalPages}
                                        page={page}
                                        onChange={(_, value) => setPage(value)}
                                    />
                                </Stack>
                            ) : null}
                        </Stack>
                    )}
                </CardContent>
            </Card>

            <ConfirmModal
                open={Boolean(pendingAction)}
                title={pendingAction?.type === "disburse" ? "Confirm Loan Disbursement" : "Confirm Loan Repayment"}
                summary={
                    <Stack spacing={1.5}>
                        {pendingAction?.type === "disburse" ? (
                            <>
                                <Stack direction="row" justifyContent="space-between" spacing={2}>
                                    <Typography variant="body2" color="text.secondary">Member</Typography>
                                    <Typography variant="body2">{pendingMember?.full_name || "Unknown"}</Typography>
                                </Stack>
                                <Stack direction="row" justifyContent="space-between" spacing={2}>
                                    <Typography variant="body2" color="text.secondary">Principal</Typography>
                                    <Typography variant="body2">{formatCurrency(pendingAction.values.principal_amount)}</Typography>
                                </Stack>
                                <Stack direction="row" justifyContent="space-between" spacing={2}>
                                    <Typography variant="body2" color="text.secondary">Interest / Term</Typography>
                                    <Typography variant="body2">
                                        {pendingAction.values.annual_interest_rate}% / {pendingAction.values.term_count} periods
                                    </Typography>
                                </Stack>
                            </>
                        ) : (
                            <>
                                <Stack direction="row" justifyContent="space-between" spacing={2}>
                                    <Typography variant="body2" color="text.secondary">Loan</Typography>
                                    <Typography variant="body2">{pendingLoan?.loan_number || "Unknown"}</Typography>
                                </Stack>
                                <Stack direction="row" justifyContent="space-between" spacing={2}>
                                    <Typography variant="body2" color="text.secondary">Repayment Amount</Typography>
                                    <Typography variant="body2">{formatCurrency(pendingAction?.values.amount)}</Typography>
                                </Stack>
                                <Stack direction="row" justifyContent="space-between" spacing={2}>
                                    <Typography variant="body2" color="text.secondary">Reference</Typography>
                                    <Typography variant="body2">{pendingAction?.values.reference || "N/A"}</Typography>
                                </Stack>
                            </>
                        )}
                    </Stack>
                }
                loading={processing}
                confirmLabel={pendingAction?.type === "disburse" ? "Disburse Loan" : "Post Repayment"}
                onCancel={() => setPendingAction(null)}
                onConfirm={() => void confirmAction()}
            />

            <Dialog
                open={showDisburseModal}
                onClose={processing ? undefined : () => setShowDisburseModal(false)}
                maxWidth="md"
                fullWidth
            >
                <DialogTitle>Loan Disbursement</DialogTitle>
                <DialogContent dividers>
                    <Stack spacing={3} sx={{ pt: 0.5 }}>
                        <Typography variant="body2" color="text.secondary">
                            Use this flow only after underwriting is complete and the member, branch, and reference have been verified.
                        </Typography>

                        <Alert severity="info" variant="outlined">
                            The backend will generate the amortization schedule and balanced journal automatically.
                        </Alert>

                        <Box component="form" id="loan-disburse-form" onSubmit={handleDisburse} sx={{ display: "grid", gap: 2 }}>
                            <Box>
                                <Typography variant="body2" fontWeight={600} sx={{ mb: 0.75 }}>
                                    Member
                                </Typography>
                                <SearchableSelect
                                    value={disburseForm.watch("member_id")}
                                    options={memberOptions}
                                    onChange={(value) => disburseForm.setValue("member_id", value, { shouldValidate: true })}
                                    placeholder="Search member to disburse to..."
                                />
                                {disburseForm.formState.errors.member_id ? (
                                    <Typography variant="caption" color="error.main">
                                        {disburseForm.formState.errors.member_id.message}
                                    </Typography>
                                ) : null}
                            </Box>

                            <Grid container spacing={2}>
                                <Grid size={{ xs: 12, md: 4 }}>
                                    <TextField
                                        label="Principal"
                                        type="number"
                                        fullWidth
                                        {...disburseForm.register("principal_amount")}
                                        error={Boolean(disburseForm.formState.errors.principal_amount)}
                                        helperText={disburseForm.formState.errors.principal_amount?.message}
                                    />
                                </Grid>
                                <Grid size={{ xs: 12, md: 4 }}>
                                    <TextField
                                        label="Interest Rate %"
                                        type="number"
                                        fullWidth
                                        {...disburseForm.register("annual_interest_rate")}
                                        error={Boolean(disburseForm.formState.errors.annual_interest_rate)}
                                        helperText={disburseForm.formState.errors.annual_interest_rate?.message}
                                    />
                                </Grid>
                                <Grid size={{ xs: 12, md: 4 }}>
                                    <TextField
                                        label="Term"
                                        type="number"
                                        fullWidth
                                        {...disburseForm.register("term_count")}
                                        error={Boolean(disburseForm.formState.errors.term_count)}
                                        helperText={disburseForm.formState.errors.term_count?.message}
                                    />
                                </Grid>
                                <Grid size={{ xs: 12, md: 4 }}>
                                    <TextField
                                        select
                                        label="Frequency"
                                        fullWidth
                                        value={disburseForm.watch("repayment_frequency")}
                                        onChange={(event) =>
                                            disburseForm.setValue("repayment_frequency", event.target.value as DisburseValues["repayment_frequency"], { shouldValidate: true })
                                        }
                                        error={Boolean(disburseForm.formState.errors.repayment_frequency)}
                                        helperText={disburseForm.formState.errors.repayment_frequency?.message}
                                    >
                                        <MenuItem value="monthly">Monthly</MenuItem>
                                        <MenuItem value="weekly">Weekly</MenuItem>
                                        <MenuItem value="daily">Daily</MenuItem>
                                    </TextField>
                                </Grid>
                                <Grid size={{ xs: 12, md: 4 }}>
                                    <TextField
                                        label="Disbursement Date"
                                        type="date"
                                        fullWidth
                                        InputLabelProps={{ shrink: true }}
                                        {...disburseForm.register("disbursement_date")}
                                        error={Boolean(disburseForm.formState.errors.disbursement_date)}
                                        helperText={disburseForm.formState.errors.disbursement_date?.message}
                                    />
                                </Grid>
                                <Grid size={{ xs: 12, md: 4 }}>
                                    <TextField
                                        label="Reference"
                                        fullWidth
                                        {...disburseForm.register("reference")}
                                        error={Boolean(disburseForm.formState.errors.reference)}
                                        helperText={disburseForm.formState.errors.reference?.message || "Optional but recommended."}
                                    />
                                </Grid>
                            </Grid>

                            <TextField
                                label="Notes"
                                multiline
                                minRows={3}
                                fullWidth
                                {...disburseForm.register("description")}
                                error={Boolean(disburseForm.formState.errors.description)}
                                helperText={disburseForm.formState.errors.description?.message || "Visible in journal context and review notes."}
                            />
                        </Box>
                    </Stack>
                </DialogContent>
                <DialogActions sx={{ px: 3, py: 2 }}>
                    <Button onClick={() => setShowDisburseModal(false)} disabled={processing} color="inherit">
                        Cancel
                    </Button>
                    <Button form="loan-disburse-form" type="submit" variant="contained" disabled={subscriptionInactive || processing}>
                        Review Disbursement
                    </Button>
                </DialogActions>
            </Dialog>

            <Dialog
                open={showRepayModal}
                onClose={processing ? undefined : () => setShowRepayModal(false)}
                maxWidth="md"
                fullWidth
            >
                <DialogTitle>Loan Repayment</DialogTitle>
                <DialogContent dividers>
                    <Stack spacing={3} sx={{ pt: 0.5 }}>
                        <Typography variant="body2" color="text.secondary">
                            Post repayments against an existing loan. The backend allocates between interest and principal in order.
                        </Typography>

                        <Alert severity="info" variant="outlined">
                            Use the exact loan reference when collecting repayment from the member counter or mobile channel.
                        </Alert>

                        <Box component="form" id="loan-repay-form" onSubmit={handleRepay} sx={{ display: "grid", gap: 2 }}>
                            <Box>
                                <Typography variant="body2" fontWeight={600} sx={{ mb: 0.75 }}>
                                    Loan
                                </Typography>
                                <SearchableSelect
                                    value={repayForm.watch("loan_id")}
                                    options={loanOptions}
                                    onChange={(value) => repayForm.setValue("loan_id", value, { shouldValidate: true })}
                                    placeholder="Search loan by number or member..."
                                />
                                {repayForm.formState.errors.loan_id ? (
                                    <Typography variant="caption" color="error.main">
                                        {repayForm.formState.errors.loan_id.message}
                                    </Typography>
                                ) : null}
                            </Box>

                            <Grid container spacing={2}>
                                <Grid size={{ xs: 12, md: 4 }}>
                                    <TextField
                                        label="Amount"
                                        type="number"
                                        fullWidth
                                        {...repayForm.register("amount")}
                                        error={Boolean(repayForm.formState.errors.amount)}
                                        helperText={repayForm.formState.errors.amount?.message}
                                    />
                                </Grid>
                                <Grid size={{ xs: 12, md: 4 }}>
                                    <TextField
                                        label="Payment Date"
                                        type="date"
                                        fullWidth
                                        InputLabelProps={{ shrink: true }}
                                        {...repayForm.register("payment_date")}
                                        error={Boolean(repayForm.formState.errors.payment_date)}
                                        helperText={repayForm.formState.errors.payment_date?.message}
                                    />
                                </Grid>
                                <Grid size={{ xs: 12, md: 4 }}>
                                    <TextField
                                        label="Reference"
                                        fullWidth
                                        {...repayForm.register("reference")}
                                        error={Boolean(repayForm.formState.errors.reference)}
                                        helperText={repayForm.formState.errors.reference?.message || "Receipt or transfer reference."}
                                    />
                                </Grid>
                            </Grid>

                            <TextField
                                label="Notes"
                                multiline
                                minRows={3}
                                fullWidth
                                {...repayForm.register("description")}
                                error={Boolean(repayForm.formState.errors.description)}
                                helperText={repayForm.formState.errors.description?.message || "Optional collection context."}
                            />
                        </Box>
                    </Stack>
                </DialogContent>
                <DialogActions sx={{ px: 3, py: 2 }}>
                    <Button onClick={() => setShowRepayModal(false)} disabled={processing} color="inherit">
                        Cancel
                    </Button>
                    <Button form="loan-repay-form" type="submit" variant="contained" color="inherit" disabled={subscriptionInactive || processing}>
                        Review Repayment
                    </Button>
                </DialogActions>
            </Dialog>
        </Stack>
    );
}
