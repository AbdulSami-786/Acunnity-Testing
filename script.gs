/**
 * script.gs
 * Dukandar ERP — Google Apps Script Backend  v6.1
 * + Per-item salesman commission (manual amount/percent)
 * + Full Order Edit (updateOrderFull)
 * + Stitcher Pay auto-credited on order creation
 * + clientStitchingCharge added to bill; stitcherPay goes to stitcher account
 * + Zero-item orders allowed (stitching-only bills)
 * + Payroll Batch Creation
 * + Complete Payroll History
 * + Salesman Salary Sheet (monthly entries with categories)
 *
 * NOTE: This file was originally pasted into chat on 2026-08-20 as a PARTIAL copy that
 * cut off mid-way through createSupplierReturn(). On 2026-08-20 the remaining sections
 * below (createSupplierReturn onward) were RECONSTRUCTED BY INFERENCE from the frontend
 * calling code — src/Googlesheet.js (every apiCall/apiGet action name + payload shape)
 * and src/Dukandar.jsx (every call site, form field, and response field actually read) —
 * NOT copied from the real deployed Apps Script source, which was not available.
 *
 * Reconstructed sections (review each against the real deployed script before redeploying):
 *   - createSupplierReturn (finished — body was cut off mid-statement)
 *   - addSupplierPayment / getSupplierPayments / getSupplierLedger
 *   - Inventory: getInventory / addInventory / updateInventory / deleteInventory
 *   - Expenses: getExpenses / addExpense / updateExpense / deleteExpense
 *   - createLedgerEntry / removeLedgerEntriesForOrder / getLedger / getBalanceSheet
 *   - Salesmen: getSalesmen / addSalesman / updateSalesman / deleteSalesman /
 *     addSalesmanPayment / updateSalesmanStats / reverseSalesmanStats /
 *     applyItemSalesmenCommissions / applyItemSalesmenCommissionsReverse
 *   - Assets / AssetMaintenance: getAssets / addAsset / updateAsset / deleteAsset /
 *     addAssetMaintenance
 *   - Payroll: getPayroll / getPayrollHistory / addSalary / markPayrollPaid /
 *     createPayrollBatch  (NOT called anywhere in the current Dukandar.jsx UI — no
 *     frontend contract to verify against; shape inferred purely from the Payroll
 *     sheet schema and the SalarySheet feature it parallels)
 *   - Salary Sheet: getSalarySheet / saveSalarySheetEntry / deleteSalarySheetEntry /
 *     paySalarySheetEntry / markSalarySheetPaid / reopenSalarySheetEntry
 *   - Reports: getSalesReport / getProfitReport / getCustomerReport  (also NOT called
 *     anywhere in Dukandar.jsx — ReportsPage computes everything client-side from
 *     getOrders/getExpenses/getProducts instead — shape inferred from the Orders/
 *     OrderItems/Expenses schemas only)
 *
 * Highest-risk spots a human should double check before redeploying:
 *   - Ledger sign convention (debit = increases what's owed to us / decreases our cash
 *     liability; credit = the opposite) was inferred from createOrder/updateOrder's
 *     existing "sale" (debit=total) and "payment"/"creditPayment" (credit=amount) calls
 *     and applied consistently to every new ledger-writing function below.
 *   - Id prefixes for new entity types (INV, EXP, LDG, SM, SLM-PAY, AST, AME, PYR, SAL)
 *     are guesses — pick short 3-4 letter prefixes that don't collide with existing ones.
 *   - Status string values ("paid"/"partial"/"pending" for SalarySheet, "active" for
 *     Assets/Salesmen, etc.) were matched to literal strings compared against in
 *     Dukandar.jsx where a call site existed; where no call site existed (Payroll,
 *     Reports) they are best-effort guesses only.
 *   - applyItemSalesmenCommissions' commission math (percent = % of that line's
 *     qty*price, amount = flat value per line) is inferred from the item shape in
 *     OrdersPage's cart (commissionType/commissionValue) but the exact formula was
 *     never visible server-side — verify against the real script.
 *   - addExpense accepts BOTH a multi-method `payments` object (from ExpensesPage's
 *     MultiPaymentInput form) and a plain string method (from creditStitcherEarnings'
 *     internal call) — verify the real backend actually supports both shapes.
 *   - getBalanceSheet / getSalesReport / getProfitReport / getCustomerReport / Payroll
 *     functions have NO frontend call site in the current Dukandar.jsx build to verify
 *     field names against — their response shapes are best-effort and should be treated
 *     as placeholders pending confirmation from the real source or future frontend use.
 *
 * PERFORMANCE (added 2026-08-20, on top of the reconstruction above): the live app was
 * reported slow — every page switch re-fetches its lists, and each Apps Script Web App
 * request already pays real latency (cold start + a fresh SpreadsheetApp.openById() +
 * full sheet reads) on its own. doGet now serves cached whole-response JSON via
 * CacheService (cachedRouteGet/getCacheGeneration/bumpCacheGeneration, ~30s TTL) instead
 * of calling routeGet directly every time; doPost bumps a "cache generation" counter after
 * every successful write so the next read after a save/delete is never served stale data.
 * This is new, untested-against-production logic — verify a save/delete is reflected
 * immediately on the next read before relying on it.
 */

// This must be the bare Sheet ID only — NOT the "/d/…" part of the URL. A "d/" prefix
// makes SpreadsheetApp.openById() throw and every request fails.
var SPREADSHEET_ID = "1SUWHzXoBlcNQ23867n-_33cq9E2sDTHAWpM-E2WDiIA";

var SHEETS = {
  Products:          "Products",
  Customers:         "Customers",
  Orders:            "Orders",
  OrderItems:        "OrderItems",
  Suppliers:         "Suppliers",
  Inventory:         "Inventory",
  Expenses:          "Expenses",
  Ledger:            "Ledger",
  Payments:          "Payments",
  Payroll:           "Payroll",
  Users:             "Users",
  Settings:          "Settings",
  Salesmen:          "Salesmen",
  SalesmenPayments:  "SalesmenPayments",
  Assets:            "Assets",
  AssetMaintenance:  "AssetMaintenance",
  Stitchers:         "Stitchers",
  StitcherPayments:  "StitcherPayments",
  StitcherLedger:    "StitcherLedger",
  OrderStitching:    "OrderStitching",
  // NEW
  SalarySheet:       "SalarySheet", // Monthly salary entries for salesmen
};

// ─────────────────────────────────────────────
// MENU
// ─────────────────────────────────────────────
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu("Dukandar ERP")
    .addItem("Setup All Sheets", "setupSheets")
    .addItem("Repair Orders Sheet Headers", "repairOrdersSheet")
    .addToUi();
}

// ─────────────────────────────────────────────
// ENTRY POINTS
// ─────────────────────────────────────────────
function doGet(e) {
  try {
    var action = e.parameter.action;
    Logger.log("doGet: action=" + action + " params=" + JSON.stringify(e.parameter));
    var result = cachedRouteGet(action, e.parameter);
    return jsonResponse(result);
  } catch (err) {
    Logger.log("doGet ERROR: " + err.message);
    return jsonResponse({ success: false, error: err.message });
  }
}

function doPost(e) {
  try {
    var rawPayload;
    if (e.parameter && e.parameter.payload) {
      rawPayload = e.parameter.payload;
    } else if (e.postData && e.postData.contents) {
      rawPayload = e.postData.contents;
    } else {
      return jsonResponse({ success: false, error: "No payload received." });
    }
    var payload = JSON.parse(rawPayload);
    var action  = payload.action;
    var data    = payload.data || {};
    Logger.log("doPost: action=" + action + " data=" + JSON.stringify(data).slice(0, 300));
    var result = routePost(action, data);
    // Any successful write can change what a subsequent GET would return (stock,
    // balances, totals, etc.) — bump the cache "generation" instead of tracking exactly
    // which cached reads this action could have affected. Failed/offline-style writes
    // (result.success === false) leave the generation untouched.
    if (result && result.success) bumpCacheGeneration();
    return jsonResponse(result);
  } catch (err) {
    Logger.log("doPost ERROR: " + err.message);
    return jsonResponse({ success: false, error: "doPost error: " + err.message });
  }
}

// ─────────────────────────────────────────────
// GET RESPONSE CACHE (CacheService)
// Apps Script Web Apps pay real latency on every single request (cold start + a fresh
// SpreadsheetApp.openById() + full sheet reads), and the frontend re-fetches the same
// lists on every page switch. Cache whole GET responses for CACHE_TTL_SECONDS, keyed by
// action+params+generation, so a repeat read within the window skips the Sheet entirely.
// CacheService entries are capped at 100KB each — if a response is too large to cache
// (e.g. a very large Orders list), storage is skipped and the request just falls through
// to a live read, same as before caching existed.
// ─────────────────────────────────────────────
var CACHE_TTL_SECONDS = 30;
var CACHE_GENERATION_KEY = "dukandar_cache_gen";

function getCacheGeneration() {
  var cache = CacheService.getScriptCache();
  var gen = cache.get(CACHE_GENERATION_KEY);
  return gen || "0";
}

function bumpCacheGeneration() {
  var cache = CacheService.getScriptCache();
  var next = (parseInt(getCacheGeneration(), 10) + 1) % 1000000;
  cache.put(CACHE_GENERATION_KEY, String(next), 21600); // cap Apps Script allows, well past any real need
}

function cachedRouteGet(action, params) {
  var cache = CacheService.getScriptCache();
  var key = "get_" + getCacheGeneration() + "_" + action + "_" + JSON.stringify(params || {});
  // CacheService keys must be <= 250 chars — fall back to uncached if a param blob is huge.
  if (key.length <= 250) {
    var hit = cache.get(key);
    if (hit) {
      try { return JSON.parse(hit); } catch (e) { /* fall through to a live read */ }
    }
  }

  var result = routeGet(action, params);

  if (key.length <= 250 && result && result.success) {
    try {
      var serialized = JSON.stringify(result);
      if (serialized.length < 100000) cache.put(key, serialized, CACHE_TTL_SECONDS);
    } catch (e) { /* non-serializable or oversized — just skip caching this one */ }
  }

  return result;
}

function routeGet(action, params) {
  switch (action) {
    case "getProducts":           return getProducts(params);
    case "getOrders":             return getOrders(params);
    case "getCustomers":          return getCustomers(params);
    case "getSuppliers":          return getSuppliers(params);
    case "getInventory":          return getInventory(params);
    case "getExpenses":           return getExpenses(params);
    case "getPayroll":            return getPayroll(params);
    case "getPayrollHistory":     return getPayrollHistory(params);
    case "getSalesReport":        return getSalesReport(params);
    case "getProfitReport":       return getProfitReport(params);
    case "getCustomerReport":     return getCustomerReport(params);
    case "getLedger":             return getLedger(params);
    case "getBalanceSheet":       return getBalanceSheet();
    case "getSalesmen":           return getSalesmen(params);
    case "getAssets":             return getAssets(params);
    case "getStitchers":          return getStitchers(params);
    case "getStitcherPayments":   return getStitcherPayments(params);
    case "getStitcherLedger":     return getStitcherLedger(params);
    case "getOrderStitching":     return getOrderStitching(params);
    case "getStitcherDashboard":  return getStitcherDashboard(params);
    case "getSupplierPayments":   return getSupplierPayments(params);
    case "getSupplierLedger":     return getSupplierLedger(params);
    // NEW
    case "getSalarySheet":        return getSalarySheet(params);
    default: return { success: false, error: "Unknown GET action: " + action };
  }
}

function routePost(action, data) {
  switch (action) {
    case "loginUser":              return loginUser(data);
    case "addProduct":             return addProduct(data);
    case "updateProduct":          return updateProduct(data);
    case "deleteProduct":          return deleteProduct(data);
    case "createOrder":            return createOrder(data);
    case "updateOrder":            return updateOrder(data);
    case "updateOrderFull":        return updateOrderFull(data);
    case "assignStitcherToOrder":  return assignStitcherToOrder(data);
    case "updateOrderStitchStatus":return updateOrderStitchStatus(data);
    case "addCustomer":            return addCustomer(data);
    case "updateCustomer":         return updateCustomer(data);
    case "deleteCustomer":         return deleteCustomer(data);
    case "addSupplier":            return addSupplier(data);
    case "updateSupplier":         return updateSupplier(data);
    case "deleteSupplier":         return deleteSupplier(data);
    case "createSupplierReturn":   return createSupplierReturn(data);
    case "addInventory":           return addInventory(data);
    case "updateInventory":        return updateInventory(data);
    case "deleteInventory":        return deleteInventory(data);
    case "addSupplierPayment":     return addSupplierPayment(data);
    case "addExpense":             return addExpense(data);
    case "updateExpense":          return updateExpense(data);
    case "deleteExpense":          return deleteExpense(data);
    case "addSalary":              return addSalary(data);
    case "markPayrollPaid":        return markPayrollPaid(data);
    case "createPayrollBatch":     return createPayrollBatch(data);
    case "addSalesman":            return addSalesman(data);
    case "updateSalesman":         return updateSalesman(data);
    case "deleteSalesman":         return deleteSalesman(data);
    case "addSalesmanPayment":     return addSalesmanPayment(data);
    case "addAsset":               return addAsset(data);
    case "updateAsset":            return updateAsset(data);
    case "deleteAsset":            return deleteAsset(data);
    case "addAssetMaintenance":    return addAssetMaintenance(data);
    case "addStitcher":            return addStitcher(data);
    case "updateStitcher":         return updateStitcher(data);
    case "deleteStitcher":         return deleteStitcher(data);
    case "addStitcherPayment":     return addStitcherPayment(data);
    // NEW
    case "saveSalarySheetEntry":   return saveSalarySheetEntry(data);
    case "deleteSalarySheetEntry": return deleteSalarySheetEntry(data);
    case "paySalarySheetEntry":    return paySalarySheetEntry(data);
    case "markSalarySheetPaid":    return markSalarySheetPaid(data);
    case "reopenSalarySheetEntry": return reopenSalarySheetEntry(data);
    default: return { success: false, error: "Unknown POST action: " + action };
  }
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function getSheet(name) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error("Sheet not found: " + name + ". Run setupSheets() first.");
  return sheet;
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function generateId(prefix) {
  return prefix + "-" + new Date().getTime().toString().slice(-8);
}

function today() {
  return Utilities.formatDate(new Date(), "Asia/Karachi", "yyyy-MM-dd");
}

function now() {
  return Utilities.formatDate(new Date(), "Asia/Karachi", "yyyy-MM-dd HH:mm:ss");
}

function sheetToObjects(sheet) {
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  var headers = data[0];
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var row = {};
    for (var j = 0; j < headers.length; j++) {
      row[headers[j]] = data[i][j];
    }
    rows.push(row);
  }
  return rows;
}

