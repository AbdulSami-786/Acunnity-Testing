/**
 * dashboard.jsx
 * Dukandar ERP — Frontend  v9.0
 * + Payment Method Integration (unified across all modules)
 * + Payment Method Ledger System (auto-updates per payment method)
 * + Data Consistency (auto-sync, no duplicates, proper reversals)
 * + Per-item salesman commission (amount/percent)
 * + Full Order Edit (updateOrderFull)
 * + Stitcher Pay auto-credited on order creation
 * + Zero-item orders allowed (stitching-only bills)
 * + Complete Payroll Module with Dashboard & History
 * + Enhanced Offline Support (IndexedDB with auto-sync)
 * + SALARY SHEET FOR SALESMEN (category structure, manual entry)
 */

import { useState, useEffect, useContext, createContext, useRef, useCallback, useMemo } from "react";
import {
    login as apiLogin,
    getProducts, addProduct, updateProduct, deleteProduct,
    getOrders, createOrder, updateOrder,
    updateOrderFull,
    updateOrderStitchStatus,
    getCustomers, addCustomer, updateCustomer, deleteCustomer,
    getSuppliers, addSupplier, updateSupplier, deleteSupplier,
    addSupplierPayment, getSupplierLedger, createSupplierReturn,
    getInventory, addInventory, updateInventory, deleteInventory,
    getExpenses, addExpense, updateExpense, deleteExpense,
    getSalesmen, addSalesman, updateSalesman, deleteSalesman, addSalesmanPayment,
    getAssets, addAsset, updateAsset, deleteAsset, addAssetMaintenance,
    getStitchers, addStitcher, updateStitcher, deleteStitcher,
    addStitcherPayment, getStitcherLedger,
    getOrderStitching, getStitcherDashboard,
    getLedger,
    initOfflineSync, syncPendingData, getPendingCount,
    // Salary sheet / payroll functions
    getSalarySheet, saveSalarySheetEntry, deleteSalarySheetEntry,
    paySalarySheetEntry, reopenSalarySheetEntry,
} from "./Googlesheet";

const AppContext = createContext(null);
function useApp() { return useContext(AppContext); }

// ─────────────────────────────────────────────
// RESPONSIVE BREAKPOINT
// Below 768px the shell switches from a fixed sidebar to a slide-out drawer + bottom tab
// bar, and pages switch multi-column grids to a single stacked column. Kept as one hook so
// every component branches on the same threshold as the CSS media queries below.
// ─────────────────────────────────────────────
const MOBILE_BREAKPOINT = 768;
function useIsMobile() {
    const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < MOBILE_BREAKPOINT);
    useEffect(() => {
        const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
        const onChange = () => setIsMobile(mq.matches);
        onChange();
        mq.addEventListener("change", onChange);
        return () => mq.removeEventListener("change", onChange);
    }, []);
    return isMobile;
}

// ─────────────────────────────────────────────
// TOAST NOTIFICATIONS
// Module-level pub/sub so any component can call toast(...) directly,
// the same way it would call the browser's alert(...), without prop drilling or context.
// ─────────────────────────────────────────────
let toastListeners = [];
let toastIdSeq = 0;
function toast(message, type = "error") {
    const id = ++toastIdSeq;
    toastListeners.forEach(fn => fn({ id, message, type }));
    return id;
}
function ToastHost() {
    const [toasts, setToasts] = useState([]);
    useEffect(() => {
        const onToast = (t) => {
            setToasts(prev => [...prev, t]);
            setTimeout(() => setToasts(prev => prev.filter(x => x.id !== t.id)), 5000);
        };
        toastListeners.push(onToast);
        return () => { toastListeners = toastListeners.filter(fn => fn !== onToast); };
    }, []);
    if (!toasts.length) return null;
    const colors = {
        error:   { bg: "#450a0a", border: "#ef4444", fg: "#fca5a5" },
        success: { bg: "#052e16", border: "#16a34a", fg: "#86efac" },
        info:    { bg: "#1e293b", border: "#334155", fg: "#cbd5e1" },
    };
    return (
        <div style={{ position: "fixed", top: 16, right: 16, zIndex: 99999, display: "flex", flexDirection: "column", gap: 8, maxWidth: 380 }}>
            {toasts.map(t => {
                const c = colors[t.type] || colors.error;
                return (
                    <div key={t.id} style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 10, padding: "12px 14px", color: c.fg, fontSize: 13, boxShadow: "0 8px 24px #00000055", display: "flex", alignItems: "flex-start", gap: 10 }}>
                        <span style={{ flex: 1, wordBreak: "break-word" }}>{t.message}</span>
                        <button onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}
                            style={{ background: "none", border: "none", color: c.fg, cursor: "pointer", opacity: 0.7, fontSize: 15, lineHeight: 1, padding: 0 }}>×</button>
                    </div>
                );
            })}
        </div>
    );
}

// ─────────────────────────────────────────────
// ICONS
// ─────────────────────────────────────────────
const Icon = ({ name, size = 18, className = "" }) => {
    const icons = {
        dashboard: <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
        orders: <><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></>,
        products: <><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></>,
        customers: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
        suppliers: <><rect x="1" y="3" width="15" height="13" /><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></>,
        inventory: <><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></>,
        reports: <><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></>,
        accounts: <><rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" /></>,
        expenses: <><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></>,
        payroll: <><path d="M20 7H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="2" /></>,
        settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>,
        plus: <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>,
        search: <><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></>,
        bell: <><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></>,
        user: <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>,
        edit: <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></>,
        trash: <><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></>,
        x: <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>,
        check: <polyline points="20 6 9 17 4 12" />,
        menu: <><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="18" x2="21" y2="18" /></>,
        print: <><polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></>,
        download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></>,
        wifi: <><path d="M5 12.55a11 11 0 0 1 14.08 0" /><path d="M1.42 9a16 16 0 0 1 21.16 0" /><path d="M8.53 16.11a6 6 0 0 1 6.95 0" /><line x1="12" y1="20" x2="12.01" y2="20" /></>,
        wifiOff: <><line x1="1" y1="1" x2="23" y2="23" /><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" /><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" /><path d="M10.71 5.05A16 16 0 0 1 22.56 9" /><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" /><path d="M8.53 16.11a6 6 0 0 1 6.95 0" /><line x1="12" y1="20" x2="12.01" y2="20" /></>,
        eye: <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></>,
        logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></>,
        trending: <><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></>,
        package: <><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></>,
        alert: <><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></>,
        refresh: <><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></>,
        money: <><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2" /><path d="M6 12h.01M18 12h.01" /></>,
        star: <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />,
        arrowLeft: <><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></>,
        receipt: <><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1z" /><line x1="8" y1="9" x2="16" y2="9" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="12" y2="17" /></>,
        userPlus: <><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><line x1="20" y1="8" x2="20" y2="14" /><line x1="23" y1="11" x2="17" y2="11" /></>,
        creditCard: <><rect x="1" y="4" width="22" height="16" rx="2" ry="2" /><line x1="1" y1="10" x2="23" y2="10" /></>,
        award: <><circle cx="12" cy="8" r="6" /><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11" /></>,
        briefcase: <><rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></>,
        tool: <><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" /></>,
        building: <><rect x="1" y="3" width="15" height="18" /><path d="M16 8h4l3 3v10H16V8z" /><line x1="5" y1="3" x2="5" y2="21" /><line x1="9" y1="3" x2="9" y2="21" /><line x1="13" y1="3" x2="13" y2="21" /><line x1="5" y1="12" x2="13" y2="12" /></>,
        percent: <><line x1="19" y1="5" x2="5" y2="19" /><circle cx="6.5" cy="6.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" /></>,
        shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></>,
        lock: <><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>,
        qrcode: <><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="5" y="5" width="3" height="3" fill="currentColor" /><rect x="16" y="5" width="3" height="3" fill="currentColor" /><rect x="5" y="16" width="3" height="3" fill="currentColor" /><path d="M14 14h3v3h-3zM17 17h3v3h-3zM14 20h3" /></>,
        camera: <><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 0 1-1.73l7-4a2 2 0 0 0 2 0l7 4A2 2 0 0 0 21 8v11z" /><circle cx="12" cy="13" r="4" /></>,
        calendar: <><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></>,
        wallet: <><path d="M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z" /><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" /><circle cx="16" cy="13" r="1" fill="currentColor" /></>,
        coins: <><circle cx="8" cy="8" r="6" /><path d="M18.09 10.37A6 6 0 1 1 10.34 18" /><path d="M7 6h1v4" /><path d="m16.71 13.88.7.71-2.82 2.82" /></>,
        arrowRight: <><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></>,
        filter: <><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></>,
        globe: <><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></>,
        send: <><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></>,
        scissors: <><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><line x1="20" y1="4" x2="8.12" y2="15.88" /><line x1="14.47" y1="14.48" x2="20" y2="20" /><line x1="8.12" y1="8.12" x2="12" y2="12" /></>,
        needle: <><path d="M4 22 L20 6" /><path d="M20 6 L16 2" /><path d="M20 6 L22 10" /><circle cx="6" cy="20" r="1.5" /></>,
        layers: <><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></>,
        userCheck: <><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><polyline points="17 11 19 13 23 9" /></>,
        sync: <><path d="M1 4v6h6M23 20v-6h-6" /><path d="M20.49 9A9 9 0 0 0 5.64 5.64M3.51 15A9 9 0 0 0 18.36 18.36" /></>,
    };
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
            {icons[name] || null}
        </svg>
    );
};

// ─────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────
const safeNum = (n) => { const v = Number(n); return Number.isFinite(v) ? v : 0; };
const fmt = (n) => "Rs " + safeNum(n).toLocaleString("en-PK");
const fmtNum = (n) => safeNum(n).toLocaleString("en-PK");
// Use local (device) date/time, not UTC — the backend records dates in Asia/Karachi
// time, and toISOString() would show "yesterday" for hours 00:00-04:59 Karachi time.
const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const thisMonth = () => today().slice(0, 7);

// ─────────────────────────────────────────────
// PAYMENT METHODS CONFIGURATION
// ─────────────────────────────────────────────
function getPaymentMethodsConfig() {
    try {
        const d = localStorage.getItem("dukandar_payment_methods");
        if (d) return JSON.parse(d);
    } catch { /* ignore malformed localStorage data, fall back to defaults */ }
    return [
        { id: "pm_cash", name: "Cash", type: "Cash", accountNo: "", bank: "", balance: 0, color: "green" },
        { id: "pm_bank", name: "Bank Account", type: "Bank", accountNo: "", bank: "HBL", balance: 0, color: "blue" },
        { id: "pm_easypaisa", name: "EasyPaisa", type: "EasyPaisa", accountNo: "", bank: "", balance: 0, color: "purple" },
        { id: "pm_jazzcash", name: "JazzCash", type: "JazzCash", accountNo: "", bank: "", balance: 0, color: "orange" },
    ];
}

function savePaymentMethodsConfig(list) {
    localStorage.setItem("dukandar_payment_methods", JSON.stringify(list));
    window.dispatchEvent(new Event("dukandar_payment_methods_changed"));
}

// Single source of truth for payment method names, used by every screen that
// takes or displays a payment (Bill Receipt, Order Detail, Orders/POS, Expenses,
// Accounts) so editing Settings → Payment Methods propagates everywhere at once.
function getPaymentMethodNames() {
    return getPaymentMethodsConfig().map(m => m.name);
}

// Re-reads the payment method list whenever it changes (including in another tab),
// so open screens stay in sync with Settings → Payment Methods.
function usePaymentMethodNames() {
    const [names, setNames] = useState(getPaymentMethodNames());
    useEffect(() => {
        const refresh = () => setNames(getPaymentMethodNames());
        window.addEventListener("dukandar_payment_methods_changed", refresh);
        window.addEventListener("storage", refresh);
        return () => {
            window.removeEventListener("dukandar_payment_methods_changed", refresh);
            window.removeEventListener("storage", refresh);
        };
    }, []);
    return names;
}

function Spinner() {
    return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 48, gap: 10, color: "#475569", fontSize: 13 }}>
            <Icon name="refresh" size={16} className="spin" />
            Loading…
            <style>{`@keyframes spin { to { transform: rotate(360deg); } } .spin { animation: spin 0.8s linear infinite; }`}</style>
        </div>
    );
}

// ─────────────────────────────────────────────
// DATE RANGE FILTER COMPONENT
// ─────────────────────────────────────────────
function DateRangeFilter({ startDate, endDate, onStartChange, onEndChange, onClear, style = {} }) {
    const presets = [
        { label: "Today", start: today(), end: today() },
        { label: "This Week", start: (() => { const d = new Date(); d.setDate(d.getDate() - d.getDay()); return d.toISOString().split("T")[0]; })(), end: today() },
        { label: "This Month", start: thisMonth() + "-01", end: today() },
        { label: "Last Month", start: (() => { const d = new Date(); d.setMonth(d.getMonth() - 1, 1); return d.toISOString().split("T")[0]; })(), end: (() => { const d = new Date(); d.setDate(0); return d.toISOString().split("T")[0]; })() },
        { label: "Last 30 Days", start: (() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().split("T")[0]; })(), end: today() },
        { label: "This Year", start: new Date().getFullYear() + "-01-01", end: today() },
    ];
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", ...style }}>
            <Icon name="calendar" size={15} style={{ color: "#64748b" }} />
            <input type="date" value={startDate} onChange={e => onStartChange(e.target.value)}
                style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 7, padding: "7px 10px", color: "#f1f5f9", fontSize: 12, outline: "none" }} />
            <span style={{ color: "#475569", fontSize: 12 }}>to</span>
            <input type="date" value={endDate} onChange={e => onEndChange(e.target.value)}
                style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 7, padding: "7px 10px", color: "#f1f5f9", fontSize: 12, outline: "none" }} />
            <div style={{ display: "flex", gap: 4 }}>
                {presets.map(p => (
                    <button key={p.label} onClick={() => { onStartChange(p.start); onEndChange(p.end); }}
                        style={{ padding: "4px 8px", borderRadius: 6, background: startDate === p.start && endDate === p.end ? "#1e40af" : "#1e293b", border: "1px solid #334155", color: startDate === p.start && endDate === p.end ? "#60a5fa" : "#64748b", fontSize: 11, cursor: "pointer", fontWeight: 500 }}>
                        {p.label}
                    </button>
                ))}
            </div>
            {(startDate || endDate) && (
                <button onClick={onClear} style={{ padding: "4px 8px", borderRadius: 6, background: "transparent", border: "1px solid #334155", color: "#f87171", fontSize: 11, cursor: "pointer" }}>
                    Clear
                </button>
            )}
        </div>
    );
}

