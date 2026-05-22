/**
 * Ischemic Heart Disease (IHD) Clinical Decision Support System - App Controller
 * Manages state, handles user interactions, runs the rules engine, and updates the DOM.
 */

// Global State
let patients = {}; // Maps 'Patient_1' -> Patient Object
let selectedPatientId = 'Patient_1';
let currentMode = 'database';
let lastSelectedDatabasePatientId = 'Patient_1';

// Initial baseline template for fallback if fetching fails
const BASELINE_TEMPLATE = {
  metadata: { patient_number: 1, record_id: "Patient_1" },
  past_medical_history_and_presentation: {
    age_group: "Under 75 Years",
    chest_pain_presentation: "Typical Angina",
    systolic_blood_pressure_mmhg: "Not Recorded",
    oxygen_saturation_pct: 95,
    history_of_diabetes: "No",
    history_of_stroke_tia: "No",
    chronic_kidney_disease: "No"
  },
  diagnostic_findings: {
    primary_diagnosis: "STEMI",
    cardiac_troponin_biomarker: "Negative / Normal"
  },
  current_hospital_prescriptions: {
    assigned_reperfusion_strategy: "Conservative Medical Management",
    p2y12_inhibitor_active: "None",
    high_bleeding_risk_status: "Standard/Low Risk Margins",
    statin_therapy_intensity: "None",
    proton_pump_inhibitor_prescribed: "No",
    concurrent_oral_anticoagulation: "No"
  },
  post_discharge_follow_up: {
    tracking_ldl_cholesterol_mg_dl: "Awaiting 4-8 Week Window"
  },
  clinical_decision_support_audit: {
    calculated_risk_tier: "High Risk",
    identified_risk_drivers: ["None Standardized"],
    regimen_clinical_status: "Suboptimized Therapy",
    identified_clinical_deviations: ["Patient is missing a high-intensity statin foundation for secondary disease prevention."],
    immediate_medication_stop_directive: "No immediate changes required.",
    required_pharmacist_interventions: "Initiate Atorvastatin 40-80mg or Rosuvastatin 20-40mg daily."
  }
};

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  initializeDatabase();
  setupEventListeners();
});

/**
 * Loads patient data from localStorage or fetches from patients_master_db.json
 */
async function initializeDatabase() {
  showLoader(true);
  try {
    const savedData = localStorage.getItem('ihd_patients_db');
    if (savedData) {
      patients = JSON.parse(savedData);
      showToast("Loaded saved clinical state from memory.");
    } else {
      const response = await fetch('./patients_master_db.json');
      if (!response.ok) throw new Error("Network response was not ok");
      patients = await response.json();
      showToast("Successfully ingested patients database.");
    }
  } catch (error) {
    console.warn("Could not fetch patients_master_db.json, generating fallback dataset: ", error);
    generateFallbackDatabase();
    showToast("Server offline. Initialized local patient registry.", "warning");
  } finally {
    showLoader(false);
    
    // Ensure all patients have valid CDS fields (run rules engine to populate/validate on load)
    Object.keys(patients).forEach(id => {
      const currentAudit = window.evaluatePatientCDS(patients[id]);
      patients[id].clinical_decision_support_audit = currentAudit;
    });

    updateGlobalMetrics();
    populateSearchDropdown();
    selectPatient(selectedPatientId);
  }
}

/**
 * Generates a mock database if patients_master_db.json is missing
 */
function generateFallbackDatabase() {
  patients = {};
  const diagnoses = ["STEMI", "NSTEMI", "Unstable Angina (UA)", "Undetermined"];
  const risks = ["High Risk", "Low Risk"];

  for (let i = 1; i <= 70; i++) {
    const pId = `Patient_${i}`;
    const pCopy = JSON.parse(JSON.stringify(BASELINE_TEMPLATE));
    pCopy.metadata.patient_number = i;
    pCopy.metadata.record_id = pId;
    
    // Distribute diagnoses and risk tiers to mirror the original file
    pCopy.diagnostic_findings.primary_diagnosis = diagnoses[i % diagnoses.length];
    pCopy.clinical_decision_support_audit.calculated_risk_tier = i % 3 === 0 ? "Low Risk" : "High Risk";
    
    patients[pId] = pCopy;
  }
}

/**
 * Attaches UI Event Listeners
 */