function findRowIndex(sheet, fieldName, value) {
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var colIndex = headers.indexOf(fieldName);
  if (colIndex === -1) return -1;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][colIndex]).trim() === String(value).trim()) return i + 1;
  }
  return -1;
}

function updateCell(sheet, rowIndex, fieldName, newValue) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var colIndex = headers.indexOf(fieldName);
  if (colIndex === -1) throw new Error("Field not found: " + fieldName);
  sheet.getRange(rowIndex, colIndex + 1).setValue(newValue);
}

// Adds a header column to an existing sheet if it's missing, so we can extend a schema
// (e.g. Payroll.paymentMethod) without forcing the user to re-run setupSheets or lose data.
function ensureColumn(sheet, colName) {
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  if (headers.indexOf(colName) !== -1) return;
  sheet.getRange(1, lastCol + 1).setValue(colName);
}

function updateStock(productId, delta) {
  var sheet = getSheet(SHEETS.Products);
  var rowIndex = findRowIndex(sheet, "id", productId);
  if (rowIndex === -1) return;
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var stockCol = headers.indexOf("stock") + 1;
  if (stockCol === 0) return;
  var current = parseFloat(sheet.getRange(rowIndex, stockCol).getValue()) || 0;
  sheet.getRange(rowIndex, stockCol).setValue(current + delta);
}

// ─────────────────────────────────────────────
// SETUP (UPDATED with SalarySheet and designation)
// ─────────────────────────────────────────────
function setupSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var schema = {
    Products:         ["id","name","category","brand","unit","purchasePrice","sellingPrice","stock","barcode","description","createdAt"],
    Customers:        ["id","name","phone","city","loyal","discount","balance","totalOrders","creditLimit","createdAt"],
    Orders:           ["id","customerId","customer","salesmanId","salesman","stitcherId","stitcher","stitchStatus","stitchCharge","stitcherPay","items","payments","total","paid","due","status","discount","date","createdAt"],
    OrderItems:       ["id","orderId","productId","productName","qty","price","total"],
    Suppliers:        ["id","name","phone","city","category","balance","createdAt"],
    Inventory:        ["id","supplierId","supplier","items","total","paid","due","payments","status","date","createdAt"],
    SupplierPayments: ["id","supplierId","supplierName","amount","method","note","date"],
    Expenses:         ["id","category","amount","payments","note","date"],
    Ledger:           ["id","type","accountId","accountName","description","debit","credit","balance","orderId","date"],
    Payments:         ["id","orderId","method","amount","date"],
    Payroll:          ["id","employeeId","employeeName","role","salary","bonus","deduction","net","month","status","paidAt","paymentMethod"],
    Users:            ["id","username","password","name","role","active"],
    Settings:         ["key","value"],
    Salesmen:         ["id","name","phone","city","designation","commissionRate","salary","joiningDate","status","totalSales","totalCommission","totalPaid","balance","notes"],
    SalesmenPayments: ["id","salesmanId","salesmanName","type","amount","month","note","date"],
    Assets:           ["id","name","category","purchaseDate","purchasePrice","currentValue","location","condition","serialNo","vendor","warrantyExpiry","notes","createdAt"],
    AssetMaintenance: ["id","assetId","assetName","type","cost","vendor","date","nextDue","notes"],
    Stitchers:        ["id","name","phone","city","joiningDate","status","totalOrders","totalPieces","totalEarnings","totalPaid","balance","paymentMethod","notes","createdAt"],
    StitcherPayments: ["id","stitcherId","stitcherName","type","amount","month","note","paymentMethod","date"],
    StitcherLedger:   ["id","stitcherId","stitcherName","type","description","debit","credit","balance","orderId","date"],
    OrderStitching:   ["id","orderId","stitcherId","stitcherName","assignedAt","assignedBy","pieces","stitcherPay","clientStitchingCharge","status","completedAt","notes"],
    // NEW
    SalarySheet:      ["id","salesmanId","salesmanName","designation","month","basicSalary","totalDays","workingDays","perDaySalary","payableSalary","commissionRate","monthlyWork","commissionAmount","otherAmount","salaryIncentive","bill","advance","netPayable","status","paidAt","notes","paidAmount","paymentMethod"],
  };

  for (var sheetName in schema) {
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) sheet = ss.insertSheet(sheetName);
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, schema[sheetName].length).setValues([schema[sheetName]]);
      sheet.getRange(1, 1, 1, schema[sheetName].length)
        .setBackground("#1a73e8").setFontColor("#ffffff").setFontWeight("bold");
    }
  }

  var usersSheet = ss.getSheetByName("Users");
  if (usersSheet.getLastRow() < 2) {
    usersSheet.appendRow(["USR-001","admin","123admin","Admin User","Admin",true]);
    usersSheet.appendRow(["USR-002","manager","manager123","Store Manager","Manager",true]);
  }

  var settingsSheet = ss.getSheetByName("Settings");
  if (settingsSheet.getLastRow() < 2) {
    settingsSheet.appendRow(["storeName","My Dukandar Store"]);
    settingsSheet.appendRow(["currency","Rs"]);
    settingsSheet.appendRow(["timezone","Asia/Karachi"]);
    settingsSheet.appendRow(["defaultCreditLimit","5000"]);
  }

  Logger.log("setupSheets: complete");
  try { SpreadsheetApp.getUi().alert("✅ Dukandar ERP v6.1 setup complete!"); } catch(e) {}
}

function repairOrdersSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEETS.Orders);
  if (!sheet) { sheet = ss.insertSheet(SHEETS.Orders); }

  var correctHeaders = [
    "id","customerId","customer","salesmanId","salesman",
    "stitcherId","stitcher","stitchStatus","stitchCharge","stitcherPay",
    "items","payments","total","paid","due","status","discount","date","createdAt"
  ];

  var data = sheet.getDataRange().getValues();
  var currentHeaders = data.length > 0 ? data[0] : [];

  if (currentHeaders.join(",") === correctHeaders.join(",")) {
    try { SpreadsheetApp.getUi().alert("✅ Orders sheet headers are already correct."); } catch(e) {}
    return;
  }

  var tempSheet = ss.insertSheet("_temp_orders_fix");
  tempSheet.getRange(1, 1, 1, correctHeaders.length).setValues([correctHeaders]);

  if (data.length > 1) {
    var oldColMap = {};
    for (var i = 0; i < currentHeaders.length; i++) {
      oldColMap[currentHeaders[i].toString().trim()] = i;
    }
    for (var row = 1; row < data.length; row++) {
      var newRow = [];
      for (var c = 0; c < correctHeaders.length; c++) {
        var hdr = correctHeaders[c];
        var oldIdx = oldColMap[hdr];
        newRow.push(oldIdx !== undefined ? data[row][oldIdx] : "");
      }
      tempSheet.appendRow(newRow);
    }
  }

  ss.deleteSheet(sheet);
  tempSheet.setName(SHEETS.Orders);
  try { SpreadsheetApp.getUi().alert("✅ Orders sheet repaired — stitcherPay column added."); } catch(e) {}
}

// ─────────────────────────────────────────────
// AUTHENTICATION
// ─────────────────────────────────────────────
function loginUser(data) {
  var sheet = getSheet(SHEETS.Users);
  var users = sheetToObjects(sheet);
  var user = users.find(function(u) {
    return u.username === data.username && u.password === data.password && u.active === true;
  });
  if (!user) return { success: false, message: "Invalid username or password." };
  return { success: true, user: { id: user.id, username: user.username, name: user.name, role: user.role } };
}

// ─────────────────────────────────────────────
// PRODUCTS
// ─────────────────────────────────────────────
function getProducts(params) {
  return { success: true, products: sheetToObjects(getSheet(SHEETS.Products)) };
}

function addProduct(data) {
  if (!data.name) return { success: false, error: "Product name is required." };
  var sheet = getSheet(SHEETS.Products);
  var id = generateId("PRD");
  sheet.appendRow([id, data.name, data.category||"", data.brand||"", data.unit||"Piece",
    parseFloat(data.purchasePrice)||0, parseFloat(data.sellingPrice)||0,
    parseFloat(data.stock)||0, data.barcode||"", data.description||"", now()]);
  return { success: true, id: id };
}

function updateProduct(data) {
  if (!data.productId) return { success: false, error: "productId is required." };
  var sheet = getSheet(SHEETS.Products);
  var rowIndex = findRowIndex(sheet, "id", data.productId);
  if (rowIndex === -1) return { success: false, error: "Product not found." };
  var fields = ["name","category","brand","unit","purchasePrice","sellingPrice","stock","barcode","description"];
  fields.forEach(function(f) { if (data[f] !== undefined) updateCell(sheet, rowIndex, f, data[f]); });
  return { success: true };
}

function deleteProduct(data) {
  if (!data.productId) return { success: false, error: "productId is required." };
  var sheet = getSheet(SHEETS.Products);
  var rowIndex = findRowIndex(sheet, "id", data.productId);
  if (rowIndex === -1) return { success: false, error: "Product not found." };
  sheet.deleteRow(rowIndex);
  return { success: true };
}

// ─────────────────────────────────────────────
// ORDERS
// ─────────────────────────────────────────────
function getOrders(params) {
  var orders = sheetToObjects(getSheet(SHEETS.Orders));
  if (params.startDate)  orders = orders.filter(function(o){ return o.date >= params.startDate; });
  if (params.endDate)    orders = orders.filter(function(o){ return o.date <= params.endDate; });
  if (params.customerId) orders = orders.filter(function(o){ return String(o.customerId) === String(params.customerId); });
  if (params.stitcherId) orders = orders.filter(function(o){ return String(o.stitcherId) === String(params.stitcherId); });
  return { success: true, orders: orders };
}