// ─────────────────────────────────────────────
// GLOBAL SEARCH COMPONENT
// ─────────────────────────────────────────────
function GlobalSearchBar({ onNavigate, mobileFullScreen, onCloseMobile }) {
    const [query, setQuery] = useState("");
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(false);
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
        const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, []);

    const searchAll = useCallback(async (q) => {
        if (!q || q.length < 2) { setResults([]); return; }
        setLoading(true);
        try {
            const [pRes, cRes, oRes] = await Promise.all([getProducts(), getCustomers(), getOrders()]);
            const results = [];
            const ql = q.toLowerCase();
            (pRes.products || []).filter(p => p.name?.toLowerCase().includes(ql) || p.barcode?.includes(q) || p.category?.toLowerCase().includes(ql))
                .slice(0, 4).forEach(p => results.push({ type: "product", icon: "products", label: p.name, sub: `${p.category} — ${fmt(p.sellingPrice)}`, page: "products", data: p }));
            (cRes.customers || []).filter(c => c.name?.toLowerCase().includes(ql) || c.phone?.includes(q))
                .slice(0, 4).forEach(c => results.push({ type: "customer", icon: "customers", label: c.name, sub: `${c.phone} — Balance: ${fmt(c.balance)}`, page: "customers", data: c }));
            (oRes.orders || []).filter(o => o.id?.toLowerCase().includes(ql) || o.customer?.toLowerCase().includes(ql))
                .slice(0, 4).forEach(o => results.push({ type: "order", icon: "orders", label: `Order ${o.id}`, sub: `${o.customer} — ${fmt(o.total)} — ${o.status}`, page: "orders", data: o }));
            setResults(results);
        } catch { setResults([]); }
        setLoading(false);
    }, []);

    useEffect(() => {
        const timer = setTimeout(() => searchAll(query), 300);
        return () => clearTimeout(timer);
    }, [query, searchAll]);

    const resultsList = (
        <>
            {results.length > 0 && (
                <div style={mobileFullScreen ? { marginTop: 12 } : { position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4, background: "#1e293b", border: "1px solid #334155", borderRadius: 10, zIndex: 9999, overflow: "hidden", boxShadow: "0 8px 32px #00000066" }}>
                    {results.map((r, i) => (
                        <div key={i} onClick={() => { onNavigate(r.page); setQuery(""); setOpen(false); onCloseMobile?.(); }}
                            style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", cursor: "pointer", borderBottom: "1px solid #0f172a", borderRadius: mobileFullScreen ? 10 : 0, background: mobileFullScreen ? "#1e293b" : "transparent", marginBottom: mobileFullScreen ? 6 : 0 }}
                            onMouseEnter={e => e.currentTarget.style.background = "#334155"}
                            onMouseLeave={e => e.currentTarget.style.background = mobileFullScreen ? "#1e293b" : "transparent"}>
                            <div style={{ width: 30, height: 30, borderRadius: 7, background: "#0f172a", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                <Icon name={r.icon} size={14} style={{ color: "#64748b" }} />
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ color: "#f1f5f9", fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</div>
                                <div style={{ color: "#64748b", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.sub}</div>
                            </div>
                            <Badge label={r.type} color={r.type === "product" ? "blue" : r.type === "customer" ? "purple" : "green"} />
                        </div>
                    ))}
                </div>
            )}
            {query.length >= 2 && results.length === 0 && !loading && (
                <div style={mobileFullScreen ? { marginTop: 12, textAlign: "center", color: "#64748b", fontSize: 13 } : { position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4, background: "#1e293b", border: "1px solid #334155", borderRadius: 10, zIndex: 9999, padding: "16px", textAlign: "center", color: "#64748b", fontSize: 13 }}>
                    No results for "{query}"
                </div>
            )}
        </>
    );

    if (mobileFullScreen) {
        return (
            <div style={{ position: "fixed", inset: 0, background: "#0f172a", zIndex: 60, display: "flex", flexDirection: "column", paddingTop: "env(safe-area-inset-top)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 12, borderBottom: "1px solid #1e293b" }}>
                    <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, background: "#1e293b", border: "1px solid #334155", borderRadius: 9, padding: "10px 12px" }}>
                        <Icon name="search" size={14} style={{ color: "#64748b", flexShrink: 0 }} />
                        <input autoFocus value={query} onChange={e => setQuery(e.target.value)}
                            placeholder="Search products, customers, orders…"
                            style={{ background: "none", border: "none", outline: "none", color: "#f1f5f9", fontSize: 15, width: "100%", fontFamily: "'DM Sans',sans-serif" }} />
                        {loading && <Icon name="refresh" size={13} className="spin" style={{ color: "#64748b" }} />}
                    </div>
                    <button onClick={onCloseMobile} style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", padding: 6, flexShrink: 0 }}>
                        <Icon name="x" size={20} />
                    </button>
                </div>
                <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>{resultsList}</div>
            </div>
        );
    }

    return (
        <div ref={ref} style={{ position: "relative", flex: 1, maxWidth: 400 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#1e293b", border: "1px solid #334155", borderRadius: 9, padding: "7px 12px" }}>
                <Icon name="search" size={14} style={{ color: "#64748b", flexShrink: 0 }} />
                <input value={query} onChange={e => { setQuery(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
                    placeholder="Search products, customers, orders…"
                    style={{ background: "none", border: "none", outline: "none", color: "#f1f5f9", fontSize: 13, width: "100%", fontFamily: "'DM Sans',sans-serif" }} />
                {loading && <Icon name="refresh" size={13} className="spin" style={{ color: "#64748b" }} />}
            </div>
            {open && resultsList}
        </div>
    );
}

// ─────────────────────────────────────────────
// LOGIN PAGE
// ─────────────────────────────────────────────
function LoginPage({ onLogin }) {
    const [form, setForm] = useState({ username: "", password: "" });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const handleSubmit = async () => {
        setLoading(true); setError("");
        try {
            const result = await apiLogin(form.username, form.password);
            if (result.success && result.user) {
                onLogin({ username: result.user.username, role: result.user.role, name: result.user.name });
                return;
            }
            // Server was reachable and explicitly rejected these credentials —
            // do NOT fall through to the offline fallback below, or a stale/default
            // password would keep working after it's been changed in the Sheet.
            if (!result.offline) {
                setError(result.message || result.error || "Invalid username or password.");
                setLoading(false);
                return;
            }
        } catch {
            // network/exception — backend unreachable
        }
        setError("Could not reach the server. Please check your connection and try again.");
        setLoading(false);
    };

    return (
        <div style={{ minHeight: "100vh", background: "#0f172a", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans', sans-serif" }}>
            <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Syne:wght@700;800&display=swap');`}</style>
            <div style={{ width: "100%", maxWidth: 400, padding: "0 20px" }}>
                <div style={{ textAlign: "center", marginBottom: 40 }}>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                        <img src="/logo.jpg" alt="Acunnity ASW" style={{ width: 44, height: 44, borderRadius: 12, objectFit: "cover" }} />
                        <span style={{ color: "#fff", fontSize: 28, fontWeight: 800, fontFamily: "'Syne',sans-serif", letterSpacing: "-0.5px" }}>Acunnity ASW</span>
                    </div>
                    <p style={{ color: "#94a3b8", fontSize: 14 }}>ERP & Business Management</p>
                </div>
                <div style={{ background: "#1e293b", borderRadius: 16, padding: 32, border: "1px solid #334155" }}>
                    <h2 style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 20, marginBottom: 24, fontFamily: "'Syne',sans-serif" }}>Sign In</h2>
                    <div style={{ marginBottom: 16 }}>
                        <label style={{ color: "#94a3b8", fontSize: 13, fontWeight: 500, display: "block", marginBottom: 6 }}>Username</label>
                        <input value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} placeholder="admin"
                            style={{ width: "100%", background: "#0f172a", border: "1px solid #334155", borderRadius: 8, padding: "10px 14px", color: "#f1f5f9", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
                    </div>
                    <div style={{ marginBottom: 20 }}>
                        <label style={{ color: "#94a3b8", fontSize: 13, fontWeight: 500, display: "block", marginBottom: 6 }}>Password</label>
                        <input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
                            onKeyDown={e => e.key === "Enter" && handleSubmit()} placeholder="••••••••"
                            style={{ width: "100%", background: "#0f172a", border: "1px solid #334155", borderRadius: 8, padding: "10px 14px", color: "#f1f5f9", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
                    </div>
                    {error && <div style={{ background: "#7f1d1d22", border: "1px solid #ef4444", borderRadius: 8, padding: "8px 12px", color: "#f87171", fontSize: 13, marginBottom: 16 }}>{error}</div>}
                    <button onClick={handleSubmit} disabled={loading}
                        style={{ width: "100%", background: "linear-gradient(135deg,#3b82f6,#8b5cf6)", border: "none", borderRadius: 8, padding: "12px", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}>
                        {loading ? "Signing in…" : "Sign In"}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────
// SIDEBAR
// ─────────────────────────────────────────────
const NAV_ITEMS = [
    { id: "dashboard", label: "Dashboard", icon: "dashboard" },
    { id: "orders", label: "Orders", icon: "orders" },
    { id: "products", label: "Products", icon: "products" },
    { id: "customers", label: "Customers", icon: "customers" },
    { id: "suppliers", label: "Suppliers", icon: "suppliers" },
    { id: "inventory", label: "Inventory", icon: "inventory" },
    { id: "salesmen", label: "Salesmen", icon: "award" },
    { id: "stitchers", label: "Stitchers", icon: "scissors" },
    { id: "assets", label: "Assets", icon: "building" },
    { id: "payroll", label: "Payroll", icon: "payroll" },
    { id: "reports", label: "Reports", icon: "reports" },
    { id: "accounts", label: "Accounts", icon: "accounts" },
    { id: "expenses", label: "Expenses", icon: "expenses" },
    { id: "payment_methods", label: "Payment Methods", icon: "wallet" },
    { id: "ledger_view", label: "Payment Ledger", icon: "receipt" },
    { id: "settings", label: "Settings", icon: "settings" },
];

function Sidebar({ page, setPage, collapsed, setCollapsed, mobileOpen, setMobileOpen }) {
    const isMobile = useIsMobile();

    const navBody = (
        <>
            <div style={{ padding: "20px 16px 16px", borderBottom: "1px solid #1e293b", display: "flex", alignItems: "center", gap: 10 }}>
                <img src="/logo.jpg" alt="Acunnity ASW" style={{ width: 34, height: 34, borderRadius: 9, objectFit: "cover", flexShrink: 0 }} />
                {(!collapsed || isMobile) && <span style={{ color: "#f1f5f9", fontSize: 18, fontWeight: 800, fontFamily: "'Syne',sans-serif", letterSpacing: "-0.5px" }}>Acunnity ASW</span>}
                {isMobile && (
                    <button onClick={() => setMobileOpen(false)} style={{ marginLeft: "auto", background: "none", border: "none", color: "#64748b", cursor: "pointer", padding: 4 }}>
                        <Icon name="x" size={18} />
                    </button>
                )}
            </div>
            <nav style={{ flex: 1, padding: "12px 8px", overflowY: "auto" }}>
                {NAV_ITEMS.map(item => {
                    const active = page === item.id;
                    return (
                        <button key={item.id} onClick={() => { setPage(item.id); if (isMobile) setMobileOpen(false); }} title={collapsed && !isMobile ? item.label : undefined}
                            style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "11px 10px", borderRadius: 8, border: "none", cursor: "pointer", background: active ? "#1e40af22" : "transparent", color: active ? "#60a5fa" : "#64748b", fontSize: 13, fontWeight: active ? 600 : 400, fontFamily: "'DM Sans',sans-serif", marginBottom: 2, textAlign: "left", transition: "all 0.15s" }}>
                            <span style={{ flexShrink: 0 }}><Icon name={item.icon} size={17} /></span>
                            {(!collapsed || isMobile) && <span>{item.label}</span>}
                        </button>
                    );
                })}
            </nav>
            {!isMobile && (
                <button onClick={() => setCollapsed(!collapsed)}
                    style={{ margin: "8px", padding: "9px", borderRadius: 8, background: "#1e293b", border: "none", color: "#64748b", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Icon name="menu" size={16} />
                </button>
            )}
        </>
    );

    if (isMobile) {
        return (
            <>
                {mobileOpen && (
                    <div onClick={() => setMobileOpen(false)}
                        style={{ position: "fixed", inset: 0, background: "#00000099", zIndex: 40, animation: "fadeIn 0.15s" }} />
                )}
                <div style={{
                    position: "fixed", top: 0, left: 0, bottom: 0, width: "min(80vw, 280px)",
                    background: "#0f172a", borderRight: "1px solid #1e293b", display: "flex", flexDirection: "column",
                    zIndex: 50, transform: mobileOpen ? "translateX(0)" : "translateX(-100%)",
                    transition: "transform 0.22s ease", boxShadow: mobileOpen ? "4px 0 24px #00000066" : "none",
                    paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)",
                }}>
                    {navBody}
                </div>
            </>
        );
    }

    return (
        <div style={{ width: collapsed ? 64 : 220, minHeight: "100vh", background: "#0f172a", borderRight: "1px solid #1e293b", display: "flex", flexDirection: "column", transition: "width 0.2s", flexShrink: 0, position: "relative", zIndex: 10 }}>
            {navBody}
        </div>
    );
}

// ─────────────────────────────────────────────
// MOBILE BOTTOM TAB BAR
// The 16 nav items don't fit a bottom bar — show the 4 highest-traffic pages plus a "More"
// button that opens the same slide-out drawer used by the hamburger menu, so every page
// stays one tap away without a cramped 16-icon strip.
// ─────────────────────────────────────────────
const BOTTOM_NAV_ITEMS = [
    { id: "dashboard", label: "Home", icon: "dashboard" },
    { id: "orders", label: "Orders", icon: "orders" },
    { id: "products", label: "Products", icon: "products" },
    { id: "customers", label: "Customers", icon: "customers" },
];

function MobileBottomNav({ page, setPage, onMore }) {
    const moreActive = !BOTTOM_NAV_ITEMS.some(i => i.id === page);
    return (
        <div style={{
            position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 30,
            background: "#0f172a", borderTop: "1px solid #1e293b",
            display: "flex", paddingBottom: "env(safe-area-inset-bottom)",
        }}>
            {BOTTOM_NAV_ITEMS.map(item => {
                const active = page === item.id;
                return (
                    <button key={item.id} onClick={() => setPage(item.id)}
                        style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, padding: "8px 4px 10px", background: "none", border: "none", color: active ? "#60a5fa" : "#64748b", cursor: "pointer" }}>
                        <Icon name={item.icon} size={20} />
                        <span style={{ fontSize: 10, fontWeight: active ? 700 : 500 }}>{item.label}</span>
                    </button>
                );
            })}
            <button onClick={onMore}
                style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, padding: "8px 4px 10px", background: "none", border: "none", color: moreActive ? "#60a5fa" : "#64748b", cursor: "pointer" }}>
                <Icon name="menu" size={20} />
                <span style={{ fontSize: 10, fontWeight: moreActive ? 700 : 500 }}>More</span>
            </button>
        </div>
    );
}

// ─────────────────────────────────────────────
// TOPBAR
// ─────────────────────────────────────────────
function Topbar({ page, user, onLogout, isOnline, onNavigate, pendingCount, onMenuTap }) {
    const label = NAV_ITEMS.find(n => n.id === page)?.label || "Dashboard";
    const isMobile = useIsMobile();
    const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
    return (
        <div style={{
            height: 56, background: "#0f172a", borderBottom: "1px solid #1e293b", display: "flex", alignItems: "center",
            padding: isMobile ? "0 12px" : "0 20px", gap: isMobile ? 8 : 12, flexShrink: 0,
            paddingTop: "env(safe-area-inset-top)",
        }}>
            {isMobile && (
                <button onClick={onMenuTap} style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", padding: 4, flexShrink: 0 }}>
                    <Icon name="menu" size={20} />
                </button>
            )}
            <h1 style={{ color: "#f1f5f9", fontSize: 16, fontWeight: 700, fontFamily: "'Syne',sans-serif", margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</h1>
            {!isMobile && <GlobalSearchBar onNavigate={onNavigate} />}
            <div style={{ flex: isMobile ? 1 : undefined }} />
            {isMobile && (
                <button onClick={() => setMobileSearchOpen(true)} style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", padding: 4, flexShrink: 0 }}>
                    <Icon name="search" size={19} />
                </button>
            )}
            {isMobile && mobileSearchOpen && (
                <GlobalSearchBar onNavigate={onNavigate} mobileFullScreen onCloseMobile={() => setMobileSearchOpen(false)} />
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 5, padding: isMobile ? 6 : "4px 10px", borderRadius: 20, background: isOnline ? "#05250d" : "#2d1010", border: `1px solid ${isOnline ? "#16a34a44" : "#ef444444"}`, flexShrink: 0 }}>
                <Icon name={isOnline ? "wifi" : "wifiOff"} size={13} />
                {!isMobile && <span style={{ fontSize: 11, fontWeight: 600, color: isOnline ? "#4ade80" : "#f87171" }}>{isOnline ? "Online" : "Offline"}</span>}
            </div>
            {pendingCount > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 5, padding: isMobile ? 6 : "4px 10px", borderRadius: 20, background: "#2d1010", border: "1px solid #f9731644", flexShrink: 0 }}>
                    <Icon name="sync" size={13} style={{ color: "#fb923c" }} className="spin" />
                    {!isMobile && <span style={{ fontSize: 11, fontWeight: 600, color: "#fb923c" }}>{pendingCount} pending</span>}
                </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                {!isMobile && (
                    <>
                        <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg,#3b82f6,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <span style={{ color: "#fff", fontSize: 13, fontWeight: 700 }}>{user.name[0]}</span>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column" }}>
                            <span style={{ color: "#f1f5f9", fontSize: 12, fontWeight: 600 }}>{user.name}</span>
                            <span style={{ color: "#64748b", fontSize: 11 }}>{user.role}</span>
                        </div>
                    </>
                )}
                <button onClick={onLogout} style={{ marginLeft: isMobile ? 0 : 4, width: 30, height: 30, borderRadius: 8, background: "transparent", border: "none", color: "#64748b", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Icon name="logout" size={15} />
                </button>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────
// SHARED UI COMPONENTS
// ─────────────────────────────────────────────
function Card({ children, style = {} }) {
    return <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 12, padding: 20, ...style }}>{children}</div>;
}

function Badge({ label, color = "blue" }) {
    const colors = { blue: { bg: "#1e3a5f", text: "#60a5fa" }, green: { bg: "#052e16", text: "#4ade80" }, red: { bg: "#450a0a", text: "#f87171" }, yellow: { bg: "#422006", text: "#fbbf24" }, purple: { bg: "#2e1065", text: "#c084fc" }, cyan: { bg: "#08303522", text: "#22d3ee" }, orange: { bg: "#431407", text: "#fb923c" } };
    const c = colors[color] || colors.blue;
    return <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: c.bg, color: c.text }}>{label}</span>;
}

// Order status can be "paid", "credit", or "cancelled" (a voided order). Centralised so
// every table/detail view renders a voided order consistently instead of mislabelling it.
function OrderStatusBadge({ status }) {
    if (status === "cancelled") return <Badge label="Cancelled" color="red" />;
    return <Badge label={status === "paid" ? "Paid" : "Credit"} color={status === "paid" ? "green" : "yellow"} />;
}

function Btn({ children, onClick, variant = "primary", size = "md", icon, disabled, style: extraStyle = {} }) {
    const base = { display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 8, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer", border: "none", fontFamily: "'DM Sans',sans-serif", transition: "opacity 0.15s", opacity: disabled ? 0.5 : 1 };
    const sizes = { sm: { padding: "6px 12px", fontSize: 12 }, md: { padding: "8px 16px", fontSize: 13 }, lg: { padding: "11px 20px", fontSize: 14 } };
    const variants = {
        primary: { background: "linear-gradient(135deg,#3b82f6,#8b5cf6)", color: "#fff" },
        secondary: { background: "#334155", color: "#cbd5e1" },
        danger: { background: "#7f1d1d", color: "#fca5a5" },
        ghost: { background: "transparent", color: "#94a3b8", border: "1px solid #334155" },
        success: { background: "#052e16", color: "#4ade80", border: "1px solid #16a34a44" },
        warning: { background: "#422006", color: "#fbbf24", border: "1px solid #f9731644" },
    };
    return (
        <button onClick={onClick} disabled={disabled} style={{ ...base, ...sizes[size], ...variants[variant], ...extraStyle }}>
            {icon && <Icon name={icon} size={size === "sm" ? 13 : 15} />}
            {children}
        </button>
    );
}

function Input({ label, value, onChange, placeholder, type = "text", required, style = {}, min, max }) {
    return (
        <div style={style}>
            {label && <label style={{ color: "#94a3b8", fontSize: 12, fontWeight: 500, display: "block", marginBottom: 5 }}>{label}{required && <span style={{ color: "#ef4444" }}> *</span>}</label>}
            <input type={type} value={value} onChange={onChange} placeholder={placeholder} min={min} max={max}
                style={{ width: "100%", background: "#0f172a", border: "1px solid #334155", borderRadius: 8, padding: "9px 12px", color: "#f1f5f9", fontSize: 13, outline: "none", boxSizing: "border-box", fontFamily: "'DM Sans',sans-serif" }} />
        </div>
    );
}

function Select({ label, value, onChange, options, style = {} }) {
    return (
        <div style={style}>
            {label && <label style={{ color: "#94a3b8", fontSize: 12, fontWeight: 500, display: "block", marginBottom: 5 }}>{label}</label>}
            <select value={value} onChange={onChange}
                style={{ width: "100%", background: "#0f172a", border: "1px solid #334155", borderRadius: 8, padding: "9px 12px", color: "#f1f5f9", fontSize: 13, outline: "none", boxSizing: "border-box", fontFamily: "'DM Sans',sans-serif" }}>
                {options.map(o => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>)}
            </select>
        </div>
    );
}

function Modal({ title, children, onClose, width = 560 }) {
    return (
        <div style={{ position: "fixed", inset: 0, background: "#00000088", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
            <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 16, width: "100%", maxWidth: width, maxHeight: "90vh", overflow: "auto" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 24px", borderBottom: "1px solid #334155" }}>
                    <h3 style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 16, margin: 0, fontFamily: "'Syne',sans-serif" }}>{title}</h3>
                    <button onClick={onClose} style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer" }}><Icon name="x" size={18} /></button>
                </div>
                <div style={{ padding: 24 }}>{children}</div>
            </div>
        </div>
    );
}

function Table({ columns, data, onEdit, onDelete, onView }) {
    if (!data?.length) return <div style={{ textAlign: "center", color: "#475569", padding: "40px 0", fontSize: 14 }}>No records found</div>;
    return (
        <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, fontFamily: "'DM Sans',sans-serif" }}>
                <thead>
                    <tr>{columns.map(c => <th key={c.key + c.label} style={{ padding: "10px 14px", textAlign: "left", color: "#64748b", fontWeight: 600, fontSize: 12, borderBottom: "1px solid #334155", whiteSpace: "nowrap" }}>{c.label}</th>)}
                        {(onEdit || onDelete || onView) && <th style={{ padding: "10px 14px", color: "#64748b", fontWeight: 600, fontSize: 12, borderBottom: "1px solid #334155" }}>Actions</th>}
                    </tr>
                </thead>
                <tbody>
                    {data.map((row, i) => (
                        <tr key={i} style={{ borderBottom: "1px solid #1e293b" }}>
                            {columns.map(c => (
                                <td key={c.key + c.label} style={{ padding: "10px 14px", color: "#cbd5e1", whiteSpace: "nowrap" }}>
                                    {c.render ? c.render(row[c.key], row) : row[c.key]}
                                </td>
                            ))}
                            {(onEdit || onDelete || onView) && (
                                <td style={{ padding: "10px 14px" }}>
                                    <div style={{ display: "flex", gap: 6 }}>
                                        {onView && <button onClick={() => onView(row)} style={{ padding: "5px 8px", borderRadius: 6, background: "#1e293b", border: "1px solid #334155", color: "#94a3b8", cursor: "pointer" }}><Icon name="eye" size={13} /></button>}
                                        {onEdit && <button onClick={() => onEdit(row)} style={{ padding: "5px 8px", borderRadius: 6, background: "#1e3a5f", border: "none", color: "#60a5fa", cursor: "pointer" }}><Icon name="edit" size={13} /></button>}
                                        {onDelete && <button onClick={() => onDelete(row)} style={{ padding: "5px 8px", borderRadius: 6, background: "#450a0a", border: "none", color: "#f87171", cursor: "pointer" }}><Icon name="trash" size={13} /></button>}
                                    </div>
                                </td>
                            )}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

// ─────────────────────────────────────────────
// UNIFIED MULTI-PAYMENT INPUT
// ─────────────────────────────────────────────
function MultiPaymentInput({ payments, onChange, maxTotal, label = "Payments", methods, remainingLabel = "Remaining (auto due)", dueLabel = "Auto Due (Credit)" }) {
    const defaultMethods = usePaymentMethodNames();
    const METHODS = (methods && methods.length) ? methods : defaultMethods;
    const total = METHODS.reduce((s, m) => s + (parseFloat(payments[m]) || 0), 0);
    const remaining = maxTotal !== undefined ? Math.max(0, maxTotal - total) : null;
    const overLimit = maxTotal !== undefined && total > maxTotal;
    return (
        <div style={{ background: "#0f172a", borderRadius: 10, padding: 14, border: `1px solid ${overLimit ? "#ef4444" : "#334155"}` }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ color: "#94a3b8", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</span>
                {maxTotal !== undefined && (
                    <span style={{ fontSize: 12, color: overLimit ? "#f87171" : remaining === 0 ? "#4ade80" : "#64748b" }}>
                        {overLimit ? `Over by Rs ${(total - maxTotal).toLocaleString()}` : `${remainingLabel}: Rs ${remaining.toLocaleString()}`}
                    </span>
                )}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {METHODS.map(method => (
                    <div key={method}>
                        <label style={{ color: "#64748b", fontSize: 11, fontWeight: 500, display: "block", marginBottom: 4 }}>{method}</label>
                        <input
                            type="number"
                            value={payments[method] || ""}
                            onChange={e => {
                                const val = parseFloat(e.target.value) || 0;
                                if (maxTotal !== undefined) {
                                    const otherTotal = METHODS.filter(k => k !== method).reduce((s, k) => s + (parseFloat(payments[k]) || 0), 0);
                                    if (otherTotal + val > maxTotal) return;
                                }
                                onChange({ ...payments, [method]: e.target.value });
                            }}
                            min="0"
                            placeholder="0"
                            style={{ width: "100%", background: "#1e293b", border: "1px solid #334155", borderRadius: 6, padding: "7px 10px", color: "#f1f5f9", fontSize: 13, outline: "none", boxSizing: "border-box" }}
                        />
                    </div>
                ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0 0", borderTop: "1px solid #1e293b", marginTop: 10 }}>
                <span style={{ color: "#94a3b8", fontSize: 13 }}>Total Paid</span>
                <span style={{ color: overLimit ? "#f87171" : "#4ade80", fontWeight: 700, fontSize: 14 }}>{fmt(total)}</span>
            </div>
            {remaining !== null && remaining > 0 && !overLimit && (
                <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0 0" }}>
                    <span style={{ color: "#fbbf24", fontSize: 12 }}>{dueLabel}</span>
                    <span style={{ color: "#fbbf24", fontWeight: 700, fontSize: 13 }}>{fmt(remaining)}</span>
                </div>
            )}
        </div>
    );
}

// ─────────────────────────────────────────────
// BILL / RECEIPT PRINT MODAL
// ─────────────────────────────────────────────
function BillReceiptModal({ order, onClose }) {
    const items = (() => { try { return typeof order.items === "string" ? JSON.parse(order.items) : (order.items || order.cart || []); } catch { return order.cart || []; } })();
    const payments = (() => { try { return typeof order.payments === "string" ? JSON.parse(order.payments) : (order.payments || {}); } catch { return {}; } })();
    const METHODS = getPaymentMethodNames();
    const totalPaid = METHODS.reduce((s, m) => s + (parseFloat(payments[m]) || 0), 0);
    const due = Number(order.total || 0) - totalPaid;
    const storeName = localStorage.getItem("dukandar_store_name") || "Dukandar Store";

    const handlePrint = () => {
        const printWin = window.open("", "_blank");
        printWin.document.write(`
      <!DOCTYPE html><html><head><title>Invoice ${order.id}</title>
      <style>
        * { margin:0; padding:0; box-sizing:border-box; }
        body { font-family: 'Courier New', monospace; font-size: 12px; color: #000; padding: 10px; max-width: 300px; margin: auto; }
        .header { text-align:center; border-bottom: 2px dashed #000; padding-bottom: 10px; margin-bottom: 10px; }
        .header h1 { font-size:18px; font-weight:800; }
        table { width:100%; border-collapse:collapse; margin-bottom:10px; }
        th { text-align:left; border-bottom:1px solid #000; padding:3px 0; font-size:11px; }
        td { padding:3px 0; font-size:11px; }
        .total-row { border-top:1px dashed #000; margin-top:6px; padding-top:6px; display:flex; justify-content:space-between; }
        .due { color:#c00; font-weight:bold; font-size:13px; }
        .paid-row { display:flex; justify-content:space-between; font-size:11px; margin-top:2px; }
        .footer { text-align:center; border-top:2px dashed #000; padding-top:10px; margin-top:10px; font-size:11px; }
      </style></head><body>
      <div class="header"><h1>${storeName}</h1><p>Invoice / Bill Receipt</p></div>
      <div style="margin-bottom:10px;font-size:11px;">
        <div><b>Bill #:</b> ${order.id}</div>
        <div><b>Date:</b> ${order.date}</div>
        <div><b>Customer:</b> ${order.customer || "Walk-in"}</div>
        ${order.salesman ? `<div><b>Salesman:</b> ${order.salesman}</div>` : ""}
        ${order.stitcher && order.clientStitchingCharge ? `<div><b>Stitcher:</b> ${order.stitcher}</div><div><b>Stitching Charge:</b> Rs ${Number(order.clientStitchingCharge).toLocaleString()}</div>` : ""}
      </div>
      <table><thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
      <tbody>${items.map(i => `<tr><td>${i.name}</td><td>${i.qty}</td><td>Rs ${Number(i.price).toLocaleString()}</td><td>Rs ${(Number(i.qty)*Number(i.price)).toLocaleString()}</td>`).join("")}</tbody>
    </table>
      ${Number(order.discount) > 0 ? `<div class="paid-row"><span>Discount (${order.discount}%)</span><span>-</span></div>` : ""}
      <div class="total-row"><span><b>TOTAL</b></span><span><b>Rs ${Number(order.total).toLocaleString()}</b></span></div>
      ${METHODS.filter(m => parseFloat(payments[m]) > 0).map(m => `<div class="paid-row"><span>Paid (${m})</span><span>Rs ${Number(payments[m]).toLocaleString()}</span></div>`).join("")}
      ${due > 0.01 ? `<div class="paid-row due"><span>CREDIT DUE</span><span>Rs ${Number(due).toLocaleString()}</span></div>` : ""}
      <div class="footer"><p>Thank you for your business!</p><p>Powered by Dukandar ERP</p></div>
      </body></html>`);
        printWin.document.close(); printWin.focus();
        setTimeout(() => { printWin.print(); printWin.close(); }, 300);
    };

    return (
        <><Modal title={`Bill Receipt — ${order.id}`} onClose={onClose} width={420}>
            <div style={{ background: "#0f172a", borderRadius: 10, padding: 20, fontFamily: "'Courier New', monospace", fontSize: 13, marginBottom: 20 }}>
                <div style={{ textAlign: "center", borderBottom: "2px dashed #334155", paddingBottom: 12, marginBottom: 12 }}>
                    <div style={{ color: "#f1f5f9", fontWeight: 800, fontSize: 18 }}>{storeName}</div>
                    <div style={{ color: "#64748b", fontSize: 11 }}>Invoice / Bill Receipt</div>
                </div>
                <div style={{ marginBottom: 12, fontSize: 12, color: "#94a3b8" }}>
                    <div>Bill #: <span style={{ color: "#f1f5f9" }}>{order.id}</span></div>
                    <div>Date: <span style={{ color: "#f1f5f9" }}>{order.date}</span></div>
                    <div>Customer: <span style={{ color: "#f1f5f9" }}>{order.customer || "Walk-in"}</span></div>
                    {order.salesman && <div>Salesman: <span style={{ color: "#f1f5f9" }}>{order.salesman}</span></div>}
                    {order.stitcher && <div>Stitcher: <span style={{ color: "#c084fc" }}>{order.stitcher}</span> {order.stitchStatus && <span style={{ color: "#64748b", fontSize: 11 }}>({order.stitchStatus})</span>}</div>}
                </div>
                {items.map((item, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 12 }}>
                        <span style={{ color: "#cbd5e1" }}>{item.name} x{item.qty}</span>
                        <span style={{ color: "#f1f5f9" }}>{fmt(Number(item.qty) * Number(item.price))}</span>
                    </div>
                ))}
                {order.clientStitchingCharge > 0 && (
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 12, borderTop: "1px solid #334155", paddingTop: 6, marginTop: 6 }}>
                        <span style={{ color: "#c084fc" }}>Stitching Service</span>
                        <span style={{ color: "#f1f5f9" }}>{fmt(order.clientStitchingCharge)}</span>
                    </div>
                )}
            </div>
            <div style={{ borderTop: "1px dashed #334155", paddingTop: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 14, color: "#f1f5f9", marginBottom: 4 }}>
                    <span>TOTAL</span><span>{fmt(order.total)}</span>
                </div>
                {METHODS.filter(m => parseFloat(payments[m]) > 0).map(m => (
                    <div key={m} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#4ade80", marginBottom: 2 }}>
                        <span>Paid ({m})</span><span>{fmt(payments[m])}</span>
                    </div>
                ))}
                {due > 0.01 && (
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#f87171", fontWeight: 700, marginTop: 4 }}>
                        <span>CREDIT DUE</span><span>{fmt(due)}</span>
                    </div>
                )}
            </div>
            <div style={{ textAlign: "center", borderTop: "1px dashed #334155", paddingTop: 10, marginTop: 10, color: "#64748b", fontSize: 11 }}>Thank you for your business!</div>
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                <Btn icon="print" onClick={handlePrint} style={{ flex: 1, justifyContent: "center" }}>Print Receipt</Btn>
                <Btn variant="ghost" onClick={onClose}>Close</Btn>
            </div>
        </Modal>
        </>
    );
}

// ─────────────────────────────────────────────
// QR CODE UTILITIES
// ─────────────────────────────────────────────
let _qrScriptPromise = null;
function ensureQRScript() {
    if (_qrScriptPromise) return _qrScriptPromise;
    _qrScriptPromise = new Promise((resolve, reject) => {
        if (window.QRCode) { resolve(); return; }
        const s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/qrcode/build/qrcode.min.js";
        s.onload = resolve; s.onerror = reject;
        document.head.appendChild(s);
    });
    return _qrScriptPromise;
}

let _scannerScriptPromise = null;
function ensureScannerScript() {
    if (_scannerScriptPromise) return _scannerScriptPromise;
    _scannerScriptPromise = new Promise((resolve, reject) => {
        if (window.Html5QrcodeScanner) { resolve(); return; }
        const s = document.createElement("script");
        s.src = "https://unpkg.com/html5-qrcode";
        s.onload = resolve; s.onerror = reject;
        document.head.appendChild(s);
    });
    return _scannerScriptPromise;
}

function makeQRPayload(product) {
    return JSON.stringify({ type: "dukandar_product", id: product.id, name: product.name, price: Number(product.sellingPrice) });
}

async function generateQRDataUrl(product) {
    await ensureQRScript();
    return await window.QRCode.toDataURL(makeQRPayload(product), { width: 200, margin: 2, color: { dark: "#0f172a", light: "#ffffff" } });
}

function QRDetailModal({ product, onClose }) {
    const [qrDataUrl, setQrDataUrl] = useState(null);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        let cancelled = false;
        generateQRDataUrl(product).then(url => { if (!cancelled) { setQrDataUrl(url); setLoading(false); } }).catch(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [product.id]);
    function download() {
        if (!qrDataUrl) return;
        const link = document.createElement("a");
        link.download = "qr-" + product.name.replace(/\s+/g, "-") + ".png";
        link.href = qrDataUrl; link.click();
    }
    return (
        <Modal title="Product QR Code" onClose={onClose} width={360}>
            <div style={{ textAlign: "center" }}>
                <div style={{ background: "#fff", borderRadius: 12, padding: 16, display: "inline-block", marginBottom: 16 }}>
                    {loading ? <div style={{ width: 200, height: 200, display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="refresh" size={24} className="spin" /></div>
                        : <img src={qrDataUrl} alt="QR Code" style={{ width: 200, height: 200, display: "block" }} />}
                </div>
                <div style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{product.name}</div>
                <div style={{ color: "#94a3b8", fontSize: 13, marginBottom: 20 }}>Rs {Number(product.sellingPrice).toLocaleString()} | Stock: {product.stock}</div>
                <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                    <Btn icon="download" onClick={download} disabled={!qrDataUrl}>Download PNG</Btn>
                    <Btn variant="ghost" onClick={onClose}>Close</Btn>
                </div>
            </div>
        </Modal>
    );
}

function BatchQRModal({ products, onClose }) {
    const [qrMap, setQrMap] = useState({});
    const [progress, setProgress] = useState(0);
    const mountedRef = useRef(true);
    useEffect(() => {
        mountedRef.current = true;
        generateAll();
        return () => { mountedRef.current = false; };
        async function generateAll() {
            await ensureQRScript();
            const chunks = [];
            for (let i = 0; i < products.length; i += 20) chunks.push(products.slice(i, i + 20));
            const map = {}; let done = 0;
            for (const chunk of chunks) {
                await Promise.all(chunk.map(async (p) => {
                    try { const url = await window.QRCode.toDataURL(makeQRPayload(p), { width: 120, margin: 1, color: { dark: "#0f172a", light: "#ffffff" } }); map[p.id] = url; } catch { /* skip this product's QR on failure */ }
                }));
                done += chunk.length;
                if (mountedRef.current) { setProgress(Math.round(done / products.length * 100)); setQrMap({ ...map }); }
            }
        }
    }, []);
    const done = Object.keys(qrMap).length;
    return (
        <Modal title={`All Product QR Codes (${done}/${products.length})`} onClose={onClose} width={820}>
            {done < products.length && (
                <div style={{ marginBottom: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <span style={{ color: "#94a3b8", fontSize: 12 }}>Generating QR codes…</span>
                        <span style={{ color: "#60a5fa", fontSize: 12 }}>{progress}%</span>
                    </div>
                    <div style={{ background: "#0f172a", borderRadius: 4, height: 6 }}>
                        <div style={{ background: "linear-gradient(135deg,#3b82f6,#8b5cf6)", height: "100%", borderRadius: 4, width: progress + "%", transition: "width 0.3s" }} />
                    </div>
                </div>
            )}
            <div style={{ maxHeight: 500, overflowY: "auto" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 12 }}>
                    {products.map(p => (
                        <div key={p.id} style={{ background: "#0f172a", borderRadius: 10, padding: 12, textAlign: "center", border: "1px solid #334155" }}>
                            <div style={{ background: "#fff", borderRadius: 6, padding: 6, display: "inline-block", marginBottom: 8 }}>
                                {qrMap[p.id] ? <img src={qrMap[p.id]} alt="" style={{ width: 100, height: 100, display: "block" }} />
                                    : <div style={{ width: 100, height: 100, display: "flex", alignItems: "center", justifyContent: "center", color: "#ccc", fontSize: 10 }}>…</div>}
                            </div>
                            <div style={{ color: "#f1f5f9", fontSize: 11, fontWeight: 600, marginBottom: 2 }}>{p.name}</div>
                            <div style={{ color: "#64748b", fontSize: 10 }}>Rs {Number(p.sellingPrice).toLocaleString()}</div>
                        </div>
                    ))}
                </div>
            </div>
        </Modal>
    );
}

function ScannerPanel({ products, onScan, onClose }) {
    const [scannerReady, setScannerReady] = useState(false);
    const [permissionDenied, setPermissionDenied] = useState(false);
    const [flashActive, setFlashActive] = useState(false);
    const [feedback, setFeedback] = useState(null);
    const scannerRef = useRef(null);
    const debounceRef = useRef(false);
    const mountedRef = useRef(true);
    const productsRef = useRef(products);
    useEffect(() => { productsRef.current = products; }, [products]);

    useEffect(() => {
        mountedRef.current = true;
        initScanner();
        return () => { mountedRef.current = false; stopScanner(); };
    }, []);

    async function initScanner() {
        try {
            await ensureScannerScript();
            if (!mountedRef.current) return;
            const scanner = new window.Html5QrcodeScanner("qr-reader-panel", { fps: 10, qrbox: { width: 220, height: 220 }, aspectRatio: 1.0 }, false);
            scannerRef.current = scanner;
            scanner.render((decodedText) => { if (mountedRef.current) handleScan(decodedText); }, () => {});
            if (mountedRef.current) setScannerReady(true);
        } catch { if (mountedRef.current) setPermissionDenied(true); }
    }

    function stopScanner() {
        if (scannerRef.current) { try { scannerRef.current.clear(); } catch { /* scanner may already be stopped */ } scannerRef.current = null; }
    }

    function handleScan(decodedText) {
        if (debounceRef.current) return;
        let parsed;
        try { parsed = JSON.parse(decodedText); } catch { setFeedback({ msg: "⚠️ Not a valid product QR", type: "warning" }); return; }
        if (parsed.type !== "dukandar_product") { setFeedback({ msg: "⚠️ Not a valid product QR", type: "warning" }); return; }
        const product = productsRef.current.find(p => p.id === parsed.id);
        if (!product) { setFeedback({ msg: "⚠️ Product not found", type: "warning" }); return; }
        onScan(product);
        setFlashActive(true);
        setFeedback({ msg: `✓ Added: ${product.name}`, type: "success" });
        debounceRef.current = true;
        setTimeout(() => { if (mountedRef.current) { debounceRef.current = false; setFlashActive(false); setFeedback(null); } }, 1500);
    }

    return (
        <div style={{ marginTop: 12, background: "#0f172a", border: "1px solid #334155", borderRadius: 12, overflow: "hidden" }}>
            <style>{`
                @keyframes scanSuccess { 0% { border-color: #334155; } 30% { border-color: #4ade80; box-shadow: 0 0 16px #4ade8066; } 100% { border-color: #334155; } }
                #qr-reader-panel { border-radius: 8px; overflow: hidden; }
                #qr-reader-panel video { border-radius: 8px !important; }
                #qr-reader-panel__dashboard { background: #0f172a !important; padding: 8px 12px !important; }
                #qr-reader-panel__dashboard_section_csr button { background: linear-gradient(135deg,#3b82f6,#8b5cf6) !important; border: none !important; color: #fff !important; border-radius: 6px !important; padding: 6px 14px !important; cursor: pointer !important; }
            `}</style>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid #1e293b" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Icon name="camera" size={16} />
                    <span style={{ color: "#f1f5f9", fontSize: 13, fontWeight: 600 }}>QR Scanner</span>
                    {scannerReady && <span style={{ color: "#4ade80", fontSize: 11 }}>● Live</span>}
                </div>
                <Btn size="sm" variant="ghost" onClick={() => { stopScanner(); onClose(); }}>Stop Scan</Btn>
            </div>
            <div style={{ padding: "12px 16px" }}>
                {permissionDenied ? (
                    <div style={{ textAlign: "center", padding: 24 }}>
                        <div style={{ color: "#f87171", fontSize: 13, marginBottom: 12 }}>Camera access denied.</div>
                        <Btn size="sm" variant="ghost" onClick={() => { stopScanner(); onClose(); }}>Use Manual Search</Btn>
                    </div>
                ) : (
                    <div style={{ border: flashActive ? "2px solid #4ade80" : "2px solid #334155", borderRadius: 10, overflow: "hidden", animation: flashActive ? "scanSuccess 0.6s ease" : "none" }}>
                        <div id="qr-reader-panel" style={{ width: "100%", maxWidth: 360, margin: "0 auto" }} />
                    </div>
                )}
                <div style={{ marginTop: 10, minHeight: 22, textAlign: "center" }}>
                    {feedback ? <span style={{ fontSize: 13, fontWeight: 600, color: feedback.type === "success" ? "#4ade80" : "#fbbf24" }}>{feedback.msg}</span>
                        : <span style={{ fontSize: 12, color: "#475569" }}>Point camera at a product QR code</span>}
                </div>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────
// PRODUCTS PAGE
// ─────────────────────────────────────────────
function ProductsPage() {
    const [products, setProducts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [search, setSearch] = useState("");
    const [showForm, setShowForm] = useState(false);
    const [editItem, setEditItem] = useState(null);
    const blank = { name: "", category: "", brand: "", unit: "Piece", purchasePrice: "", sellingPrice: "", stock: "", barcode: "" };
    const [form, setForm] = useState(blank);
    const [showQRModal, setShowQRModal] = useState(null);
    const [showBatchQR, setShowBatchQR] = useState(false);
    const [autoShowQRForId, setAutoShowQRForId] = useState(null);
    const mountedRef = useRef(true);

    useEffect(() => { mountedRef.current = true; fetchProds(); return () => { mountedRef.current = false; }; }, []);

    async function fetchProds() {
        setLoading(true);
        try {
            const res = await getProducts();
            if (!mountedRef.current) return;
            if (res.success) setProducts(res.products || []);
        } catch (err) { console.error(err); }
        finally { if (mountedRef.current) setLoading(false); }
    }

    const filtered = products.filter(p => p.name?.toLowerCase().includes(search.toLowerCase()) || p.category?.toLowerCase().includes(search.toLowerCase()) || p.barcode?.includes(search));
    const f = k => e => setForm({ ...form, [k]: e.target.value });

    async function save() {
        if (!form.name || !form.sellingPrice) return;
        setSaving(true);
        try {
            const result = editItem ? await updateProduct(editItem.id, form) : await addProduct(form);
            if (result.success) { await fetchProds(); setShowForm(false); if (!editItem && result.id) setAutoShowQRForId(result.id); }
            else toast(result.error || "Failed to save product.");
        } catch { toast("Network or server error."); }
        finally { if (mountedRef.current) setSaving(false); }
    }

    async function del(row) {
        if (!window.confirm(`Delete "${row.name}"?`)) return;
        try {
            const result = await deleteProduct(row.id);
            if (result.success) await fetchProds();
            else toast(result.error || "Failed to delete.");
        } catch { toast("Network error."); }
    }

    return (
        <div style={{ padding: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products…" style={{ flex: 1, background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "9px 12px", color: "#f1f5f9", fontSize: 13, outline: "none" }} />
                <Btn size="sm" variant="ghost" icon="refresh" onClick={fetchProds}>Refresh</Btn>
                <Btn size="sm" variant="secondary" icon="qrcode" onClick={() => setShowBatchQR(true)}>All QRs</Btn>
                <Btn onClick={() => { setForm(blank); setEditItem(null); setShowForm(true); }} icon="plus">Add Product</Btn>
            </div>
            <Card>{loading ? <Spinner /> : (
                <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, fontFamily: "'DM Sans',sans-serif" }}>
                        <thead>
                            <tr>
                                {["Barcode", "Product Name", "Category", "Brand", "Purchase", "Selling", "Stock", "Actions"].map(h => (
                                    <th key={h} style={{ padding: "10px 14px", textAlign: "left", color: "#64748b", fontWeight: 600, fontSize: 12, borderBottom: "1px solid #334155", whiteSpace: "nowrap" }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map((row, i) => (
                                <tr key={i} style={{ borderBottom: "1px solid #1e293b" }}>
                                    <td style={{ padding: "10px 14px", color: "#cbd5e1" }}>{row.barcode}</td>
                                    <td style={{ padding: "10px 14px", color: "#f1f5f9", fontWeight: 600 }}>{row.name}</td>
                                    <td style={{ padding: "10px 14px", color: "#cbd5e1" }}>{row.category}</td>
                                    <td style={{ padding: "10px 14px", color: "#cbd5e1" }}>{row.brand}</td>
                                    <td style={{ padding: "10px 14px", color: "#cbd5e1" }}>{fmt(row.purchasePrice)}</td>
                                    <td style={{ padding: "10px 14px", color: "#cbd5e1" }}>{fmt(row.sellingPrice)}</td>
                                    <td style={{ padding: "10px 14px" }}><span style={{ color: Number(row.stock) < 10 ? "#f87171" : "#4ade80", fontWeight: 600 }}>{row.stock}</span></td>
                                    <td style={{ padding: "10px 14px" }}>
                                        <div style={{ display: "flex", gap: 6 }}>
                                            <button onClick={() => setShowQRModal(row)} style={{ padding: "5px 8px", borderRadius: 6, background: "#052e16", border: "1px solid #16a34a44", color: "#4ade80", cursor: "pointer" }}><Icon name="qrcode" size={13} /></button>
                                            <button onClick={() => { setForm({ ...row }); setEditItem(row); setShowForm(true); }} style={{ padding: "5px 8px", borderRadius: 6, background: "#1e3a5f", border: "none", color: "#60a5fa", cursor: "pointer" }}><Icon name="edit" size={13} /></button>
                                            <button onClick={() => del(row)} style={{ padding: "5px 8px", borderRadius: 6, background: "#450a0a", border: "none", color: "#f87171", cursor: "pointer" }}><Icon name="trash" size={13} /></button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {!filtered.length && <tr><td colSpan={8} style={{ padding: "40px 0", textAlign: "center", color: "#475569" }}>No products found</td></tr>}
                        </tbody>
                    </table>
                </div>
            )}</Card>
            {showForm && (
                <Modal title={editItem ? "Edit Product" : "Add Product"} onClose={() => setShowForm(false)}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                        <Input label="Product Name" value={form.name} onChange={f("name")} required style={{ gridColumn: "1/-1" }} />
                        <Input label="Category" value={form.category} onChange={f("category")} />
                        <Input label="Brand" value={form.brand} onChange={f("brand")} />
                        <Input label="Barcode" value={form.barcode} onChange={f("barcode")} />
                        <Input label="Unit" value={form.unit} onChange={f("unit")} />
                        <Input label="Purchase Price" type="number" value={form.purchasePrice} onChange={f("purchasePrice")} />
                        <Input label="Selling Price" type="number" value={form.sellingPrice} onChange={f("sellingPrice")} required />
                        <Input label="Stock Quantity" type="number" value={form.stock} onChange={f("stock")} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
                        <Btn variant="ghost" onClick={() => setShowForm(false)}>Cancel</Btn>
                        <Btn onClick={save} disabled={saving}>{saving ? "Saving…" : "Save Product"}</Btn>
                    </div>
                </Modal>
            )}
            {showQRModal && <QRDetailModal product={showQRModal} onClose={() => setShowQRModal(null)} />}
            {showBatchQR && <BatchQRModal products={products} onClose={() => setShowBatchQR(false)} />}
            {autoShowQRForId && (() => { const p = products.find(x => x.id === autoShowQRForId); if (!p) return null; return <QRDetailModal product={p} onClose={() => setAutoShowQRForId(null)} />; })()}
        </div>
    );
}

// ─────────────────────────────────────────────
// CUSTOMERS PAGE
// ─────────────────────────────────────────────
function CustomersPage() {
    const [customers, setCustomers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [search, setSearch] = useState("");
    const [showForm, setShowForm] = useState(false);
    const [editItem, setEditItem] = useState(null);
    const blank = { name: "", phone: "", city: "", loyal: false, discount: 0, creditLimit: 0 };
    const [form, setForm] = useState(blank);
    const mountedRef = useRef(true);

    useEffect(() => { mountedRef.current = true; fetchCusts(); return () => { mountedRef.current = false; }; }, []);

    async function fetchCusts() {
        setLoading(true);
        try { const res = await getCustomers(); if (!mountedRef.current) return; if (res.success) setCustomers(res.customers || []); }
        catch (err) { console.error(err); }
        finally { if (mountedRef.current) setLoading(false); }
    }

    const filtered = customers.filter(c => c.name?.toLowerCase().includes(search.toLowerCase()) || c.phone?.includes(search));
    const f = k => e => setForm({ ...form, [k]: e.target.value });

    async function save() {
        if (!form.name || !form.phone) return;
        setSaving(true);
        try {
            const result = editItem ? await updateCustomer(editItem.id, form) : await addCustomer(form);
            if (result.success) { await fetchCusts(); setShowForm(false); }
            else toast(result.error || "Failed to save customer.");
        } catch { toast("Network error."); }
        finally { if (mountedRef.current) setSaving(false); }
    }

    async function del(row) {
        if (!window.confirm(`Delete customer "${row.name}"?\n\nOnly allowed if they have no outstanding balance and no orders on record.`)) return;
        try {
            const result = await deleteCustomer(row.id);
            if (result.success) await fetchCusts();
            else if (String(result.error || "").includes("Unknown")) toast("Customer delete needs the updated backend. Please re-deploy the Google Apps Script (see REDEPLOY.md).");
            else toast(result.error || "Failed to delete.");
        } catch { toast("Network error."); }
    }

    return (
        <div style={{ padding: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search customers…" style={{ flex: 1, background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "9px 12px", color: "#f1f5f9", fontSize: 13, outline: "none" }} />
                <Btn size="sm" variant="ghost" icon="refresh" onClick={fetchCusts}>Refresh</Btn>
                <Btn onClick={() => { setForm(blank); setEditItem(null); setShowForm(true); }} icon="plus">Add Customer</Btn>
            </div>
            <Card>{loading ? <Spinner /> : <Table columns={[
                { key: "id", label: "ID" }, { key: "name", label: "Name" }, { key: "phone", label: "Phone" }, { key: "city", label: "City" },
                { key: "creditLimit", label: "Credit Limit", render: v => Number(v) > 0 ? <Badge label={fmt(v)} color="cyan" /> : <span style={{ color: "#475569" }}>No limit</span> },
                { key: "balance", label: "Balance", render: v => <span style={{ color: Number(v) < 0 ? "#f87171" : "#4ade80" }}>{fmt(Math.abs(v))}{Number(v) < 0 ? " Dr" : ""}</span> },
                { key: "loyal", label: "Loyalty", render: (v, row) => v ? <Badge label={`${row.discount}% off`} color="purple" /> : "—" },
            ]} data={filtered} onEdit={row => { setForm({ ...row }); setEditItem(row); setShowForm(true); }} onDelete={del} />}</Card>
            {showForm && (
                <Modal title={editItem ? "Edit Customer" : "Add Customer"} onClose={() => setShowForm(false)}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                        <Input label="Customer Name" value={form.name} onChange={f("name")} required style={{ gridColumn: "1/-1" }} />
                        <Input label="Phone" value={form.phone} onChange={f("phone")} required />
                        <Input label="City" value={form.city} onChange={f("city")} />
                        <Input label="Credit Limit (Rs)" type="number" value={form.creditLimit} onChange={f("creditLimit")} placeholder="0 = no limit" />
                        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0" }}>
                            <input type="checkbox" checked={!!form.loyal} onChange={e => setForm({ ...form, loyal: e.target.checked })} id="loyal" />
                            <label htmlFor="loyal" style={{ color: "#94a3b8", fontSize: 13 }}>Loyalty Customer</label>
                        </div>
                        {form.loyal && <Input label="Discount %" type="number" value={form.discount} onChange={f("discount")} />}
                    </div>
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
                        <Btn variant="ghost" onClick={() => setShowForm(false)}>Cancel</Btn>
                        <Btn onClick={save} disabled={saving}>{saving ? "Saving…" : "Save Customer"}</Btn>
                    </div>
                </Modal>
            )}
        </div>
    );
}

// ─────────────────────────────────────────────
// ORDER DETAIL MODAL (used by OrdersPage)
// ─────────────────────────────────────────────
function OrderDetailModal({ order, onClose, onPaymentAdded }) {
    const [showPayForm, setShowPayForm] = useState(false);
    const [newPayments, setNewPayments] = useState(() => Object.fromEntries(getPaymentMethodNames().map(m => [m, ""])));
    const [saving, setSaving] = useState(false);
    const [showBill, setShowBill] = useState(false);
    const [stitchStatus, setStitchStatus] = useState(order.stitchStatus || "none");
    const [updatingStitch, setUpdatingStitch] = useState(false);

    const items = (() => { try { return typeof order.items === "string" ? JSON.parse(order.items) : (order.items || order.cart || []); } catch { return order.cart || []; } })();
    const payments = (() => { try { return typeof order.payments === "string" ? JSON.parse(order.payments) : (order.payments || {}); } catch { return {}; } })();
    const METHODS = getPaymentMethodNames();
    const due = Number(order.total || 0) - Number(order.paid || 0);
    const newPayTotal = METHODS.reduce((s, m) => s + (parseFloat(newPayments[m]) || 0), 0);

    async function addPayment() {
        if (newPayTotal <= 0 || newPayTotal > due) return;
        setSaving(true);
        try {
            for (const [method, amtStr] of Object.entries(newPayments)) {
                const amt = parseFloat(amtStr) || 0;
                if (amt > 0) {
                    const result = await updateOrder(order.id, { newPaymentAmount: amt, newPaymentMethod: method });
                    if (!result.success) { toast(`Failed to record payment via ${method}`); setSaving(false); return; }
                }
            }
            setShowPayForm(false);
            setNewPayments(Object.fromEntries(getPaymentMethodNames().map(m => [m, ""])));
            onPaymentAdded();
        } catch { toast("Network error."); }
        finally { setSaving(false); }
    }

    async function updateStitchStatus(newStatus) {
        setUpdatingStitch(true);
        try {
            const result = await updateOrderStitchStatus({ orderId: order.id, status: newStatus });
            if (result.success) { setStitchStatus(newStatus); onPaymentAdded(); }
            else toast(result.error || "Failed to update stitch status.");
        } catch { toast("Network error."); }
        finally { setUpdatingStitch(false); }
    }

    if (showBill) return <BillReceiptModal order={{ ...order, clientStitchingCharge: order.clientStitchingCharge, stitchStatus }} onClose={() => setShowBill(false)} />;

    const stitchStatusColors = { none: "blue", assigned: "purple", in_progress: "yellow", completed: "green", cancelled: "red" };

    return (
        <Modal title={`Order Detail — ${order.id}`} onClose={onClose} width={700}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
                {[
                    ["Customer", order.customer || "Walk-in"],
                    ["Date", order.date],
                    ["Salesman", order.salesman || "—"],
                    ["Status", null],
                    ["Total", fmt(order.total)],
                    ["Paid", fmt(order.paid)],
                    ["Due", fmt(Math.max(due, 0))]
                ].map(([label, val], i) => (
                    <div key={i} style={{ background: "#0f172a", borderRadius: 8, padding: "10px 14px" }}>
                        <div style={{ color: "#64748b", fontSize: 11, marginBottom: 3 }}>{label}</div>
                        <div style={{ color: "#f1f5f9", fontWeight: 600, fontSize: 13 }}>
                            {label === "Status" ? <OrderStatusBadge status={order.status} /> : val}
                        </div>
                    </div>
                ))}
            </div>
            {order.stitcher && (
                <div style={{ background: "#2e106522", border: "1px solid #8b5cf633", borderRadius: 10, padding: 14, marginBottom: 20 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ width: 32, height: 32, borderRadius: 8, background: "#8b5cf622", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                <Icon name="scissors" size={15} style={{ color: "#c084fc" }} />
                            </div>
                            <div>
                                <div style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 13 }}>{order.stitcher}</div>
                                <div style={{ color: "#64748b", fontSize: 11 }}>Assigned Stitcher</div>
                            </div>
                        </div>
                        <Badge label={stitchStatus || "assigned"} color={stitchStatusColors[stitchStatus] || "purple"} />
                    </div>
                    <div style={{ marginTop: 8, display: "flex", gap: 16, fontSize: 12 }}>
                        <div><span style={{ color: "#64748b" }}>Client Stitching Charge:</span> <span style={{ color: "#f1f5f9" }}>{fmt(order.clientStitchingCharge || 0)}</span></div>
                        <div><span style={{ color: "#64748b" }}>Stitcher Pay:</span> <span style={{ color: "#c084fc" }}>{fmt(order.stitcherPay || 0)}</span></div>
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                        {["assigned", "in_progress", "completed"].map(s => (
                            <button key={s} onClick={() => updateStitchStatus(s)} disabled={updatingStitch || stitchStatus === s}
                                style={{ padding: "5px 12px", borderRadius: 6, border: "1px solid #8b5cf633", background: stitchStatus === s ? "#8b5cf633" : "transparent", color: stitchStatus === s ? "#c084fc" : "#64748b", fontSize: 12, cursor: stitchStatus === s ? "default" : "pointer", fontWeight: stitchStatus === s ? 700 : 400 }}>
                                {updatingStitch ? "…" : s === "assigned" ? "Assigned" : s === "in_progress" ? "In Progress" : "Complete"}
                            </button>
                        ))}
                    </div>
                </div>
            )}
            <h4 style={{ color: "#94a3b8", fontSize: 12, fontWeight: 600, marginBottom: 10, textTransform: "uppercase" }}>Order Items</h4>
            <div style={{ background: "#0f172a", borderRadius: 8, padding: 12, marginBottom: 20 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                        <tr>{["Product", "Qty", "Price", "Total"].map(h => <th key={h} style={{ padding: "6px 10px", color: "#64748b", fontWeight: 600, fontSize: 11, textAlign: "left", borderBottom: "1px solid #1e293b" }}>{h}</th>)}</tr>
                    </thead>
                    <tbody>{items.map((item, i) => (
                        <tr key={i} style={{ borderBottom: "1px solid #1e293b" }}>
                            <td style={{ padding: "8px 10px", color: "#f1f5f9" }}>{item.name}</td>
                            <td style={{ padding: "8px 10px", color: "#94a3b8" }}>{item.qty}</td>
                            <td style={{ padding: "8px 10px", color: "#94a3b8" }}>{fmt(item.price)}</td>
                            <td style={{ padding: "8px 10px", color: "#60a5fa", fontWeight: 600 }}>{fmt(item.qty * item.price)}</td>
                        </tr>
                    ))}</tbody>
                </table>
            </div>
            <h4 style={{ color: "#94a3b8", fontSize: 12, fontWeight: 600, marginBottom: 10, textTransform: "uppercase" }}>Payment Summary</h4>
            <div style={{ background: "#0f172a", borderRadius: 8, padding: 12, marginBottom: 20 }}>
                {METHODS.filter(m => parseFloat(payments[m]) > 0).map(m => (
                    <div key={m} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #1e293b", fontSize: 13 }}>
                        <span style={{ color: "#94a3b8" }}>{m}</span>
                        <span style={{ color: "#4ade80", fontWeight: 600 }}>{fmt(payments[m])}</span>
                    </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0 0", fontWeight: 700 }}>
                    <span style={{ color: "#94a3b8" }}>Total Due</span>
                    <span style={{ color: due > 0 ? "#f87171" : "#4ade80", fontSize: 14 }}>{fmt(Math.max(due, 0))}</span>
                </div>
            </div>
            {due > 0.01 && (
                <div style={{ background: "#422006", border: "1px solid #f9731644", borderRadius: 10, padding: 16, marginBottom: 16 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: showPayForm ? 14 : 0 }}>
                        <div>
                            <div style={{ color: "#fbbf24", fontWeight: 700, fontSize: 14 }}>Credit Due: {fmt(due)}</div>
                            <div style={{ color: "#94a3b8", fontSize: 12 }}>Collect partial or full payment</div>
                        </div>
                        {!showPayForm && <Btn variant="warning" icon="money" size="sm" onClick={() => setShowPayForm(true)}>Collect Payment</Btn>}
                    </div>
                    {showPayForm && (
                        <div>
                            <MultiPaymentInput payments={newPayments} onChange={setNewPayments} maxTotal={due} label="Collect Payment" />
                            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                                <Btn onClick={addPayment} disabled={saving || newPayTotal <= 0} variant="success" size="sm">{saving ? "Saving…" : `Collect ${fmt(newPayTotal)}`}</Btn>
                                <Btn variant="ghost" size="sm" onClick={() => { setShowPayForm(false); setNewPayments(Object.fromEntries(getPaymentMethodNames().map(m => [m, ""]))); }}>Cancel</Btn>
                            </div>
                        </div>
                    )}
                </div>
            )}
            <div style={{ display: "flex", gap: 10 }}>
                <Btn icon="receipt" onClick={() => setShowBill(true)}>Print Bill Receipt</Btn>
                <Btn variant="ghost" size="sm" onClick={onClose}>Close</Btn>
            </div>
        </Modal>
    );
}

// ─────────────────────────────────────────────
// QUICK ADD CUSTOMER
// ─────────────────────────────────────────────
function QuickAddCustomerModal({ onClose, onAdded }) {
    const [form, setForm] = useState({ name: "", phone: "", city: "", loyal: false, discount: 0, creditLimit: 0 });
    const [saving, setSaving] = useState(false);
    const f = k => e => setForm({ ...form, [k]: e.target.value });

    async function save() {
        if (!form.name || !form.phone) return;
        setSaving(true);
        try {
            const res = await addCustomer(form);
            if (res.success) { onAdded({ ...form, id: res.id || "new" }); onClose(); }
            else toast(res.error || "Failed.");
        } catch { toast("Network error."); }
        finally { setSaving(false); }
    }

    return (
        <Modal title="Quick Add Customer" onClose={onClose} width={440}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <Input label="Name" value={form.name} onChange={f("name")} required style={{ gridColumn: "1/-1" }} />
                <Input label="Phone" value={form.phone} onChange={f("phone")} required />
                <Input label="City" value={form.city} onChange={f("city")} />
                <Input label="Credit Limit (Rs)" type="number" value={form.creditLimit} onChange={f("creditLimit")} placeholder="0 = no limit" />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
                <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
                <Btn onClick={save} disabled={saving}>{saving ? "Saving…" : "Add Customer"}</Btn>
            </div>
        </Modal>
    );
}

// ─────────────────────────────────────────────
// ORDERS PAGE
// ─────────────────────────────────────────────
function OrdersPage() {
    const [view, setView] = useState("list");
    const [orders, setOrders] = useState([]);
    const [allProducts, setAllProducts] = useState([]);
    const [allCustomers, setAllCustomers] = useState([]);
    const [allSalesmen, setAllSalesmen] = useState([]);
    const [allStitchers, setAllStitchers] = useState([]);
    const [selectedStitcher, setSelectedStitcher] = useState("");
    const [clientStitchingCharge, setClientStitchingCharge] = useState(0);
    const [stitcherPay, setStitcherPay] = useState(0);
    const [loading, setLoading] = useState(true);
    const [cart, setCart] = useState([]);
    const [selectedCustomer, setSelectedCustomer] = useState("Walk-in Customer");
    const [selectedCustomerObj, setSelectedCustomerObj] = useState(null);
    const [selectedSalesman, setSelectedSalesman] = useState("");
    const [payments, setPayments] = useState(() => Object.fromEntries(getPaymentMethodNames().map(m => [m, ""])));
    const [discount, setDiscount] = useState(0);
    const [productSearch, setProductSearch] = useState("");
    const [showInvoice, setShowInvoice] = useState(false);
    const [lastOrder, setLastOrder] = useState(null);
    const [saving, setSaving] = useState(false);
    const [showQuickCustomer, setShowQuickCustomer] = useState(false);
    const [viewOrder, setViewOrder] = useState(null);
    const [creditLimitErr, setCreditLimitErr] = useState(null);
    const [showBillForOrder, setShowBillForOrder] = useState(null);
    const [scannerOpen, setScannerOpen] = useState(false);
    const [startDate, setStartDate] = useState("");
    const [endDate, setEndDate] = useState("");
    const [orderSearch, setOrderSearch] = useState("");
    const mountedRef = useRef(true);

    // Edit Mode State
    const [editOrderId, setEditOrderId] = useState(null);
    const [isEditMode, setIsEditMode] = useState(false);

    useEffect(() => { mountedRef.current = true; fetchAll(); return () => { mountedRef.current = false; }; }, []);

    async function fetchAll() {
        setLoading(true);
        try {
            const [oRes, pRes, cRes, sRes, stRes] = await Promise.all([getOrders(), getProducts(), getCustomers(), getSalesmen(), getStitchers()]);
            if (!mountedRef.current) return;
            if (oRes.success) setOrders(oRes.orders || []);
            if (pRes.success) setAllProducts(pRes.products || []);
            if (cRes.success) setAllCustomers(cRes.customers || []);
            if (sRes.success) setAllSalesmen(sRes.salesmen || []);
            else { setAllSalesmen([]); console.error("getSalesmen failed — salesman list unavailable:", sRes.error); }
            if (stRes.success) setAllStitchers((stRes.stitchers || []).filter(s => s.status === "active"));
        } catch (err) { console.error(err); }
        finally { if (mountedRef.current) setLoading(false); }
    }

    function handleCustomerChange(name) {
        setSelectedCustomer(name);
        const cust = allCustomers.find(c => c.name === name);
        setSelectedCustomerObj(cust || null);
        setDiscount(cust?.loyal && Number(cust.discount) > 0 ? Number(cust.discount) : 0);
        setCreditLimitErr(null);
    }

    const subtotal = cart.reduce((s, i) => s + i.qty * i.price, 0);
    const discountAmt = Math.round(subtotal * discount / 100);
    const total = subtotal - discountAmt + parseFloat(clientStitchingCharge || 0);
    const METHODS = getPaymentMethodNames();
    const totalPaid = METHODS.reduce((s, m) => s + (parseFloat(payments[m]) || 0), 0);
    const due = total - totalPaid;
    const creditDue = due > 0 ? due : 0;
    const paidOverTotal = totalPaid > total;
    const custCreditLimit = Number(selectedCustomerObj?.creditLimit || 0);
    const custExistingDue = selectedCustomerObj ? Math.abs(Math.min(0, Number(selectedCustomerObj.balance || 0))) : 0;
    const creditLimitExceeded = custCreditLimit > 0 && (custExistingDue + creditDue) > custCreditLimit;
    const stockExceededItems = cart.filter(i => Number(i.stock) >= 0 && i.qty > Number(i.stock));
    const stockExceeded = stockExceededItems.length > 0 && !isEditMode;
    const canSave = (cart.length > 0 || parseFloat(clientStitchingCharge) > 0) && !saving && !paidOverTotal && !creditLimitExceeded && !stockExceeded;

    const filteredOrders = orders.filter(o => {
        const d = String(o.date).trim();
        const matchDate = (!startDate || d >= startDate) && (!endDate || d <= endDate);
        const q = orderSearch.toLowerCase();
        const matchSearch = !q || o.id?.toLowerCase().includes(q) || o.customer?.toLowerCase().includes(q);
        return matchDate && matchSearch;
    });

    const todayStr = today();
    const todaySales = orders.filter(o => String(o.date).trim() === todayStr).reduce((s, o) => s + Number(o.total || 0), 0);
    const todayCount = orders.filter(o => String(o.date).trim() === todayStr).length;

    const handleQRScan = useCallback((product) => {
        setCart(prevCart => {
            const existing = prevCart.find(i => i.id === product.id);
            if (existing) return prevCart.map(i => i.id === existing.id ? { ...i, qty: i.qty + 1 } : i);
            return [...prevCart, { ...product, qty: 1, price: Number(product.sellingPrice), salesmanId: "", salesmanName: "", commissionType: "percent", commissionValue: "" }];
        });
    }, []);

    const addToCart = (product) => {
        setCart(prevCart => {
            const existing = prevCart.find(i => i.id === product.id);
            if (existing) return prevCart.map(i => i.id === existing.id ? { ...i, qty: i.qty + 1 } : i);
            return [...prevCart, { ...product, qty: 1, price: Number(product.sellingPrice), salesmanId: "", salesmanName: "", commissionType: "percent", commissionValue: "" }];
        });
        setProductSearch("");
    };

    const removeFromCart = (id) => setCart(cart.filter(i => i.id !== id));
    const updateQty = (id, qty) => qty < 1 ? removeFromCart(id) : setCart(cart.map(i => i.id === id ? { ...i, qty } : i));
    const updatePrice = (id, price) => setCart(cart.map(i => i.id === id ? { ...i, price: parseFloat(price) || 0 } : i));

    const updateItemSalesman = (id, salesmanId) => {
        const sm = allSalesmen.find(s => s.id === salesmanId || s.name === salesmanId);
        setCart(cart.map(i => i.id === id ? { ...i, salesmanId: salesmanId, salesmanName: sm?.name || "" } : i));
    };

    const updateItemCommissionType = (id, type) => {
        setCart(cart.map(i => i.id === id ? { ...i, commissionType: type, commissionValue: "" } : i));
    };

    const updateItemCommissionValue = (id, value) => {
        setCart(cart.map(i => i.id === id ? { ...i, commissionValue: value } : i));
    };

    // Load order for edit
    function loadOrderForEdit(order) {
        setIsEditMode(true);
        setEditOrderId(order.id);

        const cust = allCustomers.find(c => c.id === order.customerId || c.name === order.customer);
        if (cust) { handleCustomerChange(cust.name); setSelectedCustomerObj(cust); } else { setSelectedCustomer(order.customer || "Walk-in Customer"); setSelectedCustomerObj(null); }

        setSelectedSalesman(order.salesmanId || order.salesman || "");
        // Stitcher dropdown option values are stitcher NAMES, so pre-select by name
        // (using stitcherId here left the dropdown showing "No Stitcher" when editing).
        setSelectedStitcher(order.stitcher || "");
        setClientStitchingCharge(order.clientStitchingCharge || 0);
        setStitcherPay(order.stitcherPay || 0);
        setDiscount(order.discount || 0);

        let pmts = {};
        try { pmts = typeof order.payments === "string" ? JSON.parse(order.payments) : (order.payments || {}); } catch { /* malformed payments JSON */ }
        // Union today's configured methods with whatever methods this order actually used —
        // an order paid via a since-renamed/removed method would otherwise have that amount
        // silently dropped from the edit form (and never resubmitted on save).
        const pmtKeys = new Set([...getPaymentMethodNames(), ...Object.keys(pmts)]);
        setPayments(Object.fromEntries([...pmtKeys].map(m => [m, pmts[m] || ""])));

        let items = [];
        try { items = typeof order.items === "string" ? JSON.parse(order.items) : (order.items || []); } catch { /* malformed items JSON */ }
        setCart(items.map(item => ({
            ...item,
            id: item.productId || item.id,
            name: item.name || item.productName,
            qty: Number(item.qty) || 1,
            price: Number(item.price) || 0,
            salesmanId: item.salesmanId || "",
            salesmanName: item.salesmanName || "",
            commissionType: item.commissionType || "percent",
            commissionValue: item.commissionValue || "",
        })));

        setView("new");
    }

    // Save order
    async function saveOrder() {
        if (!canSave) return;
        setSaving(true); setCreditLimitErr(null);
        const customer = allCustomers.find(c => c.name === selectedCustomer);
        const sm = allSalesmen.find(s => s.name === selectedSalesman || s.id === selectedSalesman);
        const stitcherObj = allStitchers.find(s => s.name === selectedStitcher || s.id === selectedStitcher);

        const orderPayload = {
            customerId: customer?.id || "",
            customer: selectedCustomer,
            salesmanId: sm?.id || "",
            salesman: selectedSalesman,
            stitcherId: stitcherObj?.id || "",
            stitcher: stitcherObj?.name || "",
            clientStitchingCharge: parseFloat(clientStitchingCharge) || 0,
            stitcherPay: stitcherObj ? parseFloat(stitcherPay) || 0 : 0,
            stitchPieces: cart.reduce((s, i) => s + Number(i.qty || 1), 0),
            assignedBy: "user",
            items: cart.map(i => ({
                productId: i.id,
                name: i.name,
                qty: i.qty,
                price: i.price,
                salesmanId: i.salesmanId || "",
                salesmanName: i.salesmanName || "",
                commissionType: i.commissionType || "percent",
                commissionValue: i.commissionValue || "",
            })),
            payments,
            discount,
            total,
            paid: totalPaid,
            status: due > 0 ? "credit" : "paid",
            date: today(),
        };

        try {
            let res;
            if (isEditMode && editOrderId) {
                res = await updateOrderFull(editOrderId, orderPayload);
            } else {
                res = await createOrder(orderPayload);
            }

            if (!res.success) {
                if (res.creditLimitExceeded) setCreditLimitErr(res.error);
                else toast(res.error || "Failed to save order.");
                setSaving(false);
                return;
            }

            const orderId = res.orderId || editOrderId || "ORD-" + Date.now().toString().slice(-5);
            setLastOrder({ id: orderId, ...orderPayload, cart });
            setShowInvoice(true);
            setCart([]);
            setPayments(Object.fromEntries(getPaymentMethodNames().map(m => [m, ""])));
            setDiscount(0);
            setSelectedCustomer("Walk-in Customer");
            setSelectedCustomerObj(null);
            setSelectedSalesman("");
            setSelectedStitcher("");
            setClientStitchingCharge(0);
            setStitcherPay(0);
            setIsEditMode(false);
            setEditOrderId(null);
            await fetchAll();
        } catch { toast("Network or server error."); }
        finally { if (mountedRef.current) setSaving(false); }
    }

    function cancelEdit() {
        setIsEditMode(false);
        setEditOrderId(null);
        setCart([]);
        setPayments(Object.fromEntries(getPaymentMethodNames().map(m => [m, ""])));
        setDiscount(0);
        setSelectedCustomer("Walk-in Customer");
        setSelectedCustomerObj(null);
        setSelectedSalesman("");
        setSelectedStitcher("");
        setClientStitchingCharge(0);
        setStitcherPay(0);
        setView("list");
    }

    // Void (cancel) an order without a dedicated backend action: updateOrderFull re-reads the
    // stored order and reverses EVERYTHING it created (stock, customer balance, salesman
    // commission, stitcher earnings, ledger, payments) when we re-save it empty; then we flag
    // the row "cancelled" (updateOrderFull itself would force it back to paid/credit). The
    // record stays in the list for history — nothing is hard-deleted.
    async function voidOrder(order) {
        if (order.status === "cancelled") { toast("This order is already cancelled."); return; }
        if (!window.confirm(
            `Void order ${order.id}?\n\nThis reverses its stock, payments, customer balance, salesman commission and stitcher earnings. The order stays in the list marked "Cancelled". This cannot be undone.`
        )) return;
        try {
            const res = await updateOrderFull(order.id, {
                customerId: order.customerId || "",
                customer: order.customer || "Walk-in",
                salesmanId: "", salesman: "",
                stitcherId: "", stitcher: "",
                clientStitchingCharge: 0, stitcherPay: 0,
                items: [], payments: {}, discount: 0, total: 0, paid: 0,
            });
            if (!res.success) { toast(res.error || "Failed to void order."); return; }
            const statusRes = await updateOrder(order.id, { status: "cancelled" });
            if (!statusRes.success) toast("Order reversed, but marking it Cancelled failed: " + (statusRes.error || ""));
            await fetchAll();
        } catch { toast("Network error while voiding order."); }
    }

    const filteredProducts = allProducts.filter(p => productSearch && (p.name?.toLowerCase().includes(productSearch.toLowerCase()) || String(p.barcode ?? "").includes(productSearch)));
    const customerOptions = [{ value: "Walk-in Customer", label: "Walk-in Customer" }, ...allCustomers.map(c => ({ value: c.name, label: c.loyal ? `⭐ ${c.name} (${c.discount}% off)` : c.name }))];
    const salesmanOptions = [{ value: "", label: "— No Salesman —" }, ...allSalesmen.map(s => ({ value: s.id || s.name, label: `${s.name} (${s.commissionRate}%)` }))];

    if (view === "new") {
        return (
            <div style={{ padding: 24, display: "grid", gridTemplateColumns: "1fr 380px", gap: 16, alignItems: "start" }}>
                <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                        <Btn variant="ghost" size="sm" icon="arrowLeft" onClick={() => { if (isEditMode) cancelEdit(); else setView("list"); }}>
                            {isEditMode ? "Cancel Edit" : "Back"}
                        </Btn>
                        <h2 style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 16, margin: 0, fontFamily: "'Syne',sans-serif" }}>
                            {isEditMode ? `Edit Order #${editOrderId}` : "New Order"}
                        </h2>
                        {isEditMode && <Badge label="EDIT MODE" color="orange" />}
                    </div>
                    <Card style={{ marginBottom: 12 }}>
                        <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
                            <div style={{ flex: 1 }}>
                                <label style={{ color: "#94a3b8", fontSize: 12, fontWeight: 500, display: "block", marginBottom: 5 }}>Customer</label>
                                <select value={selectedCustomer} onChange={e => handleCustomerChange(e.target.value)}
                                    style={{ width: "100%", background: "#0f172a", border: "1px solid #334155", borderRadius: 8, padding: "9px 12px", color: "#f1f5f9", fontSize: 13, outline: "none", boxSizing: "border-box" }}>
                                    {customerOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                            </div>
                            <Btn size="sm" variant="ghost" icon="userPlus" onClick={() => setShowQuickCustomer(true)}>New</Btn>
                        </div>
                    </Card>
                    <Card style={{ marginBottom: 12 }}>
                        <Select label="Salesman (optional)" value={selectedSalesman} onChange={e => setSelectedSalesman(e.target.value)} options={salesmanOptions} />
                    </Card>
                    <Card style={{ marginBottom: 12 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "end" }}>
                            <Select label="Assign Stitcher (optional)" value={selectedStitcher} onChange={e => setSelectedStitcher(e.target.value)}
                                options={[{ value: "", label: "— No Stitcher —" }, ...allStitchers.map(s => ({ value: s.name, label: s.name }))]} />
                        </div>
                        {selectedStitcher && (
                            <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                                <div>
                                    <label style={{ color: "#94a3b8", fontSize: 12, fontWeight: 500, display: "block", marginBottom: 5 }}>Client Stitching Charge (to customer)</label>
                                    <input type="number" value={clientStitchingCharge} onChange={e => { const v = e.target.value; if (v === "" || parseFloat(v) >= 0) setClientStitchingCharge(v); }} min="0" placeholder="Rs"
                                        style={{ width: "100%", background: "#0f172a", border: "1px solid #60a5fa44", borderRadius: 8, padding: "9px 12px", color: "#60a5fa", fontSize: 13, outline: "none", boxSizing: "border-box" }} />
                                </div>
                                <div>
                                    <label style={{ color: "#94a3b8", fontSize: 12, fontWeight: 500, display: "block", marginBottom: 5 }}>Stitcher Pay (company expense)</label>
                                    <input type="number" value={stitcherPay} onChange={e => { const v = e.target.value; if (v === "" || parseFloat(v) >= 0) setStitcherPay(v); }} min="0" placeholder="Rs"
                                        style={{ width: "100%", background: "#0f172a", border: "1px solid #c084fc44", borderRadius: 8, padding: "9px 12px", color: "#c084fc", fontSize: 13, outline: "none", boxSizing: "border-box" }} />
                                </div>
                            </div>
                        )}
                        {selectedStitcher && (
                            <div style={{ marginTop: 8, padding: "6px 10px", background: "#2e106522", border: "1px solid #8b5cf633", borderRadius: 7, fontSize: 12, color: "#c084fc" }}>
                                <Icon name="scissors" size={12} /> Stitcher assigned: <strong>{selectedStitcher}</strong>
                            </div>
                        )}
                    </Card>
                    <Card style={{ marginBottom: 12 }}>
                        <div style={{ position: "relative" }}>
                            <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
                                <div style={{ flex: 1 }}>
                                    <Input label="Search / Scan Product" value={productSearch} onChange={e => setProductSearch(e.target.value)} placeholder="Product name or barcode…" />
                                </div>
                                <Btn size="sm" variant={scannerOpen ? "success" : "secondary"} icon="qrcode" onClick={() => setScannerOpen(s => !s)}>
                                    {scannerOpen ? "Scanner On" : "Scan QR"}
                                </Btn>
                            </div>
                            {filteredProducts.length > 0 && !scannerOpen && (
                                <div style={{ position: "absolute", left: 0, right: 0, top: "100%", background: "#1e293b", border: "1px solid #334155", borderRadius: 8, zIndex: 20, maxHeight: 200, overflowY: "auto" }}>
                                    {filteredProducts.map(p => (
                                        <div key={p.id} onClick={() => addToCart(p)} style={{ padding: "10px 14px", cursor: "pointer", borderBottom: "1px solid #1e293b", color: "#cbd5e1", fontSize: 13 }}>
                                            <strong>{p.name}</strong> — {fmt(p.sellingPrice)} <span style={{ color: "#64748b" }}>Stock: {p.stock}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        {scannerOpen && <ScannerPanel products={allProducts} onScan={handleQRScan} onClose={() => setScannerOpen(false)} />}
                    </Card>
                    <Card>
                        <h3 style={{ color: "#94a3b8", fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Cart Items {isEditMode && <span style={{ color: "#fbbf24", fontSize: 11, marginLeft: 8 }}>(editing)</span>}</h3>
                        {!cart.length ? <div style={{ color: "#475569", textAlign: "center", padding: 24, fontSize: 13 }}>No items added {isEditMode && " — click 'Cancel Edit' to discard changes"}</div> :
                            (
                                <div style={{ overflowX: "auto" }}>
                                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                                        <thead>
                                            <tr>
                                                {["Product", "Qty", "Price", "Salesman", "Commission", "Total", ""].map(h => <th key={h} style={{ padding: "8px 10px", color: "#64748b", fontWeight: 600, fontSize: 12, textAlign: "left", borderBottom: "1px solid #334155", whiteSpace: "nowrap" }}>{h}</th>)}
                                            </tr>
                                        </thead>
                                        <tbody>{cart.map(item => {
                                            const lineTotal = item.qty * item.price;
                                            const salesmanOpts = [{ value: "", label: "—" }, ...allSalesmen.map(s => ({ value: s.id || s.name, label: `${s.name} (${s.commissionRate}%)` }))];
                                            const overStock = !isEditMode && Number(item.stock) >= 0 && item.qty > Number(item.stock);
                                            return (
                                                <tr key={item.id} style={{ borderBottom: "1px solid #1e293b" }}>
                                                    <td style={{ padding: "8px 10px", color: "#f1f5f9" }}>{item.name}</td>
                                                    <td style={{ padding: "8px 10px" }}>
                                                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                                            <button onClick={() => updateQty(item.id, item.qty - 1)} style={{ width: 24, height: 24, borderRadius: 6, background: "#334155", border: "none", color: "#f1f5f9", cursor: "pointer" }}>-</button>
                                                            <span style={{ color: overStock ? "#f87171" : "#f1f5f9", minWidth: 20, textAlign: "center", fontWeight: overStock ? 700 : 400 }}>{item.qty}</span>
                                                            <button onClick={() => updateQty(item.id, item.qty + 1)} style={{ width: 24, height: 24, borderRadius: 6, background: "#334155", border: "none", color: "#f1f5f9", cursor: "pointer" }}>+</button>
                                                        </div>
                                                        {overStock && <div style={{ color: "#f87171", fontSize: 10, marginTop: 2, whiteSpace: "nowrap" }}>Only {item.stock} in stock</div>}
                                                    </td>
                                                    <td style={{ padding: "8px 10px" }}>
                                                        <input type="number" value={item.price} onChange={e => updatePrice(item.id, e.target.value)} style={{ width: 70, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, padding: "4px 8px", color: "#f1f5f9", fontSize: 12 }} />
                                                    </td>
                                                    <td style={{ padding: "8px 10px" }}>
                                                        <select value={item.salesmanId || ""} onChange={e => updateItemSalesman(item.id, e.target.value)}
                                                            style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, padding: "4px 6px", color: "#f1f5f9", fontSize: 11, outline: "none", minWidth: 100 }}>
                                                            {salesmanOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                                        </select>
                                                    </td>
                                                    <td style={{ padding: "8px 10px" }}>
                                                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                                            <select value={item.commissionType || "percent"} onChange={e => updateItemCommissionType(item.id, e.target.value)}
                                                                style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, padding: "4px 6px", color: "#f1f5f9", fontSize: 11, outline: "none" }}>
                                                                <option value="percent">%</option>
                                                                <option value="amount">Rs</option>
                                                            </select>
                                                            <input type="number" value={item.commissionValue || ""} onChange={e => updateItemCommissionValue(item.id, e.target.value)} placeholder="0"
                                                                style={{ width: 60, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, padding: "4px 6px", color: "#c084fc", fontSize: 11, outline: "none" }} />
                                                        </div>
                                                    </td>
                                                    <td style={{ padding: "8px 10px", color: "#60a5fa", fontWeight: 600 }}>{fmt(lineTotal)}</td>
                                                    <td style={{ padding: "8px 10px" }}>
                                                        <button onClick={() => removeFromCart(item.id)} style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer" }}><Icon name="x" size={14} /></button>
                                                    </td>
                                                </tr>
                                            );
                                        })}</tbody>
                                    </table>
                                </div>
                            )}
                    </Card>
                </div>
                <div>
                    <Card style={{ marginBottom: 12 }}>
                        <h3 style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 14, marginBottom: 14, fontFamily: "'Syne',sans-serif" }}>Payment {isEditMode && <span style={{ color: "#fbbf24", fontSize: 12 }}>(editing)</span>}</h3>
                        <div style={{ marginBottom: 12 }}>
                            <label style={{ color: "#94a3b8", fontSize: 12, fontWeight: 500, display: "block", marginBottom: 5 }}>Discount %</label>
                            <input type="number" value={discount} min="0" max="100" onChange={e => setDiscount(Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)))}
                                style={{ width: "100%", background: "#0f172a", border: "1px solid #334155", borderRadius: 8, padding: "9px 12px", color: "#f1f5f9", fontSize: 13, outline: "none", boxSizing: "border-box" }} />
                        </div>
                        <MultiPaymentInput payments={payments} onChange={setPayments} maxTotal={total} label="Payment (remaining = auto credit due)" />
                    </Card>
                    <Card style={{ marginBottom: 12 }}>
                        {[
                            ["Subtotal", fmt(subtotal)],
                            ["Discount", `- ${fmt(discountAmt)}`],
                            ["Client Stitching", fmt(clientStitchingCharge)],
                            ["Total", fmt(total)],
                            ["Paid", fmt(totalPaid)],
                            ["Credit Due", fmt(Math.max(due, 0))]
                        ].map(([label, val], i) => (
                            <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: i < 5 ? "1px solid #1e293b" : "none" }}>
                                <span style={{ color: "#94a3b8", fontSize: 13 }}>{label}</span>
                                <span style={{ color: i === 3 && due > 0 ? "#fbbf24" : i === 3 && due <= 0 ? "#4ade80" : "#f1f5f9", fontWeight: i === 3 ? 700 : 400, fontSize: i === 3 ? 16 : 13 }}>{val}</span>
                            </div>
                        ))}
                    </Card>
                    {paidOverTotal && (
                        <div style={{ background: "#450a0a22", border: "1px solid #ef4444", borderRadius: 8, padding: "10px 14px", marginBottom: 12, color: "#f87171", fontSize: 13 }}>
                            Paid amount exceeds order total. Please reduce payment.
                        </div>
                    )}
                    {creditLimitExceeded && (
                        <div style={{ background: "#450a0a22", border: "1px solid #ef4444", borderRadius: 8, padding: "10px 14px", marginBottom: 12, color: "#f87171", fontSize: 13 }}>
                            Credit limit exceeded for this customer.
                        </div>
                    )}
                    {stockExceeded && (
                        <div style={{ background: "#450a0a22", border: "1px solid #ef4444", borderRadius: 8, padding: "10px 14px", marginBottom: 12, color: "#f87171", fontSize: 13 }}>
                            {stockExceededItems.map(i => i.name).join(", ")} — quantity exceeds available stock.
                        </div>
                    )}
                    {creditLimitErr && <div style={{ background: "#450a0a22", border: "1px solid #ef4444", borderRadius: 8, padding: "10px 14px", marginBottom: 12, color: "#f87171", fontSize: 12 }}>{creditLimitErr}</div>}
                    <Btn onClick={saveOrder} size="lg" disabled={!canSave} style={{ width: "100%", justifyContent: "center" }}>
                        {saving ? "Saving…" :
                         paidOverTotal ? "Paid Exceeds Total" :
                         creditLimitExceeded ? "Credit Limit Exceeded" :
                         stockExceeded ? "Insufficient Stock" :
                         isEditMode ? "Update Order" : "Save Order"}
                    </Btn>
                    {isEditMode && <Btn variant="ghost" size="sm" onClick={cancelEdit} style={{ width: "100%", marginTop: 8, justifyContent: "center" }}>Cancel Edit</Btn>}
                </div>
            </div>
        );
    }

    return (
        <div style={{ padding: 24 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 12, marginBottom: 20 }}>
                <StatCard label="Today's Sales" value={fmt(todaySales)} icon="trending" color="green" sub={`${todayCount} orders — ${todayStr}`} />
                <StatCard label="Filtered Orders" value={fmtNum(filteredOrders.length)} icon="orders" color="blue" sub={startDate || endDate ? `${startDate || "…"} to ${endDate || "…"}` : "All time"} />
                <StatCard label="Filtered Revenue" value={fmt(filteredOrders.reduce((s, o) => s + Number(o.total || 0), 0))} icon="reports" color="purple" />
                <StatCard label="Filtered Paid" value={fmt(filteredOrders.reduce((s, o) => s + Number(o.paid || 0), 0))} icon="accounts" color="cyan" />
            </div>
            <Card>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
                    <h2 style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 16, margin: 0, fontFamily: "'Syne',sans-serif" }}>Orders</h2>
                    <input value={orderSearch} onChange={e => setOrderSearch(e.target.value)} placeholder="Search order ID or customer…"
                        style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 7, padding: "7px 10px", color: "#f1f5f9", fontSize: 12, outline: "none", width: 200 }} />
                    <div style={{ flex: 1 }} />
                    <Btn size="sm" variant="ghost" icon="refresh" onClick={fetchAll}>Refresh</Btn>
                    <Btn onClick={() => { setIsEditMode(false); setEditOrderId(null); setView("new"); }} icon="plus">New Order</Btn>
                </div>
                <DateRangeFilter startDate={startDate} endDate={endDate} onStartChange={setStartDate} onEndChange={setEndDate} onClear={() => { setStartDate(""); setEndDate(""); }} style={{ marginBottom: 16 }} />
                {loading ? <Spinner /> :
                    <Table
                        columns={[
                            { key: "id", label: "Order ID" }, { key: "date", label: "Date" }, { key: "customer", label: "Customer" },
                            { key: "salesman", label: "Salesman", render: v => v || <span style={{ color: "#475569" }}>—</span> },
                            { key: "stitcher", label: "Stitcher", render: v => v ? <span style={{ color: "#c084fc", fontSize: 12 }}><Icon name="scissors" size={11} /> {v}</span> : <span style={{ color: "#475569" }}>—</span> },
                            { key: "stitchStatus", label: "Stitch", render: v => v && v !== "none" ? <Badge label={v} color={v === "completed" ? "green" : v === "assigned" ? "purple" : "yellow"} /> : <span style={{ color: "#475569" }}>—</span> },
                            { key: "total", label: "Total", render: v => fmt(v) }, { key: "paid", label: "Paid", render: v => fmt(v) },
                            { key: "status", label: "Status", render: v => <OrderStatusBadge status={v} /> },
                        ]}
                        data={filteredOrders}
                        onView={row => setViewOrder(row)}
                        onEdit={row => loadOrderForEdit(row)}
                        onDelete={voidOrder}
                    />}
            </Card>
            {viewOrder && <OrderDetailModal order={viewOrder} onClose={() => setViewOrder(null)} onPaymentAdded={async () => { await fetchAll(); setViewOrder(null); }} />}
            {showBillForOrder && <BillReceiptModal order={showBillForOrder} onClose={() => setShowBillForOrder(null)} />}
            {showInvoice && lastOrder && (
                <Modal title={isEditMode ? "Order Updated!" : "Order Saved!"} onClose={() => { setShowInvoice(false); setView("list"); }} width={420}>
                    <div style={{ textAlign: "center", marginBottom: 20 }}>
                        <div style={{ width: 56, height: 56, background: "#052e16", border: "2px solid #4ade80", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
                            <Icon name="check" size={28} style={{ color: "#4ade80" }} />
                        </div>
                        <div style={{ color: "#4ade80", fontSize: 18, fontWeight: 700, fontFamily: "'Syne',sans-serif" }}>{isEditMode ? "Order Updated!" : "Order Saved!"}</div>
                        <div style={{ color: "#64748b", fontSize: 13, marginTop: 4 }}>Order ID: {lastOrder.id}</div>
                    </div>
                    <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                        <Btn icon="receipt" onClick={() => { setShowInvoice(false); setShowBillForOrder(lastOrder); }}>Print Bill Receipt</Btn>
                        <Btn variant="ghost" onClick={() => { setShowInvoice(false); setView("list"); }}>Done</Btn>
                    </div>
                </Modal>
            )}
            {showQuickCustomer && <QuickAddCustomerModal onClose={() => setShowQuickCustomer(false)} onAdded={(cust) => { setAllCustomers(prev => [...prev, cust]); handleCustomerChange(cust.name); }} />}
        </div>
    );
}

// ─────────────────────────────────────────────
// SUPPLIERS PAGE
// ─────────────────────────────────────────────
function SuppliersPage() {
    const [suppliers, setSuppliers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [showForm, setShowForm] = useState(false);
    const [editItem, setEditItem] = useState(null);
    const [viewSup, setViewSup] = useState(null);
    const [showPayModal, setShowPayModal] = useState(null);
    const [showReturnModal, setShowReturnModal] = useState(null);
    const [showLedger, setShowLedger] = useState(null);
    const [ledgerEntries, setLedgerEntries] = useState([]);
    const [ledgerLoading, setLedgerLoading] = useState(false);
    const blank = { name: "", phone: "", city: "", category: "" };
    const [form, setForm] = useState(blank);
    const payBlank = { amount: "", method: "Cash", note: "" };
    const [payForm, setPayForm] = useState(payBlank);
    const returnBlank = { productName: "", qty: "", price: "", reason: "" };
    const [returnForm, setReturnForm] = useState(returnBlank);
    const mountedRef = useRef(true);
    useEffect(() => { mountedRef.current = true; fetchSups(); return () => { mountedRef.current = false; }; }, []);
    async function fetchSups() {
        setLoading(true);
        try { const res = await getSuppliers(); if (!mountedRef.current) return; if (res.success) setSuppliers(res.suppliers || []); }
        catch (err) { console.error(err); }
        finally { if (mountedRef.current) setLoading(false); }
    }
    const f = k => e => setForm({ ...form, [k]: e.target.value });
    async function save() {
        if (!form.name) return;
        setSaving(true);
        try {
            const result = editItem ? await updateSupplier(editItem.id, form) : await addSupplier(form);
            if (result.success) { await fetchSups(); setShowForm(false); setForm(blank); setEditItem(null); }
            else toast(result.error || "Failed.");
        } catch { toast("Network error."); }
        finally { if (mountedRef.current) setSaving(false); }
    }
    async function del(row) {
        if (!window.confirm(`Delete supplier "${row.name}"?`)) return;
        try {
            const result = await deleteSupplier(row.id);
            if (result.success) await fetchSups();
            else toast(result.error || "Failed to delete.");
        } catch { toast("Network error."); }
    }
    async function openLedger(sup) {
        setShowLedger(sup); setLedgerLoading(true);
        try {
            const res = await getSupplierLedger({ supplierId: sup.id });
            if (res.success) setLedgerEntries(res.entries || []);
        } catch { /* network error, leave ledger empty */ }
        finally { setLedgerLoading(false); }
    }
    async function payNow() {
        if (!showPayModal || !(parseFloat(payForm.amount) > 0)) return;
        setSaving(true);
        try {
            const result = await addSupplierPayment({ supplierId: showPayModal.id, supplierName: showPayModal.name, amount: parseFloat(payForm.amount), method: payForm.method, note: payForm.note });
            if (result.success) { await fetchSups(); setShowPayModal(null); setPayForm(payBlank); }
            else toast(result.error || "Payment failed.");
        } catch { toast("Network error."); }
        finally { if (mountedRef.current) setSaving(false); }
    }
    async function submitReturn() {
        if (!showReturnModal || !returnForm.productName || !(Number(returnForm.qty) > 0) || !(Number(returnForm.price) >= 0)) return;
        setSaving(true);
        try {
            const result = await createSupplierReturn({
                supplierId: showReturnModal.id, supplierName: showReturnModal.name,
                items: [{ productName: returnForm.productName, qty: Number(returnForm.qty), price: Number(returnForm.price) }],
                reason: returnForm.reason,
            });
            if (result.success) { await fetchSups(); setShowReturnModal(null); setReturnForm(returnBlank); }
            else toast(result.error || "Return failed.");
        } catch { toast("Network error."); }
        finally { if (mountedRef.current) setSaving(false); }
    }
    return (
        <div style={{ padding: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
                <h2 style={{ flex: 1, color: "#f1f5f9", fontWeight: 700, fontSize: 16, margin: 0 }}>Suppliers</h2>
                <Btn size="sm" variant="ghost" icon="refresh" onClick={fetchSups}>Refresh</Btn>
                <Btn onClick={() => { setForm(blank); setEditItem(null); setShowForm(true); }} icon="plus">Add Supplier</Btn>
            </div>
            <Card>{loading ? <Spinner /> : <Table columns={[
                { key: "id", label: "ID" }, { key: "name", label: "Supplier Name" }, { key: "phone", label: "Phone" }, { key: "city", label: "City" }, { key: "category", label: "Category" },
                { key: "balance", label: "Balance", render: v => <span style={{ color: Number(v) < 0 ? "#f87171" : "#4ade80" }}>{fmt(Math.abs(v))}{Number(v) < 0 ? " (owed)" : ""}</span> },
            ]} data={suppliers}
                onEdit={row => { setForm({ name: row.name || "", phone: row.phone || "", city: row.city || "", category: row.category || "" }); setEditItem(row); setShowForm(true); }}
                onDelete={del}
                onView={row => setViewSup(row)}
            />}</Card>
            {showForm && (
                <Modal title={editItem ? "Edit Supplier" : "Add Supplier"} onClose={() => setShowForm(false)}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                        <Input label="Supplier Name" value={form.name} onChange={f("name")} required style={{ gridColumn: "1/-1" }} />
                        <Input label="Phone" value={form.phone} onChange={f("phone")} />
                        <Input label="City" value={form.city} onChange={f("city")} />
                        <Input label="Category" value={form.category} onChange={f("category")} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
                        <Btn variant="ghost" onClick={() => setShowForm(false)}>Cancel</Btn>
                        <Btn onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Btn>
                    </div>
                </Modal>
            )}
            {viewSup && (
                <Modal title={`Supplier — ${viewSup.name}`} onClose={() => setViewSup(null)} width={600}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 20 }}>
                        {[
                            ["Phone", viewSup.phone || "—"],
                            ["City", viewSup.city || "—"],
                            ["Category", viewSup.category || "—"],
                        ].map(([l, v]) => (
                            <div key={l} style={{ background: "#0f172a", borderRadius: 8, padding: "10px 14px" }}>
                                <div style={{ color: "#64748b", fontSize: 11 }}>{l}</div>
                                <div style={{ color: "#f1f5f9", fontWeight: 600, fontSize: 13 }}>{v}</div>
                            </div>
                        ))}
                        <div style={{ background: "#0f172a", borderRadius: 8, padding: "10px 14px" }}>
                            <div style={{ color: "#64748b", fontSize: 11 }}>Balance</div>
                            <div style={{ color: Number(viewSup.balance) < 0 ? "#f87171" : "#4ade80", fontWeight: 700, fontSize: 14 }}>
                                {fmt(Math.abs(viewSup.balance))}{Number(viewSup.balance) < 0 ? " (we owe)" : ""}
                            </div>
                        </div>
                    </div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <Btn variant="warning" icon="money" onClick={() => { setViewSup(null); setShowPayModal(viewSup); }}>Make Payment</Btn>
                        <Btn variant="ghost" icon="arrowLeft" onClick={() => { setViewSup(null); setShowReturnModal(viewSup); }}>Record Return</Btn>
                        <Btn variant="ghost" onClick={() => openLedger(viewSup)}>View Ledger</Btn>
                        <Btn variant="ghost" onClick={() => setViewSup(null)}>Close</Btn>
                    </div>
                </Modal>
            )}
            {showPayModal && (
                <Modal title={`Pay Supplier — ${showPayModal.name}`} onClose={() => setShowPayModal(null)} width={460}>
                    <div style={{ background: "#0f172a", borderRadius: 10, padding: 14, marginBottom: 16 }}>
                        <div style={{ color: "#64748b", fontSize: 11 }}>Current Balance</div>
                        <div style={{ color: Number(showPayModal.balance) < 0 ? "#f87171" : "#4ade80", fontWeight: 700, fontSize: 16 }}>
                            {fmt(Math.abs(showPayModal.balance))}{Number(showPayModal.balance) < 0 ? " (we owe)" : ""}
                        </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                        <Input label="Amount (Rs)" type="number" value={payForm.amount} onChange={e => setPayForm({ ...payForm, amount: e.target.value })} required />
                        <Select label="Payment Method" value={payForm.method} onChange={e => setPayForm({ ...payForm, method: e.target.value })} options={getPaymentMethodNames()} />
                        <Input label="Note" value={payForm.note} onChange={e => setPayForm({ ...payForm, note: e.target.value })} style={{ gridColumn: "1/-1" }} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
                        <Btn variant="ghost" onClick={() => setShowPayModal(null)}>Cancel</Btn>
                        <Btn onClick={payNow} disabled={saving || !(parseFloat(payForm.amount) > 0)}>{saving ? "Saving…" : "Process Payment"}</Btn>
                    </div>
                </Modal>
            )}
            {showReturnModal && (
                <Modal title={`Record Return — ${showReturnModal.name}`} onClose={() => setShowReturnModal(null)} width={460}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                        <Input label="Product Name" value={returnForm.productName} onChange={e => setReturnForm({ ...returnForm, productName: e.target.value })} required style={{ gridColumn: "1/-1" }} />
                        <Input label="Quantity" type="number" min="0" value={returnForm.qty} onChange={e => setReturnForm({ ...returnForm, qty: e.target.value })} required />
                        <Input label="Price per Unit (Rs)" type="number" min="0" value={returnForm.price} onChange={e => setReturnForm({ ...returnForm, price: e.target.value })} required />
                        <Input label="Reason (optional)" value={returnForm.reason} onChange={e => setReturnForm({ ...returnForm, reason: e.target.value })} style={{ gridColumn: "1/-1" }} />
                    </div>
                    <div style={{ marginTop: 12, padding: "8px 12px", background: "#1e3a5f22", border: "1px solid #3b82f644", borderRadius: 8, fontSize: 12, color: "#94a3b8" }}>
                        Returning stock to the supplier reduces what we owe them (or increases what they owe us) by {fmt(Number(returnForm.qty || 0) * Number(returnForm.price || 0))}.
                    </div>
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
                        <Btn variant="ghost" onClick={() => setShowReturnModal(null)}>Cancel</Btn>
                        <Btn onClick={submitReturn} disabled={saving || !returnForm.productName || !(Number(returnForm.qty) > 0)}>{saving ? "Saving…" : "Record Return"}</Btn>
                    </div>
                </Modal>
            )}
            {showLedger && (
                <Modal title={`Ledger — ${showLedger.name}`} onClose={() => setShowLedger(null)} width={720}>
                    {ledgerLoading ? <Spinner /> :
                        (
                            <div style={{ maxHeight: 400, overflowY: "auto" }}>
                                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                                    <thead>
                                        <tr>{["Date", "Type", "Description", "Debit", "Credit"].map(h => <th key={h} style={{ padding: "8px 12px", color: "#64748b", fontWeight: 600, fontSize: 11, textAlign: "left", borderBottom: "1px solid #334155", whiteSpace: "nowrap" }}>{h}</th>)}</tr>
                                    </thead>
                                    <tbody>
                                        {ledgerEntries.length === 0 && <tr><td colSpan={5} style={{ padding: 24, textAlign: "center", color: "#475569" }}>No ledger entries yet</td></tr>}
                                        {ledgerEntries.map((e, i) => (
                                            <tr key={i} style={{ borderBottom: "1px solid #1e293b" }}>
                                                <td style={{ padding: "8px 12px", color: "#94a3b8" }}>{e.date}</td>
                                                <td style={{ padding: "8px 12px" }}><Badge label={e.type} color={e.type === "purchase" ? "orange" : e.type === "supplierPayment" ? "blue" : "yellow"} /></td>
                                                <td style={{ padding: "8px 12px", color: "#cbd5e1", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.description}</td>
                                                <td style={{ padding: "8px 12px", color: "#f87171", fontWeight: 600 }}>{parseFloat(e.debit) > 0 ? fmt(e.debit) : "—"}</td>
                                                <td style={{ padding: "8px 12px", color: "#4ade80", fontWeight: 600 }}>{parseFloat(e.credit) > 0 ? fmt(e.credit) : "—"}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
                        <Btn variant="warning" onClick={() => { setShowLedger(null); setShowPayModal(showLedger); }}>Make Payment</Btn>
                        <Btn variant="ghost" onClick={() => setShowLedger(null)}>Close</Btn>
                    </div>
                </Modal>
            )}
        </div>
    );
}

// ─────────────────────────────────────────────
// INVENTORY PAGE
// ─────────────────────────────────────────────
function parseInventoryItems(v) {
    try { return typeof v === "string" ? JSON.parse(v || "[]") : (v || []); } catch { return []; }
}
function parsePaymentsMap(v) {
    try { return typeof v === "string" ? JSON.parse(v || "{}") : (v || {}); } catch { return {}; }
}

function InventoryPage() {
    const [entries, setEntries] = useState([]);
    const [allSuppliers, setAllSuppliers] = useState([]);
    const [allProducts, setAllProducts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [showForm, setShowForm] = useState(false);
    const [editItem, setEditItem] = useState(null);
    const [startDate, setStartDate] = useState("");
    const [endDate, setEndDate] = useState("");
    const blank = { supplierId: "", supplier: "", productId: "", product: "", qty: "", purchasePrice: "", payment: "Cash" };
    const [form, setForm] = useState(blank);
    const mountedRef = useRef(true);
    useEffect(() => { mountedRef.current = true; fetchAll(); return () => { mountedRef.current = false; }; }, []);
    async function fetchAll() {
        setLoading(true);
        try {
            const [invRes, supRes, proRes] = await Promise.all([getInventory(), getSuppliers(), getProducts()]);
            if (!mountedRef.current) return;
            if (invRes.success) setEntries(invRes.inventory || []);
            if (supRes.success) setAllSuppliers(supRes.suppliers || []);
            if (proRes.success) setAllProducts(proRes.products || []);
        } catch (err) { console.error(err); }
        finally { if (mountedRef.current) setLoading(false); }
    }
    const f = k => e => setForm({ ...form, [k]: e.target.value });
    const filtered = entries.filter(e => {
        const d = String(e.date).trim();
        return (!startDate || d >= startDate) && (!endDate || d <= endDate);
    });
    // The Add/Edit form only handles a single product line + single payment method per
    // entry, so only entries shaped that way (i.e. created through this same form) can
    // be edited here without silently dropping data. Others can still be deleted.
    function canEdit(row) {
        const items = parseInventoryItems(row.items);
        const methods = Object.keys(parsePaymentsMap(row.payments)).filter(k => Number(parsePaymentsMap(row.payments)[k]) > 0);
        return items.length <= 1 && methods.length <= 1;
    }
    async function save() {
        if (!form.product || !Number(form.qty) || Number(form.qty) <= 0 || Number(form.purchasePrice) < 0) return;
        setSaving(true);
        try {
            const total = Number(form.qty) * Number(form.purchasePrice);
            // Backend reads a `payments` map ({method: amount}), not a single `payment` string.
            // "Credit" means nothing was paid yet, so the full total becomes supplier due.
            const payments = form.payment === "Credit" ? {} : { [form.payment]: total };
            const payload = { supplierId: form.supplierId, supplier: form.supplier, items: [{ productId: form.productId, productName: form.product, qty: Number(form.qty), purchasePrice: Number(form.purchasePrice) }], payments, total };
            const result = editItem ? await updateInventory(editItem.id, payload) : await addInventory(payload);
            if (result.success) { await fetchAll(); setShowForm(false); setForm(blank); setEditItem(null); }
            else toast(result.error || "Failed.");
        } catch { toast("Network error."); }
        finally { if (mountedRef.current) setSaving(false); }
    }
    async function del(row) {
        if (!window.confirm(`Delete this inventory purchase (${row.id})? This will reverse the stock and supplier balance it added.`)) return;
        try {
            const result = await deleteInventory(row.id);
            if (result.success) await fetchAll();
            else toast(result.error || "Failed to delete.");
        } catch { toast("Network error."); }
    }
    function openEdit(row) {
        if (!canEdit(row)) { toast("This purchase has multiple products or split payments and can't be edited here — delete and re-add it instead."); return; }
        const items = parseInventoryItems(row.items);
        const item = items[0] || {};
        const methods = Object.entries(parsePaymentsMap(row.payments)).filter(([, amt]) => Number(amt) > 0);
        setForm({
            supplierId: row.supplierId || "", supplier: row.supplier || "",
            productId: item.productId || "", product: item.productName || "",
            qty: item.qty ?? "", purchasePrice: item.purchasePrice ?? "",
            payment: methods.length ? methods[0][0] : "Credit",
        });
        setEditItem(row);
        setShowForm(true);
    }
    return (
        <div style={{ padding: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                <h2 style={{ flex: 1, color: "#f1f5f9", fontWeight: 700, fontSize: 16, margin: 0 }}>Inventory / Stock In</h2>
                <Btn size="sm" variant="ghost" icon="refresh" onClick={fetchAll}>Refresh</Btn>
                <Btn onClick={() => { setForm(blank); setEditItem(null); setShowForm(true); }} icon="plus">Add Inventory</Btn>
            </div>
            <DateRangeFilter startDate={startDate} endDate={endDate} onStartChange={setStartDate} onEndChange={setEndDate} onClear={() => { setStartDate(""); setEndDate(""); }} style={{ marginBottom: 16 }} />
            <Card>{loading ? <Spinner /> : <Table columns={[
                { key: "id", label: "ID" }, { key: "date", label: "Date" }, { key: "supplier", label: "Supplier" },
                { key: "items", label: "Products", render: v => {
                    const items = parseInventoryItems(v);
                    return items.length ? items.map(it => `${it.productName || "?"} × ${it.qty}`).join(", ") : "—";
                } },
                { key: "total", label: "Total", render: v => fmt(v) },
                { key: "payments", label: "Payment", render: v => {
                    const p = parsePaymentsMap(v);
                    const methods = Object.keys(p).filter(k => Number(p[k]) > 0);
                    return methods.length ? methods.join(", ") : "Credit";
                } },
            ]} data={filtered}
                onEdit={openEdit}
                onDelete={del}
            />}</Card>
            {showForm && (
                <Modal title={editItem ? "Edit Inventory" : "Add Inventory"} onClose={() => setShowForm(false)}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                        <Select label="Supplier" value={form.supplierId} onChange={e => { const s = allSuppliers.find(x => x.id === e.target.value); setForm({ ...form, supplierId: e.target.value, supplier: s?.name || "" }); }} style={{ gridColumn: "1/-1" }}
                            options={[{ value: "", label: "Select Supplier" }, ...allSuppliers.map(s => ({ value: s.id, label: s.name }))]} />
                        <Select label="Product" value={form.productId} onChange={e => { const p = allProducts.find(x => x.id === e.target.value); setForm({ ...form, productId: e.target.value, product: p?.name || "", purchasePrice: p?.purchasePrice || "" }); }} style={{ gridColumn: "1/-1" }}
                            options={[{ value: "", label: "Select Product" }, ...allProducts.map(p => ({ value: p.id, label: p.name }))]} />
                        <Input label="Quantity" type="number" min="0" value={form.qty} onChange={f("qty")} />
                        <Input label="Purchase Price" type="number" min="0" value={form.purchasePrice} onChange={f("purchasePrice")} />
                        <Select label="Payment Method" value={form.payment} onChange={f("payment")} options={[...getPaymentMethodNames(), "Credit"]} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
                        <Btn variant="ghost" onClick={() => setShowForm(false)}>Cancel</Btn>
                        <Btn onClick={save} disabled={saving}>{saving ? "Saving…" : "Save Inventory"}</Btn>
                    </div>
                </Modal>
            )}
        </div>
    );
}

// ─────────────────────────────────────────────
// EXPENSES PAGE
// ─────────────────────────────────────────────
function ExpensesPage() {
    const [expenses, setExpenses] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [showForm, setShowForm] = useState(false);
    const [editItem, setEditItem] = useState(null);
    const [startDate, setStartDate] = useState("");
    const [endDate, setEndDate] = useState("");
    const blank = { category: "Rent", amount: "", payments: Object.fromEntries(getPaymentMethodNames().map(m => [m, ""])), note: "" };
    const [form, setForm] = useState(blank);
    const mountedRef = useRef(true);
    useEffect(() => { mountedRef.current = true; fetchExp(); return () => { mountedRef.current = false; }; }, []);
    async function fetchExp() {
        setLoading(true);
        try { const res = await getExpenses(); if (!mountedRef.current) return; if (res.success) setExpenses(res.expenses || []); }
        catch (err) { console.error(err); }
        finally { if (mountedRef.current) setLoading(false); }
    }
    const f = k => e => setForm({ ...form, [k]: e.target.value });
    const METHODS = getPaymentMethodNames();
    const payTotal = METHODS.reduce((s, m) => s + (parseFloat(form.payments[m]) || 0), 0);
    const filtered = expenses.filter(e => {
        const d = String(e.date).trim();
        return (!startDate || d >= startDate) && (!endDate || d <= endDate);
    });
    const total = filtered.reduce((s, e) => s + parseFloat(e.amount || 0), 0);
    async function save() {
        const amount = form.amount || payTotal;
        if (!amount) return;
        setSaving(true);
        try {
            const payload = { ...form, amount: parseFloat(amount) || payTotal, date: editItem ? (editItem.date || today()) : today() };
            const result = editItem ? await updateExpense(editItem.id, payload) : await addExpense(payload);
            if (result.success) { await fetchExp(); setShowForm(false); setForm(blank); setEditItem(null); }
            else toast(result.error || "Failed.");
        } catch { toast("Network error."); }
        finally { if (mountedRef.current) setSaving(false); }
    }
    async function del(row) {
        if (!window.confirm(`Delete this expense (${row.category}: ${fmt(row.amount)})?`)) return;
        try {
            const result = await deleteExpense(row.id);
            if (result.success) await fetchExp();
            else toast(result.error || "Failed to delete.");
        } catch { toast("Network error."); }
    }
    const parsePayments = (v) => {
        try { return typeof v === "string" ? (v.startsWith("{") ? JSON.parse(v) : { [v]: null }) : v; } catch { return {}; }
    };
    function openEdit(row) {
        const parsed = parsePayments(row.payments) || {};
        // Union today's configured methods with whatever method(s) this expense actually
        // used — an expense recorded via a since-renamed/removed method would otherwise
        // have that amount silently dropped from the edit form (and never resubmitted).
        const methodKeys = new Set([...getPaymentMethodNames(), ...Object.keys(parsed)]);
        const payments = Object.fromEntries([...methodKeys].map(m => [m, parsed[m] != null ? String(parsed[m]) : ""]));
        setForm({ category: row.category || "Rent", amount: row.amount != null ? String(row.amount) : "", payments, note: row.note || "" });
        setEditItem(row);
        setShowForm(true);
    }
    return (
        <div style={{ padding: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                <h2 style={{ flex: 1, color: "#f1f5f9", fontWeight: 700, fontSize: 16, margin: 0 }}>Expenses</h2>
                <div style={{ background: "#450a0a22", border: "1px solid #ef444444", borderRadius: 8, padding: "6px 14px", color: "#f87171", fontSize: 13, fontWeight: 600 }}>Total: {fmt(total)}</div>
                <Btn size="sm" variant="ghost" icon="refresh" onClick={fetchExp}>Refresh</Btn>
                <Btn onClick={() => { setForm(blank); setEditItem(null); setShowForm(true); }} icon="plus">Add Expense</Btn>
            </div>
            <DateRangeFilter startDate={startDate} endDate={endDate} onStartChange={setStartDate} onEndChange={setEndDate} onClear={() => { setStartDate(""); setEndDate(""); }} style={{ marginBottom: 16 }} />
            <Card>{loading ? <Spinner /> : <Table columns={[
                { key: "id", label: "ID" }, { key: "date", label: "Date" }, { key: "category", label: "Category" },
                { key: "amount", label: "Amount", render: v => fmt(v) },
                { key: "payments", label: "Payment", render: v => {
                    const p = parsePayments(v);
                    if (typeof p === "object") {
                        const methods = Object.entries(p).filter(([, amt]) => parseFloat(amt) > 0).map(([m, amt]) => `${m}: ${fmt(amt)}`);
                        return methods.length ? methods.join(", ") : (typeof v === "string" ? v : "—");
                    }
                    return v || "—";
                }},
                { key: "note", label: "Note" },
            ]} data={filtered}
                onEdit={openEdit}
                onDelete={del}
            />}</Card>
            {showForm && (
                <Modal title={editItem ? "Edit Expense" : "Add Expense"} onClose={() => setShowForm(false)}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
                        <Select label="Category" value={form.category} onChange={f("category")} options={["Salary", "Rent", "Fuel", "Electricity", "Internet", "Marketing", "Maintenance", "Other"]} />
                        <Input label="Total Amount (or auto from payments)" type="number" value={form.amount} onChange={f("amount")} placeholder={`Auto: ${payTotal}`} />
                        <Input label="Note" value={form.note} onChange={f("note")} style={{ gridColumn: "1/-1" }} />
                    </div>
                    <MultiPaymentInput payments={form.payments} onChange={p => setForm({ ...form, payments: p })} label="Split Payment Methods" />
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
                        <Btn variant="ghost" onClick={() => setShowForm(false)}>Cancel</Btn>
                        <Btn onClick={save} disabled={saving}>{saving ? "Saving…" : "Save Expense"}</Btn>
                    </div>
                </Modal>
            )}
        </div>
    );
}

// ─────────────────────────────────────────────
// SALESMEN PAGE (UPDATED with Salary Sheet)
// ─────────────────────────────────────────────
function SalesmenPage() {
    const [salesmen, setSalesmen] = useState([]);
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [showForm, setShowForm] = useState(false);
    const [editItem, setEditItem] = useState(null);
    const [viewSM, setViewSM] = useState(null);
    const [showPayModal, setShowPayModal] = useState(null);
    const blank = {
        name: "", phone: "", city: "", designation: "",
        commissionRate: 2, salary: 0, joiningDate: today(),
        status: "active", notes: ""
    };
    const [form, setForm] = useState(blank);

    const payBlank = { type: "salary", amount: "", month: thisMonth(), note: "", paymentMethod: "Cash" };
    const [payForm, setPayForm] = useState(payBlank);

    const mountedRef = useRef(true);

    useEffect(() => { mountedRef.current = true; fetchAll(); return () => { mountedRef.current = false; }; }, []);

    async function fetchAll() {
        setLoading(true);
        try {
            const [smRes, oRes] = await Promise.all([getSalesmen(), getOrders()]);
            if (!mountedRef.current) return;
            if (smRes.success) setSalesmen(smRes.salesmen || []); else { setSalesmen([]); console.error("getSalesmen failed — salesman list unavailable:", smRes.error); }
            if (oRes.success) setOrders(oRes.orders || []);
        } catch (err) { console.error(err); }
        finally { if (mountedRef.current) setLoading(false); }
    }

    const f = k => e => setForm({ ...form, [k]: e.target.value });

    async function saveSalesman() {
        if (!form.name) return;
        setSaving(true);
        try {
            const result = editItem ? await updateSalesman(editItem.id, form) : await addSalesman(form);
            if (result.success) { await fetchAll(); setShowForm(false); }
            else toast(result.error || "Failed.");
        } catch { toast("Network error."); }
        finally { if (mountedRef.current) setSaving(false); }
    }

    async function delSalesman(row) {
        if (!window.confirm(`Delete salesman "${row.name}"?`)) return;
        try {
            const result = await deleteSalesman(row.id);
            if (result.success) await fetchAll();
            else toast(result.error || "Failed.");
        } catch { toast("Network error."); }
    }

    async function payNow() {
        if (!showPayModal || !(parseFloat(payForm.amount) > 0)) return;
        setSaving(true);
        try {
            const result = await addSalesmanPayment({ salesmanId: showPayModal.id, salesmanName: showPayModal.name, ...payForm, amount: parseFloat(payForm.amount) });
            if (result.success) { await fetchAll(); setShowPayModal(null); setPayForm(payBlank); }
            else toast(result.error || "Payment failed.");
        } catch { toast("Network error."); }
        finally { if (mountedRef.current) setSaving(false); }
    }

    const getSmOrders = (sm) => orders.filter(o => o.salesman === sm.name || o.salesmanId === sm.id);

    return (
        <div style={{ padding: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
                <h2 style={{ flex: 1, color: "#f1f5f9", fontWeight: 700, fontSize: 16, margin: 0 }}>Salesmen</h2>
                <Btn size="sm" variant="ghost" icon="refresh" onClick={fetchAll}>Refresh</Btn>
                <Btn onClick={() => { setForm(blank); setEditItem(null); setShowForm(true); }} icon="plus">Add Salesman</Btn>
            </div>

            {loading ? <Spinner /> : (
                <Card>
                    <Table
                        columns={[
                            { key: "id", label: "ID" },
                            { key: "name", label: "Name" },
                            { key: "phone", label: "Phone" },
                            { key: "city", label: "City" },
                            { key: "designation", label: "Designation", render: v => v || <span style={{ color: "#475569" }}>—</span> },
                            { key: "salary", label: "Salary", render: v => fmt(v) },
                            { key: "commissionRate", label: "Commission", render: v => <Badge label={`${v}%`} color="purple" /> },
                            { key: "totalSales", label: "Total Sales", render: v => fmt(v) },
                            { key: "totalCommission", label: "Commission Earned", render: v => <span style={{ color: "#c084fc", fontWeight: 700 }}>{fmt(v)}</span> },
                            { key: "status", label: "Status", render: v => <Badge label={v || "active"} color={v === "active" ? "green" : "red"} /> },
                        ]}
                        data={salesmen}
                        onEdit={row => { setForm({ ...row }); setEditItem(row); setShowForm(true); }}
                        onDelete={delSalesman}
                        onView={row => setViewSM(row)}
                    />
                </Card>
            )}

            {/* Salesman Form Modal */}
            {showForm && (
                <Modal title={editItem ? "Edit Salesman" : "Add Salesman"} onClose={() => setShowForm(false)} width={600}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                        <Input label="Full Name" value={form.name} onChange={f("name")} required style={{ gridColumn: "1/-1" }} />
                        <Input label="Phone" value={form.phone} onChange={f("phone")} />
                        <Input label="City" value={form.city} onChange={f("city")} />
                        <Input label="Designation (Category)" value={form.designation} onChange={f("designation")} placeholder="e.g. Manager, Master, Helper" />
                        <Input label="Monthly Salary (Rs)" type="number" value={form.salary} onChange={f("salary")} />
                        <Input label="Commission Rate (%)" type="number" value={form.commissionRate} onChange={f("commissionRate")} />
                        <Input label="Joining Date" type="date" value={form.joiningDate} onChange={f("joiningDate")} />
                        <Select label="Status" value={form.status} onChange={f("status")} options={["active", "inactive", "resigned"]} />
                        <Input label="Notes" value={form.notes} onChange={f("notes")} style={{ gridColumn: "1/-1" }} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
                        <Btn variant="ghost" onClick={() => setShowForm(false)}>Cancel</Btn>
                        <Btn onClick={saveSalesman} disabled={saving}>{saving ? "Saving…" : "Save Salesman"}</Btn>
                    </div>
                </Modal>
            )}

            {/* View Salesman Modal */}
            {viewSM && (
                <Modal title={`Salesman — ${viewSM.name}`} onClose={() => setViewSM(null)} width={700}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 20 }}>
                        {[
                            ["Phone", viewSM.phone || "—"],
                            ["City", viewSM.city || "—"],
                            ["Designation", viewSM.designation || "—"],
                            ["Joining", viewSM.joiningDate || "—"],
                            ["Salary", fmt(viewSM.salary)],
                            ["Commission", `${viewSM.commissionRate}%`],
                            ["Status", viewSM.status || "active"]
                        ].map(([l, v]) => (
                            <div key={l} style={{ background: "#0f172a", borderRadius: 8, padding: "10px 14px" }}>
                                <div style={{ color: "#64748b", fontSize: 11 }}>{l}</div>
                                <div style={{ color: "#f1f5f9", fontWeight: 600, fontSize: 13 }}>{v}</div>
                            </div>
                        ))}
                    </div>
                    <Table columns={[
                        { key: "id", label: "Order ID" }, { key: "date", label: "Date" }, { key: "customer", label: "Customer" },
                        { key: "total", label: "Total", render: v => fmt(v) },
                        { key: "status", label: "Status", render: v => <OrderStatusBadge status={v} /> },
                    ]} data={getSmOrders(viewSM)} />
                    <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                        <Btn variant="warning" icon="money" onClick={() => { setViewSM(null); setShowPayModal(viewSM); }}>Make Payment</Btn>
                        <Btn variant="ghost" onClick={() => setViewSM(null)}>Close</Btn>
                    </div>
                </Modal>
            )}

            {/* Pay Salesman Modal */}
            {showPayModal && (
                <Modal title={`Pay — ${showPayModal.name}`} onClose={() => setShowPayModal(null)} width={480}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                        <Select label="Payment Type" value={payForm.type} onChange={e => setPayForm({ ...payForm, type: e.target.value })} options={[{ value: "salary", label: "Salary" }, { value: "commission", label: "Commission" }, { value: "bonus", label: "Bonus" }, { value: "advance", label: "Advance" }]} />
                        <Input label="Amount (Rs)" type="number" value={payForm.amount} onChange={e => setPayForm({ ...payForm, amount: e.target.value })} required />
                        <Input label="Month" type="month" value={payForm.month} onChange={e => setPayForm({ ...payForm, month: e.target.value })} />
                        <Select label="Payment Method" value={payForm.paymentMethod} onChange={e => setPayForm({ ...payForm, paymentMethod: e.target.value })} options={getPaymentMethodNames()} />
                        <Input label="Note" value={payForm.note} onChange={e => setPayForm({ ...payForm, note: e.target.value })} style={{ gridColumn: "1/-1" }} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
                        <Btn variant="ghost" onClick={() => setShowPayModal(null)}>Cancel</Btn>
                        <Btn onClick={payNow} disabled={saving || !payForm.amount}>{saving ? "Saving…" : "Process Payment"}</Btn>
                    </div>
                </Modal>
            )}

        </div>
    );
}

// ─────────────────────────────────────────────
// STITCHERS PAGE
// ─────────────────────────────────────────────
function StitchersPage() {
    const { user } = useApp();
    const [stitchers, setStitchers] = useState([]);
    const [stitchingRecords, setStitchingRecords] = useState([]);
    const [dashboardStats, setDashboardStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [tab, setTab] = useState("dashboard");
    const [showForm, setShowForm] = useState(false);
    const [editItem, setEditItem] = useState(null);
    const [viewSt, setViewSt] = useState(null);
    const [showPayModal, setShowPayModal] = useState(null);
    const [showLedger, setShowLedger] = useState(null);
    const [ledgerEntries, setLedgerEntries] = useState([]);
    const [ledgerLoading, setLedgerLoading] = useState(false);
    const [search, setSearch] = useState("");
    const [filterStatus, setFilterStatus] = useState("all");

    const blank = { name: "", phone: "", city: "", joiningDate: today(), status: "active", paymentMethod: "Cash", notes: "" };
    const [form, setForm] = useState(blank);
    const [payForm, setPayForm] = useState({ amount: "", month: thisMonth(), note: "", paymentMethod: "Cash" });
    const mountedRef = useRef(true);

    useEffect(() => { mountedRef.current = true; fetchAll(); return () => { mountedRef.current = false; }; }, []);

    async function fetchAll() {
        setLoading(true);
        try {
            const [stRes, osRes, dashRes] = await Promise.all([
                getStitchers(), getOrderStitching(), getStitcherDashboard()
            ]);
            if (!mountedRef.current) return;
            if (stRes.success) setStitchers(stRes.stitchers || []);
            if (osRes.success) setStitchingRecords(osRes.records || []);
            if (dashRes.success) setDashboardStats(dashRes);
        } catch (err) { console.error(err); }
        finally { if (mountedRef.current) setLoading(false); }
    }

    async function openLedger(st) {
        setShowLedger(st); setLedgerLoading(true);
        try {
            const res = await getStitcherLedger({ stitcherId: st.id });
            if (res.success) setLedgerEntries(res.entries || []);
        } catch { /* network error, leave ledger empty */ }
        finally { setLedgerLoading(false); }
    }

    const f = k => e => setForm({ ...form, [k]: e.target.value });

    async function save() {
        if (!form.name) return;
        setSaving(true);
        try {
            const result = editItem ? await updateStitcher(editItem.id, form) : await addStitcher(form);
            if (result.success) { await fetchAll(); setShowForm(false); }
            else toast(result.error || "Failed to save stitcher.");
        } catch { toast("Network error."); }
        finally { if (mountedRef.current) setSaving(false); }
    }

    async function del(row) {
        if (!window.confirm(`Delete stitcher "${row.name}"?`)) return;
        try {
            const result = await deleteStitcher(row.id);
            if (result.success) await fetchAll();
            else toast(result.error || "Failed.");
        } catch { toast("Network error."); }
    }

    async function payNow() {
        if (!showPayModal || !(parseFloat(payForm.amount) > 0)) return;
        setSaving(true);
        try {
            const result = await addStitcherPayment({ stitcherId: showPayModal.id, stitcherName: showPayModal.name, type: "payment", ...payForm, amount: parseFloat(payForm.amount) });
            if (result.success) { await fetchAll(); setShowPayModal(null); setPayForm({ amount: "", month: thisMonth(), note: "", paymentMethod: "Cash" }); }
            else toast(result.error || "Payment failed.");
        } catch { toast("Network error."); }
        finally { if (mountedRef.current) setSaving(false); }
    }

    const getStOrders = (st) => stitchingRecords.filter(r => String(r.stitcherId) === String(st.id));
    const getStPending = (st) => getStOrders(st).filter(r => r.status !== "completed").length;
    const getStCompleted = (st) => getStOrders(st).filter(r => r.status === "completed").length;

    const filtered = stitchers.filter(s => {
        const matchStatus = filterStatus === "all" || s.status === filterStatus;
        const matchSearch = !search || s.name?.toLowerCase().includes(search.toLowerCase()) || s.phone?.includes(search);
        return matchStatus && matchSearch;
    });

    const ds = dashboardStats;

    return (
        <div style={{ padding: 24 }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
                {[
                    { id: "dashboard", label: "Dashboard" },
                    { id: "list", label: "Stitchers" },
                    { id: "performance", label: "Performance" },
                    { id: "workload", label: "Workload" },
                ].map(t => (
                    <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: "8px 16px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, background: tab === t.id ? "linear-gradient(135deg,#8b5cf6,#3b82f6)" : "#1e293b", color: tab === t.id ? "#fff" : "#64748b" }}>
                        {t.label}
                    </button>
                ))}
                <div style={{ flex: 1 }} />
                <Btn size="sm" variant="ghost" icon="refresh" onClick={fetchAll}>Refresh</Btn>
                {(user?.role === "Admin" || user?.role === "Manager") && (
                    <Btn onClick={() => { setForm(blank); setEditItem(null); setShowForm(true); }} icon="plus">Add Stitcher</Btn>
                )}
            </div>
            {loading ? <Spinner /> :
                (
                    <>
                        {tab === "dashboard" && (
                            <div style={{ display: "grid", gap: 16 }}>
                                {ds && (
                                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: 12 }}>
                                        <StatCard label="Total Stitchers" value={fmtNum(ds.totalStitchers)} icon="scissors" color="purple" />
                                        <StatCard label="Active Stitchers" value={fmtNum(ds.activeStitchers)} icon="check" color="green" />
                                        <StatCard label="Pending Orders" value={fmtNum(ds.pendingOrders)} icon="orders" color="yellow" />
                                        <StatCard label="Completed Orders" value={fmtNum(ds.completedOrders)} icon="award" color="cyan" />
                                        <StatCard label="Total Earnings" value={fmt(ds.totalEarnings)} icon="trending" color="blue" />
                                        <StatCard label="Total Paid" value={fmt(ds.totalPaid)} icon="money" color="green" />
                                        <StatCard label="Outstanding" value={fmt(ds.totalBalance)} icon="alert" color={ds.totalBalance > 0 ? "orange" : "green"} />
                                    </div>
                                )}
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 12 }}>
                                    {stitchers.filter(s => s.status === "active").map(st => {
                                        const pending = getStPending(st);
                                        const completed = getStCompleted(st);
                                        const balance = parseFloat(st.balance) || 0;
                                        return (
                                            <div key={st.id} style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 14, padding: 18, transition: "transform 0.1s" }}>
                                                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                                                    <div style={{ width: 44, height: 44, borderRadius: 12, background: "linear-gradient(135deg,#8b5cf6,#3b82f6)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                                        <span style={{ color: "#fff", fontWeight: 700, fontSize: 18 }}>{st.name?.[0] || "S"}</span>
                                                    </div>
                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                        <div style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{st.name}</div>
                                                        <div style={{ fontSize: 11, color: "#64748b" }}>Pay per order</div>
                                                    </div>
                                                    <Badge label={st.status || "active"} color={st.status === "active" ? "green" : "red"} />
                                                </div>
                                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
                                                    {[
                                                        ["Pending", pending, "#fbbf24"],
                                                        ["Done", completed, "#4ade80"],
                                                        ["Bal.", fmt(balance), balance > 0 ? "#fb923c" : "#64748b"]
                                                    ].map(([l, v, c]) => (
                                                        <div key={l} style={{ background: "#0f172a", borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
                                                            <div style={{ color: "#64748b", fontSize: 10, marginBottom: 2 }}>{l}</div>
                                                            <div style={{ color: c, fontWeight: 700, fontSize: 13 }}>{v}</div>
                                                        </div>
                                                    ))}
                                                </div>
                                                <div style={{ display: "flex", gap: 6 }}>
                                                    <Btn size="sm" variant="warning" style={{ flex: 1, justifyContent: "center" }} onClick={() => setShowPayModal(st)}>Pay</Btn>
                                                    <Btn size="sm" variant="ghost" onClick={() => openLedger(st)}>Ledger</Btn>
                                                    <Btn size="sm" variant="ghost" icon="eye" onClick={() => setViewSt(st)} />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                        {tab === "list" && (
                            <div>
                                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
                                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search stitchers…"
                                        style={{ flex: 1, minWidth: 160, background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "9px 12px", color: "#f1f5f9", fontSize: 13, outline: "none" }} />
                                    <Select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                                        options={[{ value: "all", label: "All Status" }, { value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]} />
                                </div>
                                <Card>
                                    <Table
                                        columns={[
                                            { key: "id", label: "ID" },
                                            { key: "name", label: "Name" },
                                            { key: "phone", label: "Phone" },
                                            { key: "city", label: "City" },
                                            { key: "totalOrders", label: "Orders", render: v => fmtNum(v) },
                                            { key: "totalPieces", label: "Pieces", render: v => fmtNum(v) },
                                            { key: "totalEarnings", label: "Earned", render: v => <span style={{ color: "#4ade80", fontWeight: 700 }}>{fmt(v)}</span> },
                                            { key: "totalPaid", label: "Paid", render: v => fmt(v) },
                                            { key: "balance", label: "Balance", render: v => <span style={{ color: parseFloat(v) > 0 ? "#fb923c" : "#64748b", fontWeight: 700 }}>{fmt(v)}</span> },
                                            { key: "status", label: "Status", render: v => <Badge label={v || "active"} color={v === "active" ? "green" : "red"} /> },
                                        ]}
                                        data={filtered}
                                        onEdit={row => { setForm({ ...row }); setEditItem(row); setShowForm(true); }}
                                        onDelete={del}
                                        onView={row => setViewSt(row)}
                                    />
                                </Card>
                            </div>
                        )}
                        {tab === "performance" && (
                            <div>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 12 }}>
                                    {stitchers.map((st, idx) => {
                                        const stRecs = getStOrders(st);
                                        const completed = stRecs.filter(r => r.status === "completed").length;
                                        const pending = stRecs.filter(r => r.status !== "completed").length;
                                        const pieces = parseFloat(st.totalPieces) || 0;
                                        const earnings = parseFloat(st.totalEarnings) || 0;
                                        const rankColors = ["#fbbf24", "#94a3b8", "#fb923c"];
                                        return (
                                            <div key={st.id} style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 14, padding: 16 }}>
                                                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                                                    <div style={{ width: 32, height: 32, borderRadius: 8, background: "#0f172a", display: "flex", alignItems: "center", justifyContent: "center", border: `2px solid ${rankColors[idx] || "#334155"}` }}>
                                                        <span style={{ color: rankColors[idx] || "#64748b", fontWeight: 800, fontSize: 14 }}>#{idx + 1}</span>
                                                    </div>
                                                    <div>
                                                        <div style={{ color: "#f1f5f9", fontWeight: 700 }}>{st.name}</div>
                                                        <Badge label={st.status || "active"} color={st.status === "active" ? "green" : "red"} />
                                                    </div>
                                                    <Btn size="sm" variant="warning" style={{ marginLeft: "auto" }} onClick={() => setShowPayModal(st)}>Pay</Btn>
                                                </div>
                                                <div style={{ marginBottom: 10 }}>
                                                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#64748b", marginBottom: 4 }}>
                                                        <span>Completion Rate</span>
                                                        <span style={{ color: "#4ade80" }}>{stRecs.length > 0 ? Math.round(completed / stRecs.length * 100) : 0}%</span>
                                                    </div>
                                                    <div style={{ height: 6, background: "#0f172a", borderRadius: 4 }}>
                                                        <div style={{ height: "100%", width: (stRecs.length > 0 ? Math.round(completed / stRecs.length * 100) : 0) + "%", background: "linear-gradient(135deg,#8b5cf6,#3b82f6)", borderRadius: 4, transition: "width 0.5s" }} />
                                                    </div>
                                                </div>
                                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                                    {[
                                                        ["Completed", completed, "#4ade80"],
                                                        ["Pending", pending, "#fbbf24"],
                                                        ["Pieces", fmtNum(pieces), "#60a5fa"],
                                                        ["Earnings", fmt(earnings), "#c084fc"]
                                                    ].map(([l, v, c]) => (
                                                        <div key={l} style={{ background: "#0f172a", borderRadius: 8, padding: "8px 10px" }}>
                                                            <div style={{ color: "#64748b", fontSize: 11 }}>{l}</div>
                                                            <div style={{ color: c, fontWeight: 700, fontSize: 13 }}>{v}</div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                        {tab === "workload" && (
                            <Card>
                                <h3 style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 14, marginBottom: 16, fontFamily: "'Syne',sans-serif" }}>Active Stitching Orders</h3>
                                <Table
                                    columns={[
                                        { key: "orderId", label: "Order ID" },
                                        { key: "stitcherName", label: "Stitcher", render: v => <span style={{ color: "#c084fc" }}>{v}</span> },
                                        { key: "assignedAt", label: "Assigned", render: v => String(v).slice(0, 10) },
                                        { key: "pieces", label: "Pieces" },
                                        { key: "stitcherPay", label: "Stitcher Pay", render: v => fmt(v) },
                                        { key: "status", label: "Status", render: v => <Badge label={v} color={v === "completed" ? "green" : v === "in_progress" ? "yellow" : "purple"} /> },
                                        { key: "completedAt", label: "Completed", render: v => v ? String(v).slice(0, 10) : "—" },
                                    ]}
                                    data={stitchingRecords}
                                />
                            </Card>
                        )}
                    </>
                )}
            {showForm && (
                <Modal title={editItem ? "Edit Stitcher" : "Add Stitcher"} onClose={() => setShowForm(false)} width={600}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                        <Input label="Full Name" value={form.name} onChange={f("name")} required style={{ gridColumn: "1/-1" }} />
                        <Input label="Phone" value={form.phone} onChange={f("phone")} />
                        <Input label="City" value={form.city} onChange={f("city")} />
                        <Input label="Joining Date" type="date" value={form.joiningDate} onChange={f("joiningDate")} />
                        <Select label="Status" value={form.status} onChange={f("status")} options={[{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]} />
                        <Select label="Payment Method" value={form.paymentMethod} onChange={f("paymentMethod")} options={getPaymentMethodNames()} />
                        <Input label="Notes" value={form.notes} onChange={f("notes")} style={{ gridColumn: "1/-1" }} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
                        <Btn variant="ghost" onClick={() => setShowForm(false)}>Cancel</Btn>
                        <Btn onClick={save} disabled={saving}>{saving ? "Saving…" : "Save Stitcher"}</Btn>
                    </div>
                </Modal>
            )}
            {viewSt && (
                <Modal title={`Stitcher — ${viewSt.name}`} onClose={() => setViewSt(null)} width={700}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 20 }}>
                        {[
                            ["Phone", viewSt.phone || "—"],
                            ["City", viewSt.city || "—"],
                            ["Joining", viewSt.joiningDate || "—"],
                            ["Payment Method", viewSt.paymentMethod || "Cash"],
                            ["Status", viewSt.status || "active"],
                            ["Total Orders", fmtNum(viewSt.totalOrders)],
                            ["Total Pieces", fmtNum(viewSt.totalPieces)],
                            ["Total Earned", fmt(viewSt.totalEarnings)],
                            ["Total Paid", fmt(viewSt.totalPaid)],
                            ["Balance Payable", fmt(viewSt.balance)],
                            ["Notes", viewSt.notes || "—"]
                        ].map(([l, v]) => (
                            <div key={l} style={{ background: "#0f172a", borderRadius: 8, padding: "10px 14px" }}>
                                <div style={{ color: "#64748b", fontSize: 11 }}>{l}</div>
                                <div style={{ color: l === "Balance Payable" ? (parseFloat(viewSt.balance) > 0 ? "#fb923c" : "#64748b") : "#f1f5f9", fontWeight: 600, fontSize: 13 }}>{v}</div>
                            </div>
                        ))}
                    </div>
                    <h4 style={{ color: "#94a3b8", fontSize: 12, fontWeight: 600, marginBottom: 10, textTransform: "uppercase" }}>Stitching History</h4>
                    <Table columns={[
                        { key: "orderId", label: "Order" }, { key: "assignedAt", label: "Assigned", render: v => String(v).slice(0, 10) },
                        { key: "pieces", label: "Pieces" }, { key: "stitcherPay", label: "Stitcher Pay", render: v => fmt(v) },
                        { key: "status", label: "Status", render: v => <Badge label={v} color={v === "completed" ? "green" : "purple"} /> },
                    ]} data={getStOrders(viewSt)} />
                    <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                        <Btn variant="warning" icon="money" onClick={() => { setViewSt(null); setShowPayModal(viewSt); }}>Make Payment</Btn>
                        <Btn variant="ghost" onClick={() => openLedger(viewSt)}>View Ledger</Btn>
                        <Btn variant="ghost" icon="edit" onClick={() => { setForm({ ...viewSt }); setEditItem(viewSt); setViewSt(null); setShowForm(true); }}>Edit</Btn>
                        <Btn variant="ghost" onClick={() => setViewSt(null)}>Close</Btn>
                    </div>
                </Modal>
            )}
            {showPayModal && (
                <Modal title={`Payment — ${showPayModal.name}`} onClose={() => setShowPayModal(null)} width={500}>
                    <div style={{ background: "#0f172a", borderRadius: 10, padding: 14, marginBottom: 16 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                            {[
                                ["Earnings", fmt(showPayModal.totalEarnings)],
                                ["Paid", fmt(showPayModal.totalPaid)],
                                ["Balance", fmt(showPayModal.balance)]
                            ].map(([l, v]) => (
                                <div key={l}>
                                    <div style={{ color: "#64748b", fontSize: 11 }}>{l}</div>
                                    <div style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 14 }}>{v}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                        <Input label="Amount (Rs)" type="number" value={payForm.amount} onChange={e => setPayForm({ ...payForm, amount: e.target.value })} required />
                        <Input label="Month" type="month" value={payForm.month} onChange={e => setPayForm({ ...payForm, month: e.target.value })} />
                        <Select label="Payment Method" value={payForm.paymentMethod} onChange={e => setPayForm({ ...payForm, paymentMethod: e.target.value })} options={getPaymentMethodNames()} />
                        <Input label="Note" value={payForm.note} onChange={e => setPayForm({ ...payForm, note: e.target.value })} style={{ gridColumn: "1/-1" }} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
                        <Btn variant="ghost" onClick={() => setShowPayModal(null)}>Cancel</Btn>
                        <Btn onClick={payNow} disabled={saving || !payForm.amount}>{saving ? "Processing…" : "Process Payment"}</Btn>
                    </div>
                </Modal>
            )}
            {showLedger && (
                <Modal title={`Ledger — ${showLedger.name}`} onClose={() => setShowLedger(null)} width={720}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
                        {[
                            ["Total Earnings", fmt(showLedger.totalEarnings), "#4ade80"],
                            ["Total Paid", fmt(showLedger.totalPaid), "#60a5fa"],
                            ["Balance Due", fmt(showLedger.balance), parseFloat(showLedger.balance) > 0 ? "#fb923c" : "#64748b"]
                        ].map(([l, v, c]) => (
                            <div key={l} style={{ background: "#0f172a", borderRadius: 8, padding: "12px 14px" }}>
                                <div style={{ color: "#64748b", fontSize: 11, marginBottom: 4 }}>{l}</div>
                                <div style={{ color: c, fontWeight: 700, fontSize: 16 }}>{v}</div>
                            </div>
                        ))}
                    </div>
                    {ledgerLoading ? <Spinner /> :
                        (
                            <div style={{ maxHeight: 400, overflowY: "auto" }}>
                                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                                    <thead>
                                        <tr>{["Date", "Type", "Description", "Debit", "Credit"].map(h => <th key={h} style={{ padding: "8px 12px", color: "#64748b", fontWeight: 600, fontSize: 11, textAlign: "left", borderBottom: "1px solid #334155", whiteSpace: "nowrap" }}>{h}</th>)}</tr>
                                    </thead>
                                    <tbody>
                                        {ledgerEntries.length === 0 && <tr><td colSpan={5} style={{ padding: 24, textAlign: "center", color: "#475569" }}>No ledger entries yet</td></tr>}
                                        {ledgerEntries.map((e, i) => (
                                            <tr key={i} style={{ borderBottom: "1px solid #1e293b" }}>
                                                <td style={{ padding: "8px 12px", color: "#94a3b8" }}>{e.date}</td>
                                                <td style={{ padding: "8px 12px" }}><Badge label={e.type} color={e.type === "earning" ? "green" : e.type === "payment" ? "blue" : "cyan"} /></td>
                                                <td style={{ padding: "8px 12px", color: "#cbd5e1", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.description}</td>
                                                <td style={{ padding: "8px 12px", color: "#f87171", fontWeight: 600 }}>{parseFloat(e.debit) > 0 ? fmt(e.debit) : "—"}</td>
                                                <td style={{ padding: "8px 12px", color: "#4ade80", fontWeight: 600 }}>{parseFloat(e.credit) > 0 ? fmt(e.credit) : "—"}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
                        <Btn variant="warning" onClick={() => { setShowLedger(null); setShowPayModal(showLedger); }}>Make Payment</Btn>
                        <Btn variant="ghost" onClick={() => setShowLedger(null)}>Close</Btn>
                    </div>
                </Modal>
            )}
        </div>
    );
}

// ─────────────────────────────────────────────
// ASSETS PAGE
// ─────────────────────────────────────────────
function AssetsPage() {
    const [assets, setAssets] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [showForm, setShowForm] = useState(false);
    const [editItem, setEditItem] = useState(null);
    const [viewAsset, setViewAsset] = useState(null);
    const [showMaintForm, setShowMaintForm] = useState(null);
    const [tab, setTab] = useState("list");
    const blank = { name: "", category: "Equipment", purchaseDate: today(), purchasePrice: "", currentValue: "", location: "", condition: "Good", serialNo: "", vendor: "", warrantyExpiry: "", notes: "" };
    const [form, setForm] = useState(blank);
    const mBlank = { type: "Repair", cost: "", vendor: "", date: today(), nextDue: "", notes: "", paymentMethod: "Cash" };
    const [mForm, setMForm] = useState(mBlank);
    const mountedRef = useRef(true);
    useEffect(() => { mountedRef.current = true; fetchAssets(); return () => { mountedRef.current = false; }; }, []);
    async function fetchAssets() {
        setLoading(true);
        try { const res = await getAssets(); if (!mountedRef.current) return; if (res.success) setAssets(res.assets || []); }
        catch (err) { console.error(err); }
        finally { if (mountedRef.current) setLoading(false); }
    }
    const f = k => e => setForm({ ...form, [k]: e.target.value });
    const mf = k => e => setMForm({ ...mForm, [k]: e.target.value });
    async function save() {
        if (!form.name) return;
        setSaving(true);
        try {
            const result = editItem ? await updateAsset(editItem.id, form) : await addAsset(form);
            if (result.success) { await fetchAssets(); setShowForm(false); }
            else toast(result.error || "Failed.");
        } catch { toast("Network error."); }
        finally { if (mountedRef.current) setSaving(false); }
    }
    async function del(row) {
        if (!window.confirm(`Delete "${row.name}"?`)) return;
        try {
            const result = await deleteAsset(row.id);
            if (result.success) await fetchAssets();
            else toast(result.error || "Failed.");
        } catch { toast("Network error."); }
    }
    async function saveMaint() {
        if (!showMaintForm || !mForm.type) return;
        setSaving(true);
        try {
            const result = await addAssetMaintenance({ assetId: showMaintForm.id, assetName: showMaintForm.name, ...mForm });
            if (result.success) { await fetchAssets(); setShowMaintForm(null); setMForm(mBlank); }
            else toast(result.error || "Failed.");
        } catch { toast("Network error."); }
        finally { if (mountedRef.current) setSaving(false); }
    }
    const totalValue = assets.reduce((s, a) => s + Number(a.currentValue || a.purchasePrice || 0), 0);
    const totalCost = assets.reduce((s, a) => s + Number(a.purchasePrice || 0), 0);
    return (
        <div style={{ padding: 24 }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
                {["list", "summary"].map(t => (
                    <button key={t} onClick={() => setTab(t)} style={{ padding: "8px 16px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, background: tab === t ? "linear-gradient(135deg,#3b82f6,#8b5cf6)" : "#1e293b", color: tab === t ? "#fff" : "#64748b" }}>
                        {t === "list" ? "Assets" : "Summary"}
                    </button>
                ))}
                <div style={{ flex: 1 }} />
                <Btn size="sm" variant="ghost" icon="refresh" onClick={fetchAssets}>Refresh</Btn>
                <Btn onClick={() => { setForm(blank); setEditItem(null); setShowForm(true); }} icon="plus">Add Asset</Btn>
            </div>
            {loading ? <Spinner /> :
                (
                    <>
                        {tab === "summary" && (
                            <div>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 12, marginBottom: 20 }}>
                                    <StatCard label="Total Assets" value={fmtNum(assets.length)} icon="building" color="blue" />
                                    <StatCard label="Purchase Cost" value={fmt(totalCost)} icon="money" color="red" />
                                    <StatCard label="Current Value" value={fmt(totalValue)} icon="trending" color="green" />
                                    <StatCard label="Depreciation" value={fmt(totalCost - totalValue)} icon="alert" color="yellow" />
                                </div>
                            </div>
                        )}
                        {tab === "list" && (
                            <Card>
                                <Table
                                    columns={[
                                        { key: "id", label: "ID" }, { key: "name", label: "Asset Name" }, { key: "category", label: "Category" },
                                        { key: "purchaseDate", label: "Purchased" }, { key: "purchasePrice", label: "Cost", render: v => fmt(v) },
                                        { key: "currentValue", label: "Current Value", render: v => fmt(v) }, { key: "location", label: "Location" },
                                        { key: "condition", label: "Condition", render: v => <Badge label={v || "Good"} color={v === "Good" || v === "Excellent" ? "green" : v === "Fair" ? "yellow" : "red"} /> },
                                    ]}
                                    data={assets} onEdit={row => { setForm({ ...row }); setEditItem(row); setShowForm(true); }} onDelete={del} onView={row => setViewAsset(row)}
                                />
                            </Card>
                        )}
                    </>
                )}
            {showForm && (
                <Modal title={editItem ? "Edit Asset" : "Add Asset"} onClose={() => setShowForm(false)} width={640}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                        <Input label="Asset Name" value={form.name} onChange={f("name")} required style={{ gridColumn: "1/-1" }} />
                        <Select label="Category" value={form.category} onChange={f("category")} options={["Equipment", "Vehicle", "Furniture", "Electronics", "Building", "Land", "Software", "Other"]} />
                        <Input label="Location" value={form.location} onChange={f("location")} />
                        <Input label="Purchase Date" type="date" value={form.purchaseDate} onChange={f("purchaseDate")} />
                        <Input label="Purchase Price (Rs)" type="number" value={form.purchasePrice} onChange={f("purchasePrice")} />
                        <Input label="Current Value (Rs)" type="number" value={form.currentValue} onChange={f("currentValue")} />
                        <Select label="Condition" value={form.condition} onChange={f("condition")} options={["Excellent", "Good", "Fair", "Poor", "Damaged"]} />
                        <Input label="Serial Number" value={form.serialNo} onChange={f("serialNo")} />
                        <Input label="Vendor" value={form.vendor} onChange={f("vendor")} />
                        <Input label="Warranty Expiry" type="date" value={form.warrantyExpiry} onChange={f("warrantyExpiry")} />
                        <Input label="Notes" value={form.notes} onChange={f("notes")} style={{ gridColumn: "1/-1" }} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
                        <Btn variant="ghost" onClick={() => setShowForm(false)}>Cancel</Btn>
                        <Btn onClick={save} disabled={saving}>{saving ? "Saving…" : "Save Asset"}</Btn>
                    </div>
                </Modal>
            )}
            {viewAsset && (
                <Modal title={`Asset — ${viewAsset.name}`} onClose={() => setViewAsset(null)} width={600}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
                        {[
                            ["Category", viewAsset.category],
                            ["Location", viewAsset.location || "—"],
                            ["Purchased", viewAsset.purchaseDate],
                            ["Cost", fmt(viewAsset.purchasePrice)],
                            ["Current Value", fmt(viewAsset.currentValue || viewAsset.purchasePrice)],
                            ["Condition", viewAsset.condition]
                        ].map(([l, v]) => (
                            <div key={l} style={{ background: "#0f172a", borderRadius: 8, padding: "10px 14px" }}>
                                <div style={{ color: "#64748b", fontSize: 11 }}>{l}</div>
                                <div style={{ color: "#f1f5f9", fontWeight: 600, fontSize: 13 }}>{v}</div>
                            </div>
                        ))}
                    </div>
                    <div style={{ display: "flex", gap: 10 }}>
                        <Btn icon="tool" variant="warning" onClick={() => { setViewAsset(null); setShowMaintForm(viewAsset); }}>Add Maintenance</Btn>
                        <Btn variant="ghost" onClick={() => { setForm({ ...viewAsset }); setEditItem(viewAsset); setViewAsset(null); setShowForm(true); }} icon="edit">Edit</Btn>
                        <Btn variant="ghost" onClick={() => setViewAsset(null)}>Close</Btn>
                    </div>
                </Modal>
            )}
            {showMaintForm && (
                <Modal title={`Maintenance — ${showMaintForm.name}`} onClose={() => setShowMaintForm(null)} width={480}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                        <Select label="Type" value={mForm.type} onChange={mf("type")} options={["Repair", "Service", "Inspection", "Replacement", "Upgrade"]} />
                        <Input label="Cost (Rs)" type="number" value={mForm.cost} onChange={mf("cost")} />
                        <Input label="Vendor" value={mForm.vendor} onChange={mf("vendor")} />
                        <Select label="Payment Method" value={mForm.paymentMethod} onChange={mf("paymentMethod")} options={getPaymentMethodNames()} />
                        <Input label="Date" type="date" value={mForm.date} onChange={mf("date")} />
                        <Input label="Next Due Date" type="date" value={mForm.nextDue} onChange={mf("nextDue")} />
                        <Input label="Notes" value={mForm.notes} onChange={mf("notes")} style={{ gridColumn: "1/-1" }} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
                        <Btn variant="ghost" onClick={() => setShowMaintForm(null)}>Cancel</Btn>
                        <Btn onClick={saveMaint} disabled={saving}>{saving ? "Saving…" : "Save Maintenance"}</Btn>
                    </div>
                </Modal>
            )}
        </div>
    );
}

// ─────────────────────────────────────────────
// REPORTS PAGE
// ─────────────────────────────────────────────
function ReportsPage() {
    const [tab, setTab] = useState("sales");
    const [orders, setOrders] = useState([]);
    const [products, setProducts] = useState([]);
    const [customers, setCustomers] = useState([]);
    const [salesmen, setSalesmen] = useState([]);
    const [expenses, setExpenses] = useState([]);
    const [stitchers, setStitchers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [startDate, setStartDate] = useState("");
    const [endDate, setEndDate] = useState("");
    const mountedRef = useRef(true);

    useEffect(() => { mountedRef.current = true; fetchAll(); return () => { mountedRef.current = false; }; }, []);

    async function fetchAll() {
        setLoading(true);
        try {
            const [oRes, pRes, cRes, sRes, eRes, stRes] = await Promise.all([getOrders(), getProducts(), getCustomers(), getSalesmen(), getExpenses(), getStitchers()]);
            if (!mountedRef.current) return;
            if (oRes.success) setOrders(oRes.orders || []);
            if (pRes.success) setProducts(pRes.products || []);
            if (cRes.success) setCustomers(cRes.customers || []);
            if (sRes.success) setSalesmen(sRes.salesmen || []); else { setSalesmen([]); console.error("getSalesmen failed — salesman list unavailable:", sRes.error); }
            if (eRes.success) setExpenses(eRes.expenses || []);
            if (stRes.success) setStitchers(stRes.stitchers || []);
        } catch (err) { console.error(err); }
        finally { if (mountedRef.current) setLoading(false); }
    }

    const filteredOrders = orders.filter(o => {
        const d = String(o.date).trim();
        return (!startDate || d >= startDate) && (!endDate || d <= endDate);
    });
    const filteredExpenses = expenses.filter(e => {
        const d = String(e.date).trim();
        return (!startDate || d >= startDate) && (!endDate || d <= endDate);
    });

    const totalRevenue = filteredOrders.reduce((s, o) => s + Number(o.total || 0), 0);
    const totalPaidRevenue = filteredOrders.reduce((s, o) => s + Number(o.paid || 0), 0);
    const totalCredit = filteredOrders.reduce((s, o) => s + Math.max(0, Number(o.total || 0) - Number(o.paid || 0)), 0);
    const totalExpenses = filteredExpenses.reduce((s, e) => s + Number(e.amount || 0), 0);

    const productMap = {};
    products.forEach(p => { productMap[p.id] = p; });
    let estimatedCOGS = 0;
    filteredOrders.forEach(o => {
        let items = [];
        try { items = typeof o.items === "string" ? JSON.parse(o.items) : (o.items || []); } catch { /* malformed items JSON */ }
        items.forEach(item => {
            const prod = products.find(p => p.id === item.productId || p.name === item.name);
            if (prod) estimatedCOGS += Number(item.qty || 0) * Number(prod.purchasePrice || 0);
        });
    });
    const grossProfit = totalRevenue - estimatedCOGS;
    const netProfit = grossProfit - totalExpenses;

    const todayStr = today(), monthStr = thisMonth();
    const todaySales = orders.filter(o => String(o.date).trim() === todayStr).reduce((s, o) => s + Number(o.total || 0), 0);
    const monthlySales = orders.filter(o => String(o.date).startsWith(monthStr)).reduce((s, o) => s + Number(o.total || 0), 0);

    const last7 = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(); d.setDate(d.getDate() - (6 - i));
        const ds = d.toISOString().split("T")[0];
        const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        return { day: days[d.getDay()], sales: orders.filter(o => String(o.date).trim() === ds).reduce((s, o) => s + Number(o.total || 0), 0) };
    });

    const tabs = [{ id: "sales", label: "Sales" }, { id: "salesmen", label: "Salesman" }, { id: "stitchers", label: "Stitchers" }, { id: "products", label: "Products" }, { id: "customers", label: "Customers" }, { id: "profit", label: "Profit & Loss" }];

    return (
        <div style={{ padding: 24 }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
                {tabs.map(t => (
                    <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: "8px 16px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, background: tab === t.id ? "linear-gradient(135deg,#3b82f6,#8b5cf6)" : "#1e293b", color: tab === t.id ? "#fff" : "#64748b" }}>
                        {t.label}
                    </button>
                ))}
                <div style={{ flex: 1 }} />
                <Btn size="sm" variant="ghost" icon="refresh" onClick={fetchAll}>Refresh</Btn>
            </div>

            <DateRangeFilter startDate={startDate} endDate={endDate} onStartChange={setStartDate} onEndChange={setEndDate} onClear={() => { setStartDate(""); setEndDate(""); }} style={{ marginBottom: 16 }} />

            {loading ? <Spinner /> :
                (
                    <>
                        {tab === "sales" && (
                            <div style={{ display: "grid", gap: 16 }}>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 12 }}>
                                    <StatCard label="Today Sales" value={fmt(todaySales)} icon="trending" color="green" />
                                    <StatCard label="Monthly Sales" value={fmt(monthlySales)} icon="reports" color="blue" />
                                    <StatCard label="Filtered Revenue" value={fmt(totalRevenue)} icon="money" color="purple" sub={startDate || endDate ? "Filtered period" : "All time"} />
                                    <StatCard label="Total Orders" value={fmtNum(filteredOrders.length)} icon="orders" color="cyan" />
                                </div>
                                <Card><h3 style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 14, marginBottom: 16 }}>Last 7 Days</h3><MiniChart data={last7} /></Card>
                                <Card>
                                    <h3 style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 14, marginBottom: 16 }}>Orders</h3>
                                    <Table columns={[
                                        { key: "id", label: "Order ID" }, { key: "date", label: "Date" }, { key: "customer", label: "Customer" },
                                        { key: "salesman", label: "Salesman", render: v => v || <span style={{ color: "#475569" }}>—</span> },
                                        { key: "total", label: "Total", render: v => fmt(v) },
                                        { key: "status", label: "Status", render: v => <OrderStatusBadge status={v} /> },
                                    ]} data={filteredOrders} />
                                </Card>
                            </div>
                        )}
                        {tab === "salesmen" && (
                            <div>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 12, marginBottom: 20 }}>
                                    {salesmen.map(sm => {
                                        const smOrders = filteredOrders.filter(o => o.salesman === sm.name || o.salesmanId === sm.id);
                                        const smSales = smOrders.reduce((s, o) => s + Number(o.total || 0), 0);
                                        const smComm = Math.round(smSales * Number(sm.commissionRate || 0) / 100);
                                        return (
                                            <div key={sm.id} style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 12, padding: 16 }}>
                                                <div style={{ color: "#f1f5f9", fontWeight: 700, marginBottom: 8 }}>{sm.name}</div>
                                                <Badge label={`${sm.commissionRate}%`} color="purple" />
                                                <div style={{ marginTop: 10, fontSize: 13, color: "#94a3b8" }}>Orders: <strong style={{ color: "#f1f5f9" }}>{smOrders.length}</strong></div>
                                                <div style={{ fontSize: 13, color: "#94a3b8" }}>Sales: <strong style={{ color: "#4ade80" }}>{fmt(smSales)}</strong></div>
                                                <div style={{ fontSize: 13, color: "#94a3b8" }}>Commission: <strong style={{ color: "#c084fc" }}>{fmt(smComm)}</strong></div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                        {tab === "products" && (
                            <Card>
                                <Table columns={[
                                    { key: "name", label: "Product" }, { key: "category", label: "Category" },
                                    { key: "sellingPrice", label: "Price", render: v => fmt(v) }, { key: "purchasePrice", label: "Cost", render: v => fmt(v) },
                                    { key: "stock", label: "Stock" },
                                    { key: "sellingPrice", label: "Profit/Unit", render: (v, row) => <span style={{ color: "#4ade80" }}>{fmt(Number(row.sellingPrice) - Number(row.purchasePrice))}</span> },
                                ]} data={products} />
                            </Card>
                        )}
                        {tab === "stitchers" && (
                            <div style={{ display: "grid", gap: 16 }}>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 12 }}>
                                    <StatCard label="Total Stitchers" value={fmtNum(stitchers.length)} icon="scissors" color="purple" />
                                    <StatCard label="Active" value={fmtNum(stitchers.filter(s => s.status === "active").length)} icon="check" color="green" />
                                    <StatCard label="Total Earnings" value={fmt(stitchers.reduce((s, st) => s + (parseFloat(st.totalEarnings) || 0), 0))} icon="money" color="blue" />
                                    <StatCard label="Outstanding Balance" value={fmt(stitchers.reduce((s, st) => s + (parseFloat(st.balance) || 0), 0))} icon="alert" color="orange" />
                                </div>
                                <Card>
                                    <h3 style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 14, marginBottom: 16 }}>Stitcher Performance Report</h3>
                                    <Table columns={[
                                        { key: "name", label: "Stitcher", render: v => <span style={{ color: "#c084fc", fontWeight: 600 }}>{v}</span> },
                                        { key: "totalOrders", label: "Orders", render: v => fmtNum(v) },
                                        { key: "totalPieces", label: "Pieces", render: v => fmtNum(v) },
                                        { key: "totalEarnings", label: "Total Earned", render: v => <span style={{ color: "#4ade80", fontWeight: 700 }}>{fmt(v)}</span> },
                                        { key: "totalPaid", label: "Paid", render: v => fmt(v) },
                                        { key: "balance", label: "Balance", render: v => <span style={{ color: parseFloat(v) > 0 ? "#fb923c" : "#64748b", fontWeight: 700 }}>{fmt(v)}</span> },
                                        { key: "status", label: "Status", render: v => <Badge label={v || "active"} color={v === "active" ? "green" : "red"} /> },
                                    ]} data={stitchers} />
                                </Card>
                                <Card>
                                    <h3 style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 14, marginBottom: 14 }}>Stitching Cost Impact</h3>
                                    {(() => {
                                        const stitchOrders = filteredOrders.filter(o => o.stitcher);
                                        const stitchRevenue = stitchOrders.reduce((s, o) => s + (parseFloat(o.clientStitchingCharge) || 0), 0);
                                        const stitchExpense = stitchOrders.reduce((s, o) => s + (parseFloat(o.stitcherPay) || 0), 0);
                                        return (
                                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                                                {[
                                                    ["Stitched Orders", stitchOrders.length, "#c084fc"],
                                                    ["Client Charge Revenue", fmt(stitchRevenue), "#60a5fa"],
                                                    ["Stitcher Expense", fmt(stitchExpense), "#f87171"]
                                                ].map(([l, v, c]) => (
                                                    <div key={l} style={{ background: "#0f172a", borderRadius: 10, padding: 14 }}>
                                                        <div style={{ color: "#64748b", fontSize: 12, marginBottom: 4 }}>{l}</div>
                                                        <div style={{ color: c, fontWeight: 700, fontSize: 16 }}>{v}</div>
                                                    </div>
                                                ))}
                                            </div>
                                        );
                                    })()}
                                </Card>
                            </div>
                        )}
                        {tab === "customers" && (
                            <Card>
                                <Table columns={[
                                    { key: "name", label: "Customer" }, { key: "phone", label: "Phone" },
                                    { key: "loyal", label: "Loyalty", render: (v, row) => v ? <Badge label={`${row.discount}% off`} color="purple" /> : "—" },
                                    { key: "creditLimit", label: "Credit Limit", render: v => Number(v) > 0 ? <Badge label={fmt(v)} color="cyan" /> : "No limit" },
                                    { key: "balance", label: "Balance", render: v => <span style={{ color: Number(v) < 0 ? "#f87171" : "#4ade80" }}>{fmt(Math.abs(v))}</span> },
                                ]} data={customers} />
                            </Card>
                        )}
                        {tab === "profit" && (
                            <div style={{ display: "grid", gap: 16 }}>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 12 }}>
                                    <StatCard label="Total Revenue" value={fmt(totalRevenue)} icon="trending" color="green" sub="All orders" />
                                    <StatCard label="Cash Collected" value={fmt(totalPaidRevenue)} icon="accounts" color="blue" sub="Paid orders" />
                                    <StatCard label="Est. COGS" value={fmt(estimatedCOGS)} icon="package" color="red" sub="Purchase cost of sold items" />
                                    <StatCard label="Total Expenses" value={fmt(totalExpenses)} icon="expenses" color="orange" />
                                    <StatCard label="Stitching Cost" value={fmt(filteredOrders.reduce((s, o) => s + (parseFloat(o.stitcherPay) || 0), 0))} icon="scissors" color="purple" sub="Paid to stitchers" />
                                    <StatCard label="Gross Profit" value={fmt(grossProfit)} icon="reports" color={grossProfit >= 0 ? "green" : "red"} sub="Revenue - COGS" />
                                    <StatCard label="Net Profit" value={fmt(netProfit)} icon="money" color={netProfit >= 0 ? "cyan" : "red"} sub="Gross - Expenses" />
                                </div>
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                                    <Card>
                                        <h3 style={{ color: "#4ade80", fontWeight: 700, fontSize: 14, marginBottom: 14 }}>Income</h3>
                                        {[
                                            ["Sales Revenue", totalRevenue],
                                            ["Cash Collected", totalPaidRevenue],
                                            ["Credit Receivable", totalCredit]
                                        ].map(([l, v]) => (
                                            <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #1e293b", fontSize: 13 }}>
                                                <span style={{ color: "#94a3b8" }}>{l}</span>
                                                <span style={{ color: "#4ade80", fontWeight: 600 }}>{fmt(v)}</span>
                                            </div>
                                        ))}
                                    </Card>
                                    <Card>
                                        <h3 style={{ color: "#f87171", fontWeight: 700, fontSize: 14, marginBottom: 14 }}>Expenditure</h3>
                                        {[
                                            ["Est. COGS", estimatedCOGS],
                                            ["Total Expenses", totalExpenses],
                                            ["Total Cost", estimatedCOGS + totalExpenses]
                                        ].map(([l, v]) => (
                                            <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #1e293b", fontSize: 13 }}>
                                                <span style={{ color: "#94a3b8" }}>{l}</span>
                                                <span style={{ color: "#f87171", fontWeight: 600 }}>{fmt(v)}</span>
                                            </div>
                                        ))}
                                        <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0 0", fontWeight: 700 }}>
                                            <span style={{ color: netProfit >= 0 ? "#4ade80" : "#f87171" }}>Net Profit</span>
                                            <span style={{ color: netProfit >= 0 ? "#4ade80" : "#f87171", fontSize: 15 }}>{fmt(netProfit)}</span>
                                        </div>
                                    </Card>
                                </div>
                                <Card>
                                    <h3 style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 14, marginBottom: 14 }}>Expense Breakdown</h3>
                                    {(() => {
                                        const byCategory = {};
                                        filteredExpenses.forEach(e => { byCategory[e.category] = (byCategory[e.category] || 0) + Number(e.amount || 0); });
                                        return Object.entries(byCategory).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => (
                                            <div key={cat} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #1e293b" }}>
                                                <span style={{ color: "#f1f5f9", fontSize: 13 }}>{cat}</span>
                                                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                                                    <div style={{ width: 80, height: 6, background: "#1e293b", borderRadius: 4, overflow: "hidden" }}>
                                                        <div style={{ height: "100%", width: Math.min(100, amt / totalExpenses * 100) + "%", background: "linear-gradient(135deg,#3b82f6,#8b5cf6)", borderRadius: 4 }} />
                                                    </div>
                                                    <span style={{ color: "#f87171", fontSize: 13, fontWeight: 600, minWidth: 80, textAlign: "right" }}>{fmt(amt)}</span>
                                                </div>
                                            </div>
                                        ));
                                    })()}
                                </Card>
                            </div>
                        )}
                    </>
                )}
        </div>
    );
}

// ─────────────────────────────────────────────
// ACCOUNTS PAGE
// ─────────────────────────────────────────────
function AccountsPage() {
    const [tab, setTab] = useState("balance");
    const [orders, setOrders] = useState([]);
    const [expenses, setExpenses] = useState([]);
    const [ledgerEntries, setLedgerEntries] = useState([]);
    const [loading, setLoading] = useState(true);
    const [startDate, setStartDate] = useState("");
    const [endDate, setEndDate] = useState("");
    const mountedRef = useRef(true);

    useEffect(() => { mountedRef.current = true; fetchAll(); return () => { mountedRef.current = false; }; }, []);

    async function fetchAll() {
        setLoading(true);
        try {
            const [oRes, eRes, lRes] = await Promise.all([getOrders(), getExpenses(), getLedger()]);
            if (!mountedRef.current) return;
            if (oRes.success) setOrders(oRes.orders || []);
            if (eRes.success) setExpenses(eRes.expenses || []);
            if (lRes.success) setLedgerEntries(lRes.entries || []);
        } catch (err) { console.error(err); }
        finally { if (mountedRef.current) setLoading(false); }
    }

    const filteredOrders = orders.filter(o => {
        const d = String(o.date).trim();
        return (!startDate || d >= startDate) && (!endDate || d <= endDate);
    });
    const filteredExpenses = expenses.filter(e => {
        const d = String(e.date).trim();
        return (!startDate || d >= startDate) && (!endDate || d <= endDate);
    });
    const filteredLedger = ledgerEntries
        .filter(e => {
            const d = String(e.date).trim();
            return (!startDate || d >= startDate) && (!endDate || d <= endDate);
        })
        .sort((a, b) => String(b.date).localeCompare(String(a.date)));

    const totalRevenue = filteredOrders.reduce((s, o) => s + Number(o.total || 0), 0);
    const totalCollected = filteredOrders.reduce((s, o) => s + Number(o.paid || 0), 0);
    const creditReceivable = filteredOrders.filter(o => o.status === "credit").reduce((s, o) => s + Math.max(0, Number(o.total || 0) - Number(o.paid || 0)), 0);
    const totalExpenses = filteredExpenses.reduce((s, e) => s + Number(e.amount || 0), 0);

    const METHODS = getPaymentMethodNames();

    function getMethodInflow(method) {
        return filteredOrders.reduce((s, o) => {
            let pmts = {};
            try { pmts = typeof o.payments === "string" ? JSON.parse(o.payments) : (o.payments || {}); } catch { /* malformed payments JSON */ }
            return s + (parseFloat(pmts[method]) || 0);
        }, 0);
    }

    function getMethodOutflow(method) {
        return filteredExpenses.reduce((s, e) => {
            let pmts = {};
            try { pmts = typeof e.payments === "string" ? (e.payments.startsWith("{") ? JSON.parse(e.payments) : {}) : (e.payments || {}); } catch { /* malformed payments JSON */ }
            let amt = parseFloat(pmts[method]) || 0;
            if (!amt && e.payments === method) amt = parseFloat(e.amount) || 0;
            return s + amt;
        }, 0);
    }

    const customMethods = getPaymentMethodsConfig();
    const allMethodNames = [...new Set([...METHODS, ...customMethods.map(m => m.name)])];

    const tabs = [{ id: "balance", label: "Balance Sheet" }, { id: "ledger", label: "Ledger" }, { id: "moneyflow", label: "Money Flow" }];

    return (
        <div style={{ padding: 24 }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                {tabs.map(t => <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: "8px 16px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, background: tab === t.id ? "linear-gradient(135deg,#3b82f6,#8b5cf6)" : "#1e293b", color: tab === t.id ? "#fff" : "#64748b" }}>{t.label}</button>)}
                <div style={{ flex: 1 }} />
                <Btn size="sm" variant="ghost" icon="refresh" onClick={fetchAll}>Refresh</Btn>
            </div>

            <DateRangeFilter startDate={startDate} endDate={endDate} onStartChange={setStartDate} onEndChange={setEndDate} onClear={() => { setStartDate(""); setEndDate(""); }} style={{ marginBottom: 16 }} />

            {loading ? <Spinner /> :
                (
                    <>
                        {tab === "balance" && (
                            <div style={{ display: "grid", gap: 16 }}>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 12 }}>
                                    <StatCard label="Total Revenue" value={fmt(totalRevenue)} icon="trending" color="green" />
                                    <StatCard label="Cash Collected" value={fmt(totalCollected)} icon="accounts" color="blue" />
                                    <StatCard label="Credit Receivable" value={fmt(creditReceivable)} icon="alert" color="yellow" />
                                    <StatCard label="Total Expenses" value={fmt(totalExpenses)} icon="expenses" color="red" />
                                </div>
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                                    <Card>
                                        <h3 style={{ color: "#4ade80", fontWeight: 700, fontSize: 14, marginBottom: 14, fontFamily: "'Syne',sans-serif" }}>Assets</h3>
                                        {[
                                            ["Sales Revenue", totalRevenue],
                                            ["Cash Collected", totalCollected],
                                            ["Credit Receivable", creditReceivable]
                                        ].map(([l, v]) => (
                                            <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #1e293b", fontSize: 13 }}>
                                                <span style={{ color: "#94a3b8" }}>{l}</span>
                                                <span style={{ color: "#4ade80", fontWeight: 600 }}>{fmt(v)}</span>
                                            </div>
                                        ))}
                                        <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0 0", fontWeight: 700 }}>
                                            <span style={{ color: "#4ade80" }}>Total Assets</span>
                                            <span style={{ color: "#4ade80", fontSize: 15 }}>{fmt(totalRevenue + creditReceivable)}</span>
                                        </div>
                                    </Card>
                                    <Card>
                                        <h3 style={{ color: "#f87171", fontWeight: 700, fontSize: 14, marginBottom: 14, fontFamily: "'Syne',sans-serif" }}>Liabilities & Expenses</h3>
                                        <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #1e293b", fontSize: 13 }}>
                                            <span style={{ color: "#94a3b8" }}>Customer Credit Owed</span>
                                            <span style={{ color: "#f87171", fontWeight: 600 }}>{fmt(creditReceivable)}</span>
                                        </div>
                                        <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #1e293b", fontSize: 13 }}>
                                            <span style={{ color: "#94a3b8" }}>Total Expenses</span>
                                            <span style={{ color: "#f87171", fontWeight: 600 }}>{fmt(totalExpenses)}</span>
                                        </div>
                                        <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0 0", fontWeight: 700 }}>
                                            <span style={{ color: totalCollected - totalExpenses >= 0 ? "#4ade80" : "#f87171" }}>Net Position</span>
                                            <span style={{ color: totalCollected - totalExpenses >= 0 ? "#4ade80" : "#f87171", fontSize: 15 }}>{fmt(totalCollected - totalExpenses)}</span>
                                        </div>
                                    </Card>
                                </div>
                            </div>
                        )}
                        {tab === "ledger" && (
                            <Card>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                                    <h3 style={{ color: "#94a3b8", fontSize: 12, fontWeight: 600, margin: 0, textTransform: "uppercase" }}>All Transactions ({fmtNum(filteredLedger.length)})</h3>
                                    <div style={{ display: "flex", gap: 16, fontSize: 12 }}>
                                        <span style={{ color: "#4ade80" }}>Debit: {fmt(filteredLedger.reduce((s, e) => s + (parseFloat(e.debit) || 0), 0))}</span>
                                        <span style={{ color: "#f87171" }}>Credit: {fmt(filteredLedger.reduce((s, e) => s + (parseFloat(e.credit) || 0), 0))}</span>
                                    </div>
                                </div>
                                <Table columns={[
                                    { key: "date", label: "Date" },
                                    { key: "type", label: "Type", render: v => <Badge label={v} color={{ sale: "green", payment: "blue", creditPayment: "blue", expense: "red", purchase: "orange", purchasePayment: "orange", supplierPayment: "orange", salesmanPayment: "purple", stitcherPayment: "purple", assetPurchase: "cyan", orderEdit: "yellow", supplierReturn: "yellow" }[v] || "blue"} /> },
                                    { key: "accountName", label: "Account" },
                                    { key: "description", label: "Description" },
                                    { key: "debit", label: "Debit", render: v => parseFloat(v) > 0 ? <span style={{ color: "#4ade80" }}>{fmt(v)}</span> : "—" },
                                    { key: "credit", label: "Credit", render: v => parseFloat(v) > 0 ? <span style={{ color: "#f87171" }}>{fmt(v)}</span> : "—" },
                                    { key: "orderId", label: "Ref" },
                                ]} data={filteredLedger} />
                            </Card>
                        )}
                        {tab === "moneyflow" && (
                            <div style={{ display: "grid", gap: 16 }}>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 12 }}>
                                    {allMethodNames.map(method => {
                                        const inflow = getMethodInflow(method);
                                        const outflow = getMethodOutflow(method);
                                        const net = inflow - outflow;
                                        const pmCfg = customMethods.find(m => m.name === method);
                                        const openingBal = parseFloat(pmCfg?.balance || 0);
                                        const balance = openingBal + net;
                                        const typeColorMap = { Cash: "green", Bank: "blue", EasyPaisa: "purple", JazzCash: "orange" };
                                        const color = pmCfg ? (pmCfg.color || typeColorMap[pmCfg.type] || "blue") : (typeColorMap[method] || "blue");
                                        const colors = { green: { bg: "#052e1622", border: "#16a34a44", icon: "#4ade80" }, blue: { bg: "#1e3a5f22", border: "#3b82f644", icon: "#60a5fa" }, purple: { bg: "#2e106522", border: "#8b5cf644", icon: "#c084fc" }, orange: { bg: "#43140022", border: "#f9731644", icon: "#fb923c" }, cyan: { bg: "#08303522", border: "#22d3ee44", icon: "#22d3ee" } };
                                        const c = colors[color] || colors.blue;
                                        return (
                                            <div key={method} style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 14, padding: 20 }}>
                                                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                                                    <div style={{ width: 38, height: 38, borderRadius: 10, background: c.icon + "22", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                                        <Icon name="wallet" size={18} style={{ color: c.icon }} />
                                                    </div>
                                                    <div style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 14 }}>{method}</div>
                                                </div>
                                                <div style={{ color: "#f1f5f9", fontSize: 20, fontWeight: 800, fontFamily: "'Syne',sans-serif", marginBottom: 12 }}>{fmt(balance)}</div>
                                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                                    <div style={{ background: "#05250d44", borderRadius: 8, padding: "8px 10px" }}>
                                                        <div style={{ color: "#64748b", fontSize: 10 }}>In</div>
                                                        <div style={{ color: "#4ade80", fontWeight: 700 }}>{fmt(inflow)}</div>
                                                    </div>
                                                    <div style={{ background: "#450a0a44", borderRadius: 8, padding: "8px 10px" }}>
                                                        <div style={{ color: "#64748b", fontSize: 10 }}>Out</div>
                                                        <div style={{ color: "#f87171", fontWeight: 700 }}>{fmt(outflow)}</div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                                <Card>
                                    <h3 style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 14, marginBottom: 14 }}>Total Money Flow Summary</h3>
                                    {[
                                        ["Total Inflow (All Methods)", allMethodNames.reduce((s, m) => s + getMethodInflow(m), 0), "#4ade80"],
                                        ["Total Outflow (All Methods)", allMethodNames.reduce((s, m) => s + getMethodOutflow(m), 0), "#f87171"],
                                        ["Net Position", allMethodNames.reduce((s, m) => s + getMethodInflow(m) - getMethodOutflow(m), 0), "#60a5fa"],
                                        ["Credit Receivable", creditReceivable, "#fbbf24"]
                                    ].map(([l, v, c]) => (
                                        <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #1e293b", fontSize: 13 }}>
                                            <span style={{ color: "#94a3b8" }}>{l}</span>
                                            <span style={{ color: c, fontWeight: 700, fontSize: 14 }}>{fmt(v)}</span>
                                        </div>
                                    ))}
                                </Card>
                            </div>
                        )}
                    </>
                )}
        </div>
    );
}

// ─────────────────────────────────────────────
// PAYMENT LEDGER VIEW PAGE
// ─────────────────────────────────────────────
// The Ledger sheet has no dedicated payment-method column, so per-method breakdowns are
// recovered from the "via <Method>" text the backend embeds in each entry's description.
// Only single-method transactions can be attributed this way — a split payment across
// multiple methods can't be divided from text alone, so those are left out of this view
// (they still show as one combined row in Accounts > Ledger).
const LEDGER_INFLOW_TYPES = new Set(["payment", "creditPayment"]);
const LEDGER_OUTFLOW_TYPES = new Set(["stitcherPayment", "supplierPayment", "purchasePayment", "expense"]);

function extractLedgerPaymentMethod(description) {
    const m = String(description || "").match(/via\s+(.+?)(?=\s+(?:for|to)\s|\s+—|\s+\(edited\)|$)/i);
    if (!m) return null;
    const method = m[1].trim();
    return method.includes(",") ? null : method;
}

function PaymentLedgerPage() {
    const [selectedMethod, setSelectedMethod] = useState("Cash");
    const [startDate, setStartDate] = useState("");
    const [endDate, setEndDate] = useState("");
    const [ledgerEntries, setLedgerEntries] = useState([]);
    const [loading, setLoading] = useState(true);
    const mountedRef = useRef(true);

    useEffect(() => { mountedRef.current = true; fetchAll(); return () => { mountedRef.current = false; }; }, []);

    async function fetchAll() {
        setLoading(true);
        try {
            const res = await getLedger();
            if (mountedRef.current && res.success) setLedgerEntries(res.entries || []);
        } catch (err) { console.error(err); }
        finally { if (mountedRef.current) setLoading(false); }
    }

    const methodHistory = useMemo(() => {
        const byMethod = {};
        getPaymentMethodNames().forEach(m => { byMethod[m] = []; });
        ledgerEntries
            .slice()
            .sort((a, b) => String(a.date).localeCompare(String(b.date)))
            .forEach(entry => {
                const isIn = LEDGER_INFLOW_TYPES.has(entry.type);
                const isOut = LEDGER_OUTFLOW_TYPES.has(entry.type);
                if (!isIn && !isOut) return;
                const method = extractLedgerPaymentMethod(entry.description);
                if (!method || !byMethod[method]) return;
                const amt = isIn ? (parseFloat(entry.credit) || 0) : (parseFloat(entry.debit) || 0);
                byMethod[method].push({
                    id: entry.id, dateTime: entry.date, supplierName: entry.accountName,
                    description: entry.description,
                    debit: isIn ? amt : 0, credit: isOut ? amt : 0,
                });
            });
        Object.keys(byMethod).forEach(method => {
            const pmCfg = getPaymentMethodsConfig().find(m => m.name === method);
            let balance = parseFloat(pmCfg?.balance || 0);
            byMethod[method].forEach(e => { balance += e.debit - e.credit; e.balance = balance; });
            byMethod[method].reverse(); // newest first for display
        });
        return byMethod;
    }, [ledgerEntries]);

    const fullHistory = useMemo(() => methodHistory[selectedMethod] || [], [methodHistory, selectedMethod]);
    const balance = fullHistory.length ? fullHistory[0].balance : parseFloat(getPaymentMethodsConfig().find(m => m.name === selectedMethod)?.balance || 0);

    const entries = useMemo(() => {
        let filtered = fullHistory;
        if (startDate) filtered = filtered.filter(e => String(e.dateTime).slice(0, 10) >= startDate);
        if (endDate) filtered = filtered.filter(e => String(e.dateTime).slice(0, 10) <= endDate);
        return filtered;
    }, [fullHistory, startDate, endDate]);

    const totalDebit = entries.reduce((s, e) => s + (e.debit || 0), 0);
    const totalCredit = entries.reduce((s, e) => s + (e.credit || 0), 0);

    return (
        <div style={{ padding: 24 }}>
            <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
                <h2 style={{ flex: 1, color: "#f1f5f9", fontWeight: 700, fontSize: 16, margin: 0, fontFamily: "'Syne',sans-serif" }}>Payment Method Ledger</h2>
                {getPaymentMethodNames().map(method => (
                    <button key={method} onClick={() => setSelectedMethod(method)}
                        style={{ padding: "8px 16px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, background: selectedMethod === method ? "linear-gradient(135deg,#3b82f6,#8b5cf6)" : "#1e293b", color: selectedMethod === method ? "#fff" : "#64748b" }}>
                        {method}
                    </button>
                ))}
                <Btn size="sm" variant="ghost" icon="refresh" onClick={fetchAll}>Refresh</Btn>
            </div>

            {loading ? <Spinner /> : (
                <>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 12, marginBottom: 20 }}>
                        <StatCard label="Current Balance" value={fmt(balance)} icon="wallet" color="blue" />
                        <StatCard label="Total In (Debit)" value={fmt(totalDebit)} icon="trending" color="green" />
                        <StatCard label="Total Out (Credit)" value={fmt(totalCredit)} icon="trending" color="red" sub="Payments made" />
                        <StatCard label="Entries" value={fmtNum(entries.length)} icon="receipt" color="purple" />
                    </div>

                    <Card style={{ marginBottom: 16 }}>
                        <DateRangeFilter startDate={startDate} endDate={endDate} onStartChange={setStartDate} onEndChange={setEndDate} onClear={() => { setStartDate(""); setEndDate(""); }} />
                    </Card>

                    <Card>
                        <h3 style={{ color: "#94a3b8", fontSize: 12, fontWeight: 600, marginBottom: 16, textTransform: "uppercase" }}>Ledger Entries for {selectedMethod}</h3>
                        <div style={{ maxHeight: 500, overflowY: "auto" }}>
                            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                                <thead>
                                    <tr>{["Date & Time", "Supplier/Reference", "Description", "Debit", "Credit", "Balance"].map(h => <th key={h} style={{ padding: "8px 12px", color: "#64748b", fontWeight: 600, fontSize: 11, textAlign: "left", borderBottom: "1px solid #334155", whiteSpace: "nowrap" }}>{h}</th>)}</tr>
                                </thead>
                                <tbody>
                                    {entries.length === 0 ? (
                                        <tr><td colSpan={6} style={{ padding: "24px", textAlign: "center", color: "#475569" }}>No entries for {selectedMethod}</td></tr>
                                    ) : (
                                        entries.map((entry, i) => (
                                            <tr key={i} style={{ borderBottom: "1px solid #1e293b" }}>
                                                <td style={{ padding: "8px 12px", color: "#94a3b8" }}>{entry.dateTime?.slice(0, 16) || "—"}</td>
                                                <td style={{ padding: "8px 12px", color: "#f1f5f9" }}>{entry.supplierName || "—"}</td>
                                                <td style={{ padding: "8px 12px", color: "#cbd5e1", maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.description}</td>
                                                <td style={{ padding: "8px 12px", color: "#f87171", fontWeight: 600 }}>{entry.debit > 0 ? fmt(entry.debit) : "—"}</td>
                                                <td style={{ padding: "8px 12px", color: "#4ade80", fontWeight: 600 }}>{entry.credit > 0 ? fmt(entry.credit) : "—"}</td>
                                                <td style={{ padding: "8px 12px", color: "#f1f5f9", fontWeight: 700 }}>{fmt(entry.balance)}</td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </Card>
                </>
            )}
        </div>
    );
}

// ─────────────────────────────────────────────
// PAYMENT METHODS PAGE
// ─────────────────────────────────────────────
function PaymentMethodsPage() {
    const [methods, setMethods] = useState(getPaymentMethodsConfig());
    const [showForm, setShowForm] = useState(false);
    const [editItem, setEditItem] = useState(null);
    const blank = { name: "", type: "Cash", accountNo: "", bank: "", balance: 0, color: "blue" };
    const [form, setForm] = useState(blank);

    function save() {
        if (!form.name) return;
        let updated;
        if (editItem) {
            updated = methods.map(m => m.id === editItem.id ? { ...m, ...form } : m);
        } else {
            updated = [...methods, { ...form, id: "pm_" + Date.now(), balance: parseFloat(form.balance) || 0 }];
        }
        setMethods(updated);
        savePaymentMethodsConfig(updated);
        setShowForm(false);
        setForm(blank);
        setEditItem(null);
    }

    function del(m) {
        if (!window.confirm(`Delete "${m.name}"?`)) return;
        const updated = methods.filter(x => x.id !== m.id);
        setMethods(updated);
        savePaymentMethodsConfig(updated);
    }

    const f = k => e => setForm({ ...form, [k]: e.target.value });
    const typeColors = { Cash: "green", Bank: "blue", EasyPaisa: "purple", JazzCash: "orange", Other: "cyan" };

    return (
        <div style={{ padding: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
                <h2 style={{ flex: 1, color: "#f1f5f9", fontWeight: 700, fontSize: 16, margin: 0, fontFamily: "'Syne',sans-serif" }}>Payment Methods</h2>
                <Btn onClick={() => { setForm(blank); setEditItem(null); setShowForm(true); }} icon="plus">Add Method</Btn>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 16 }}>
                {methods.map(m => {
                    const color = typeColors[m.type] || m.color || "blue";
                    const colors = { green: { bg: "#052e1622", border: "#16a34a44", icon: "#4ade80" }, blue: { bg: "#1e3a5f22", border: "#3b82f644", icon: "#60a5fa" }, purple: { bg: "#2e106522", border: "#8b5cf644", icon: "#c084fc" }, orange: { bg: "#43140022", border: "#f9731644", icon: "#fb923c" }, cyan: { bg: "#08303522", border: "#22d3ee44", icon: "#22d3ee" } };
                    const c = colors[color] || colors.blue;
                    return (
                        <div key={m.id} style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 14, padding: 20 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                                <div style={{ width: 44, height: 44, borderRadius: 12, background: c.icon + "22", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                    <Icon name="wallet" size={20} style={{ color: c.icon }} />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <div style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 15 }}>{m.name}</div>
                                    <Badge label={m.type} color={color} />
                                </div>
                                <div style={{ display: "flex", gap: 6 }} onClick={e => e.stopPropagation()}>
                                    <button onClick={() => { setForm({ ...m }); setEditItem(m); setShowForm(true); }} style={{ padding: "5px 8px", borderRadius: 6, background: "#1e3a5f", border: "none", color: "#60a5fa", cursor: "pointer" }}><Icon name="edit" size={13} /></button>
                                    <button onClick={() => del(m)} style={{ padding: "5px 8px", borderRadius: 6, background: "#450a0a", border: "none", color: "#f87171", cursor: "pointer" }}><Icon name="trash" size={13} /></button>
                                </div>
                            </div>
                            {m.bank && <div style={{ color: "#64748b", fontSize: 12, marginBottom: 4 }}>{m.bank}{m.accountNo ? ` — ${m.accountNo}` : ""}</div>}
                            <div style={{ color: "#f1f5f9", fontSize: 22, fontWeight: 800, fontFamily: "'Syne',sans-serif", marginBottom: 8 }}>{fmt(m.balance)}</div>
                            <div style={{ fontSize: 11, color: "#64748b" }}>Opening Balance</div>
                        </div>
                    );
                })}
            </div>

            {showForm && (
                <Modal title={editItem ? "Edit Payment Method" : "Add Payment Method"} onClose={() => { setShowForm(false); setEditItem(null); }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                        <Input label="Method Name" value={form.name} onChange={f("name")} required style={{ gridColumn: "1/-1" }} placeholder="e.g. HBL Bank, Cash Drawer" />
                        <Select label="Type" value={form.type} onChange={f("type")} options={["Cash", "Bank", "EasyPaisa", "JazzCash", "Other"]} />
                        <Select label="Color" value={form.color} onChange={f("color")} options={[{ value: "green", label: "Green" }, { value: "blue", label: "Blue" }, { value: "purple", label: "Purple" }, { value: "orange", label: "Orange" }, { value: "cyan", label: "Cyan" }]} />
                        <Input label="Bank Name (optional)" value={form.bank} onChange={f("bank")} placeholder="e.g. HBL, MCB" />
                        <Input label="Account Number (optional)" value={form.accountNo} onChange={f("accountNo")} />
                        <Input label="Opening Balance (Rs)" type="number" value={form.balance} onChange={f("balance")} placeholder="0" style={{ gridColumn: "1/-1" }} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
                        <Btn variant="ghost" onClick={() => { setShowForm(false); setEditItem(null); }}>Cancel</Btn>
                        <Btn onClick={save}>{editItem ? "Update Method" : "Add Method"}</Btn>
                    </div>
                </Modal>
            )}
        </div>
    );
}

// ─────────────────────────────────────────────
// SETTINGS PAGE
// ─────────────────────────────────────────────
function SettingsPage({ user }) {
    const [storeName, setStoreName] = useState(localStorage.getItem("dukandar_store_name") || "Accunity ASW");
    const [saved, setSaved] = useState(false);

    function saveSettings() {
        localStorage.setItem("dukandar_store_name", storeName);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
    }

    return (
        <div style={{ padding: 24 }}>
            <div style={{ maxWidth: 600 }}>
                <Card style={{ marginBottom: 16 }}>
                    <h3 style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 14, marginBottom: 16, fontFamily: "'Syne',sans-serif" }}>Store Settings</h3>
                    <Input label="Store Name (shown on receipts)" value={storeName} onChange={e => setStoreName(e.target.value)} style={{ marginBottom: 14 }} />
                    <div style={{ background: "#052e1622", border: "1px solid #16a34a44", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#4ade80", marginBottom: 14 }}>
                        <Icon name="check" size={14} /> Google Sheet connected
                    </div>
                    <Btn onClick={saveSettings}>{saved ? "✓ Saved!" : "Save Settings"}</Btn>
                </Card>
                <Card style={{ marginBottom: 16 }}>
                    <h3 style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 14, marginBottom: 16, fontFamily: "'Syne',sans-serif" }}>Account</h3>
                    <div style={{ display: "flex", gap: 14, alignItems: "center", padding: "10px 0" }}>
                        <div style={{ width: 44, height: 44, borderRadius: 10, background: "linear-gradient(135deg,#3b82f6,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <span style={{ color: "#fff", fontWeight: 700, fontSize: 18 }}>{user.name[0]}</span>
                        </div>
                        <div><div style={{ color: "#f1f5f9", fontWeight: 600 }}>{user.name}</div><div style={{ color: "#64748b", fontSize: 12 }}>{user.role}</div></div>
                    </div>
                </Card>
                <Card>
                    <h3 style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 14, marginBottom: 14, fontFamily: "'Syne',sans-serif" }}>v9.0 New Features</h3>
                    {[
                        ["✦ Enhanced Offline Support", "Auto-sync with IndexedDB and pending count indicator"],
                        ["✦ Payroll Batch Creation", "Select multiple employees and pay them in one go"],
                        ["✦ Payroll History", "View paid salary history with filtering by month"],
                        ["✦ Offline Sync Indicator", "Shows pending count in top bar"],
                        ["✦ All previous features retained", "Full order edit, stitcher management, supplier payments, etc."]
                    ].map(([t, d]) => (
                        <div key={t} style={{ padding: "10px 0", borderBottom: "1px solid #1e293b" }}>
                            <div style={{ color: "#60a5fa", fontSize: 13, fontWeight: 600 }}>{t}</div>
                            <div style={{ color: "#64748b", fontSize: 12, marginTop: 2 }}>{d}</div>
                        </div>
                    ))}
                </Card>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────
// PAYROLL PAGE - UPDATED WITH DASHBOARD & HISTORY
// ─────────────────────────────────────────────
// PayrollPage IS the (detailed) Salary Sheet: monthly per-employee salary with day/commission
// math, edit, and PARTIAL payments from a chosen account. The old simple Payroll page and the
// duplicate Salary Sheet tab under Salesmen were merged into this one.
function PayrollPage() {
    const [month, setMonth] = useState(thisMonth());
    const [entries, setEntries] = useState([]);
    const [salesmen, setSalesmen] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [filterDesignation, setFilterDesignation] = useState("");
    const [editEntry, setEditEntry] = useState(null);
    const [showForm, setShowForm] = useState(false);
    const [payTarget, setPayTarget] = useState(null);

    const entryBlank = {
        salesmanId: "", salesmanName: "", designation: "",
        basicSalary: "", totalDays: "30", workingDays: "",
        commissionRate: "", monthlyWork: "", otherAmount: "",
        bill: "", advance: "", notes: ""
    };
    const [entryForm, setEntryForm] = useState(entryBlank);
    const [payForm, setPayForm] = useState({}); // split-payment map { method: amount }
    const mountedRef = useRef(true);

    // Payment methods come from the Payment Methods page (Cash / Bank / EasyPaisa / JazzCash + any custom).
    const payMethods = getPaymentMethodsConfig().map(m => m.name);

    useEffect(() => { mountedRef.current = true; fetchSalesmen(); return () => { mountedRef.current = false; }; }, []);
    useEffect(() => { if (month) fetchEntries(month); }, [month]);

    async function fetchSalesmen() {
        try { const res = await getSalesmen(); if (mountedRef.current && res.success) setSalesmen(res.salesmen || []); }
        catch (err) { console.error(err); }
    }
    async function fetchEntries(m) {
        setLoading(true);
        try { const res = await getSalarySheet({ month: m }); if (mountedRef.current && res.success) setEntries(res.entries || []); }
        catch (err) { console.error(err); }
        finally { if (mountedRef.current) setLoading(false); }
    }

    function calcSalaryFields(form) {
        const basic = parseFloat(form.basicSalary) || 0;
        const total = parseInt(form.totalDays) || 30;
        const working = Math.min(Math.max(parseInt(form.workingDays) || 0, 0), total);
        const perDay = total > 0 ? basic / total : 0;
        const payable = perDay * working;
        const commRate = parseFloat(form.commissionRate) || 0;
        const monthly = parseFloat(form.monthlyWork) || 0;
        const commAmount = monthly * commRate / 100;
        const other = parseFloat(form.otherAmount) || 0;
        const salaryIncentive = payable + commAmount + other;
        const advance = parseFloat(form.advance) || 0;
        return { perDaySalary: perDay, payableSalary: payable, commissionAmount: commAmount, salaryIncentive, netPayable: salaryIncentive - advance };
    }
    const calc = calcSalaryFields(entryForm);

    function openForm(entry) {
        if (entry) {
            setEditEntry(entry);
            setEntryForm({
                salesmanId: entry.salesmanId || "", salesmanName: entry.salesmanName || "", designation: entry.designation || "",
                basicSalary: entry.basicSalary ?? "", totalDays: entry.totalDays ?? "30", workingDays: entry.workingDays ?? "",
                commissionRate: entry.commissionRate ?? "", monthlyWork: entry.monthlyWork ?? "", otherAmount: entry.otherAmount ?? "",
                bill: entry.bill ?? "", advance: entry.advance ?? "", notes: entry.notes || "",
            });
        } else { setEditEntry(null); setEntryForm(entryBlank); }
        setShowForm(true);
    }
    const sf = k => e => setEntryForm({ ...entryForm, [k]: e.target.value });

    async function saveEntry() {
        if (!entryForm.salesmanId) return;
        const data = { ...entryForm, month };
        if (editEntry) data.id = editEntry.id;
        setSaving(true);
        try {
            const res = await saveSalarySheetEntry(data);
            if (res.success) { await fetchEntries(month); setShowForm(false); setEditEntry(null); }
            else toast(res.error || "Failed to save entry.");
        } catch { toast("Network error."); }
        finally { if (mountedRef.current) setSaving(false); }
    }
    async function delEntry(entry) {
        if (!window.confirm(`Delete salary entry for ${entry.salesmanName}?`)) return;
        try { const res = await deleteSalarySheetEntry(entry.id); if (res.success) await fetchEntries(month); else toast(res.error || "Failed to delete."); }
        catch { toast("Network error."); }
    }
    async function reopen(entry) {
        if (!window.confirm(`Reopen ${entry.salesmanName}'s salary? This reverses ALL payments made for it and sets it back to unpaid.`)) return;
        try { const res = await reopenSalarySheetEntry(entry.id); if (res.success) await fetchEntries(month); else toast(res.error || "Failed."); }
        catch { toast("Network error."); }
    }

    function openPay(entry) {
        const rem = Math.max(0, (Number(entry.netPayable) || 0) - (Number(entry.paidAmount) || 0));
        // Pre-fill the first account with the full remaining so "pay full" is one click;
        // the user can split it across accounts instead.
        setPayForm({ [payMethods[0] || "Cash"]: rem ? String(rem) : "" });
        setPayTarget(entry);
    }
    // Split payment: post one salary payment per account that has an amount. Each call
    // records a payment against the entry (paidAmount ++), and auto-deducts from that account.
    async function pay() {
        if (!payTarget) return;
        const rem = Math.max(0, (Number(payTarget.netPayable) || 0) - (Number(payTarget.paidAmount) || 0));
        const parts = payMethods.map(m => ({ method: m, amt: parseFloat(payForm[m]) || 0 })).filter(p => p.amt > 0);
        const total = parts.reduce((s, p) => s + p.amt, 0);
        if (total <= 0 || total > rem + 0.01) return;
        setSaving(true);
        try {
            for (const p of parts) {
                const res = await paySalarySheetEntry({ id: payTarget.id, amount: p.amt, paymentMethod: p.method });
                if (!res.success) {
                    if (String(res.error || "").includes("Unknown")) toast("Salary payment needs the updated backend. Please re-deploy the Google Apps Script (see REDEPLOY.md).");
                    else toast(res.error || `Failed to record payment via ${p.method}.`);
                    break;
                }
            }
            await fetchEntries(month);
            setPayTarget(null);
        } catch { toast("Network error."); }
        finally { if (mountedRef.current) setSaving(false); }
    }

    const designations = [...new Set(salesmen.map(s => s.designation).filter(Boolean))];
    const salesmanOptions = salesmen.map(s => ({ value: s.id, label: `${s.name} (${s.designation || "No designation"})` }));
    const shown = entries.filter(e => !filterDesignation || e.designation === filterDesignation);
    const totalNet = shown.reduce((s, e) => s + (Number(e.netPayable) || 0), 0);
    const totalPaid = shown.reduce((s, e) => s + (Number(e.paidAmount) || 0), 0);
    const totalRemaining = Math.max(0, totalNet - totalPaid);

    const statusBadge = (e) => {
        const paid = Number(e.paidAmount) || 0, net = Number(e.netPayable) || 0;
        if (e.status === "paid" || (net > 0 && paid >= net - 0.01)) return <Badge label="Paid" color="green" />;
        if (paid > 0.01) return <Badge label="Partial" color="orange" />;
        return <Badge label="Pending" color="yellow" />;
    };

    // Pay-modal live figures (guarded — payTarget may be null).
    const remaining = payTarget ? Math.max(0, (Number(payTarget.netPayable) || 0) - (Number(payTarget.paidAmount) || 0)) : 0;
    const payTotal = payMethods.reduce((s, m) => s + (parseFloat(payForm[m]) || 0), 0);
    const remainingAfter = Math.max(0, remaining - payTotal);
    const payValid = payTotal > 0 && payTotal <= remaining + 0.01;

    const th = { padding: "8px 10px", color: "#64748b", fontWeight: 600, fontSize: 11, textAlign: "left", whiteSpace: "nowrap" };
    const td = { padding: "8px 10px", color: "#cbd5e1", whiteSpace: "nowrap" };

    return (
        <div style={{ padding: 24 }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
                <h2 style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 16, margin: 0, fontFamily: "'Syne',sans-serif" }}>Payroll — Salary Sheet</h2>
                <div>
                    <label style={{ color: "#94a3b8", fontSize: 12, fontWeight: 500, display: "block", marginBottom: 4 }}>Month</label>
                    <input type="month" value={month} onChange={e => setMonth(e.target.value)}
                        style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 7, padding: "8px 12px", color: "#f1f5f9", fontSize: 13, outline: "none" }} />
                </div>
                <div>
                    <label style={{ color: "#94a3b8", fontSize: 12, fontWeight: 500, display: "block", marginBottom: 4 }}>Designation</label>
                    <select value={filterDesignation} onChange={e => setFilterDesignation(e.target.value)}
                        style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 7, padding: "8px 12px", color: "#f1f5f9", fontSize: 13, outline: "none" }}>
                        <option value="">All</option>
                        {designations.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                </div>
                <div style={{ flex: 1 }} />
                <Btn size="sm" variant="ghost" icon="refresh" onClick={() => fetchEntries(month)}>Refresh</Btn>
                <Btn onClick={() => openForm(null)} icon="plus">Add Entry</Btn>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 12, marginBottom: 16 }}>
                <StatCard label="Total Net Payable" value={fmt(totalNet)} icon="money" color="blue" sub="What we owe this month" />
                <StatCard label="Total Paid" value={fmt(totalPaid)} icon="check" color="green" sub="Auto-deducted from accounts" />
                <StatCard label="Total Remaining" value={fmt(totalRemaining)} icon="alert" color={totalRemaining > 0 ? "orange" : "green"} />
                <StatCard label="Employees" value={fmtNum(shown.length)} icon="customers" color="purple" sub={month} />
            </div>

            {loading ? <Spinner /> : (
                <Card>
                    <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                            <thead>
                                <tr style={{ background: "#0f172a", borderBottom: "2px solid #334155" }}>
                                    {["Name", "Designation", "Basic", "Days", "Working", "Per Day", "Payable", "Comm %", "Monthly Work", "Comm Amt", "Other", "Sal+Inc", "Bill", "Advance", "Net Payable", "Paid", "Remaining", "Status", "Actions"].map(h => <th key={h} style={th}>{h}</th>)}
                                </tr>
                            </thead>
                            <tbody>
                                {shown.map(entry => {
                                    const net = Number(entry.netPayable) || 0;
                                    const paid = Number(entry.paidAmount) || 0;
                                    const rem = Math.max(0, net - paid);
                                    return (
                                        <tr key={entry.id} style={{ borderBottom: "1px solid #1e293b" }}>
                                            <td style={{ ...td, color: "#f1f5f9", fontWeight: 600 }}>{entry.salesmanName}</td>
                                            <td style={{ ...td, color: "#94a3b8" }}>{entry.designation || "—"}</td>
                                            <td style={td}>{fmt(entry.basicSalary)}</td>
                                            <td style={td}>{entry.totalDays}</td>
                                            <td style={td}>{entry.workingDays}</td>
                                            <td style={td}>{fmt(entry.perDaySalary)}</td>
                                            <td style={td}>{fmt(entry.payableSalary)}</td>
                                            <td style={td}>{entry.commissionRate || 0}%</td>
                                            <td style={td}>{fmt(entry.monthlyWork)}</td>
                                            <td style={{ ...td, color: "#c084fc", fontWeight: 600 }}>{fmt(entry.commissionAmount)}</td>
                                            <td style={td}>{fmt(entry.otherAmount)}</td>
                                            <td style={{ ...td, color: "#60a5fa", fontWeight: 700 }}>{fmt(entry.salaryIncentive)}</td>
                                            <td style={td}>{fmt(entry.bill)}</td>
                                            <td style={{ ...td, color: "#f87171" }}>{fmt(entry.advance)}</td>
                                            <td style={{ ...td, color: net < 0 ? "#f87171" : "#f1f5f9", fontWeight: 700 }}>{fmt(net)}</td>
                                            <td style={{ ...td, color: "#4ade80", fontWeight: 600 }}>{fmt(paid)}</td>
                                            <td style={{ ...td, color: rem > 0 ? "#fb923c" : "#64748b", fontWeight: 700 }}>{fmt(rem)}</td>
                                            <td style={{ padding: "8px 10px" }}>{statusBadge(entry)}</td>
                                            <td style={{ padding: "8px 10px" }}>
                                                <div style={{ display: "flex", gap: 6 }}>
                                                    {rem > 0.01 && <button onClick={() => openPay(entry)} style={{ padding: "4px 8px", borderRadius: 6, background: "#052e16", border: "none", color: "#4ade80", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>Pay</button>}
                                                    {paid > 0.01 && <button onClick={() => reopen(entry)} style={{ padding: "4px 8px", borderRadius: 6, background: "#2d1010", border: "none", color: "#f87171", cursor: "pointer", fontSize: 11 }}>Reopen</button>}
                                                    <button onClick={() => openForm(entry)} style={{ padding: "4px 8px", borderRadius: 6, background: "#1e3a5f", border: "none", color: "#60a5fa", cursor: "pointer", fontSize: 11 }}>Edit</button>
                                                    <button onClick={() => delEntry(entry)} style={{ padding: "4px 8px", borderRadius: 6, background: "#450a0a", border: "none", color: "#f87171", cursor: "pointer", fontSize: 11 }}>Del</button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                                {shown.length === 0 && <tr><td colSpan={19} style={{ padding: "40px 0", textAlign: "center", color: "#475569" }}>No salary entries for this month.</td></tr>}
                            </tbody>
                        </table>
                    </div>
                </Card>
            )}

            {/* Partial Pay modal — shows what we owe vs what we're paying now, from a chosen account */}
            {payTarget && (
                <Modal title={`Pay Salary — ${payTarget.salesmanName}`} onClose={() => setPayTarget(null)} width={460}>
                    <div style={{ background: "#0f172a", borderRadius: 10, padding: 14, marginBottom: 16, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                        {[
                            ["Net Payable (owe)", fmt(Number(payTarget.netPayable) || 0), "#f1f5f9"],
                            ["Already Paid", fmt(Number(payTarget.paidAmount) || 0), "#4ade80"],
                            ["Remaining", fmt(remaining), "#fb923c"],
                        ].map(([l, v, c]) => (
                            <div key={l}>
                                <div style={{ color: "#64748b", fontSize: 11 }}>{l}</div>
                                <div style={{ color: c, fontWeight: 700, fontSize: 14 }}>{v}</div>
                            </div>
                        ))}
                    </div>
                    <MultiPaymentInput
                        payments={payForm}
                        onChange={setPayForm}
                        maxTotal={remaining}
                        methods={payMethods}
                        label="Pay Salary (split across accounts)"
                        remainingLabel="Remaining to pay"
                        dueLabel="Still unpaid"
                    />
                    <div style={{ marginTop: 10, padding: "8px 12px", background: "#1e3a5f22", border: "1px solid #3b82f644", borderRadius: 8, fontSize: 12, color: "#94a3b8" }}>
                        <Icon name="wallet" size={12} style={{ color: "#60a5fa" }} /> Paying <strong style={{ color: "#60a5fa" }}>{fmt(payTotal)}</strong> now — each account is auto-deducted (Money Flow + Payment Ledger). Remaining after: <strong style={{ color: "#fb923c" }}>{fmt(remainingAfter)}</strong>.
                    </div>
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
                        <Btn variant="ghost" onClick={() => setPayTarget(null)}>Cancel</Btn>
                        <Btn variant="success" icon="check" onClick={pay} disabled={saving || !payValid}>{saving ? "Paying…" : `Pay ${fmt(payTotal)}`}</Btn>
                    </div>
                </Modal>
            )}

            {/* Add / Edit salary entry */}
            {showForm && (
                <Modal title={editEntry ? "Edit Salary Entry" : "Add Salary Entry"} onClose={() => setShowForm(false)} width={720}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                        <Select
                            label="Employee"
                            value={entryForm.salesmanId}
                            onChange={e => {
                                const sm = salesmen.find(s => s.id === e.target.value);
                                setEntryForm({
                                    ...entryForm,
                                    salesmanId: e.target.value,
                                    salesmanName: sm ? sm.name : "",
                                    designation: sm ? sm.designation || "" : "",
                                    commissionRate: sm ? sm.commissionRate : "",
                                    basicSalary: sm ? sm.salary : "",
                                });
                            }}
                            options={[{ value: "", label: "Select Employee" }, ...salesmanOptions]}
                            style={{ gridColumn: "1/-1" }}
                        />
                        <Input label="Designation (auto)" value={entryForm.designation} onChange={sf("designation")} />
                        <Input label="Basic Salary" type="number" value={entryForm.basicSalary} onChange={sf("basicSalary")} />
                        <Input label="Total Days" type="number" value={entryForm.totalDays} onChange={sf("totalDays")} />
                        <Input label="Working Days" type="number" value={entryForm.workingDays} onChange={sf("workingDays")} />
                        <div style={{ background: "#0f172a", borderRadius: 6, padding: "6px 10px", color: "#94a3b8", fontSize: 12 }}>Per Day: <span style={{ color: "#f1f5f9", fontWeight: 600 }}>{fmt(calc.perDaySalary)}</span></div>
                        <div style={{ background: "#0f172a", borderRadius: 6, padding: "6px 10px", color: "#94a3b8", fontSize: 12 }}>Payable: <span style={{ color: "#f1f5f9", fontWeight: 600 }}>{fmt(calc.payableSalary)}</span></div>
                        <Input label="Commission Rate (%)" type="number" value={entryForm.commissionRate} onChange={sf("commissionRate")} />
                        <Input label="Monthly Work (Sales)" type="number" value={entryForm.monthlyWork} onChange={sf("monthlyWork")} />
                        <div style={{ background: "#0f172a", borderRadius: 6, padding: "6px 10px", color: "#94a3b8", fontSize: 12 }}>Commission Amt: <span style={{ color: "#c084fc", fontWeight: 600 }}>{fmt(calc.commissionAmount)}</span></div>
                        <Input label="Other Amount" type="number" value={entryForm.otherAmount} onChange={sf("otherAmount")} />
                        <div style={{ background: "#0f172a", borderRadius: 6, padding: "6px 10px", color: "#94a3b8", fontSize: 12, gridColumn: "1/-1" }}>Salary + Incentive: <span style={{ color: "#60a5fa", fontWeight: 700 }}>{fmt(calc.salaryIncentive)}</span></div>
                        <Input label="BILL (if any)" type="number" value={entryForm.bill} onChange={sf("bill")} />
                        <Input label="Advance" type="number" value={entryForm.advance} onChange={sf("advance")} />
                        <div style={{ background: "#0f172a", borderRadius: 6, padding: "6px 10px", color: "#94a3b8", fontSize: 12, gridColumn: "1/-1" }}>Net Payable: <span style={{ color: calc.netPayable < 0 ? "#f87171" : "#4ade80", fontWeight: 700 }}>{fmt(calc.netPayable)}</span></div>
                        <Input label="Notes" value={entryForm.notes} onChange={sf("notes")} style={{ gridColumn: "1/-1" }} />
                    </div>
                    {editEntry && Number(editEntry.paidAmount) > 0 && (
                        <div style={{ marginTop: 12, color: "#64748b", fontSize: 12 }}>Note: {fmt(editEntry.paidAmount)} already paid on this entry is preserved.</div>
                    )}
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
                        <Btn variant="ghost" onClick={() => setShowForm(false)}>Cancel</Btn>
                        <Btn onClick={saveEntry} disabled={saving || !entryForm.salesmanId}>{saving ? "Saving…" : "Save Entry"}</Btn>
                    </div>
                </Modal>
            )}
        </div>
    );
}

// ─────────────────────────────────────────────
// STAT CARD COMPONENT
// ─────────────────────────────────────────────
function StatCard({ label, value, icon, color, sub }) {
    const colors = { blue: { bg: "#1e3a5f22", border: "#3b82f644", icon: "#3b82f6" }, green: { bg: "#052e1622", border: "#16a34a44", icon: "#4ade80" }, purple: { bg: "#2e106522", border: "#8b5cf644", icon: "#c084fc" }, orange: { bg: "#43160022", border: "#f9731644", icon: "#fb923c" }, red: { bg: "#450a0a22", border: "#ef444444", icon: "#f87171" }, cyan: { bg: "#08303522", border: "#22d3ee44", icon: "#22d3ee" }, yellow: { bg: "#42200622", border: "#f9731644", icon: "#fbbf24" } };
    const c = colors[color] || colors.blue;
    return (
        <div style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 12, padding: "16px 20px", display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 42, height: 42, borderRadius: 10, background: c.icon + "22", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Icon name={icon} size={20} style={{ color: c.icon }} />
            </div>
            <div>
                <div style={{ color: "#94a3b8", fontSize: 12, fontWeight: 500, marginBottom: 2 }}>{label}</div>
                <div style={{ color: "#f1f5f9", fontSize: 18, fontWeight: 700, fontFamily: "'Syne',sans-serif" }}>{value}</div>
                {sub && <div style={{ color: "#64748b", fontSize: 11, marginTop: 1 }}>{sub}</div>}
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────
// DASHBOARD PAGE
// ─────────────────────────────────────────────
function DashboardPage() {
    const [loading, setLoading] = useState(true);
    const [orders, setOrders] = useState([]);
    const [products, setProducts] = useState([]);
    const [customers, setCustomers] = useState([]);
    const [stitcherStats, setStitcherStats] = useState(null);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        fetchAll();
        return () => { mountedRef.current = false; };
    }, []);

    async function fetchAll() {
        setLoading(true);
        try {
            const [oRes, pRes, cRes, stDash] = await Promise.all([getOrders(), getProducts(), getCustomers(), getStitcherDashboard()]);
            if (!mountedRef.current) return;
            if (oRes.success) setOrders(oRes.orders || []);
            if (pRes.success) setProducts(pRes.products || []);
            if (cRes.success) setCustomers(cRes.customers || []);
            if (stDash.success) setStitcherStats(stDash);
        } catch (err) { console.error(err); }
        finally { if (mountedRef.current) setLoading(false); }
    }

    const todayStr = today(), monthStr = thisMonth();
    const todaySales = orders.filter(o => String(o.date).trim() === todayStr).reduce((s, o) => s + Number(o.total || 0), 0);
    const monthlySales = orders.filter(o => String(o.date).startsWith(monthStr)).reduce((s, o) => s + Number(o.total || 0), 0);
    const monthOrders = orders.filter(o => String(o.date).startsWith(monthStr)).length;
    const loyalCount = customers.filter(c => c.loyal).length;
    const last7 = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(); d.setDate(d.getDate() - (6 - i));
        const ds = d.toISOString().split("T")[0];
        const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        return { day: days[d.getDay()], sales: orders.filter(o => String(o.date).trim() === ds).reduce((s, o) => s + Number(o.total || 0), 0) };
    });
    const lowStock = products.filter(p => Number(p.stock) > 0 && Number(p.stock) < 10);

    if (loading) return <Spinner />;
    return (
        <div style={{ padding: 24 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 12, marginBottom: 20 }}>
                <StatCard label="Today Sales" value={fmt(todaySales)} icon="trending" color="green" sub={todayStr} />
                <StatCard label="Monthly Sales" value={fmt(monthlySales)} icon="reports" color="blue" sub={monthStr} />
                <StatCard label="Monthly Orders" value={fmtNum(monthOrders)} icon="orders" color="purple" />
                <StatCard label="Total Customers" value={fmtNum(customers.length)} icon="customers" color="cyan" sub={`${loyalCount} loyal`} />
                {stitcherStats && <StatCard label="Active Stitchers" value={fmtNum(stitcherStats.activeStitchers)} icon="scissors" color="purple" sub={`${stitcherStats.pendingOrders} pending`} />}
                {stitcherStats && <StatCard label="Stitch Outstanding" value={fmt(stitcherStats.totalBalance)} icon="money" color="orange" sub="Payable to stitchers" />}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
                <Card>
                    <h3 style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 14, marginBottom: 16, fontFamily: "'Syne',sans-serif" }}>Last 7 Days Sales</h3>
                    <MiniChart data={last7} />
                </Card>
                <Card>
                    <h3 style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 14, marginBottom: 16, fontFamily: "'Syne',sans-serif" }}>Low Stock Alerts</h3>
                    {lowStock.length === 0
                        ? <div style={{ color: "#4ade80", fontSize: 13 }}>✓ All products have adequate stock</div>
                        : lowStock.map(p => (
                            <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: "#450a0a22", borderRadius: 8, border: "1px solid #ef444444", marginBottom: 6 }}>
                                <span style={{ color: "#f1f5f9", fontSize: 13 }}>{p.name}</span>
                                <Badge label={`${p.stock} left`} color="red" />
                            </div>
                        ))}
                </Card>
            </div>
            <Card>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                    <h3 style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 14, margin: 0, fontFamily: "'Syne',sans-serif" }}>Recent Orders</h3>
                    <Btn size="sm" variant="ghost" icon="refresh" onClick={fetchAll}>Refresh</Btn>
                </div>
                <Table
                    columns={[
                        { key: "id", label: "Order ID" }, { key: "date", label: "Date" }, { key: "customer", label: "Customer" },
                        { key: "total", label: "Amount", render: v => fmt(v) },
                        { key: "status", label: "Status", render: v => <OrderStatusBadge status={v} /> },
                    ]}
                    data={orders.slice(0, 5)}
                />
            </Card>
        </div>
    );
}

// ─────────────────────────────────────────────
// MINI CHART
// ─────────────────────────────────────────────
function MiniChart({ data }) {
    if (!data?.length) return null;
    const max = Math.max(...data.map(d => d.sales), 1);
    return (
        <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 60 }}>
            {data.map((d, i) => (
                <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                    <div style={{ width: "100%", height: Math.max(Math.round((d.sales / max) * 48), 4), background: "linear-gradient(180deg,#3b82f6,#8b5cf6)", borderRadius: 4 }} />
                    <span style={{ color: "#475569", fontSize: 10 }}>{d.day}</span>
                </div>
            ))}
        </div>
    );
}

// ─────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────
export default function DukandarApp() {
    const [user, setUser] = useState(null);
    const [page, setPage] = useState("dashboard");
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const [pendingCount, setPendingCount] = useState(0);
    const isMobile = useIsMobile();

    useEffect(() => {
        const on = async () => {
            setIsOnline(true);
            const result = await syncPendingData();
            console.log("[Dukandar] Auto-sync on reconnect:", result);
        };
        const off = () => setIsOnline(false);
        window.addEventListener("online", on);
        window.addEventListener("offline", off);
        initOfflineSync();

        const checkPending = setInterval(async () => {
            const count = await getPendingCount();
            setPendingCount(count);
        }, 5000);

        return () => {
            window.removeEventListener("online", on);
            window.removeEventListener("offline", off);
            clearInterval(checkPending);
        };
    }, []);

    if (!user) return <LoginPage onLogin={setUser} />;

    const pages = {
        dashboard: <DashboardPage />,
        orders: <OrdersPage />,
        products: <ProductsPage />,
        customers: <CustomersPage />,
        suppliers: <SuppliersPage />,
        inventory: <InventoryPage />,
        salesmen: <SalesmenPage />,
        stitchers: <StitchersPage />,
        assets: <AssetsPage />,
        payroll: <PayrollPage />,
        reports: <ReportsPage />,
        accounts: <AccountsPage />,
        expenses: <ExpensesPage />,
        payment_methods: <PaymentMethodsPage />,
        ledger_view: <PaymentLedgerPage />,
        settings: <SettingsPage user={user} />,
    };

    return (
        <AppContext.Provider value={{ user, isOnline, isMobile }}>
            <ToastHost />
            <style>{`
                @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Syne:wght@700;800&display=swap');
                * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
                html, body { background: #0f172a; overscroll-behavior-y: contain; }
                body { -webkit-text-size-adjust: 100%; }
                ::-webkit-scrollbar { width: 4px; height: 4px; }
                ::-webkit-scrollbar-track { background: #0f172a; }
                ::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
                input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; }
                input, select, textarea, button { font-size: 16px; }
                @keyframes spin { to { transform: rotate(360deg); } }
                @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
                .spin { animation: spin 0.8s linear infinite; }

                /* Responsive helpers used across page components — grids/forms opt in via
                   className so they collapse to one column and tables scroll instead of
                   overflowing the viewport on phones. */
                .responsive-grid { display: grid; gap: 16px; }
                .responsive-table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
                @media (max-width: 767px) {
                    .responsive-grid { grid-template-columns: 1fr !important; }
                    .hide-mobile { display: none !important; }
                    .page-padding { padding: 14px !important; }
                }
                @media (min-width: 768px) {
                    .hide-desktop { display: none !important; }
                }
            `}</style>
            <div style={{ display: "flex", minHeight: "100vh", fontFamily: "'DM Sans', sans-serif", background: "#0f172a" }}>
                <Sidebar page={page} setPage={setPage} collapsed={sidebarCollapsed} setCollapsed={setSidebarCollapsed} mobileOpen={mobileNavOpen} setMobileOpen={setMobileNavOpen} />
                <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
                    <Topbar page={page} user={user} onLogout={() => setUser(null)} isOnline={isOnline} onNavigate={setPage} pendingCount={pendingCount} onMenuTap={() => setMobileNavOpen(true)} />
                    <main style={{ flex: 1, overflowY: "auto", paddingBottom: isMobile ? "calc(56px + env(safe-area-inset-bottom))" : 0 }}>
                        {pages[page] || <DashboardPage />}
                    </main>
                    {isMobile && <MobileBottomNav page={page} setPage={setPage} onMore={() => setMobileNavOpen(true)} />}
                </div>
            </div>
        </AppContext.Provider>
    );
}



