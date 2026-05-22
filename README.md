# Ischemic Heart Disease (IHD) Clinical Decision Support System

A production-ready, high-contrast, responsive single-page web dashboard designed for hospital pharmacists to audit and optimize pharmacological regimens for patients with Ischemic Heart Disease (IHD).

## Key Features
- **Global Metrics Tracker**: Dynamically monitors compliance rate (regimens set to "Optimized"), total count of "Critical Safety Violations", and a custom progress bar for "High-Intensity Statin" initiation.
- **Interactive Autocomplete Search**: Accessible searching and selection of all 70 patient records.
- **Clinical Rules Simulation Engine**: Allows pharmacists to edit baseline history, primary diagnosis, and current prescriptions in real-time to immediately re-evaluate the clinical status (Red for Safety Violations, Yellow for Suboptimized, Green for Optimized).
- **Directives & Actions Panel**: Highlights immediate medication stop directives (with a danger icon and flashing red warnings) and provides an actionable checkout checklist of pharmacist interventions.
- **Sleek Clinical UI**: Custom Dark-themed styling utilizing Slate-900 `#0f172a`, Emerald Green `#10b981` (optimized), Amber `#f59e0b` (suboptimized), and Crimson `#ef4444` (critical safety).

## Installation & Setup

1. **Install Node dependencies**:
   ```powershell
   npm install
   ```

2. **Launch the Dashboard**:
   ```powershell
   npm run dev
   ```
   *Note: This starts a local Vite server, which is required to fetch the `patients_master_db.json` database without CORS blocks.*

3. **Verify Clinical Rules Offline**:
   ```powershell
   node verify_rules.js
   ```
   *This executes a headless test suite that validates the compliance engine's logical outputs.*