function createOrder(data) {
  Logger.log("createOrder: customer=" + data.customer + " total=" + data.total);

  var hasItems = (data.items && data.items.length > 0);
  var clientStitchingCharge = parseFloat(data.clientStitchingCharge) || 0;
  var stitcherPay           = parseFloat(data.stitcherPay) || 0;

  if (!hasItems && clientStitchingCharge <= 0) {
    return { success: false, error: "Order must have at least one product or a stitching charge." };
  }

  var orderId  = generateId("ORD");
  var total    = parseFloat(data.total) || 0;
  var paid     = parseFloat(data.paid) || 0;
  var due      = Math.max(0, total - paid);
  var discount = parseFloat(data.discount) || 0;
  var status   = due > 0.01 ? "credit" : "paid";
  var dateStr  = today();

  if (due > 0 && data.customerId) {
    var custSheet = getSheet(SHEETS.Customers);
    var customers = sheetToObjects(custSheet);
    var cust = customers.find(function(c){ return String(c.id) === String(data.customerId); });
    if (cust) {
      var creditLimit = parseFloat(cust.creditLimit) || 0;
      var curBalance  = parseFloat(cust.balance) || 0;
      var existingDue = curBalance < 0 ? Math.abs(curBalance) : 0;
      if (creditLimit > 0 && (existingDue + due) > creditLimit) {
        return {
          success: false,
          error: "Credit limit exceeded.",
          creditLimitExceeded: true,
          creditLimit: creditLimit,
          existingDue: existingDue,
          newDue: due,
        };
      }
    }
  }

  var itemsJson    = JSON.stringify(data.items || []);
  var paymentsJson = JSON.stringify(data.payments || {});

  var ordersSheet = getSheet(SHEETS.Orders);
  ordersSheet.appendRow([
    orderId,
    data.customerId  || "",
    data.customer    || "Walk-in",
    data.salesmanId  || "",
    data.salesman    || "",
    data.stitcherId  || "",
    data.stitcher    || "",
    data.stitcherId  ? "assigned" : "none",
    clientStitchingCharge,
    stitcherPay,
    itemsJson,
    paymentsJson,
    total, paid, due, status, discount,
    dateStr, now()
  ]);

  var itemsSheet = getSheet(SHEETS.OrderItems);
  (data.items || []).forEach(function(item) {
    var itemId = generateId("ITM");
    itemsSheet.appendRow([
      itemId, orderId,
      item.productId || "", item.name || item.productName || "",
      parseFloat(item.qty), parseFloat(item.price),
      parseFloat(item.qty) * parseFloat(item.price)
    ]);
    if (item.productId) updateStock(item.productId, -parseFloat(item.qty));
  });

  var paymentsSheet  = getSheet(SHEETS.Payments);
  var paymentMethods = data.payments || {};
  Object.keys(paymentMethods).forEach(function(method) {
    var amount = parseFloat(paymentMethods[method]) || 0;
    if (amount > 0) {
      paymentsSheet.appendRow([generateId("PAY"), orderId, method, amount, dateStr]);
      createLedgerEntry(
        "payment",
        data.customerId || "WALKIN",
        data.customer   || "Walk-in",
        "Payment via " + method + " for Order " + orderId,
        0, amount, orderId, dateStr
      );
    }
  });

  if (due > 0.01 && data.customerId) updateCustomerBalance(data.customerId, -due);

  createLedgerEntry(
    "sale",
    data.customerId || "WALKIN",
    data.customer   || "Walk-in",
    "Order " + orderId,
    total, 0, orderId, dateStr
  );

  var itemSalesmenApplied = applyItemSalesmenCommissions(data.items || []);
  if (Object.keys(itemSalesmenApplied).length === 0 && data.salesmanId) {
    updateSalesmanStats(data.salesmanId, total);
  }

  if (data.stitcherId && data.stitcher) {
    var pieces = parseInt(data.stitchPieces) ||
      (data.items
        ? data.items.reduce(function(s, i){ return s + parseInt(i.qty || 1); }, 0)
        : 1);

    createOrderStitchingRecord(
      orderId,
      data.stitcherId,
      data.stitcher,
      pieces,
      stitcherPay,
      clientStitchingCharge,
      "assigned",
      data.assignedBy || "admin"
    );

    if (stitcherPay > 0) {
      creditStitcherEarnings(data.stitcherId, data.stitcher, stitcherPay, pieces, orderId);
    }
  }

  return { success: true, orderId: orderId, total: total, paid: paid, due: due, status: status };
}

function creditStitcherEarnings(stitcherId, stitcherName, stitcherPay, pieces, orderId) {
  var sheet    = getSheet(SHEETS.Stitchers);
  var rowIndex = findRowIndex(sheet, "id", stitcherId);
  if (rowIndex === -1) return;

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  function getCol(name) { return headers.indexOf(name) + 1; }

  var curOrders   = parseInt(sheet.getRange(rowIndex, getCol("totalOrders")).getValue())   || 0;
  var curPieces   = parseInt(sheet.getRange(rowIndex, getCol("totalPieces")).getValue())   || 0;
  var curEarnings = parseFloat(sheet.getRange(rowIndex, getCol("totalEarnings")).getValue()) || 0;
  var curBal      = parseFloat(sheet.getRange(rowIndex, getCol("balance")).getValue())       || 0;

  sheet.getRange(rowIndex, getCol("totalOrders")).setValue(curOrders + 1);
  sheet.getRange(rowIndex, getCol("totalPieces")).setValue(curPieces + (pieces || 0));
  sheet.getRange(rowIndex, getCol("totalEarnings")).setValue(curEarnings + stitcherPay);
  sheet.getRange(rowIndex, getCol("balance")).setValue(curBal + stitcherPay);

  createStitcherLedgerEntry(
    stitcherId, stitcherName,
    "earning",
    "Stitcher Pay for Order " + orderId,
    0, stitcherPay, orderId
  );

  addExpense({
    category: "Stitching",
    amount:   stitcherPay,
    payments: "Cash",
    note:     "Stitcher Pay — Order " + orderId + " — " + stitcherName,
    date:     today(),
  });
}

function updateOrder(data) {
  Logger.log("updateOrder: data=" + JSON.stringify(data));
  if (!data || typeof data !== "object") return { success: false, error: "Missing request data." };
  if (!data.orderId) return { success: false, error: "orderId is required." };

  var sheet    = getSheet(SHEETS.Orders);
  var rowIndex = findRowIndex(sheet, "id", data.orderId);
  if (rowIndex === -1) return { success: false, error: "Order not found: " + data.orderId };

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  function findCol(candidates) {
    for (var i = 0; i < candidates.length; i++) {
      var idx = headers.indexOf(candidates[i]);
      if (idx !== -1) return idx + 1;
    }
    return -1;
  }

  var totalCol    = findCol(["total"]);
  var paidCol     = findCol(["paid"]);
  var dueCol      = findCol(["due"]);
  var statusCol   = findCol(["status"]);
  var custIdCol   = findCol(["customerId"]);
  var custNameCol = findCol(["customer","customerName"]);

  if (data.newPaymentAmount !== undefined) {
    var payAmt    = parseFloat(data.newPaymentAmount) || 0;
    var payMethod = data.newPaymentMethod || "Cash";
    var total     = parseFloat(sheet.getRange(rowIndex, totalCol).getValue()) || 0;
    var curPaid   = parseFloat(sheet.getRange(rowIndex, paidCol).getValue())  || 0;
    var newPaid   = curPaid + payAmt;
    var newDue    = Math.max(0, total - newPaid);
    var newStatus = newDue < 0.01 ? "paid" : "credit";

    sheet.getRange(rowIndex, paidCol).setValue(newPaid);
    sheet.getRange(rowIndex, dueCol).setValue(newDue);
    sheet.getRange(rowIndex, statusCol).setValue(newStatus);

    var paymentsSheet = getSheet(SHEETS.Payments);
    paymentsSheet.appendRow([generateId("PAY"), data.orderId, payMethod, payAmt, today()]);

    var customerId   = sheet.getRange(rowIndex, custIdCol).getValue();
    var customerName = sheet.getRange(rowIndex, custNameCol).getValue();

    createLedgerEntry(
      "creditPayment",
      customerId, customerName,
      "Credit payment via " + payMethod + " for Order " + data.orderId,
      0, payAmt, data.orderId, today()
    );

    if (customerId) updateCustomerBalance(customerId, payAmt);
    return { success: true, newPaid: newPaid, newDue: newDue, newStatus: newStatus };
  }

  if (data.status !== undefined && statusCol !== -1) updateCell(sheet, rowIndex, "status", data.status);
  return { success: true };
}

function updateOrderFull(data) {
  if (!data || !data.orderId) return { success: false, error: "orderId is required." };

  var ordersSheet = getSheet(SHEETS.Orders);
  var rowIndex    = findRowIndex(ordersSheet, "id", data.orderId);
  if (rowIndex === -1) return { success: false, error: "Order not found." };

  var headers   = ordersSheet.getRange(1, 1, 1, ordersSheet.getLastColumn()).getValues()[0];
  var rowValues = ordersSheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
  var oldOrder  = {};
  headers.forEach(function(h, i) { oldOrder[h] = rowValues[i]; });

  var oldItems = [];
  try { oldItems = JSON.parse(oldOrder.items || "[]"); } catch (e) {}

  oldItems.forEach(function(item) {
    if (item.productId) updateStock(item.productId, parseFloat(item.qty) || 0);
  });

  var oldGroups = applyItemSalesmenCommissionsReverse(oldItems);
  if (Object.keys(oldGroups).length === 0 && oldOrder.salesmanId) {
    reverseSalesmanStats(oldOrder.salesmanId, parseFloat(oldOrder.total) || 0);
  }

  // Reverse old stitcher earnings before re-applying the (possibly changed) assignment below.
  var osSheet = getSheet(SHEETS.OrderStitching);
  var osRow   = findRowIndex(osSheet, "orderId", data.orderId);
  if (osRow !== -1) {
    var osHeaders   = osSheet.getRange(1, 1, 1, osSheet.getLastColumn()).getValues()[0];
    var osRowValues = osSheet.getRange(osRow, 1, 1, osHeaders.length).getValues()[0];
    var oldStitcherRec = {};
    osHeaders.forEach(function(h, i) { oldStitcherRec[h] = osRowValues[i]; });
    var oldStitcherPay = parseFloat(oldStitcherRec.stitcherPay) || 0;
    if (oldStitcherRec.stitcherId && oldStitcherPay > 0) {
      reverseStitcherEarnings(oldStitcherRec.stitcherId, oldStitcherRec.stitcherName, oldStitcherPay, parseInt(oldStitcherRec.pieces) || 0);
    }
  }

  var newItems    = data.items || [];
  var newTotal    = parseFloat(data.total) || 0;
  var newPaid     = parseFloat(data.paid) || 0;
  var newDiscount = parseFloat(data.discount) || 0;
  var newDue      = Math.max(0, newTotal - newPaid);
  var newStatus   = newDue > 0.01 ? "credit" : "paid";

  newItems.forEach(function(item) {
    if (item.productId) updateStock(item.productId, -(parseFloat(item.qty) || 0));
  });

  var newGroups = applyItemSalesmenCommissions(newItems);
  if (Object.keys(newGroups).length === 0 && data.salesmanId) {
    updateSalesmanStats(data.salesmanId, newTotal);
  }

  var oldDue   = Math.max(0, (parseFloat(oldOrder.total) || 0) - (parseFloat(oldOrder.paid) || 0));
  var dueDelta = newDue - oldDue;
  if (data.customerId && dueDelta !== 0) updateCustomerBalance(data.customerId, -dueDelta);

  removeLedgerEntriesForOrder(data.orderId);

  function setCell(field, value) {
    var col = headers.indexOf(field);
    if (col !== -1) ordersSheet.getRange(rowIndex, col + 1).setValue(value);
  }
  setCell("customerId", data.customerId || "");
  setCell("customer",   data.customer   || "Walk-in");
  setCell("salesmanId", data.salesmanId || "");
  setCell("salesman",   data.salesman   || "");
  setCell("items",      JSON.stringify(newItems));
  setCell("payments",   JSON.stringify(data.payments || {}));
  setCell("total",      newTotal);
  setCell("paid",       newPaid);
  setCell("due",        newDue);
  setCell("status",     newStatus);
  setCell("discount",   newDiscount);
  setCell("stitcherId",   data.stitcherId || "");
  setCell("stitcher",     data.stitcher   || "");
  setCell("stitchCharge", parseFloat(data.clientStitchingCharge) || 0);
  setCell("stitcherPay",  parseFloat(data.stitcherPay) || 0);
  setCell("stitchStatus", data.stitcherId ? "assigned" : "none");

  var newStitcherPay  = parseFloat(data.stitcherPay) || 0;
  var newStitchCharge = parseFloat(data.clientStitchingCharge) || 0;
  if (data.stitcherId) {
    var newPieces = parseInt(data.stitchPieces) ||
      newItems.reduce(function(s, i){ return s + (parseInt(i.qty) || 1); }, 0);
    if (osRow !== -1) {
      updateCell(osSheet, osRow, "stitcherId",            data.stitcherId);
      updateCell(osSheet, osRow, "stitcherName",          data.stitcher || "");
      updateCell(osSheet, osRow, "pieces",                newPieces);
      updateCell(osSheet, osRow, "stitcherPay",           newStitcherPay);
      updateCell(osSheet, osRow, "clientStitchingCharge", newStitchCharge);
      updateCell(osSheet, osRow, "status",                "assigned");
      updateCell(osSheet, osRow, "completedAt",           "");
    } else {
      createOrderStitchingRecord(
        data.orderId, data.stitcherId, data.stitcher || "",
        newPieces, newStitcherPay, newStitchCharge, "assigned", data.assignedBy || "admin"
      );
    }
    if (newStitcherPay > 0) {
      creditStitcherEarnings(data.stitcherId, data.stitcher || "", newStitcherPay, newPieces, data.orderId);
    }
  } else if (osRow !== -1) {
    updateCell(osSheet, osRow, "status", "cancelled");
  }

  createLedgerEntry(
    "sale",
    data.customerId || "WALKIN",
    data.customer   || "Walk-in",
    "Order " + data.orderId + " (edited)",
    newTotal, 0, data.orderId, today()
  );
  var newPayments = data.payments || {};
  Object.keys(newPayments).forEach(function(method) {
    var amt = parseFloat(newPayments[method]) || 0;
    if (amt > 0) {
      createLedgerEntry(
        "payment", data.customerId || "WALKIN", data.customer || "Walk-in",
        "Payment via " + method + " for Order " + data.orderId + " (edited)",
        0, amt, data.orderId, today()
      );
    }
  });
  createLedgerEntry(
    "orderEdit",
    data.customerId || "WALKIN",
    data.customer   || "Walk-in",
    "Order " + data.orderId + " edited — total: " + (parseFloat(oldOrder.total)||0) + " → " + newTotal,
    0, 0, data.orderId, today()
  );

  return { success: true, orderId: data.orderId, total: newTotal, paid: newPaid, due: newDue, status: newStatus };
}

