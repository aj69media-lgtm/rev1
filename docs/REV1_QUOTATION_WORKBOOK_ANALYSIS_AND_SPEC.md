# REV1 Quotation Workbook Analysis and Calculation Specification

**Reference Workbook:** `RCC26-1998067-CONSrev01 (Likha ni Inay Cebu ground floor) - llama.csv`  
**Company:** REV1 Construction Corp.  
**Parent System:** BuildCore Construction Business Management System (CBMS)  

---

## 1. Workbook Structure & Worksheet Relationships

The original `.xlsm` workbook consists of five coordinated worksheets, digitized into CBMS database entities:

| Worksheet | Original Visibility | Workbook Role | CBMS Equivalent |
|---|---|---|---|
| `Title Page` | Visible | Primary quotation header, Section A/B/C line items, selling & internal cost columns, totals, scope notes, T&C, signatories | `quotations`, `quotation_revisions`, `quotation_sections`, `quotation_items`, `QuotationDocumentPrint` |
| `Hidden` | Very Hidden | Quotation parameters, payment terms, VAT %, discount %, optional scope flags (`chkSupply`, `chkInstall`, etc.), duration & manpower formulas | `quotation_revisions` columns (`scope_options_json`, `terms_json`, `vat_rate`, `discount_pct`, `estimated_manpower`, `estimated_duration_days`) + `quotation_settings` |
| `PT_Directory` | Visible | Preparer, reviewer, and approver directory (name, title, phone, email) | Existing CBMS `users` and `personnel` tables |
| `PH_Data` | Hidden | Philippine province, city/municipality, barangay, ZIP code, and reference distance table | `ph_locations` table |
| `Source` | Very Hidden | Reusable item & General Requirements catalog template | `quotation_catalog_items` + `quotation_units` + `quotation_categories` |

---

## 2. Named Configuration Options (`Hidden` Sheet Controls)

The workbook defines option flags that dynamically shape the quotation subject, scope wording, and General Requirements inclusions:

- **Scope Checkboxes**: `chkSupply` (Supply of Materials), `chkInstall` (Installation / Labor), `chkDelivery` (Delivery & Hauling), `chkDesign` (Design & Engineering), `chkTC` (Testing & Commissioning).
- **Trade / Discipline Radio Options**: `optCons` (Construction / Architectural Works), `optAux` (Auxiliary Systems), `optMEPF` (MEPF Works), `optMisc` (Miscellaneous Works), `optOptions` (Custom Scope).
- **CBMS Behavior**: Stored per revision in `scope_options_json`. When scope flags are toggled, CBMS preserves line-item draft values, updates suggested subject phrasing (e.g., `"SUPPLY OF LABOR AND MATERIALS FOR ..."`), and tracks active scope inclusions without destroying previously entered estimates.

---

## 3. Pricing Formulas & Gross Profit Methodology (Critical)

### 3.1 Gross Profit Margin Formula (NOT Simple Markup)

The REV1 workbook computes client selling unit rates from internal direct unit costs using **Gross Profit Margin (`GP%`)** and **`ROUNDUP(..., 0)`**:

```text
Material Selling Rate  = ROUNDUP(Material Unit Cost / (1 - Material GP%), 0)
Labor Selling Rate     = ROUNDUP(Labor Unit Cost    / (1 - Labor GP%),    0)
Combined Selling Rate  = Material Selling Rate + Labor Selling Rate
Extended Selling       = Quantity × Combined Selling Rate
```

- **Default GP%**: `0.300` (`30.0%`) for both Materials and Labor in the reference workbook, configurable per item and per revision.
- **Example Verification**: Direct Cost = `₱1,000.00`, GP = `30%`: `1000 / (1 - 0.30) = 1428.5714...` -> `ROUNDUP(..., 0)` = **`₱1,429.00`** (whereas simple 30% markup would yield `₱1,300.00`, which is prohibited).
- **IEEE-754 Floating-Point Normalization Rule**: In JavaScript/PHP binary floating point, exact ratios such as `75.60 / (1 - 0.30) = 75.60 / 0.7 = 108.00000000000001`. Uncorrected `Math.ceil()` would wrongly return `109` instead of Excel's `108`. CBMS normalizes division to 10 decimal places (`Number((cost / (1 - gp)).toFixed(10))`) prior to `Math.ceil()`, matching Excel Row 60 (`rebar, 10mm`, Labor Cost `75.60`, GP `0.300` -> `108.00`) 100%.

### 3.2 Special Item Pricing Modes & Visibility Rules

| Mode / Flag | CSV Representation | Calculation & Subtotal Inclusion Rule |
|---|---|---|
| `computed` | Numeric unit cost & GP% | Standard `ROUNDUP(cost / (1 - gp), 0)` |
| `included` | Text `"included"` in Material or Labor rate | Rate contributes `0` numerically; client document prints `"included"` in that rate column |
| `excluded` | Blank / excluded scope | Rate contributes `0`; prints `—` |
| `override` | Manual rate override | Uses authorized `override_mat_rate` / `override_lbr_rate` while logging original computed rate, user, timestamp, and reason |
| `visibility_mode = 'hidden'` | Text `"hidden"` in `TOTAL COST` column | Sub-component / BOM breakdown row (e.g., `rebar`, `CHB`, `cement`, or `Ceiling paint` Row 106). Displays unit rates internally when expanded, but **is excluded from Section Subtotals and Grand Totals** to prevent double-counting parent assemblies. |

---

## 4. Section Subtotals, VAT, Special Discount & Overall Reconciliation

### 4.1 Rounding & Aggregation Stages

