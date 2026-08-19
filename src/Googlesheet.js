/**
 * googlesheet.js
 * Dukandar ERP — Frontend API Helper  v5.0
 * + Enhanced Offline Support (IndexedDB with auto-sync)
 * + Payroll Batch Creation
 * + Full order editing
 * + Stitcher Management & Ledger
 * + Supplier Payments & Ledger
 * + Inventory v2 (multi-method payments, edit/delete)
 * + createSupplierReturn (restored)
 */

const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyDrhlxu4JeuAKxUVAbjGJ1Sy3pd9IvbQvsFa_IOZmCZjoPuUkAVRHv4dCYS0MDTZQqxw/exec";

const DB_NAME = "DukandarOfflineDB";
const DB_VERSION = 1;
const STORE_NAME = "pendingRequests";

// ─────────────────────────────────────────────
// OFFLINE DATABASE SETUP
// ─────────────────────────────────────────────
function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export async function saveOfflineData(payload) {
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        store.add({ ...payload, savedAt: new Date().toISOString(), status: "pending" });
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => { db.close(); resolve(true); };
            tx.onerror = () => { db.close(); reject(tx.error); };
        });
    } catch (err) {
        console.warn("[Dukandar Offline] IndexedDB unavailable, using localStorage:", err);
        const queue = JSON.parse(localStorage.getItem("dukandar_offline_queue") || "[]");
        queue.push({ ...payload, savedAt: new Date().toISOString(), status: "pending" });
        localStorage.setItem("dukandar_offline_queue", JSON.stringify(queue));
    }
}

export async function syncPendingData() {
    if (!navigator.onLine) return { synced: 0, failed: 0, skipped: true };
    let synced = 0, failed = 0;

    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const all = await new Promise((resolve, reject) => {
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });

        for (const item of all) {
            try {
                const body = new URLSearchParams();
                body.append("payload", JSON.stringify({ action: item.action, data: item.data }));
                const result = await fetch(SCRIPT_URL, { method: "POST", body, redirect: "follow" });
                if (result.ok) {
                    await result.text();
                    store.delete(item.id);
                    synced++;
                } else {
                    failed++;
                }
            } catch (err) {
                console.error("[Dukandar Sync] Error syncing:", err);
                failed++;
            }
        }

        await new Promise((res) => { tx.oncomplete = res; });
        db.close();
    } catch (err) {
        console.warn("[Dukandar Sync] IndexedDB sync error:", err);
    }

    // Also sync from localStorage queue
    const queue = JSON.parse(localStorage.getItem("dukandar_offline_queue") || "[]");
    const remaining = [];
    for (const item of queue) {
        try {
            const body = new URLSearchParams();
            body.append("payload", JSON.stringify({ action: item.action, data: item.data }));
            const result = await fetch(SCRIPT_URL, { method: "POST", body, redirect: "follow" });
            if (result.ok) {
                synced++;
            } else {
                remaining.push(item);
                failed++;
            }
        } catch (err) {
            console.warn("[Dukandar Sync] LocalStorage sync error for action", item.action, ":", err);
            remaining.push(item);
            failed++;
        }
    }
    localStorage.setItem("dukandar_offline_queue", JSON.stringify(remaining));

    console.log(`[Dukandar Sync] Complete — synced: ${synced}, failed: ${failed}`);
    return { synced, failed };
}

export function initOfflineSync() {
    window.addEventListener("online", async () => {
        console.log("[Dukandar] Back online — starting auto-sync");
        const result = await syncPendingData();
        console.log("[Dukandar] Auto-sync complete:", result);
    });
}