function assignStitcherToOrder(data) {
  if (!data.orderId || !data.stitcherId) return { success: false, error: "orderId and stitcherId required." };

  var ordersSheet = getSheet(SHEETS.Orders);
  var orderRow    = findRowIndex(ordersSheet, "id", data.orderId);
  if (orderRow === -1) return { success: false, error: "Order not found." };

  updateCell(ordersSheet, orderRow, "stitcherId",   data.stitcherId);
  updateCell(ordersSheet, orderRow, "stitcher",     data.stitcherName || "");
  updateCell(ordersSheet, orderRow, "stitchStatus", "assigned");
  updateCell(ordersSheet, orderRow, "stitchCharge", parseFloat(data.clientStitchingCharge) || 0);
  updateCell(ordersSheet, orderRow, "stitcherPay",  parseFloat(data.stitcherPay) || 0);

  var osSheet  = getSheet(SHEETS.OrderStitching);
  var existing = findRowIndex(osSheet, "orderId", data.orderId);
  var pieces         = parseInt(data.pieces) || 1;
  var stitcherPay    = parseFloat(data.stitcherPay) || 0;
  var stitchCharge   = parseFloat(data.clientStitchingCharge) || 0;

  if (existing !== -1) {
    var osData = sheetToObjects(osSheet);
    var oldRec = osData.find(function(r){ return String(r.orderId) === String(data.orderId); });
    if (oldRec && oldRec.stitcherId && String(oldRec.stitcherId) !== String(data.stitcherId)) {
      var oldPay = parseFloat(oldRec.stitcherPay) || 0;
      if (oldPay > 0) reverseStitcherEarnings(oldRec.stitcherId, oldRec.stitcherName, oldPay, parseInt(oldRec.pieces)||0);
    }
    updateCell(osSheet, existing, "stitcherId",            data.stitcherId);
    updateCell(osSheet, existing, "stitcherName",          data.stitcherName || "");
    updateCell(osSheet, existing, "assignedAt",            now());
    updateCell(osSheet, existing, "assignedBy",            data.assignedBy || "admin");
    updateCell(osSheet, existing, "pieces",                pieces);
    updateCell(osSheet, existing, "stitcherPay",           stitcherPay);
    updateCell(osSheet, existing, "clientStitchingCharge", stitchCharge);
    updateCell(osSheet, existing, "status",                "assigned");
    updateCell(osSheet, existing, "completedAt",           "");
  } else {
    createOrderStitchingRecord(
      data.orderId, data.stitcherId, data.stitcherName,
      pieces, stitcherPay, stitchCharge, "assigned", data.assignedBy || "admin"
    );
  }

  if (stitcherPay > 0) {
    creditStitcherEarnings(data.stitcherId, data.stitcherName, stitcherPay, pieces, data.orderId);
  }

  return { success: true };
}

function updateOrderStitchStatus(data) {
  if (!data.orderId) return { success: false, error: "orderId required." };

  var ordersSheet = getSheet(SHEETS.Orders);
  var orderRow    = findRowIndex(ordersSheet, "id", data.orderId);
  if (orderRow === -1) return { success: false, error: "Order not found." };
  updateCell(ordersSheet, orderRow, "stitchStatus", data.status);

  var osSheet = getSheet(SHEETS.OrderStitching);
  var osRow   = findRowIndex(osSheet, "orderId", data.orderId);

  if (osRow !== -1) {
    updateCell(osSheet, osRow, "status", data.status);
    if (data.status === "completed") {
      updateCell(osSheet, osRow, "completedAt", now());
    }
    if (data.notes) updateCell(osSheet, osRow, "notes", data.notes);
  }

  return { success: true };
}

function createOrderStitchingRecord(orderId, stitcherId, stitcherName, pieces, stitcherPay, clientStitchingCharge, status, assignedBy) {
  var sheet = getSheet(SHEETS.OrderStitching);
  var id    = generateId("OST");
  sheet.appendRow([
    id, orderId, stitcherId, stitcherName,
    now(), assignedBy,
    pieces,
    stitcherPay,
    clientStitchingCharge,
    status,
    "", ""
  ]);
}

function reverseStitcherEarnings(stitcherId, stitcherName, amount, pieces) {
  var sheet    = getSheet(SHEETS.Stitchers);
  var rowIndex = findRowIndex(sheet, "id", stitcherId);
  if (rowIndex === -1) return;
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  function getCol(name) { return headers.indexOf(name) + 1; }

  var curOrders   = parseInt(sheet.getRange(rowIndex, getCol("totalOrders")).getValue())     || 0;
  var curPieces   = parseInt(sheet.getRange(rowIndex, getCol("totalPieces")).getValue())     || 0;
  var curEarnings = parseFloat(sheet.getRange(rowIndex, getCol("totalEarnings")).getValue()) || 0;
  var curBal      = parseFloat(sheet.getRange(rowIndex, getCol("balance")).getValue())       || 0;

  sheet.getRange(rowIndex, getCol("totalOrders")).setValue(Math.max(0, curOrders - 1));
  sheet.getRange(rowIndex, getCol("totalPieces")).setValue(Math.max(0, curPieces - (pieces || 0)));
  sheet.getRange(rowIndex, getCol("totalEarnings")).setValue(Math.max(0, curEarnings - amount));
  sheet.getRange(rowIndex, getCol("balance")).setValue(curBal - amount);

  createStitcherLedgerEntry(
    stitcherId, stitcherName,
    "reversal",
    "Earnings reversed — stitcher re-assigned",
    amount, 0, ""
  );
}

// ─────────────────────────────────────────────
// STITCHER CRUD
// ─────────────────────────────────────────────
function getStitchers(params) {
  var stitchers = sheetToObjects(getSheet(SHEETS.Stitchers));
  if (params && params.status) stitchers = stitchers.filter(function(s){ return s.status === params.status; });
  return { success: true, stitchers: stitchers };
}

function addStitcher(data) {
  if (!data.name) return { success: false, error: "Stitcher name is required." };
  var sheet = getSheet(SHEETS.Stitchers);
  var id    = generateId("STR");
  sheet.appendRow([
    id,
    data.name,
    data.phone        || "",
    data.city         || "",
    data.joiningDate  || today(),
    data.status       || "active",
    0, 0, 0, 0, 0,
    data.paymentMethod || "Cash",
    data.notes         || "",
    now()
  ]);
  createStitcherLedgerEntry(id, data.name, "joined", "Stitcher joined: " + data.name, 0, 0, "");
  return { success: true, id: id };
}

function updateStitcher(data) {
  if (!data.stitcherId) return { success: false, error: "stitcherId is required." };
  var sheet    = getSheet(SHEETS.Stitchers);
  var rowIndex = findRowIndex(sheet, "id", data.stitcherId);
  if (rowIndex === -1) return { success: false, error: "Stitcher not found." };

  var fields = ["name","phone","city","joiningDate","status","paymentMethod","notes"];
  fields.forEach(function(f) { if (data[f] !== undefined) updateCell(sheet, rowIndex, f, data[f]); });
  return { success: true };
}

function deleteStitcher(data) {
  if (!data.stitcherId) return { success: false, error: "stitcherId is required." };
  var sheet    = getSheet(SHEETS.Stitchers);
  var rowIndex = findRowIndex(sheet, "id", data.stitcherId);
  if (rowIndex === -1) return { success: false, error: "Stitcher not found." };
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var balCol  = headers.indexOf("balance") + 1;
  var balance = balCol > 0 ? (parseFloat(sheet.getRange(rowIndex, balCol).getValue()) || 0) : 0;
  if (Math.abs(balance) > 0.01) {
    return { success: false, error: "Stitcher has an outstanding balance (" + balance + "). Settle it before deleting." };
  }
  sheet.deleteRow(rowIndex);
  return { success: true };
}

function addStitcherPayment(data) {
  if (!data.stitcherId || !data.amount) return { success: false, error: "stitcherId and amount required." };

  var pmtSheet = getSheet(SHEETS.StitcherPayments);
  var id       = generateId("STP");
  pmtSheet.appendRow([
    id,
    data.stitcherId,
    data.stitcherName  || "",
    data.type          || "payment",
    parseFloat(data.amount),
    data.month         || today().slice(0, 7),
    data.note          || "",
    data.paymentMethod || "Cash",
    today()
  ]);

  var sheet    = getSheet(SHEETS.Stitchers);
  var rowIndex = findRowIndex(sheet, "id", data.stitcherId);
  if (rowIndex !== -1) {
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    function getCol(name) { return headers.indexOf(name) + 1; }
    var curPaid = parseFloat(sheet.getRange(rowIndex, getCol("totalPaid")).getValue()) || 0;
    var curBal  = parseFloat(sheet.getRange(rowIndex, getCol("balance")).getValue())   || 0;
    var amt     = parseFloat(data.amount);
    sheet.getRange(rowIndex, getCol("totalPaid")).setValue(curPaid + amt);
    sheet.getRange(rowIndex, getCol("balance")).setValue(curBal - amt);
  }

  createStitcherLedgerEntry(
    data.stitcherId, data.stitcherName || "",
    "payment",
    "Payment via " + (data.paymentMethod || "Cash") + " — " + (data.month || ""),
    parseFloat(data.amount), 0, ""
  );

  // Stitcher pay is expensed at earning time (creditStitcherEarnings -> addExpense),
  // so this only settles what's already owed — a single ledger entry, not a new expense.
  createLedgerEntry(
    "stitcherPayment",
    data.stitcherId,
    data.stitcherName || "",
    "Payment via " + (data.paymentMethod || "Cash") + " to stitcher" + (data.note ? " — " + data.note : ""),
    parseFloat(data.amount), 0, "", today()
  );

  return { success: true, id: id };
}

function getStitcherPayments(params) {
  var payments = sheetToObjects(getSheet(SHEETS.StitcherPayments));
  if (params && params.stitcherId) payments = payments.filter(function(p){ return String(p.stitcherId) === String(params.stitcherId); });
  if (params && params.month)      payments = payments.filter(function(p){ return String(p.month)      === String(params.month); });
  return { success: true, payments: payments };
}

function getStitcherLedger(params) {
  var entries = sheetToObjects(getSheet(SHEETS.StitcherLedger));
  if (params && params.stitcherId) entries = entries.filter(function(e){ return String(e.stitcherId) === String(params.stitcherId); });
  return { success: true, entries: entries };
}

function getOrderStitching(params) {
  var records = sheetToObjects(getSheet(SHEETS.OrderStitching));
  if (params && params.orderId)    records = records.filter(function(r){ return String(r.orderId)    === String(params.orderId); });
  if (params && params.stitcherId) records = records.filter(function(r){ return String(r.stitcherId) === String(params.stitcherId); });
  if (params && params.status)     records = records.filter(function(r){ return r.status === params.status; });
  return { success: true, records: records };
}

function createStitcherLedgerEntry(stitcherId, stitcherName, type, description, debit, credit, orderId) {
  var sheet = getSheet(SHEETS.StitcherLedger);
  var id    = generateId("SLG");
  sheet.appendRow([id, stitcherId, stitcherName, type, description, debit||0, credit||0, 0, orderId||"", today()]);
}

function getStitcherDashboard(params) {
  var stitchers  = sheetToObjects(getSheet(SHEETS.Stitchers));
  var osRecords  = sheetToObjects(getSheet(SHEETS.OrderStitching));

  var totalStitchers  = stitchers.length;
  var activeStitchers = stitchers.filter(function(s){ return s.status === "active"; }).length;
  var pendingOrders   = osRecords.filter(function(r){ return r.status === "assigned" || r.status === "in_progress"; }).length;
  var completedOrders = osRecords.filter(function(r){ return r.status === "completed"; }).length;
  var totalEarnings   = stitchers.reduce(function(s, st){ return s + (parseFloat(st.totalEarnings) || 0); }, 0);
  var totalPaid       = stitchers.reduce(function(s, st){ return s + (parseFloat(st.totalPaid)     || 0); }, 0);
  var totalBalance    = stitchers.reduce(function(s, st){ return s + (parseFloat(st.balance)       || 0); }, 0);

  return {
    success:        true,
    totalStitchers: totalStitchers,
    activeStitchers:activeStitchers,
    pendingOrders:  pendingOrders,
    completedOrders:completedOrders,
    totalEarnings:  totalEarnings,
    totalPaid:      totalPaid,
    totalBalance:   totalBalance,
  };
}

// ─────────────────────────────────────────────
// CUSTOMERS
// ─────────────────────────────────────────────
function getCustomers(params) {
  return { success: true, customers: sheetToObjects(getSheet(SHEETS.Customers)) };
}

function addCustomer(data) {
  if (!data.name) return { success: false, error: "Customer name is required." };
  var sheet = getSheet(SHEETS.Customers);
  var id    = generateId("CUS");
  sheet.appendRow([id, data.name, data.phone||"", data.city||"",
    data.loyal ? true : false, parseFloat(data.discount)||0, 0, 0,
    parseFloat(data.creditLimit)||0, now()]);
  return { success: true, id: id };
}

