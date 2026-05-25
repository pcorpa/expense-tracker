# **Project Requirements & System Architecture: AI Expense Tracker**

This document outlines the comprehensive technical requirements, data models, and workflow architectures for the AI-powered expense tracking application. The system is designed to ensure strict data integrity and high-quality statistical modeling through robust normalization and automated AI ingestion.

## **1\. Definition of "Statistical Truth" & Rules**

* **Audit State:** A record is only considered "Master Data" when is\_reviewed \= true. Until then, it remains a draft subject to changes.  
* **Mathematical Tolerance Margin:** A **1% tolerance** is established for cross-validations.  
  * *Rule:* |(Quantity × Unit\_Price) \- Item\_Total| ≤ (Item\_Total × 0.01)  
  * *Purpose:* To handle minor discrepancies due to decimal rounding, particularly for weighed products (e.g., kilograms).  
* **Header Integrity:** The sum of all item\_total values must strictly match the total\_amount of the transaction header within the tolerance margin (1%).  
* **Uncertainty Handling:** If the AI encounters illegible data, it MUST default to NULL or "Unknown" to force a human review, strictly avoiding data hallucinations.

## **2\. Category Taxonomy**

To ensure consistent groupings in pivot tables and charts, only the following explicitly defined categories are allowed:

* Comida  
* Limpieza  
* Salud  
* Entretenimiento  
* Hogar  
* Transporte  
* Vestimenta  
* Restaurante  
* Cuidado Personal  
* Mascotas  
* Servicios  
* Educación  
* Tecnología  
* Otro

## **3\. AI Specifications (Gemini 2.5 Flash)**

The extraction engine uses the following protocol to transform images into structured data. The prompt is maintained in Spanish to match the expected receipt language and categorization.  
**Extraction Prompt:**  
Analiza este ticket. Nombre: ${fileName}.  
Categorías permitidas: Comida, Limpieza, Salud, Entretenimiento, Hogar, Transporte, Vestimenta, Restaurante, Cuidado Personal, Mascotas, Servicios, Educación, Tecnología, Otro.  
Reglas:  
1\. 'unit\_price': Precio unitario.  
2\. 'quantity': Cantidad o peso.  
3\. 'item\_total\_from\_ticket': El precio final de la línea.  
4\. Usa 'Unknown' si no es legible.

**Response Schema (JSON):** The system strictly expects an object containing: filename, date, vendor, city, total\_amount, and an array of products.

##  

## **4\. Data Model, Entities, and Relationships**

The database in Supabase is normalized to allow for accurate time-series analysis and price variation tracking.

| Entity (Table) | Properties (Columns) | Relationships |
| :---- | :---- | :---- |
| **profiles** | id, email, first\_name, last\_name, created\_at | Linked to auth.users. Many-to-Many with groups via group\_members. |
| **groups** | id, name, created\_at | One-to-Many with receipts and transactions. |
| **group\_members** | group\_id, user\_id, role, created\_at | Junction table resolving the Many-to-Many relationship between profiles and groups. |
| **receipts** | id, user\_id, group\_id, image\_url, status, raw\_ocr\_json, created\_at, updated\_at | One-to-One or One-to-Zero with transactions. |
| **transactions** | id, receipt\_id, user\_id, group\_id, type, is\_reviewed, vendor\_or\_source, date, total\_amount, currency | The header record. One-to-Many with transaction\_items. |
| **transaction\_items** | id, transaction\_id, name, category, product\_id, quantity, unit\_price, item\_total | The granular detail. Many-to-One with transactions and Many-to-One with products. |
| **products** | id, name (UNIQUE), category, created\_at | Master catalog to normalize names. One-to-Many with transaction\_items. |

## 

## **5\. Feature Roadmap**

### **Phase 1: Core Architecture & Data Integrity (Current)**

The objective of this phase is to build a flawless relational database and a manual entry interface that prevents the ingestion of corrupt or mathematically invalid data.

* **Relational Schema Implementation:** Deployment of the database structure in Supabase (`transactions`, `transaction_items`, `products`, `receipts`), ensuring numeric fields accept `NULL` values for future automated ingestion while maintaining strict foreign key constraints.  
* **Security & Access Control:** Configuration of Row Level Security (RLS) policies to guarantee users can only read and write data belonging to their authorized groups (`group_id`).  
* **Granular Entry UI (`TransactionEntry.tsx`):** Development of a dynamic form that forces the user to justify every expense through individual line items.  
* **Mathematical Cross-Validation:** Implementation of client-side logic that automatically calculates subtotals and blocks the save action if the sum of the items differs from the transaction total (enforcing the 1% tolerance margin).  
* **Data Normalization Engine:** Integration of an autocomplete component connected to the `transaction_items` or `products`table to unify nomenclature and eliminate statistical noise caused by typographical errors.

  ### **Phase 2: Asynchronous AI Pipeline & Human-in-the-Loop (Next Steps)**

This phase automates data ingestion by eliminating repetitive manual entry, while implementing a strict audit workflow to maintain statistical accuracy.

* **Storage Configuration:** Creation of secure Supabase Storage buckets to host receipt images, optimized for standard mobile formats.  
* **Edge Function Deployment:** Programming a serverless function (Deno) triggered automatically upon detecting a new image upload in the storage bucket.  
* **Gemini API Integration:** Secure server-side connection to the Google Gemini API, transmitting the structured extraction prompt (JSON Schema) and handling quota limit errors (HTTP 429).  
* **Graceful Degradation Logic:** System configuration ensuring that unreadable fields or "Unknown" AI outputs are safely inserted as `NULL` values into the database without breaking the execution of surrounding rows.  
* **Audit Dashboard (`ReviewQueue.tsx`):** Creation of a dedicated interface listing exclusively transactions with `is_reviewed = false`. **Crucially, this dashboard must include full inline editing capabilities, allowing the user to manually correct, overwrite, or fill in missing values (quantities, names, unit prices) before explicitly approving and consolidating the record into the master dataset.**

  ### **Phase 3: Statistical Analytics & Data Portability**

The final phase transforms clean data into actionable insights, applying statistical methods to analyze price variance, consumption habits, and budget anomalies.

* **Taxonomy Distribution:** Integration of charting libraries (Chart.js / Recharts) to render pie and bar charts showing expenditure density based strictly on the 14 official categories.  
* **Time-Series Price Tracking (Inflation Index):** Development of a longitudinal analysis module to track the evolution of the `unit_price` for specific products over time, acting as a personal inflation gauge.  
* **Moving Averages (Trend Smoothing):** Visualizing 7-day or 30-day moving averages for general expenses to filter out daily noise and identify underlying spending trends.  
* **Anomaly Detection (Outliers):** Implementing logic to automatically flag individual transactions or items that fall outside a defined statistical threshold (e.g., 2 standard deviations from the category mean) to catch pricing errors or unusual spending spikes.  
* **Pareto Analysis (80/20 Rule):** Generating reports that identify the top 20% of vendors or products that account for 80% of the total financial output.  
* **Shared Finance Breakdown:** Implementation of `group_id` filtered views to automatically calculate balances and contribution ratios for each member in a shared expense group.  
* **Analytical Export Utility:** Creation of an export engine generating flat CSV or JSON files with normalized columns, optimized for direct import into external statistical software environments.  
* 