export async function getPendingCount() {
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const count = await new Promise((resolve, reject) => {
            const req = store.count();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        db.close();
        const localQueue = JSON.parse(localStorage.getItem("dukandar_offline_queue") || "[]");
        return count + localQueue.length;
    } catch (err) {
        console.error("[Dukandar] Error getting pending count:", err);
        const localQueue = JSON.parse(localStorage.getItem("dukandar_offline_queue") || "[]");
        return localQueue.length;
    }
}

// ─────────────────────────────────────────────
// BASE POST – sends payload as URLSearchParams
// ─────────────────────────────────────────────
async function apiCall(action, data = {}) {
    const payload = JSON.stringify({ action, data });

    console.log(`[Dukandar POST] action="${action}"`, data);

    if (!navigator.onLine) {
        console.warn(`[Dukandar POST] Offline — queuing "${action}"`);
        await saveOfflineData({ action, data });
        return { success: false, offline: true, message: "Saved offline. Will sync when online." };
    }

    try {
        const body = new URLSearchParams();
        body.append("payload", payload);

        const response = await fetch(SCRIPT_URL, {
            method: "POST",
            body,
            redirect: "follow",
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const text = await response.text();
        console.log(`[Dukandar POST] raw response for "${action}":`, text.slice(0, 300));

        let parsed;
        try {
            parsed = JSON.parse(text);
        } catch {
            const trimmed = text.trim();
            const jsonMatch = trimmed.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
            if (jsonMatch) {
                try {
                    parsed = JSON.parse(jsonMatch[1]);
                } catch {
                    console.error("[Dukandar POST] Could not parse response for action '" + action + "':", text);
                    return { success: false, error: "Server returned invalid JSON." };
                }
            } else {
                console.error("[Dukandar POST] Non-JSON response for action '" + action + "':", text);
                return { success: false, error: "Server returned unexpected response." };
            }
        }

        console.log(`[Dukandar POST] parsed response for "${action}":`, parsed);

        if (!parsed.success) {
            console.error(`[Dukandar POST] Backend error for "${action}":`, parsed.error || parsed.message);
        }

        return parsed;

    } catch (error) {
        console.error(`[Dukandar API] POST "${action}" failed:`, error);
        await saveOfflineData({ action, data });
        return { success: false, error: error.message, offline: true };
    }
}

// ─────────────────────────────────────────────
// BASE GET
// ─────────────────────────────────────────────
async function apiGet(action, params = {}) {
    const url = new URL(SCRIPT_URL);
    url.searchParams.set("action", action);
    Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
    });

    console.log(`[Dukandar GET] action="${action}"`, params);

    try {
        const response = await fetch(url.toString(), { method: "GET", redirect: "follow" });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const text = await response.text();
        console.log(`[Dukandar GET] raw response for "${action}":`, text.slice(0, 300));

        let parsed;
        try {
            parsed = JSON.parse(text);
        } catch {
            console.error("[Dukandar GET] Non-JSON response for action '" + action + "':", text);
            return { success: false, error: "Invalid JSON from server", raw: text };
        }

        if (!parsed.success) {
            console.error(`[Dukandar GET] Backend error for "${action}":`, parsed.error);
        }

        return parsed;

    } catch (error) {
        console.error(`[Dukandar API] GET "${action}" failed:`, error);
        return { success: false, error: error.message };
    }
}

// ─────────────────────────────────────────────
// AUTHENTICATION
// ─────────────────────────────────────────────
export async function login(username, password) {
    const result = await apiCall("loginUser", { username, password });
    if (result.success && result.user) {
        localStorage.setItem("dukandar_user", JSON.stringify(result.user));
    }
    return result;
}

export function logout() {
    localStorage.removeItem("dukandar_user");
    localStorage.removeItem("dukandar_token");
}

export function getCurrentUser() {
    try { return JSON.parse(localStorage.getItem("dukandar_user") || "null"); } catch { return null; }
}

// ─────────────────────────────────────────────
// PRODUCTS
// ─────────────────────────────────────────────
export async function getProducts() {
    return await apiGet("getProducts");
}

export async function addProduct(product) {
    return await apiCall("addProduct", product);
}

export async function updateProduct(productId, updates) {
    if (!productId) return { success: false, error: "Missing productId" };
    return await apiCall("updateProduct", { productId, ...updates });
}

export async function deleteProduct(productId) {
    if (!productId) return { success: false, error: "Missing productId" };
    return await apiCall("deleteProduct", { productId });
}

// ─────────────────────────────────────────────
// ORDERS
// ─────────────────────────────────────────────
export async function getOrders(filters = {}) {
    return await apiGet("getOrders", filters);
}

export async function createOrder(order) {
    return await apiCall("createOrder", order);
}

export async function updateOrder(orderId, updates) {
    if (!orderId) return { success: false, error: "Missing orderId" };
    return await apiCall("updateOrder", { orderId, ...updates });
}

export async function updateOrderFull(orderId, updates) {
    if (!orderId) return { success: false, error: "Missing orderId" };
    return await apiCall("updateOrderFull", { orderId, ...updates });
}

export async function assignStitcherToOrder(data) {
    return await apiCall("assignStitcherToOrder", data);
}

export async function updateOrderStitchStatus(data) {
    return await apiCall("updateOrderStitchStatus", data);
}

// ─────────────────────────────────────────────
// CUSTOMERS
// ─────────────────────────────────────────────
export async function getCustomers() {
    return await apiGet("getCustomers");
}

export async function addCustomer(customer) {
    return await apiCall("addCustomer", customer);
}

export async function updateCustomer(customerId, updates) {
    if (!customerId) return { success: false, error: "Missing customerId" };
    return await apiCall("updateCustomer", { customerId, ...updates });
}

export async function deleteCustomer(customerId) {
    if (!customerId) return { success: false, error: "Missing customerId" };
    return await apiCall("deleteCustomer", { customerId });
}

// ─────────────────────────────────────────────
// SUPPLIERS
// ─────────────────────────────────────────────
export async function getSuppliers() {
    return await apiGet("getSuppliers");
}

export async function addSupplier(supplier) {
    return await apiCall("addSupplier", supplier);
}

export async function updateSupplier(supplierId, updates) {
    if (!supplierId) return { success: false, error: "Missing supplierId" };
    return await apiCall("updateSupplier", { supplierId, ...updates });
}

export async function deleteSupplier(supplierId) {
    if (!supplierId) return { success: false, error: "Missing supplierId" };
    return await apiCall("deleteSupplier", { supplierId });
}

export async function createSupplierReturn(returnData) {
    return await apiCall("createSupplierReturn", returnData);
}

export async function addSupplierPayment(data) {
    return await apiCall("addSupplierPayment", data);
}

export async function getSupplierPayments(filters = {}) {
    return await apiGet("getSupplierPayments", filters);
}

export async function getSupplierLedger(filters = {}) {
    return await apiGet("getSupplierLedger", filters);
}

// ─────────────────────────────────────────────
// INVENTORY
// ─────────────────────────────────────────────
export async function getInventory(filters = {}) {
    return await apiGet("getInventory", filters);
}

export async function addInventory(entry) {
    return await apiCall("addInventory", entry);
}

export async function updateInventory(inventoryId, updates) {
    if (!inventoryId) return { success: false, error: "Missing inventoryId" };
    return await apiCall("updateInventory", { inventoryId, ...updates });
}

export async function deleteInventory(inventoryId) {
    if (!inventoryId) return { success: false, error: "Missing inventoryId" };
    return await apiCall("deleteInventory", { inventoryId });
}

// ─────────────────────────────────────────────
// EXPENSES
// ─────────────────────────────────────────────
export async function getExpenses(filters = {}) {
    return await apiGet("getExpenses", filters);
}

export async function addExpense(expense) {
    return await apiCall("addExpense", expense);
}

export async function updateExpense(expenseId, updates) {
    if (!expenseId) return { success: false, error: "Missing expenseId" };
    return await apiCall("updateExpense", { expenseId, ...updates });
}

export async function deleteExpense(expenseId) {
    if (!expenseId) return { success: false, error: "Missing expenseId" };
    return await apiCall("deleteExpense", { expenseId });
}

// ─────────────────────────────────────────────
// PAYROLL
// ─────────────────────────────────────────────
export async function getPayroll(month) {
    return await apiGet("getPayroll", { month });
}

export async function getPayrollHistory(month) {
    return await apiGet("getPayrollHistory", { month });
}

export async function addSalary(salary) {
    return await apiCall("addSalary", salary);
}

export async function markPayrollPaid(data) {
    if (!data || !data.id) return { success: false, error: "Missing payroll id" };
    return await apiCall("markPayrollPaid", data);
}

export async function createPayrollBatch(data) {
    return await apiCall("createPayrollBatch", data);
}

// ─────────────────────────────────────────────
// SALARY SHEET
// ─────────────────────────────────────────────
export async function getSalarySheet(params = {}) {
    return await apiGet("getSalarySheet", params);
}

export async function saveSalarySheetEntry(data) {
    return await apiCall("saveSalarySheetEntry", data);
}

export async function deleteSalarySheetEntry(id) {
    if (!id) return { success: false, error: "Missing id" };
    return await apiCall("deleteSalarySheetEntry", { id });
}

export async function markSalarySheetPaid(data) {
    return await apiCall("markSalarySheetPaid", data);
}

export async function paySalarySheetEntry(data) {
    if (!data || !data.id) return { success: false, error: "Missing salary entry id" };
    if (!(parseFloat(data.amount) > 0)) return { success: false, error: "Payment amount must be greater than 0" };
    return await apiCall("paySalarySheetEntry", data);
}

export async function reopenSalarySheetEntry(id) {
    if (!id) return { success: false, error: "Missing id" };
    return await apiCall("reopenSalarySheetEntry", { id });
}

// ─────────────────────────────────────────────
// SALESMEN
// ─────────────────────────────────────────────
export async function getSalesmen() {
    return await apiGet("getSalesmen");
}

export async function addSalesman(salesman) {
    return await apiCall("addSalesman", salesman);
}

export async function updateSalesman(salesmanId, updates) {
    if (!salesmanId) return { success: false, error: "Missing salesmanId" };
    return await apiCall("updateSalesman", { salesmanId, ...updates });
}

export async function deleteSalesman(salesmanId) {
    if (!salesmanId) return { success: false, error: "Missing salesmanId" };
    return await apiCall("deleteSalesman", { salesmanId });
}

export async function addSalesmanPayment(data) {
    return await apiCall("addSalesmanPayment", data);
}

// ─────────────────────────────────────────────
// STITCHERS
// ─────────────────────────────────────────────
export async function getStitchers(filters = {}) {
    return await apiGet("getStitchers", filters);
}

export async function addStitcher(stitcher) {
    return await apiCall("addStitcher", stitcher);
}

export async function updateStitcher(stitcherId, updates) {
    if (!stitcherId) return { success: false, error: "Missing stitcherId" };
    return await apiCall("updateStitcher", { stitcherId, ...updates });
}

export async function deleteStitcher(stitcherId) {
    if (!stitcherId) return { success: false, error: "Missing stitcherId" };
    return await apiCall("deleteStitcher", { stitcherId });
}

export async function addStitcherPayment(data) {
    return await apiCall("addStitcherPayment", data);
}

export async function getStitcherPayments(filters = {}) {
    return await apiGet("getStitcherPayments", filters);
}

export async function getStitcherLedger(filters = {}) {
    return await apiGet("getStitcherLedger", filters);
}

export async function getOrderStitching(filters = {}) {
    return await apiGet("getOrderStitching", filters);
}

export async function getStitcherDashboard() {
    return await apiGet("getStitcherDashboard");
}

// ─────────────────────────────────────────────
// ASSETS
// ─────────────────────────────────────────────
export async function getAssets() {
    return await apiGet("getAssets");
}

export async function addAsset(asset) {
    return await apiCall("addAsset", asset);
}

export async function updateAsset(assetId, updates) {
    if (!assetId) return { success: false, error: "Missing assetId" };
    return await apiCall("updateAsset", { assetId, ...updates });
}

export async function deleteAsset(assetId) {
    if (!assetId) return { success: false, error: "Missing assetId" };
    return await apiCall("deleteAsset", { assetId });
}

export async function addAssetMaintenance(data) {
    return await apiCall("addAssetMaintenance", data);
}

// ─────────────────────────────────────────────
// REPORTS
// ─────────────────────────────────────────────
export async function getSalesReport(startDate, endDate) {
    return await apiGet("getSalesReport", { startDate, endDate });
}

export async function getProfitReport(startDate, endDate) {
    return await apiGet("getProfitReport", { startDate, endDate });
}

export async function getCustomerReport(customerId = "") {
    return await apiGet("getCustomerReport", { customerId });
}

// ─────────────────────────────────────────────
// ACCOUNTING
// ─────────────────────────────────────────────
export async function getLedger(filters = {}) {
    return await apiGet("getLedger", filters);
}

export async function getBalanceSheet() {
    return await apiGet("getBalanceSheet");
}