function updateCustomer(data) {
  if (!data.customerId) return { success: false, error: "customerId is required." };
  var sheet    = getSheet(SHEETS.Customers);
  var rowIndex = findRowIndex(sheet, "id", data.customerId);
  if (rowIndex === -1) return { success: false, error: "Customer not found." };
  if (data.name        !== undefined) updateCell(sheet, rowIndex, "name",        data.name);
  if (data.phone       !== undefined) updateCell(sheet, rowIndex, "phone",       data.phone);
  if (data.city        !== undefined) updateCell(sheet, rowIndex, "city",        data.city);
  if (data.loyal       !== undefined) updateCell(sheet, rowIndex, "loyal",       data.loyal);
  if (data.discount    !== undefined) updateCell(sheet, rowIndex, "discount",    parseFloat(data.discount));
  if (data.creditLimit !== undefined) updateCell(sheet, rowIndex, "creditLimit", parseFloat(data.creditLimit));
  return { success: true };
}

function deleteCustomer(data) {
  if (!data.customerId) return { success: false, error: "customerId is required." };
  var sheet    = getSheet(SHEETS.Customers);
  var rowIndex = findRowIndex(sheet, "id", data.customerId);
  if (rowIndex === -1) return { success: false, error: "Customer not found." };

  // Refuse to delete a customer who still owes / is owed money.
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var balCol  = headers.indexOf("balance") + 1;
  var balance = balCol > 0 ? (parseFloat(sheet.getRange(rowIndex, balCol).getValue()) || 0) : 0;
  if (Math.abs(balance) > 0.01) {
    return { success: false, error: "Customer has an outstanding balance (" + balance + "). Settle it before deleting." };
  }

  // Refuse to delete a customer with orders on record — keeps sales history intact.
  var orders = sheetToObjects(getSheet(SHEETS.Orders));
  var hasOrders = orders.some(function(o){ return String(o.customerId) === String(data.customerId); });
  if (hasOrders) {
    return { success: false, error: "Customer has orders on record and can't be deleted." };
  }

  sheet.deleteRow(rowIndex);
  return { success: true };
}

function updateCustomerBalance(customerId, delta) {
  var sheet    = getSheet(SHEETS.Customers);
  var rowIndex = findRowIndex(sheet, "id", customerId);
  if (rowIndex === -1) return;
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var balCol  = headers.indexOf("balance") + 1;
  if (balCol === 0) return;
  var current = parseFloat(sheet.getRange(rowIndex, balCol).getValue()) || 0;
  sheet.getRange(rowIndex, balCol).setValue(current + delta);
}

// ─────────────────────────────────────────────
// SUPPLIERS
// ─────────────────────────────────────────────
function getSuppliers(params) {
  return { success: true, suppliers: sheetToObjects(getSheet(SHEETS.Suppliers)) };
}

function addSupplier(data) {
  if (!data.name) return { success: false, error: "Supplier name is required." };
  var sheet = getSheet(SHEETS.Suppliers);
  var id    = generateId("SUP");
  sheet.appendRow([id, data.name, data.phone||"", data.city||"", data.category||"", 0, now()]);
  return { success: true, id: id };
}

function updateSupplier(data) {
  if (!data.supplierId) return { success: false, error: "supplierId is required." };
  var sheet    = getSheet(SHEETS.Suppliers);
  var rowIndex = findRowIndex(sheet, "id", data.supplierId);
  if (rowIndex === -1) return { success: false, error: "Supplier not found." };
  var fields = ["name","phone","city","category"];
  fields.forEach(function(f) { if (data[f] !== undefined) updateCell(sheet, rowIndex, f, data[f]); });
  return { success: true };
}

function deleteSupplier(data) {
  if (!data.supplierId) return { success: false, error: "supplierId is required." };
  var sheet    = getSheet(SHEETS.Suppliers);
  var rowIndex = findRowIndex(sheet, "id", data.supplierId);
  if (rowIndex === -1) return { success: false, error: "Supplier not found." };
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var balCol  = headers.indexOf("balance") + 1;
  var balance = balCol > 0 ? (parseFloat(sheet.getRange(rowIndex, balCol).getValue()) || 0) : 0;
  if (Math.abs(balance) > 0.01) {
    return { success: false, error: "Supplier has an outstanding balance (" + balance + "). Settle it before deleting." };
  }
  sheet.deleteRow(rowIndex);
  return { success: true };
}

function updateSupplierBalance(supplierId, delta) {
  if (!supplierId) return;
  var sheet    = getSheet(SHEETS.Suppliers);
  var rowIndex = findRowIndex(sheet, "id", supplierId);
  if (rowIndex === -1) return;
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var balCol  = headers.indexOf("balance") + 1;
  if (balCol === 0) return;
  var current = parseFloat(sheet.getRange(rowIndex, balCol).getValue()) || 0;
  sheet.getRange(rowIndex, balCol).setValue(current + delta);
}

// ─────────────────────────────────────────────
// SUPPLIER RETURNS
// ─────────────────────────────────────────────
function createSupplierReturn(data) {
  if (!data || !data.supplierId) return { success: false, error: "supplierId is required." };
  if (!data.items || !data.items.length) return { success: false, error: "At least one returned item is required." };

  var total = 0;
  data.items.forEach(function(item) {
    var qty   = parseFloat(item.qty)   || 0;
    var price = parseFloat(item.price) || 0;
    total += qty * price;
  });
  if (total <= 0) return { success: false, error: "Return total must be greater than 0." };

  var returnId = generateId("SRT");
  var dateStr  = data.date || today();

  // Returning stock TO the supplier — mirror createOrder's -qty stock pattern, reversed.
  data.items.forEach(function(item) {
    if (item.productId) updateStock(item.productId, -(parseFloat(item.qty) || 0));
  });

  // Reduces what we owe the supplier (or increases what they owe us if already settled).
  updateSupplierBalance(data.supplierId, -total);

  createLedgerEntry(
    "supplierReturn",
    data.supplierId,
    data.supplierName || "",
    "Supplier return" + (data.reason ? " — " + data.reason : "") + " (" + returnId + ")",
    0, total, "", dateStr
  );

  return { success: true, id: returnId, total: total };
}

// ─────────────────────────────────────────────
// SUPPLIER PAYMENTS / LEDGER
// ─────────────────────────────────────────────
function addSupplierPayment(data) {
  if (!data.supplierId || !data.amount) return { success: false, error: "supplierId and amount required." };

  var amount   = parseFloat(data.amount) || 0;
  var pmtSheet = getSheet(SHEETS.SupplierPayments);
  var id       = generateId("SPY");
  pmtSheet.appendRow([
    id,
    data.supplierId,
    data.supplierName || "",
    amount,
    data.method || "Cash",
    data.note   || "",
    today()
  ]);

  // Paying a supplier reduces what we owe them.
  updateSupplierBalance(data.supplierId, -amount);

  createLedgerEntry(
    "supplierPayment",
    data.supplierId,
    data.supplierName || "",
    "Payment via " + (data.method || "Cash") + " to supplier" + (data.note ? " — " + data.note : ""),
    0, amount, "", today()
  );

  return { success: true, id: id };
}

function getSupplierPayments(params) {
  var payments = sheetToObjects(getSheet(SHEETS.SupplierPayments));
  if (params && params.supplierId) payments = payments.filter(function(p){ return String(p.supplierId) === String(params.supplierId); });
  return { success: true, payments: payments };
}

// There's no separate SupplierLedger sheet in the schema (unlike StitcherLedger) — supplier
// transactions (Inventory purchases, returns, payments) are all logged to the shared Ledger
// sheet keyed by accountId=supplierId, so this filters that sheet, matching getStitcherLedger's
// {success, entries} shape.
function getSupplierLedger(params) {
  var entries = sheetToObjects(getSheet(SHEETS.Ledger));
  if (params && params.supplierId) entries = entries.filter(function(e){ return String(e.accountId) === String(params.supplierId); });
  return { success: true, entries: entries };
}

// ─────────────────────────────────────────────
// INVENTORY (Supplier Purchases — stock IN)
// ─────────────────────────────────────────────
function getInventory(params) {
  var entries = sheetToObjects(getSheet(SHEETS.Inventory));
  if (params && params.supplierId) entries = entries.filter(function(e){ return String(e.supplierId) === String(params.supplierId); });
  if (params && params.startDate)  entries = entries.filter(function(e){ return e.date >= params.startDate; });
  if (params && params.endDate)    entries = entries.filter(function(e){ return e.date <= params.endDate; });
  return { success: true, inventory: entries };
}

function addInventory(entry) {
  if (!entry.items || !entry.items.length) return { success: false, error: "At least one item is required." };

  var total = parseFloat(entry.total);
  if (!(total >= 0)) {
    total = entry.items.reduce(function(s, item) {
      return s + (parseFloat(item.qty) || 0) * (parseFloat(item.purchasePrice) || 0);
    }, 0);
  }

  var payments = entry.payments || {};
  var paid = 0;
  Object.keys(payments).forEach(function(m) { paid += parseFloat(payments[m]) || 0; });
  var due    = Math.max(0, total - paid);
  var status = due > 0.01 ? "credit" : "paid";
  var dateStr = today();
  var id = generateId("INV");

  var sheet = getSheet(SHEETS.Inventory);
  sheet.appendRow([
    id,
    entry.supplierId || "",
    entry.supplier   || "",
    JSON.stringify(entry.items),
    total, paid, due,
    JSON.stringify(payments),
    status, dateStr, now()
  ]);

  // Stock coming IN — positive updateStock, opposite sign from createOrder.
  entry.items.forEach(function(item) {
    if (item.productId) updateStock(item.productId, parseFloat(item.qty) || 0);
    // Keep the product's purchasePrice in sync with the latest cost, mirroring how
    // Products already tracks it (best-effort; skipped if the product row is missing).
    if (item.productId && item.purchasePrice !== undefined) {
      try { updateCell(getSheet(SHEETS.Products), findRowIndex(getSheet(SHEETS.Products), "id", item.productId), "purchasePrice", parseFloat(item.purchasePrice) || 0); } catch (e) {}
    }
  });

  // Purchasing on credit increases what we owe the supplier.
  if (due > 0.01 && entry.supplierId) updateSupplierBalance(entry.supplierId, due);

  createLedgerEntry(
    "purchase",
    entry.supplierId || "",
    entry.supplier   || "",
    "Inventory purchase " + id,
    0, total, "", dateStr
  );

  Object.keys(payments).forEach(function(method) {
    var amount = parseFloat(payments[method]) || 0;
    if (amount > 0) {
      createLedgerEntry(
        "purchasePayment",
        entry.supplierId || "",
        entry.supplier   || "",
        "Payment via " + method + " for Inventory " + id,
        0, amount, "", dateStr
      );
    }
  });

  return { success: true, id: id, total: total, paid: paid, due: due, status: status };
}

function updateInventory(inventoryId, updates) {
  // routePost dispatches with a single `data` object (updateInventory(data)); the frontend's
  // updateInventory(id, updates) helper instead spreads { inventoryId, ...updates } into that
  // same object before sending, so on the wire it's always one object — normalize here.
  if (typeof inventoryId === "object" && inventoryId !== null) { updates = inventoryId; inventoryId = updates.inventoryId; }
  if (!inventoryId) return { success: false, error: "inventoryId is required." };

  var sheet    = getSheet(SHEETS.Inventory);
  var rowIndex = findRowIndex(sheet, "id", inventoryId);
  if (rowIndex === -1) return { success: false, error: "Inventory entry not found." };

  var headers   = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var rowValues = sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
  var oldEntry  = {};
  headers.forEach(function(h, i) { oldEntry[h] = rowValues[i]; });

  var oldItems = [];
  try { oldItems = JSON.parse(oldEntry.items || "[]"); } catch (e) {}
  // Reverse old stock-in and old supplier due before re-applying the edited values.
  oldItems.forEach(function(item) {
    if (item.productId) updateStock(item.productId, -(parseFloat(item.qty) || 0));
  });
  var oldDue = parseFloat(oldEntry.due) || 0;
  if (oldDue > 0.01 && oldEntry.supplierId) updateSupplierBalance(oldEntry.supplierId, -oldDue);

  var newItems = updates.items || oldItems;
  var newTotal = parseFloat(updates.total);
  if (!(newTotal >= 0)) {
    newTotal = newItems.reduce(function(s, item) {
      return s + (parseFloat(item.qty) || 0) * (parseFloat(item.purchasePrice) || 0);
    }, 0);
  }
  var newPayments = updates.payments || {};
  var newPaid = 0;
  Object.keys(newPayments).forEach(function(m) { newPaid += parseFloat(newPayments[m]) || 0; });
  var newDue    = Math.max(0, newTotal - newPaid);
  var newStatus = newDue > 0.01 ? "credit" : "paid";
  var supplierId = updates.supplierId !== undefined ? updates.supplierId : oldEntry.supplierId;
  var supplier   = updates.supplier   !== undefined ? updates.supplier   : oldEntry.supplier;

  newItems.forEach(function(item) {
    if (item.productId) updateStock(item.productId, parseFloat(item.qty) || 0);
  });
  if (newDue > 0.01 && supplierId) updateSupplierBalance(supplierId, newDue);

  function setCell(field, value) {
    var col = headers.indexOf(field);
    if (col !== -1) sheet.getRange(rowIndex, col + 1).setValue(value);
  }
  setCell("supplierId", supplierId || "");
  setCell("supplier",   supplier   || "");
  setCell("items",      JSON.stringify(newItems));
  setCell("total",      newTotal);
  setCell("paid",       newPaid);
  setCell("due",        newDue);
  setCell("payments",   JSON.stringify(newPayments));
  setCell("status",     newStatus);

  createLedgerEntry(
    "purchase",
    supplierId || "",
    supplier   || "",
    "Inventory purchase " + inventoryId + " (edited)",
    0, newTotal, "", today()
  );

  return { success: true, id: inventoryId, total: newTotal, paid: newPaid, due: newDue, status: newStatus };
}