1. **Line Item Rates (`Mat Sell`, `Lbr Sell`)**: Rounded up to whole pesos (`ROUNDUP(..., 0)`).
2. **Line Item Extended Amounts**: `Qty × Combined Unit Rate` (exact product; internal costs `Qty × Unit Cost` retain 2-decimal precision).
3. **Section Subtotals (A, B, C, ...)**: Sum of all **visible** (`visibility_mode = 'visible'`, `row_type = 'item'`) rows in that section:
   - `Section Selling = SUM(Extended Selling)`
   - `Section Direct Cost = SUM(Extended Mat Cost) + SUM(Extended Lbr Cost)`
   - `Section Gross Profit = Section Selling - Section Direct Cost`
   - `Section GP% = Section Gross Profit / Section Selling` (never an unweighted average of item GP%s).
4. **Pre-VAT Total (`TOTAL AMOUNT`)**: `SUM(Section Selling Subtotals)`.
5. **VAT (`12% VAT`)**: `ROUND(Total Selling Pre-VAT × (VAT Rate / 100), 2)` — default `12%`, stored per revision.
6. **Total Selling Price (VAT Inc.)**: `ROUND(Total Selling Pre-VAT + VAT Amount, 2)`.
7. **Less Special Discount**: Applied to the VAT-Inclusive total per workbook Row 238–239:
   - `Discount Amount = ROUND(Total Selling VAT Inc. × (Discount % / 100), 2)`
   - `Total Discounted Price = ROUND(Total Selling VAT Inc. - Discount Amount, 2)`

---

## 5. Manpower & Project Duration Rules

- **Derived Manpower Team / Supervision Formula** (`Hidden` sheet):
  ```text
  Team Units = ROUNDUP(Manpower / 10, 0) + 1 + QUOTIENT(Manpower, 25) + 3 × QUOTIENT(Manpower, 100)
  ```
  For `Manpower = 15` (CSV Row 241): `ceil(15/10) + 1 + floor(15/25) + 3 * floor(15/100) = 2 + 1 + 0 + 0 = 3`.
- **Duration Conversions**: Explicit `estimated_duration_days` (`90 days` in CSV Row 242) with explicit display in days, weeks (`days / 7`), and months (`days / 30` reference).

---

## 6. Workbook Audit: Legacy Formulas & Broken `#REF!` Findings

| Source Location | Issue Found | Classification | CBMS Resolution |
|---|---|---|---|
| Rows 54, 222, 233, 235, 237, 239 (Col P) | `#REF!` cell error in Section/Total GP summary column | **Broken Formula** | Replaced with true aggregate GP formula `(Selling - DirectCost) / Selling` computed cleanly on backend. |
| Row 106 (`Ceiling paint`) | Marked `hidden` in Total Cost col I (`58,807.00`), excluded from `2,408,433.00` Section B subtotal | **Valid Existing Logic** | Preserved `visibility_mode = 'hidden'` exclusion rule so Section B matches `2,408,433.00` identically. |
| Row 54 Col P (`445,750.00`) | Sums hidden General Requirements rows 33–51 separately from Site Mgmt Row 39 | **Legacy Reference** | Tracked in internal assembly breakdown; only visible Row 39 (`189,143.00`) and Row 52 (`42,858.00`) roll into `232,001.00`. |
| Excel VBA Macros (`Save`, `Print`, `AddRow`, `HideRow`) | Windows/Office desktop VBA dependencies | **Replaced Natively** | Rebuilt as database-backed REST API + React spreadsheet editor + browser Print/PDF templates (GoDaddy cPanel compatible). |

---

## 7. Controlled Reference Verification (`RCC26-1998067-CONS REV01`)

| Metric | Reference CSV Value | CBMS Engine Result | Status |
|---|---|---|---|
| Section A (`General Requirements`) Selling | `₱232,001.00` | `₱232,001.00` | MATCH |
| Section A Direct Cost | `₱162,400.00` | `₱162,400.00` | MATCH |
| Section B (`General Items`) Selling | `₱2,408,433.00` | `₱2,408,433.00` | MATCH |
| Section B Direct Cost | `₱1,685,890.32` | `₱1,685,890.32` | MATCH |
| Section C (`Commercial Fixtures`) Selling | `₱509,470.00` | `₱509,470.00` | MATCH |
| Section C Direct Cost | `₱356,605.00` | `₱356,605.00` | MATCH |
| Pre-VAT `TOTAL AMOUNT` | `₱3,149,904.00` | `₱3,149,904.00` | MATCH |
| Total Direct Cost | `₱2,204,895.32` | `₱2,204,895.32` | MATCH |
| `12% VAT` | `₱377,988.48` | `₱377,988.48` | MATCH |
| `TOTAL SELLING PRICE (VAT INC)` | `₱3,527,892.48` | `₱3,527,892.48` | MATCH |
| `Rebar 10mm` Labor Selling (`75.60 @ 30% GP`) | `₱108.00` | `₱108.00` | MATCH |
| Derived Manpower Team Units (`Manpower = 15`) | `3` | `3` | MATCH |

---

## 8. Confidentiality & Role Permission Matrix

Internal unit costs, supplier prices, GP%, profit amounts, and cost overrides are strictly filtered on the backend:
- Users without `quotations:view_internal_costing` receive **only** client-safe fields (`mat_sell_rate`, `lbr_sell_rate`, `combined_unit_rate`, `extended_selling`, section selling subtotals, VAT, approved discount, final total). All cost/GP/supplier properties are omitted from API payloads and CSV exports.
- Client representatives (`client_rep`) are blocked at route middleware (`requirePermission('quotations', ...)`).