function setupEventListeners() {
  // Autocomplete Search Box Inputs
  const searchInput = document.getElementById('patientSearchInput');
  
  searchInput.addEventListener('input', handleSearchInput);
  searchInput.addEventListener('focus', () => toggleSearchDropdown(true));
  
  // Close dropdown on outside click
  document.addEventListener('click', (e) => {
    const container = document.querySelector('.search-container');
    if (container && !container.contains(e.target)) {
      toggleSearchDropdown(false);
    }
  });

  // Prev / Next button
  document.getElementById('prevPatientBtn').addEventListener('click', selectPreviousPatient);
  document.getElementById('nextPatientBtn').addEventListener('click', selectNextPatient);

  // Quick Simulation Controls
  document.getElementById('btnSimulateQueue').addEventListener('click', simulateClinicalQueue);
  document.getElementById('btnResetDatabase').addEventListener('click', resetDatabaseToBaseline);

  // Mode Switcher buttons
  document.getElementById('btnModeDatabase').addEventListener('click', () => setMode('database'));
  document.getElementById('btnModePredictor').addEventListener('click', () => setMode('predictor'));
  document.getElementById('predictCDSBtn').addEventListener('click', runPredictorAnalysis);
  document.getElementById('saveNewPatientBtn').addEventListener('click', savePredictorPatientToRegistry);

  // Form Inputs (Column 1 & Column 2) for Interactive Re-evaluation
  const formInputs = [
    'select_age_group', 'select_chest_pain',
    'input_sys_bp', 'input_sp_o2', 
    'check_diabetes', 'check_stroke', 'check_ckd',
    'select_diagnosis', 'select_troponin', 'select_reperfusion',
    'select_p2y12', 'select_bleeding_risk', 'select_statin',
    'select_ppi', 'select_anticoagulation'
  ];

  formInputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      const eventType = el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input';
      el.addEventListener(eventType, () => {
        if (currentMode === 'database') {
          // Real-time reactive preview before committing
          triggerRealtimeCDSPreview();
        } else {
          // In predictor mode, hide the registry button and reset audit state until Run CDS is clicked
          document.getElementById('saveNewPatientBtn').style.display = 'none';
          renderPendingCDSState();
        }
      });
    }
  });

  // Apply Changes Button
  document.getElementById('applyInterventionBtn').addEventListener('click', commitClinicalInterventions);
  
  // Keyboard access for dropdown
  searchInput.addEventListener('keydown', handleSearchKeydown);
}

/**
 * Updates Top Analytics row (Global Compliance, Violations, Statin Progress)
 */
function updateGlobalMetrics() {
  const patientList = Object.values(patients);
  const total = patientList.length || 70;

  let optimizedCount = 0;
  let violationCount = 0;
  let highStatinCount = 0;

  patientList.forEach(p => {
    const status = p.clinical_decision_support_audit?.regimen_clinical_status;
    const statin = p.current_hospital_prescriptions?.statin_therapy_intensity;

    if (status === "Optimized") optimizedCount++;
    if (status === "Critical Safety Violation") violationCount++;
    if (statin === "High-Intensity") highStatinCount++;
  });

  const suboptimizedCount = Math.max(0, total - optimizedCount - violationCount);

  const complianceRate = ((optimizedCount / total) * 100).toFixed(1);
  const statinRate = ((highStatinCount / total) * 100).toFixed(1);

  // Animate global metrics values
  animateNumberValue('metricCompliancePercent', complianceRate);
  animateNumberValue('metricViolationsCount', violationCount);
  
  // Violations badge warning state
  const violationsCard = document.getElementById('violationsMetricCard');
  if (violationsCard) {
    if (violationCount > 0) {
      violationsCard.classList.add('alert-active');
    } else {
      violationsCard.classList.remove('alert-active');
    }
  }

  // Update progress bar
  const progressBar = document.getElementById('statinProgressBar');
  const progressText = document.getElementById('statinProgressText');
  if (progressBar) progressBar.style.width = `${statinRate}%`;
  if (progressText) progressText.textContent = `${statinRate}% (${highStatinCount}/${total} Patients)`;

  // Update Cohort distribution bar segments
  const segOptimized = document.getElementById('cohortSegOptimized');
  const segSuboptimized = document.getElementById('cohortSegSuboptimized');
  const segViolations = document.getElementById('cohortSegViolations');
  
  if (segOptimized) segOptimized.style.width = `${(optimizedCount / total * 100).toFixed(1)}%`;
  if (segSuboptimized) segSuboptimized.style.width = `${(suboptimizedCount / total * 100).toFixed(1)}%`;
  if (segViolations) segViolations.style.width = `${(violationCount / total * 100).toFixed(1)}%`;

  // Update Cohort legend percentages
  const legendOpt = document.getElementById('legendOptPct');
  const legendSub = document.getElementById('legendSubPct');
  const legendVio = document.getElementById('legendVioPct');
  
  if (legendOpt) legendOpt.textContent = `${(optimizedCount / total * 100).toFixed(0)}%`;
  if (legendSub) legendSub.textContent = `${(suboptimizedCount / total * 100).toFixed(0)}%`;
  if (legendVio) legendVio.textContent = `${(violationCount / total * 100).toFixed(0)}%`;
}