function deleteInventory(inventoryId) {
  if (typeof inventoryId === "object") inventoryId = inventoryId.inventoryId;
  if (!inventoryId) return { success: false, error: "inventoryId is required." };

  var sheet    = getSheet(SHEETS.Inventory);
  var rowIndex = findRowIndex(sheet, "id", inventoryId);
  if (rowIndex === -1) return { success: false, error: "Inventory entry not found." };

  var headers   = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var rowValues = sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
  var entry = {};
  headers.forEach(function(h, i) { entry[h] = rowValues[i]; });

  var items = [];
  try { items = JSON.parse(entry.items || "[]"); } catch (e) {}

  // Reverse the stock this purchase added and the supplier due it created.
  items.forEach(function(item) {
    if (item.productId) updateStock(item.productId, -(parseFloat(item.qty) || 0));
  });
  var due = parseFloat(entry.due) || 0;
  if (due > 0.01 && entry.supplierId) updateSupplierBalance(entry.supplierId, -due);

  sheet.deleteRow(rowIndex);

  createLedgerEntry(
    "purchase",
    entry.supplierId || "",
    entry.supplier   || "",
    "Inventory purchase " + inventoryId + " deleted (reversed)",
    0, 0, "", today()
  );

  return { success: true };
}

// ─────────────────────────────────────────────
// EXPENSES
// ─────────────────────────────────────────────
function getExpenses(params) {
  var expenses = sheetToObjects(getSheet(SHEETS.Expenses));
  if (params && params.category)  expenses = expenses.filter(function(e){ return e.category === params.category; });
  if (params && params.startDate) expenses = expenses.filter(function(e){ return e.date >= params.startDate; });
  if (params && params.endDate)   expenses = expenses.filter(function(e){ return e.date <= params.endDate; });
  return { success: true, expenses: expenses };
}

// data.payments may be either a multi-method object ({Cash:"100", "Bank Account":"50"}, from
// ExpensesPage's MultiPaymentInput form) or a plain method-name string (from internal callers
// like creditStitcherEarnings which pass payments:"Cash"). Handle both.
function addExpense(expense) {
  if (!expense.category) return { success: false, error: "Expense category is required." };

  var paymentsRaw = expense.payments;
  var amount = parseFloat(expense.amount) || 0;
  var paymentsToStore;

  if (paymentsRaw && typeof paymentsRaw === "object") {
    var sum = 0;
    Object.keys(paymentsRaw).forEach(function(m) { sum += parseFloat(paymentsRaw[m]) || 0; });
    if (!amount) amount = sum;
    paymentsToStore = paymentsRaw;
  } else if (typeof paymentsRaw === "string" && paymentsRaw) {
    var methodMap = {};
    methodMap[paymentsRaw] = amount;
    paymentsToStore = methodMap;
  } else {
    paymentsToStore = {};
  }

  if (!(amount > 0)) return { success: false, error: "Expense amount must be greater than 0." };

  var id = generateId("EXP");
  var dateStr = expense.date || today();
  var sheet = getSheet(SHEETS.Expenses);
  sheet.appendRow([
    id,
    expense.category,
    amount,
    JSON.stringify(paymentsToStore),
    expense.note || "",
    dateStr
  ]);

  createLedgerEntry(
    "expense",
    "EXPENSE",
    expense.category,
    expense.category + (expense.note ? " — " + expense.note : "") + " (" + id + ")",
    0, amount, "", dateStr
  );

  return { success: true, id: id };
}

function updateExpense(expenseId, updates) {
  if (typeof expenseId === "object") { updates = expenseId; expenseId = updates.expenseId; }
  if (!expenseId) return { success: false, error: "expenseId is required." };

  var sheet    = getSheet(SHEETS.Expenses);
  var rowIndex = findRowIndex(sheet, "id", expenseId);
  if (rowIndex === -1) return { success: false, error: "Expense not found." };

  if (updates.category !== undefined) updateCell(sheet, rowIndex, "category", updates.category);
  if (updates.note     !== undefined) updateCell(sheet, rowIndex, "note",     updates.note);

  var paymentsRaw = updates.payments;
  var amount = updates.amount !== undefined ? (parseFloat(updates.amount) || 0) : undefined;
  if (paymentsRaw !== undefined) {
    var paymentsToStore;
    if (paymentsRaw && typeof paymentsRaw === "object") {
      var sum = 0;
      Object.keys(paymentsRaw).forEach(function(m) { sum += parseFloat(paymentsRaw[m]) || 0; });
      if (amount === undefined) amount = sum;
      paymentsToStore = paymentsRaw;
    } else if (typeof paymentsRaw === "string" && paymentsRaw) {
      var methodMap = {};
      methodMap[paymentsRaw] = amount || 0;
      paymentsToStore = methodMap;
    } else {
      paymentsToStore = {};
    }
    updateCell(sheet, rowIndex, "payments", JSON.stringify(paymentsToStore));
  }
  if (amount !== undefined) updateCell(sheet, rowIndex, "amount", amount);

  return { success: true };
}

function deleteExpense(expenseId) {
  if (typeof expenseId === "object") expenseId = expenseId.expenseId;
  if (!expenseId) return { success: false, error: "expenseId is required." };

  var sheet    = getSheet(SHEETS.Expenses);
  var rowIndex = findRowIndex(sheet, "id", expenseId);
  if (rowIndex === -1) return { success: false, error: "Expense not found." };
  sheet.deleteRow(rowIndex);
  return { success: true };
}

// ─────────────────────────────────────────────
// LEDGER
// ─────────────────────────────────────────────
// Sign convention (inferred from createOrder/updateOrder above): debit increases what's
// owed TO us (a sale, or something that increases receivables); credit decreases it (a
// payment received, or money paid out that settles/reduces an owed balance). "balance" is
// a simple running total across the WHOLE ledger sheet (debit adds, credit subtracts) —
// mirrors how a single running account balance is typically shown in this kind of ledger UI.
function createLedgerEntry(type, accountId, accountName, description, debit, credit, orderId, date) {
  var sheet = getSheet(SHEETS.Ledger);
  var id    = generateId("LDG");
  debit  = parseFloat(debit)  || 0;
  credit = parseFloat(credit) || 0;

  var lastRow = sheet.getLastRow();
  var prevBalance = 0;
  if (lastRow > 1) {
    var headers  = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var balCol   = headers.indexOf("balance") + 1;
    if (balCol > 0) prevBalance = parseFloat(sheet.getRange(lastRow, balCol).getValue()) || 0;
  }
  var newBalance = prevBalance + debit - credit;

  sheet.appendRow([
    id, type || "", accountId || "", accountName || "",
    description || "", debit, credit, newBalance,
    orderId || "", date || today()
  ]);
  return id;
}

// Called by updateOrderFull before re-adding fresh ledger entries for an edited order, so
// edits don't double-count the original sale/payment rows. Deletes every Ledger row whose
// orderId matches (does not attempt to re-thread the running "balance" column afterward —
// balance is a best-effort running total, not a strict ledger invariant here).
function removeLedgerEntriesForOrder(orderId) {
  if (!orderId) return;
  var sheet = getSheet(SHEETS.Ledger);
  var data  = sheet.getDataRange().getValues();
  if (data.length < 2) return;
  var headers    = data[0];
  var orderIdCol = headers.indexOf("orderId");
  if (orderIdCol === -1) return;

  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][orderIdCol]).trim() === String(orderId).trim()) {
      sheet.deleteRow(i + 1);
    }
  }
}

function getLedger(params) {
  var entries = sheetToObjects(getSheet(SHEETS.Ledger));
  if (params && params.accountId) entries = entries.filter(function(e){ return String(e.accountId) === String(params.accountId); });
  if (params && params.type)      entries = entries.filter(function(e){ return e.type === params.type; });
  if (params && params.orderId)   entries = entries.filter(function(e){ return String(e.orderId) === String(params.orderId); });
  if (params && params.startDate) entries = entries.filter(function(e){ return e.date >= params.startDate; });
  if (params && params.endDate)   entries = entries.filter(function(e){ return e.date <= params.endDate; });
  return { success: true, entries: entries };
}

// No frontend call site exists for this in the current Dukandar.jsx (AccountsPage computes
// its balance sheet client-side from getOrders/getExpenses instead) — field names below
// mirror the equivalent client-side computation in AccountsPage as closely as possible so a
// future caller has a reasonable contract to adopt.
function getBalanceSheet() {
  var orders   = sheetToObjects(getSheet(SHEETS.Orders));
  var expenses = sheetToObjects(getSheet(SHEETS.Expenses));
  var suppliers= sheetToObjects(getSheet(SHEETS.Suppliers));
  var customers= sheetToObjects(getSheet(SHEETS.Customers));

  var totalRevenue     = orders.reduce(function(s, o){ return s + (parseFloat(o.total) || 0); }, 0);
  var totalCollected   = orders.reduce(function(s, o){ return s + (parseFloat(o.paid)  || 0); }, 0);
  var creditReceivable = orders.filter(function(o){ return o.status === "credit"; })
    .reduce(function(s, o){ return s + Math.max(0, (parseFloat(o.total)||0) - (parseFloat(o.paid)||0)); }, 0);
  var totalExpenses    = expenses.reduce(function(s, e){ return s + (parseFloat(e.amount) || 0); }, 0);
  var supplierPayable  = suppliers.reduce(function(s, sup){ return s + Math.max(0, parseFloat(sup.balance) || 0); }, 0);
  var customerCredit   = customers.reduce(function(s, c){ var b = parseFloat(c.balance) || 0; return s + (b < 0 ? -b : 0); }, 0);

  return {
    success:          true,
    totalRevenue:      totalRevenue,
    totalCollected:    totalCollected,
    creditReceivable:  creditReceivable,
    totalExpenses:     totalExpenses,
    supplierPayable:   supplierPayable,
    customerCredit:    customerCredit,
    netPosition:        totalCollected - totalExpenses,
    totalAssets:        totalRevenue + creditReceivable,
  };
}

// ─────────────────────────────────────────────
// SALESMEN
// ─────────────────────────────────────────────
function getSalesmen(params) {
  var salesmen = sheetToObjects(getSheet(SHEETS.Salesmen));
  if (params && params.status) salesmen = salesmen.filter(function(s){ return s.status === params.status; });
  return { success: true, salesmen: salesmen };
}

function addSalesman(data) {
  if (!data.name) return { success: false, error: "Salesman name is required." };
  var sheet = getSheet(SHEETS.Salesmen);
  var id    = generateId("SLM");
  sheet.appendRow([
    id,
    data.name,
    data.phone          || "",
    data.city            || "",
    data.designation     || "",
    parseFloat(data.commissionRate) || 0,
    parseFloat(data.salary)         || 0,
    data.joiningDate     || today(),
    data.status          || "active",
    0, 0, 0, 0,
    data.notes           || ""
  ]);
  return { success: true, id: id };
}

function updateSalesman(data) {
  if (!data.salesmanId) return { success: false, error: "salesmanId is required." };
  var sheet    = getSheet(SHEETS.Salesmen);
  var rowIndex = findRowIndex(sheet, "id", data.salesmanId);
  if (rowIndex === -1) return { success: false, error: "Salesman not found." };
  var fields = ["name","phone","city","designation","commissionRate","salary","joiningDate","status","notes"];
  fields.forEach(function(f) { if (data[f] !== undefined) updateCell(sheet, rowIndex, f, data[f]); });
  return { success: true };
}

function deleteSalesman(data) {
  if (!data.salesmanId) return { success: false, error: "salesmanId is required." };
  var sheet    = getSheet(SHEETS.Salesmen);
  var rowIndex = findRowIndex(sheet, "id", data.salesmanId);
  if (rowIndex === -1) return { success: false, error: "Salesman not found." };
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var balCol  = headers.indexOf("balance") + 1;
  var balance = balCol > 0 ? (parseFloat(sheet.getRange(rowIndex, balCol).getValue()) || 0) : 0;
  if (Math.abs(balance) > 0.01) {
    return { success: false, error: "Salesman has an outstanding balance (" + balance + "). Settle it before deleting." };
  }
  sheet.deleteRow(rowIndex);
  return { success: true };
}

