import { Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { brandColors } from "../theme/colors";

export interface Column<T> {
    key: string;
    header: string;
    render: (row: T) => ReactNode;
}

interface DataTableProps<T> {
    rows: T[];
    columns: Column<T>[];
    emptyMessage?: string;
}

export function DataTable<T>({ rows, columns, emptyMessage = "No records available." }: DataTableProps<T>) {
    if (!rows.length) {
        return (
            <Paper variant="outlined" sx={{ p: 4, textAlign: "center", borderStyle: "dashed" }}>
                <Typography variant="body2" color="text.secondary">
                    {emptyMessage}
                </Typography>
            </Paper>
        );
    }

    return (
        <TableContainer component={Paper} variant="outlined">
            <Table size="small">
                <TableHead>
                    <TableRow>
                        {columns.map((column) => (
                            <TableCell
                                key={column.key}
                                sx={{
                                    textTransform: "uppercase",
                                    letterSpacing: "0.08em",
                                    fontSize: 11,
                                    color: "primary.main",
                                    bgcolor: brandColors.primary[100],
                                    borderBottomColor: "divider"
                                }}
                            >
                                {column.header}
                            </TableCell>
                        ))}
                    </TableRow>
                </TableHead>
                <TableBody>
                    {rows.map((row, index) => (
                        <TableRow
                            key={index}
                            hover
                            sx={{
                                "&:hover td": {
                                    bgcolor: "rgba(31, 168, 230, 0.04)"
                                }
                            }}
                        >
                            {columns.map((column) => (
                                <TableCell key={column.key}>{column.render(row)}</TableCell>
                            ))}
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </TableContainer>
    );
}