/**
 * Autocomplete Dropdown Search Mechanics
 */
function populateSearchDropdown() {
  const dropdown = document.getElementById('searchDropdownList');
  dropdown.innerHTML = '';

  Object.keys(patients).forEach(id => {
    const p = patients[id];
    const status = p.clinical_decision_support_audit?.regimen_clinical_status || "Suboptimized Therapy";
    
    // Status dot color mapping
    let statusClass = 'dot-suboptimized';
    if (status === "Optimized") statusClass = 'dot-optimized';
    if (status === "Critical Safety Violation") statusClass = 'dot-violation';

    const item = document.createElement('div');
    item.className = 'dropdown-item';
    item.setAttribute('data-id', id);
    item.innerHTML = `
      <span class="dropdown-patient-name">${id}</span>
      <span class="dropdown-patient-diag">${p.diagnostic_findings?.primary_diagnosis || 'Undetermined'}</span>
      <div class="status-indicator-dot ${statusClass}" title="${status}"></div>
    `;

    item.addEventListener('click', () => {
      selectPatient(id);
      toggleSearchDropdown(false);
    });

    dropdown.appendChild(item);
  });
}

function handleSearchInput(e) {
  const query = e.target.value.toLowerCase().trim();
  const items = document.querySelectorAll('.dropdown-item');
  let matchCount = 0;

  items.forEach(item => {
    const patientId = item.getAttribute('data-id').toLowerCase();
    const cleanId = patientId.replace('_', ' '); // allow searching "Patient 5" as well as "Patient_5"
    const diagText = item.querySelector('.dropdown-patient-diag').textContent.toLowerCase();
    
    if (patientId.includes(query) || cleanId.includes(query) || diagText.includes(query)) {
      item.style.display = 'flex';
      matchCount++;
    } else {
      item.style.display = 'none';
    }
  });

  const noResults = document.getElementById('searchNoResults');
  if (matchCount === 0) {
    noResults.style.display = 'block';
  } else {
    noResults.style.display = 'none';
  }

  toggleSearchDropdown(true);
}

function toggleSearchDropdown(show) {
  const dropdown = document.getElementById('searchDropdownList');
  if (show) {
    dropdown.classList.add('show');
  } else {
    dropdown.classList.remove('show');
  }
}

function handleSearchKeydown(e) {
  const dropdown = document.getElementById('searchDropdownList');
  const items = Array.from(dropdown.querySelectorAll('.dropdown-item')).filter(i => i.style.display !== 'none');
  
  if (!dropdown.classList.contains('show') && items.length > 0) {
    if (e.key === 'ArrowDown' || e.key === 'Enter') {
      toggleSearchDropdown(true);
      return;
    }
  }

  let activeIndex = items.findIndex(i => i.classList.contains('focused'));

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (activeIndex !== -1) items[activeIndex].classList.remove('focused');
    activeIndex = (activeIndex + 1) % items.length;
    items[activeIndex].classList.add('focused');
    items[activeIndex].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (activeIndex !== -1) items[activeIndex].classList.remove('focused');
    activeIndex = (activeIndex - 1 + items.length) % items.length;
    items[activeIndex].classList.add('focused');
    items[activeIndex].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (activeIndex !== -1) {
      const selectedId = items[activeIndex].getAttribute('data-id');
      selectPatient(selectedId);
      toggleSearchDropdown(false);
    }
  } else if (e.key === 'Escape') {
    toggleSearchDropdown(false);
  }
}

/**
 * Select & Render Patient Details
 */