function addSalesmanPayment(data) {
  if (!data.salesmanId || !data.amount) return { success: false, error: "salesmanId and amount required." };

  var amount   = parseFloat(data.amount) || 0;
  var pmtSheet = getSheet(SHEETS.SalesmenPayments);
  var id       = generateId("SMP");
  pmtSheet.appendRow([
    id,
    data.salesmanId,
    data.salesmanName || "",
    data.type          || "salary",
    amount,
    data.month         || today().slice(0, 7),
    data.note          || "",
    today()
  ]);

  var sheet    = getSheet(SHEETS.Salesmen);
  var rowIndex = findRowIndex(sheet, "id", data.salesmanId);
  if (rowIndex !== -1) {
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    function getCol(name) { return headers.indexOf(name) + 1; }
    var curPaid = parseFloat(sheet.getRange(rowIndex, getCol("totalPaid")).getValue()) || 0;
    var curBal  = parseFloat(sheet.getRange(rowIndex, getCol("balance")).getValue())   || 0;
    sheet.getRange(rowIndex, getCol("totalPaid")).setValue(curPaid + amount);
    sheet.getRange(rowIndex, getCol("balance")).setValue(curBal - amount);
  }

  createLedgerEntry(
    "salesmanPayment",
    data.salesmanId,
    data.salesmanName || "",
    (data.type || "salary") + " payment via " + (data.paymentMethod || "Cash") + (data.note ? " — " + data.note : "") + " (" + (data.month || "") + ")",
    0, amount, "", today()
  );

  return { success: true, id: id };
}

// Credits a salesman's stats (totalSales, totalCommission, balance) for a plain order-level
// sale (used as the fallback path when no per-item salesman commissions were applied).
function updateSalesmanStats(salesmanId, saleAmount) {
  if (!salesmanId) return;
  var sheet    = getSheet(SHEETS.Salesmen);
  var rowIndex = findRowIndex(sheet, "id", salesmanId);
  if (rowIndex === -1) return;
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  function getCol(name) { return headers.indexOf(name) + 1; }

  var commissionRate = parseFloat(sheet.getRange(rowIndex, getCol("commissionRate")).getValue()) || 0;
  var commission     = (parseFloat(saleAmount) || 0) * commissionRate / 100;

  var curSales      = parseFloat(sheet.getRange(rowIndex, getCol("totalSales")).getValue())      || 0;
  var curCommission = parseFloat(sheet.getRange(rowIndex, getCol("totalCommission")).getValue()) || 0;
  var curBal        = parseFloat(sheet.getRange(rowIndex, getCol("balance")).getValue())         || 0;

  sheet.getRange(rowIndex, getCol("totalSales")).setValue(curSales + (parseFloat(saleAmount) || 0));
  sheet.getRange(rowIndex, getCol("totalCommission")).setValue(curCommission + commission);
  sheet.getRange(rowIndex, getCol("balance")).setValue(curBal + commission);
}

// Reverses what updateSalesmanStats applied — used when an order is edited/its sale total
// changes, before the (possibly different) new totals are re-applied.
function reverseSalesmanStats(salesmanId, saleAmount) {
  if (!salesmanId) return;
  var sheet    = getSheet(SHEETS.Salesmen);
  var rowIndex = findRowIndex(sheet, "id", salesmanId);
  if (rowIndex === -1) return;
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  function getCol(name) { return headers.indexOf(name) + 1; }

  var commissionRate = parseFloat(sheet.getRange(rowIndex, getCol("commissionRate")).getValue()) || 0;
  var commission     = (parseFloat(saleAmount) || 0) * commissionRate / 100;

  var curSales      = parseFloat(sheet.getRange(rowIndex, getCol("totalSales")).getValue())      || 0;
  var curCommission = parseFloat(sheet.getRange(rowIndex, getCol("totalCommission")).getValue()) || 0;
  var curBal        = parseFloat(sheet.getRange(rowIndex, getCol("balance")).getValue())         || 0;

  sheet.getRange(rowIndex, getCol("totalSales")).setValue(Math.max(0, curSales - (parseFloat(saleAmount) || 0)));
  sheet.getRange(rowIndex, getCol("totalCommission")).setValue(Math.max(0, curCommission - commission));
  sheet.getRange(rowIndex, getCol("balance")).setValue(curBal - commission);
}

// Per-item salesman commission. Cart items from OrdersPage carry salesmanId/salesmanName/
// commissionType ("percent"|"amount")/commissionValue. Only items that have BOTH a
// salesmanId and a commissionValue > 0 are credited here — items without a per-item
// salesman fall through to the order-level updateSalesmanStats(data.salesmanId, total)
// fallback in createOrder/updateOrderFull (that's why callers check
// Object.keys(result).length === 0 before calling the fallback).
// Returns an object keyed by salesmanId -> total commission credited, so callers can tell
// whether any per-item commissions were applied at all.
function applyItemSalesmenCommissions(items) {
  var result = {};
  (items || []).forEach(function(item) {
    if (!item.salesmanId) return;
    var commissionValue = parseFloat(item.commissionValue) || 0;
    if (commissionValue <= 0) return;

    var qty      = parseFloat(item.qty)   || 0;
    var price    = parseFloat(item.price) || 0;
    var lineTotal = qty * price;
    var commission = item.commissionType === "amount"
      ? commissionValue
      : (lineTotal * commissionValue / 100);
    if (commission <= 0) return;

    var sheet    = getSheet(SHEETS.Salesmen);
    var rowIndex = findRowIndex(sheet, "id", item.salesmanId);
    if (rowIndex !== -1) {
      var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      function getCol(name) { return headers.indexOf(name) + 1; }
      var curSales      = parseFloat(sheet.getRange(rowIndex, getCol("totalSales")).getValue())      || 0;
      var curCommission = parseFloat(sheet.getRange(rowIndex, getCol("totalCommission")).getValue()) || 0;
      var curBal        = parseFloat(sheet.getRange(rowIndex, getCol("balance")).getValue())         || 0;
      sheet.getRange(rowIndex, getCol("totalSales")).setValue(curSales + lineTotal);
      sheet.getRange(rowIndex, getCol("totalCommission")).setValue(curCommission + commission);
      sheet.getRange(rowIndex, getCol("balance")).setValue(curBal + commission);
    }

    createLedgerEntry(
      "salesmanPayment",
      item.salesmanId,
      item.salesmanName || "",
      "Commission on " + (item.name || item.productName || "item") + " (" + (item.commissionType || "percent") + ")",
      0, commission, "", today()
    );

    result[item.salesmanId] = (result[item.salesmanId] || 0) + commission;
  });
  return result;
}

// Reverses applyItemSalesmenCommissions — used by updateOrderFull before re-applying the
// (possibly edited) per-item commissions for the new item list.
function applyItemSalesmenCommissionsReverse(items) {
  var result = {};
  (items || []).forEach(function(item) {
    if (!item.salesmanId) return;
    var commissionValue = parseFloat(item.commissionValue) || 0;
    if (commissionValue <= 0) return;

    var qty       = parseFloat(item.qty)   || 0;
    var price     = parseFloat(item.price) || 0;
    var lineTotal = qty * price;
    var commission = item.commissionType === "amount"
      ? commissionValue
      : (lineTotal * commissionValue / 100);
    if (commission <= 0) return;

    var sheet    = getSheet(SHEETS.Salesmen);
    var rowIndex = findRowIndex(sheet, "id", item.salesmanId);
    if (rowIndex !== -1) {
      var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      function getCol(name) { return headers.indexOf(name) + 1; }
      var curSales      = parseFloat(sheet.getRange(rowIndex, getCol("totalSales")).getValue())      || 0;
      var curCommission = parseFloat(sheet.getRange(rowIndex, getCol("totalCommission")).getValue()) || 0;
      var curBal        = parseFloat(sheet.getRange(rowIndex, getCol("balance")).getValue())         || 0;
      sheet.getRange(rowIndex, getCol("totalSales")).setValue(Math.max(0, curSales - lineTotal));
      sheet.getRange(rowIndex, getCol("totalCommission")).setValue(Math.max(0, curCommission - commission));
      sheet.getRange(rowIndex, getCol("balance")).setValue(curBal - commission);
    }

    result[item.salesmanId] = (result[item.salesmanId] || 0) + commission;
  });
  return result;
}

// ─────────────────────────────────────────────
// ASSETS
// ─────────────────────────────────────────────
function getAssets(params) {
  var assets = sheetToObjects(getSheet(SHEETS.Assets));
  if (params && params.category) assets = assets.filter(function(a){ return a.category === params.category; });
  return { success: true, assets: assets };
}

function addAsset(data) {
  if (!data.name) return { success: false, error: "Asset name is required." };
  var sheet = getSheet(SHEETS.Assets);
  var id    = generateId("AST");
  sheet.appendRow([
    id,
    data.name,
    data.category         || "Equipment",
    data.purchaseDate     || today(),
    parseFloat(data.purchasePrice) || 0,
    parseFloat(data.currentValue)  || parseFloat(data.purchasePrice) || 0,
    data.location          || "",
    data.condition          || "Good",
    data.serialNo            || "",
    data.vendor               || "",
    data.warrantyExpiry        || "",
    data.notes                 || "",
    now()
  ]);
  return { success: true, id: id };
}

function updateAsset(data) {
  if (!data.assetId) return { success: false, error: "assetId is required." };
  var sheet    = getSheet(SHEETS.Assets);
  var rowIndex = findRowIndex(sheet, "id", data.assetId);
  if (rowIndex === -1) return { success: false, error: "Asset not found." };
  var fields = ["name","category","purchaseDate","purchasePrice","currentValue","location","condition","serialNo","vendor","warrantyExpiry","notes"];
  fields.forEach(function(f) { if (data[f] !== undefined) updateCell(sheet, rowIndex, f, data[f]); });
  return { success: true };
}

function deleteAsset(data) {
  if (!data.assetId) return { success: false, error: "assetId is required." };
  var sheet    = getSheet(SHEETS.Assets);
  var rowIndex = findRowIndex(sheet, "id", data.assetId);
  if (rowIndex === -1) return { success: false, error: "Asset not found." };
  sheet.deleteRow(rowIndex);
  return { success: true };
}

function addAssetMaintenance(data) {
  if (!data.assetId || !data.type) return { success: false, error: "assetId and type required." };
  var sheet = getSheet(SHEETS.AssetMaintenance);
  var id    = generateId("AME");
  var cost  = parseFloat(data.cost) || 0;
  sheet.appendRow([
    id,
    data.assetId,
    data.assetName || "",
    data.type,
    cost,
    data.vendor  || "",
    data.date    || today(),
    data.nextDue || "",
    data.notes   || ""
  ]);

  if (cost > 0) {
    addExpense({
      category: "Asset Maintenance",
      amount:   cost,
      payments: data.paymentMethod || "Cash",
      note:     data.type + " — " + (data.assetName || data.assetId),
      date:     data.date || today(),
    });
    createLedgerEntry(
      "assetPurchase",
      data.assetId,
      data.assetName || "",
      data.type + " maintenance — " + (data.vendor || ""),
      0, cost, "", data.date || today()
    );
  }

  return { success: true, id: id };
}

// ─────────────────────────────────────────────
// PAYROLL
// (No call site exists in the current Dukandar.jsx UI — PayrollPage in this build actually
// drives the SalarySheet feature below, not this Payroll sheet. This section is reconstructed
// purely from the Payroll schema and Googlesheet.js's apiCall signatures; treat field names
// as best-effort until confirmed against a real frontend caller.)
// ─────────────────────────────────────────────
function getPayroll(params) {
  var rows = sheetToObjects(getSheet(SHEETS.Payroll));
  if (params && params.month) rows = rows.filter(function(r){ return r.month === params.month; });
  return { success: true, payroll: rows };
}

function getPayrollHistory(params) {
  var rows = sheetToObjects(getSheet(SHEETS.Payroll));
  if (params && params.month)      rows = rows.filter(function(r){ return r.month === params.month; });
  if (params && params.employeeId) rows = rows.filter(function(r){ return String(r.employeeId) === String(params.employeeId); });
  return { success: true, history: rows };
}

function addSalary(data) {
  if (!data.employeeId || !data.employeeName) return { success: false, error: "employeeId and employeeName required." };
  var sheet  = getSheet(SHEETS.Payroll);
  var id     = generateId("PYR");
  var salary = parseFloat(data.salary) || 0;
  var bonus  = parseFloat(data.bonus)  || 0;
  var deduction = parseFloat(data.deduction) || 0;
  var net    = salary + bonus - deduction;
  sheet.appendRow([
    id,
    data.employeeId,
    data.employeeName,
    data.role  || "",
    salary, bonus, deduction, net,
    data.month || today().slice(0, 7),
    "pending", "", ""
  ]);
  return { success: true, id: id, net: net };
}

function markPayrollPaid(data) {
  if (!data || !data.id) return { success: false, error: "id is required." };
  var sheet    = getSheet(SHEETS.Payroll);
  var rowIndex = findRowIndex(sheet, "id", data.id);
  if (rowIndex === -1) return { success: false, error: "Payroll entry not found." };

  updateCell(sheet, rowIndex, "status", "paid");
  updateCell(sheet, rowIndex, "paidAt", now());
  updateCell(sheet, rowIndex, "paymentMethod", data.paymentMethod || "Cash");

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var rowValues = sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
  var entry = {};
  headers.forEach(function(h, i) { entry[h] = rowValues[i]; });
  var net = parseFloat(entry.net) || 0;

  createLedgerEntry(
    "expense",
    entry.employeeId || "",
    entry.employeeName || "",
    "Payroll paid via " + (data.paymentMethod || "Cash") + " for " + (entry.month || ""),
    0, net, "", today()
  );

  return { success: true };
}