function selectPatient(id) {
  if (!patients[id]) return;
  selectedPatientId = id;
  
  // Update UI Elements
  document.getElementById('patientSearchInput').value = id;
  document.getElementById('displayPatientId').textContent = id;
  
  // Highlight active item in dropdown
  document.querySelectorAll('.dropdown-item').forEach(item => {
    if (item.getAttribute('data-id') === id) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  const p = patients[id];

  // Fill Baseline Columns inputs
  const pmh = p.past_medical_history_and_presentation || {};
  document.getElementById('select_age_group').value = pmh.age_group || 'Under 75 Years';
  document.getElementById('select_chest_pain').value = pmh.chest_pain_presentation || 'Typical Angina';
  document.getElementById('input_sys_bp').value = pmh.systolic_blood_pressure_mmhg || 'Not Recorded';
  document.getElementById('input_sp_o2').value = pmh.oxygen_saturation_pct || 95;
  document.getElementById('check_diabetes').checked = pmh.history_of_diabetes === "Yes";
  document.getElementById('check_stroke').checked = pmh.history_of_stroke_tia === "Yes";
  document.getElementById('check_ckd').checked = pmh.chronic_kidney_disease === "Yes";

  // Fill Diagnostic & Prescriptions inputs
  const findings = p.diagnostic_findings || {};
  document.getElementById('select_diagnosis').value = findings.primary_diagnosis || 'Undetermined';
  document.getElementById('select_troponin').value = findings.cardiac_troponin_biomarker || 'Negative / Normal';

  const rx = p.current_hospital_prescriptions || {};
  document.getElementById('select_reperfusion').value = rx.assigned_reperfusion_strategy || 'Conservative Medical Management';
  document.getElementById('select_p2y12').value = rx.p2y12_inhibitor_active || 'None';
  document.getElementById('select_bleeding_risk').value = rx.high_bleeding_risk_status || 'Standard/Low Risk Margins';
  document.getElementById('select_statin').value = rx.statin_therapy_intensity || 'None';
  document.getElementById('select_ppi').value = rx.proton_pump_inhibitor_prescribed || 'No';
  document.getElementById('select_anticoagulation').value = rx.concurrent_oral_anticoagulation || 'No';

  // Fill CDS Column
  const audit = p.clinical_decision_support_audit || {};
  renderClinicalAuditColumn(audit);
}

function selectPreviousPatient() {
  if (currentMode === 'predictor') return;
  const currentNum = parseInt(selectedPatientId.split('_')[1]);
  const existingNumbers = Object.keys(patients).map(id => parseInt(id.split('_')[1])).filter(n => !isNaN(n));
  const maxNum = existingNumbers.length > 0 ? Math.max(...existingNumbers) : 70;
  
  let prevNum = currentNum - 1;
  while (prevNum >= 1 && !patients[`Patient_${prevNum}`]) {
    prevNum--;
  }
  if (prevNum < 1) {
    prevNum = maxNum;
    while (prevNum >= 1 && !patients[`Patient_${prevNum}`]) {
      prevNum--;
    }
  }
  selectPatient(`Patient_${prevNum}`);
}

function selectNextPatient() {
  if (currentMode === 'predictor') return;
  const currentNum = parseInt(selectedPatientId.split('_')[1]);
  const existingNumbers = Object.keys(patients).map(id => parseInt(id.split('_')[1])).filter(n => !isNaN(n));
  const maxNum = existingNumbers.length > 0 ? Math.max(...existingNumbers) : 70;
  
  let nextNum = currentNum + 1;
  while (nextNum <= maxNum && !patients[`Patient_${nextNum}`]) {
    nextNum++;
  }
  if (nextNum > maxNum) {
    nextNum = 1;
    while (nextNum <= maxNum && !patients[`Patient_${nextNum}`]) {
      nextNum++;
    }
  }
  selectPatient(`Patient_${nextNum}`);
}

/**
 * Form Preview & Realtime CDS engine
 */
function getPatientObjectFromInputs() {
  const numPart = selectedPatientId.startsWith('Patient_') ? parseInt(selectedPatientId.split('_')[1]) : 999;
  return {
    metadata: {
      patient_number: numPart,
      record_id: selectedPatientId
    },
    past_medical_history_and_presentation: {
      age_group: document.getElementById('select_age_group').value,
      chest_pain_presentation: document.getElementById('select_chest_pain').value,
      systolic_blood_pressure_mmhg: document.getElementById('input_sys_bp').value,
      oxygen_saturation_pct: parseInt(document.getElementById('input_sp_o2').value) || 95,
      history_of_diabetes: document.getElementById('check_diabetes').checked ? "Yes" : "No",
      history_of_stroke_tia: document.getElementById('check_stroke').checked ? "Yes" : "No",
      chronic_kidney_disease: document.getElementById('check_ckd').checked ? "Yes" : "No"
    },
    diagnostic_findings: {
      primary_diagnosis: document.getElementById('select_diagnosis').value,
      cardiac_troponin_biomarker: document.getElementById('select_troponin').value
    },
    current_hospital_prescriptions: {
      assigned_reperfusion_strategy: document.getElementById('select_reperfusion').value,
      p2y12_inhibitor_active: document.getElementById('select_p2y12').value,
      high_bleeding_risk_status: document.getElementById('select_bleeding_risk').value,
      statin_therapy_intensity: document.getElementById('select_statin').value,
      proton_pump_inhibitor_prescribed: document.getElementById('select_ppi').value,
      concurrent_oral_anticoagulation: document.getElementById('select_anticoagulation').value
    }
  };
}

function triggerRealtimeCDSPreview() {
  const tempPatient = getPatientObjectFromInputs();
  const computedAudit = window.evaluatePatientCDS(tempPatient);
  renderClinicalAuditColumn(computedAudit);
  
  if (currentMode === 'database') {
    // Highlight "Apply Changes" button to indicate unsaved changes
    const applyBtn = document.getElementById('applyInterventionBtn');
    if (applyBtn) applyBtn.classList.add('pulse-highlight');
  }
}

/**
 * Controller logic for Mode Toggle and Predictor
 */
function setMode(mode) {
  if (currentMode === mode) return;
  currentMode = mode;
  
  const btnDatabase = document.getElementById('btnModeDatabase');
  const btnPredictor = document.getElementById('btnModePredictor');
  const searchInput = document.getElementById('patientSearchInput');
  const prevBtn = document.getElementById('prevPatientBtn');
  const nextBtn = document.getElementById('nextPatientBtn');
  const applyBtn = document.getElementById('applyInterventionBtn');
  const saveBtn = document.getElementById('saveNewPatientBtn');
  const predictBtn = document.getElementById('predictCDSBtn');
  
  if (mode === 'predictor') {
    if (selectedPatientId !== 'NewPatient') {
      lastSelectedDatabasePatientId = selectedPatientId;
    }
    
    btnDatabase.classList.remove('active');
    btnPredictor.classList.add('active');
    
    searchInput.disabled = true;
    searchInput.placeholder = "Disabled in Predictor Mode";
    searchInput.value = "New Patient (Predictor)";
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    
    applyBtn.style.display = 'none';
    predictBtn.style.display = 'block';
    saveBtn.style.display = 'none';
    
    selectedPatientId = 'NewPatient';
    document.getElementById('displayPatientId').textContent = 'New Patient (Predictor)';
    
    loadPredictorDefaults();
    showToast("Switched to New Patient Predictor Mode.");
  } else {
    btnDatabase.classList.add('active');
    btnPredictor.classList.remove('active');
    
    searchInput.disabled = false;
    searchInput.placeholder = "Type patient number or primary diagnosis (e.g., Patient_10, STEMI)...";
    prevBtn.disabled = false;
    nextBtn.disabled = false;
    
    applyBtn.style.display = 'block';
    predictBtn.style.display = 'none';
    saveBtn.style.display = 'none';
    if (applyBtn) applyBtn.classList.remove('pulse-highlight');
    
    selectedPatientId = lastSelectedDatabasePatientId;
    selectPatient(selectedPatientId);
    showToast("Returned to Database Audit Mode.");
  }
}

function loadPredictorDefaults() {
  document.getElementById('select_age_group').value = "Under 75 Years";
  document.getElementById('select_chest_pain').value = "Typical Angina";
  document.getElementById('input_sys_bp').value = "120";
  document.getElementById('input_sp_o2').value = 95;
  document.getElementById('check_diabetes').checked = false;
  document.getElementById('check_stroke').checked = false;
  document.getElementById('check_ckd').checked = false;
  
  document.getElementById('select_diagnosis').value = "STEMI";
  document.getElementById('select_troponin').value = "Negative / Normal";
  document.getElementById('select_reperfusion').value = "Conservative Medical Management";
  document.getElementById('select_p2y12').value = "None";
  document.getElementById('select_bleeding_risk').value = "Standard/Low Risk Margins";
  document.getElementById('select_statin').value = "None";
  document.getElementById('select_ppi').value = "No";
  document.getElementById('select_anticoagulation').value = "No";
  
  renderPendingCDSState();
}

function runPredictorAnalysis() {
  const tempPatient = getPatientObjectFromInputs();
  const computedAudit = window.evaluatePatientCDS(tempPatient);
  renderClinicalAuditColumn(computedAudit);
  
  document.getElementById('saveNewPatientBtn').style.display = 'block';
  showToast("Clinical Decision Support analysis completed.");
}

function renderPendingCDSState() {
  const auditContainer = document.getElementById('cdsAuditCardContainer');
  
  // Clear previous status classes to return card to neutral grey/slate styling
  auditContainer.classList.remove('status-card-optimized', 'status-card-suboptimized', 'status-card-violation');
  
  // Risk Tier Badge
  const tierEl = document.getElementById('val_risk_tier');
  tierEl.textContent = "Pending";
  tierEl.className = 'risk-badge risk-pending';
  
  // Regimen Status Label
  const statusEl = document.getElementById('val_regimen_status');
  statusEl.textContent = "Awaiting Analysis";
  
  // Identified Risk Drivers List
  const driversContainer = document.getElementById('list_risk_drivers');
  driversContainer.innerHTML = `<li class="text-slate-muted italic">Awaiting clinical analysis...</li>`;
  
  // Identified Clinical Deviations List
  const deviationsContainer = document.getElementById('list_deviations');
  deviationsContainer.innerHTML = `<li class="text-slate-muted italic">Awaiting clinical analysis...</li>`;
  
  // Bottom Medication Stop Directive
  const stopDirectiveAlert = document.getElementById('stopDirectiveContainer');
  const stopDirectiveText = document.getElementById('val_stop_directive_text');
  
  stopDirectiveAlert.className = 'stop-directive-card stop-inactive';
  stopDirectiveText.innerHTML = `<strong>Directive:</strong> Analysis pending. Input details and click "Run CDS Analysis".`;
  
  // Required Pharmacist Interventions Checklist
  const interventionsList = document.getElementById('val_pharmacist_interventions_list');
  interventionsList.innerHTML = `
    <div class="intervention-check-item" style="cursor: default; background: rgba(148, 163, 184, 0.03); border-style: dashed;">
      <span class="intervention-text italic" style="color: var(--text-muted);">Please click "Run CDS Analysis" to evaluate the therapy protocol.</span>
    </div>
  `;
}

function savePredictorPatientToRegistry() {
  const existingNumbers = Object.keys(patients).map(id => parseInt(id.split('_')[1])).filter(n => !isNaN(n));
  const nextNum = existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 71;
  const nextPatientId = `Patient_${nextNum}`;

  const newPatient = getPatientObjectFromInputs();
  newPatient.metadata.patient_number = nextNum;
  newPatient.metadata.record_id = nextPatientId;
  
  newPatient.post_discharge_follow_up = {
    tracking_ldl_cholesterol_mg_dl: "Awaiting 4-8 Week Window"
  };

  newPatient.clinical_decision_support_audit = window.evaluatePatientCDS(newPatient);
  patients[nextPatientId] = newPatient;

  localStorage.setItem('ihd_patients_db', JSON.stringify(patients));

  populateSearchDropdown();
  updateGlobalMetrics();
  
  // Reset back to database mode
  currentMode = 'database';
  
  const btnDatabase = document.getElementById('btnModeDatabase');
  const btnPredictor = document.getElementById('btnModePredictor');
  const searchInput = document.getElementById('patientSearchInput');
  const prevBtn = document.getElementById('prevPatientBtn');
  const nextBtn = document.getElementById('nextPatientBtn');
  const applyBtn = document.getElementById('applyInterventionBtn');
  const saveBtn = document.getElementById('saveNewPatientBtn');
  const predictBtn = document.getElementById('predictCDSBtn');
  
  btnDatabase.classList.add('active');
  btnPredictor.classList.remove('active');
  searchInput.disabled = false;
  searchInput.placeholder = "Type patient number or primary diagnosis (e.g., Patient_10, STEMI)...";
  prevBtn.disabled = false;
  nextBtn.disabled = false;
  applyBtn.style.display = 'block';
  predictBtn.style.display = 'none';
  saveBtn.style.display = 'none';
  if (applyBtn) applyBtn.classList.remove('pulse-highlight');

  selectedPatientId = nextPatientId;
  selectPatient(nextPatientId);

  showToast(`Successfully added ${nextPatientId} to registry.`);
}


/**
 * Renders the CDS Card (Column 3) & Bottom alerts
 */
function renderClinicalAuditColumn(audit) {
  const status = audit.regimen_clinical_status || "Suboptimized Therapy";
  const tier = audit.calculated_risk_tier || "Low Risk";
  const auditContainer = document.getElementById('cdsAuditCardContainer');

  // Clear previous status classes
  auditContainer.classList.remove('status-card-optimized', 'status-card-suboptimized', 'status-card-violation');

  // Apply colors based on clinical compliance
  let statusLabel = "Suboptimized";
  if (status === "Optimized") {
    auditContainer.classList.add('status-card-optimized');
    statusLabel = "Optimized compliance";
  } else if (status === "Suboptimized Therapy") {
    auditContainer.classList.add('status-card-suboptimized');
    statusLabel = "Suboptimized Regimen";
  } else if (status === "Critical Safety Violation") {
    auditContainer.classList.add('status-card-violation');
    statusLabel = "Critical Safety Violation";
  }

  // Risk Tier Badge
  const tierEl = document.getElementById('val_risk_tier');
  tierEl.textContent = tier;
  tierEl.className = 'risk-badge ' + (tier === 'High Risk' ? 'risk-high' : 'risk-low');

  // Status Badge
  const statusEl = document.getElementById('val_regimen_status');
  statusEl.textContent = status;

  // Identified Risk Drivers List
  const driversContainer = document.getElementById('list_risk_drivers');
  driversContainer.innerHTML = '';
  const drivers = audit.identified_risk_drivers || [];
  if (drivers.length === 0 || (drivers.length === 1 && drivers[0] === "None Standardized")) {
    driversContainer.innerHTML = `<li class="text-slate-muted italic">No active cardiovascular drivers.</li>`;
  } else {
    drivers.forEach(d => {
      const li = document.createElement('li');
      li.textContent = d;
      driversContainer.appendChild(li);
    });
  }

  // Identified Clinical Deviations List
  const deviationsContainer = document.getElementById('list_deviations');
  deviationsContainer.innerHTML = '';
  const deviations = audit.identified_clinical_deviations || [];
  if (deviations.length === 0 || (deviations.length === 1 && deviations[0] === "None")) {
    deviationsContainer.innerHTML = `<li class="text-optimized-text italic font-medium">✓ Regimen complies with cardiology guidelines.</li>`;
  } else {
    deviations.forEach(dev => {
      const li = document.createElement('li');
      li.className = 'deviation-item';
      li.innerHTML = `<span class="bullet-cross">⚠️</span> ${dev}`;
      deviationsContainer.appendChild(li);
    });
  }

  // --- Render Actionable Clinical Margins (Bottom Alert & Instructions) ---
  const stopDirective = audit.immediate_medication_stop_directive || "No immediate changes required.";
  const stopDirectiveAlert = document.getElementById('stopDirectiveContainer');
  const stopDirectiveText = document.getElementById('val_stop_directive_text');

  if (stopDirective !== "No immediate changes required.") {
    stopDirectiveAlert.className = 'stop-directive-card stop-active';
    stopDirectiveText.innerHTML = `<strong>CRITICAL DIRECTIVE:</strong> ${stopDirective}`;
  } else {
    stopDirectiveAlert.className = 'stop-directive-card stop-inactive';
    stopDirectiveText.innerHTML = `<strong>Directive:</strong> Patient treatment protocol conforms with safety standards. No immediate suspensions required.`;
  }

  // Required Pharmacist Interventions Checklist
  const interventionsList = document.getElementById('val_pharmacist_interventions_list');
  interventionsList.innerHTML = '';

  const rawInterventions = audit.required_pharmacist_interventions;
  let interventionsArray = [];
  if (Array.isArray(rawInterventions)) {
    interventionsArray = rawInterventions;
  } else if (typeof rawInterventions === 'string') {
    // If it's a string from original JSON, check if it's formatted as text
    interventionsArray = [rawInterventions];
  }

  if (interventionsArray.length === 0 || (interventionsArray.length === 1 && interventionsArray[0].includes("optimized. Monitor"))) {
    const item = document.createElement('div');
    item.className = 'intervention-check-item success-item';
    item.innerHTML = `
      <span class="intervention-success-badge">✓</span>
      <span class="intervention-text italic">Therapy optimized. Verify follow-up appointment is scheduled.</span>
    `;
    interventionsList.appendChild(item);
  } else {
    interventionsArray.forEach((val, idx) => {
      const item = document.createElement('label');
      item.className = 'intervention-check-item';
      item.innerHTML = `
        <input type="checkbox" id="check_interv_${idx}" class="pharmacist-check">
        <span class="custom-checkbox"></span>
        <span class="intervention-text">${val}</span>
      `;
      interventionsList.appendChild(item);
    });
  }
}

/**
 * Commits user inputs for selected patient to State and updates metrics
 */
function commitClinicalInterventions() {
  const updatedPatient = getPatientObjectFromInputs();
  const reAudited = window.evaluatePatientCDS(updatedPatient);
  
  updatedPatient.clinical_decision_support_audit = reAudited;
  
  // Save to State
  patients[selectedPatientId] = updatedPatient;

  // Persist locally
  localStorage.setItem('ihd_patients_db', JSON.stringify(patients));

  // Remove Highlight
  document.getElementById('applyInterventionBtn').classList.remove('pulse-highlight');

  // Trigger DOM redraws
  updateGlobalMetrics();
  populateSearchDropdown();
  selectPatient(selectedPatientId);
  
  showToast(`Applied pharmacological updates for ${selectedPatientId}.`);
}

/**
 * Simulates Clinical Queue (Generates varied data across 70 patients for visual representation)
 */
function simulateClinicalQueue() {
  showLoader(true);
  setTimeout(() => {
    Object.keys(patients).forEach((id, index) => {
      const p = patients[id];
      const pmh = p.past_medical_history_and_presentation;
      const findings = p.diagnostic_findings;
      const rx = p.current_hospital_prescriptions;

      // Randomize history a bit
      pmh.history_of_diabetes = index % 3 === 0 ? "Yes" : "No";
      pmh.history_of_stroke_tia = index % 8 === 0 ? "Yes" : "No"; // Contraindication trigger for Prasugrel
      pmh.chronic_kidney_disease = index % 5 === 0 ? "Yes" : "No";
      pmh.oxygen_saturation_pct = index % 12 === 0 ? 88 : 96; // Hypoxia trigger
      pmh.systolic_blood_pressure_mmhg = index % 15 === 0 ? "Not Recorded" : (index % 10 === 0 ? 155 : 122);

      // Randomize treatments
      const roll = index % 10;
      if (roll < 6) {
        // ~60% Optimized Patients
        rx.statin_therapy_intensity = "High-Intensity";
        rx.p2y12_inhibitor_active = "Ticagrelor";
        rx.proton_pump_inhibitor_prescribed = "Yes";
        rx.concurrent_oral_anticoagulation = "No";
      } else if (roll < 8) {
        // ~20% Suboptimized Patients
        rx.statin_therapy_intensity = "None"; // missing statins
        rx.p2y12_inhibitor_active = "Clopidogrel";
        rx.proton_pump_inhibitor_prescribed = "No";
        rx.concurrent_oral_anticoagulation = "No";
      } else if (roll === 8) {
        // ~10% Safety Violation (Prasugrel contraindicated)
        pmh.history_of_stroke_tia = "Yes";
        rx.p2y12_inhibitor_active = "Prasugrel";
        rx.statin_therapy_intensity = "High-Intensity";
      } else {
        // ~10% Safety Violation (Triple Therapy without PPI)
        rx.p2y12_inhibitor_active = "Clopidogrel";
        rx.concurrent_oral_anticoagulation = "Yes";
        rx.proton_pump_inhibitor_prescribed = "No"; // Missing PPI
        rx.statin_therapy_intensity = "High-Intensity";
      }

      // Re-run rules engine
      p.clinical_decision_support_audit = window.evaluatePatientCDS(p);
    });

    // Save & Redraw
    localStorage.setItem('ihd_patients_db', JSON.stringify(patients));
    updateGlobalMetrics();
    populateSearchDropdown();
    selectPatient(selectedPatientId);
    showLoader(false);
    showToast("Simulated clinical queue with randomized case scenarios.");
  }, 400);
}

/**
 * Resets local database back to the raw ingested JSON file values
 */
function resetDatabaseToBaseline() {
  if (confirm("Reset patient database? All custom pharmacist edits and simulations will be cleared.")) {
    showLoader(true);
    localStorage.removeItem('ihd_patients_db');
    setTimeout(() => {
      initializeDatabase();
    }, 300);
  }
}

/**
 * Animation Utilities
 */
function animateNumberValue(id, endValue) {
  const obj = document.getElementById(id);
  if (!obj) return;
  const isInt = !endValue.toString().includes('.');
  const end = parseFloat(endValue);
  let start = parseFloat(obj.textContent) || 0;
  if (start === end) {
    obj.textContent = endValue;
    return;
  }
  const duration = 500; // ms
  const startTime = performance.now();

  function updateNumber(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const value = start + progress * (end - start);
    obj.textContent = isInt ? Math.floor(value) : value.toFixed(1);
    if (progress < 1) {
      requestAnimationFrame(updateNumber);
    } else {
      obj.textContent = endValue;
    }
  }
  requestAnimationFrame(updateNumber);
}

/**
 * Loader & Toast Notifications
 */
function showLoader(show) {
  const loader = document.getElementById('appLoader');
  if (loader) {
    loader.style.display = show ? 'flex' : 'none';
  }
}

function showToast(message, type = 'success') {
  const toastContainer = document.getElementById('toastContainer');
  if (!toastContainer) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${type === 'success' ? '✓' : '⚠️'}</span>
    <span class="toast-message">${message}</span>
  `;
  toastContainer.appendChild(toast);

  // Fade out and remove
  setTimeout(() => {
    toast.classList.add('toast-fadeout');
    toast.addEventListener('transitionend', () => toast.remove());
  }, 3500);
}