// data is expected to carry a list of employees to batch-create payroll rows for a given
// month, e.g. { month, employees: [{employeeId, employeeName, role, salary, bonus, deduction}] }.
function createPayrollBatch(data) {
  if (!data || !data.month) return { success: false, error: "month is required." };
  var list = data.employees || data.salesmen || [];
  if (!list.length) return { success: false, error: "No employees provided for batch." };

  var created = [];
  list.forEach(function(emp) {
    var result = addSalary({
      employeeId: emp.employeeId || emp.id,
      employeeName: emp.employeeName || emp.name,
      role: emp.role || emp.designation || "",
      salary: emp.salary,
      bonus: emp.bonus,
      deduction: emp.deduction,
      month: data.month,
    });
    if (result.success) created.push(result.id);
  });

  return { success: true, created: created, count: created.length };
}

// ─────────────────────────────────────────────
// SALARY SHEET (Salesmen monthly entries)
// ─────────────────────────────────────────────
// Mirrors PayrollPage's calcSalaryFields() in Dukandar.jsx exactly, so entries computed
// here match what the UI previews before saving.
function calcSalarySheetFields(data) {
  var basic   = parseFloat(data.basicSalary) || 0;
  var total   = parseInt(data.totalDays) || 30;
  var working = Math.min(Math.max(parseInt(data.workingDays) || 0, 0), total);
  var perDay  = total > 0 ? basic / total : 0;
  var payable = perDay * working;
  var commRate   = parseFloat(data.commissionRate) || 0;
  var monthly    = parseFloat(data.monthlyWork) || 0;
  var commAmount = monthly * commRate / 100;
  var other = parseFloat(data.otherAmount) || 0;
  var salaryIncentive = payable + commAmount + other;
  var advance = parseFloat(data.advance) || 0;
  return {
    perDaySalary:     perDay,
    payableSalary:    payable,
    commissionAmount: commAmount,
    salaryIncentive:  salaryIncentive,
    netPayable:       salaryIncentive - advance,
  };
}

function getSalarySheet(params) {
  var entries = sheetToObjects(getSheet(SHEETS.SalarySheet));
  if (params && params.month)      entries = entries.filter(function(e){ return e.month === params.month; });
  if (params && params.salesmanId) entries = entries.filter(function(e){ return String(e.salesmanId) === String(params.salesmanId); });
  return { success: true, entries: entries };
}

function saveSalarySheetEntry(data) {
  if (!data.salesmanId) return { success: false, error: "salesmanId is required." };
  if (!data.month)      return { success: false, error: "month is required." };

  var calc = calcSalarySheetFields(data);
  var sheet = getSheet(SHEETS.SalarySheet);

  if (data.id) {
    var rowIndex = findRowIndex(sheet, "id", data.id);
    if (rowIndex === -1) return { success: false, error: "Salary entry not found." };
    var fields = {
      salesmanId: data.salesmanId, salesmanName: data.salesmanName || "", designation: data.designation || "",
      month: data.month,
      basicSalary: parseFloat(data.basicSalary) || 0,
      totalDays: parseInt(data.totalDays) || 30,
      workingDays: parseInt(data.workingDays) || 0,
      perDaySalary: calc.perDaySalary,
      payableSalary: calc.payableSalary,
      commissionRate: parseFloat(data.commissionRate) || 0,
      monthlyWork: parseFloat(data.monthlyWork) || 0,
      commissionAmount: calc.commissionAmount,
      otherAmount: parseFloat(data.otherAmount) || 0,
      salaryIncentive: calc.salaryIncentive,
      bill: parseFloat(data.bill) || 0,
      advance: parseFloat(data.advance) || 0,
      netPayable: calc.netPayable,
      notes: data.notes || "",
    };
    Object.keys(fields).forEach(function(f) { updateCell(sheet, rowIndex, f, fields[f]); });
    return { success: true, id: data.id };
  }

  var id = generateId("SAL");
  sheet.appendRow([
    id,
    data.salesmanId, data.salesmanName || "", data.designation || "", data.month,
    parseFloat(data.basicSalary) || 0,
    parseInt(data.totalDays) || 30,
    parseInt(data.workingDays) || 0,
    calc.perDaySalary, calc.payableSalary,
    parseFloat(data.commissionRate) || 0,
    parseFloat(data.monthlyWork) || 0,
    calc.commissionAmount,
    parseFloat(data.otherAmount) || 0,
    calc.salaryIncentive,
    parseFloat(data.bill) || 0,
    parseFloat(data.advance) || 0,
    calc.netPayable,
    "pending", "", data.notes || "", 0, ""
  ]);
  return { success: true, id: id };
}

function deleteSalarySheetEntry(data) {
  var id = (data && typeof data === "object") ? data.id : data;
  if (!id) return { success: false, error: "id is required." };
  var sheet    = getSheet(SHEETS.SalarySheet);
  var rowIndex = findRowIndex(sheet, "id", id);
  if (rowIndex === -1) return { success: false, error: "Salary entry not found." };
  sheet.deleteRow(rowIndex);
  return { success: true };
}

// Partial (or full, if amount === remaining) payment against one salary entry. Accumulates
// paidAmount, flips status to "paid" once paidAmount reaches netPayable (matches
// PayrollPage's statusBadge: paid >= net-0.01 => "paid", paid>0.01 => "partial", else
// "pending"), and records a ledger entry so it shows up in Money Flow / Payment Ledger
// per the "each account is auto-deducted" comment in PayrollPage.
function paySalarySheetEntry(data) {
  if (!data || !data.id) return { success: false, error: "id is required." };
  var amount = parseFloat(data.amount) || 0;
  if (!(amount > 0)) return { success: false, error: "amount must be greater than 0." };

  var sheet    = getSheet(SHEETS.SalarySheet);
  var rowIndex = findRowIndex(sheet, "id", data.id);
  if (rowIndex === -1) return { success: false, error: "Salary entry not found." };

  var headers   = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var rowValues = sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
  var entry = {};
  headers.forEach(function(h, i) { entry[h] = rowValues[i]; });

  var net       = parseFloat(entry.netPayable) || 0;
  var curPaid   = parseFloat(entry.paidAmount)  || 0;
  var newPaid   = curPaid + amount;
  var newStatus = newPaid >= net - 0.01 ? "paid" : (newPaid > 0.01 ? "partial" : "pending");

  updateCell(sheet, rowIndex, "paidAmount", newPaid);
  updateCell(sheet, rowIndex, "status", newStatus);
  updateCell(sheet, rowIndex, "paymentMethod", data.paymentMethod || "Cash");
  if (newStatus === "paid") updateCell(sheet, rowIndex, "paidAt", now());

  createLedgerEntry(
    "salesmanPayment",
    entry.salesmanId || "",
    entry.salesmanName || "",
    "Salary payment via " + (data.paymentMethod || "Cash") + " for " + (entry.month || "") + (data.note ? " — " + data.note : ""),
    0, amount, "", today()
  );

  return { success: true, id: data.id, paidAmount: newPaid, status: newStatus };
}

// Marks the FULL netPayable as paid in one shot (distinct from paySalarySheetEntry's
// partial/split flow) — used for a single "mark as paid" action rather than a chosen amount.
function markSalarySheetPaid(data) {
  var id = (data && typeof data === "object") ? data.id : data;
  if (!id) return { success: false, error: "id is required." };

  var sheet    = getSheet(SHEETS.SalarySheet);
  var rowIndex = findRowIndex(sheet, "id", id);
  if (rowIndex === -1) return { success: false, error: "Salary entry not found." };

  var headers   = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var rowValues = sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
  var entry = {};
  headers.forEach(function(h, i) { entry[h] = rowValues[i]; });

  var net     = parseFloat(entry.netPayable) || 0;
  var curPaid = parseFloat(entry.paidAmount) || 0;
  var remaining = Math.max(0, net - curPaid);

  updateCell(sheet, rowIndex, "paidAmount", net);
  updateCell(sheet, rowIndex, "status", "paid");
  updateCell(sheet, rowIndex, "paidAt", now());
  if (data && data.paymentMethod) updateCell(sheet, rowIndex, "paymentMethod", data.paymentMethod);

  if (remaining > 0.01) {
    createLedgerEntry(
      "salesmanPayment",
      entry.salesmanId || "",
      entry.salesmanName || "",
      "Salary marked paid in full for " + (entry.month || ""),
      0, remaining, "", today()
    );
  }

  return { success: true, id: id, paidAmount: net, status: "paid" };
}

// Reopens a paid/partial entry back to pending — reverses ALL payments made against it
// (per the confirm dialog in PayrollPage: "This reverses ALL payments... sets it back to
// unpaid"), resetting paidAmount to 0 rather than trying to reverse individual ledger rows.
function reopenSalarySheetEntry(data) {
  var id = (data && typeof data === "object") ? data.id : data;
  if (!id) return { success: false, error: "id is required." };

  var sheet    = getSheet(SHEETS.SalarySheet);
  var rowIndex = findRowIndex(sheet, "id", id);
  if (rowIndex === -1) return { success: false, error: "Salary entry not found." };

  updateCell(sheet, rowIndex, "paidAmount", 0);
  updateCell(sheet, rowIndex, "status", "pending");
  updateCell(sheet, rowIndex, "paidAt", "");

  return { success: true, id: id };
}

// ─────────────────────────────────────────────
// REPORTS
// (No call site exists in the current Dukandar.jsx UI — ReportsPage computes everything
// client-side from getOrders/getExpenses/getProducts instead. Field names below are
// best-effort, derived only from the Orders/OrderItems/Expenses schemas.)
// ─────────────────────────────────────────────
function getSalesReport(params) {
  var orders = sheetToObjects(getSheet(SHEETS.Orders));
  if (params && params.startDate) orders = orders.filter(function(o){ return o.date >= params.startDate; });
  if (params && params.endDate)   orders = orders.filter(function(o){ return o.date <= params.endDate; });

  var totalSales   = orders.reduce(function(s, o){ return s + (parseFloat(o.total) || 0); }, 0);
  var totalPaid    = orders.reduce(function(s, o){ return s + (parseFloat(o.paid)  || 0); }, 0);
  var totalDue     = orders.reduce(function(s, o){ return s + Math.max(0, (parseFloat(o.total)||0) - (parseFloat(o.paid)||0)); }, 0);
  var orderCount   = orders.length;

  return {
    success: true,
    orders: orders,
    totalSales: totalSales,
    totalPaid: totalPaid,
    totalDue: totalDue,
    orderCount: orderCount,
  };
}

function getProfitReport(params) {
  var orders = sheetToObjects(getSheet(SHEETS.Orders));
  if (params && params.startDate) orders = orders.filter(function(o){ return o.date >= params.startDate; });
  if (params && params.endDate)   orders = orders.filter(function(o){ return o.date <= params.endDate; });

  var products = sheetToObjects(getSheet(SHEETS.Products));
  var costById = {};
  products.forEach(function(p) { costById[p.id] = parseFloat(p.purchasePrice) || 0; });

  var revenue = 0, cost = 0;
  orders.forEach(function(o) {
    var items = [];
    try { items = JSON.parse(o.items || "[]"); } catch (e) {}
    items.forEach(function(item) {
      var qty   = parseFloat(item.qty)   || 0;
      var price = parseFloat(item.price) || 0;
      revenue += qty * price;
      cost    += qty * (costById[item.productId] || 0);
    });
  });

  var expenses = sheetToObjects(getSheet(SHEETS.Expenses));
  if (params && params.startDate) expenses = expenses.filter(function(e){ return e.date >= params.startDate; });
  if (params && params.endDate)   expenses = expenses.filter(function(e){ return e.date <= params.endDate; });
  var totalExpenses = expenses.reduce(function(s, e){ return s + (parseFloat(e.amount) || 0); }, 0);

  var grossProfit = revenue - cost;
  var netProfit    = grossProfit - totalExpenses;

  return {
    success: true,
    revenue: revenue,
    cost: cost,
    grossProfit: grossProfit,
    totalExpenses: totalExpenses,
    netProfit: netProfit,
  };
}

function getCustomerReport(params) {
  var customerId = params && params.customerId;
  var orders = sheetToObjects(getSheet(SHEETS.Orders));
  if (customerId) orders = orders.filter(function(o){ return String(o.customerId) === String(customerId); });

  var totalSales = orders.reduce(function(s, o){ return s + (parseFloat(o.total) || 0); }, 0);
  var totalPaid  = orders.reduce(function(s, o){ return s + (parseFloat(o.paid)  || 0); }, 0);
  var totalDue   = orders.reduce(function(s, o){ return s + Math.max(0, (parseFloat(o.total)||0) - (parseFloat(o.paid)||0)); }, 0);

  return {
    success: true,
    orders: orders,
    totalSales: totalSales,
    totalPaid: totalPaid,
    totalDue: totalDue,
    orderCount: orders.length,
  };
}
