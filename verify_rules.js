/**
 * CARDIO-CDS Clinical Rules Verification Script
 * Headless test runner to validate the rules engine behavior.
 */

const { evaluatePatientCDS } = require('./js/rules.js');

console.log('==================================================');
console.log('  CARDIO-CDS CLINICAL RULES VALIDATION SUITE      ');
console.log('==================================================\n');

let totalTests = 0;
let passedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    console.log(`[PASS] ${message}`);
    passedTests++;
  } else {
    console.error(`[FAIL] ${message}`);
  }
}

// Mock Patients
const mockPatientBase = {
  metadata: { patient_number: 1, record_id: "Patient_1" },
  past_medical_history_and_presentation: {
    age_group: "Under 75 Years",
    chest_pain_presentation: "Typical Angina",
    systolic_blood_pressure_mmhg: "120",
    oxygen_saturation_pct: 95,
    history_of_diabetes: "No",
    history_of_stroke_tia: "No",
    chronic_kidney_disease: "No"
  },
  diagnostic_findings: {
    primary_diagnosis: "STEMI",
    cardiac_troponin_biomarker: "Positive / Elevated"
  },
  current_hospital_prescriptions: {
    assigned_reperfusion_strategy: "PCI",
    p2y12_inhibitor_active: "Ticagrelor",
    high_bleeding_risk_status: "Standard/Low Risk Margins",
    statin_therapy_intensity: "High-Intensity",
    proton_pump_inhibitor_prescribed: "Yes",
    concurrent_oral_anticoagulation: "No"
  }
};

// Test Case 1: Optimized Compliance
try {
  const p = JSON.parse(JSON.stringify(mockPatientBase));
  const result = evaluatePatientCDS(p);
  assert(result.regimen_clinical_status === "Optimized", "Test Case 1: Full guideline compliance should return 'Optimized' status.");
  assert(result.identified_clinical_deviations.length === 1 && result.identified_clinical_deviations[0] === "None", "Test Case 1: Optimized status should have no deviations.");
} catch (e) {
  console.error('[ERROR] Test Case 1 crashed: ', e);
}

// Test Case 2: Suboptimized - Missing High-Intensity Statin
try {
  const p = JSON.parse(JSON.stringify(mockPatientBase));
  p.current_hospital_prescriptions.statin_therapy_intensity = "None";
  const result = evaluatePatientCDS(p);
  assert(result.regimen_clinical_status === "Suboptimized Therapy", "Test Case 2: Missing statin should return 'Suboptimized Therapy' status.");
  assert(result.identified_clinical_deviations.some(d => d.includes("missing a high-intensity statin")), "Test Case 2: Should list missing statin deviation.");
  assert(result.required_pharmacist_interventions.some(i => i.includes("Initiate Atorvastatin")), "Test Case 2: Should suggest initiating Atorvastatin.");
} catch (e) {
  console.error('[ERROR] Test Case 2 crashed: ', e);
}

// Test Case 3: Suboptimized - Moderate-Intensity Statin
try {
  const p = JSON.parse(JSON.stringify(mockPatientBase));
  p.current_hospital_prescriptions.statin_therapy_intensity = "Moderate-Intensity";
  const result = evaluatePatientCDS(p);
  assert(result.regimen_clinical_status === "Suboptimized Therapy", "Test Case 3: Moderate statin should return 'Suboptimized Therapy'.");
  assert(result.identified_clinical_deviations.some(d => d.includes("moderate-intensity statin")), "Test Case 3: Deviation should flag moderate-intensity.");
} catch (e) {
  console.error('[ERROR] Test Case 3 crashed: ', e);
}

// Test Case 4: Critical Safety Violation - Prasugrel with prior Stroke/TIA
try {
  const p = JSON.parse(JSON.stringify(mockPatientBase));
  p.past_medical_history_and_presentation.history_of_stroke_tia = "Yes";
  p.current_hospital_prescriptions.p2y12_inhibitor_active = "Prasugrel";
  const result = evaluatePatientCDS(p);
  assert(result.regimen_clinical_status === "Critical Safety Violation", "Test Case 4: Prasugrel with Stroke history must trigger a 'Critical Safety Violation'.");
  assert(result.immediate_medication_stop_directive.includes("STOP Prasugrel"), "Test Case 4: Stop directive must specifically flag Prasugrel suspension.");
  assert(result.required_pharmacist_interventions.some(i => i.includes("Discontinue Prasugrel")), "Test Case 4: Interventions must suggest discontinuing and switching.");
} catch (e) {
  console.error('[ERROR] Test Case 4 crashed: ', e);
}

// Test Case 5: Critical Safety Violation - Triple Therapy without PPI
try {
  const p = JSON.parse(JSON.stringify(mockPatientBase));
  p.current_hospital_prescriptions.concurrent_oral_anticoagulation = "Yes";
  p.current_hospital_prescriptions.proton_pump_inhibitor_prescribed = "No";
  const result = evaluatePatientCDS(p);
  assert(result.regimen_clinical_status === "Critical Safety Violation", "Test Case 5: Combination of anticoagulation and P2Y12 without PPI must trigger 'Critical Safety Violation'.");
  assert(result.identified_clinical_deviations.some(d => d.includes("gastroprotection")), "Test Case 5: Deviation list should contain bleeding risk / gastroprotection flag.");
} catch (e) {
  console.error('[ERROR] Test Case 5 crashed: ', e);
}

// Test Case 6: Suboptimized - Hypoxia
try {
  const p = JSON.parse(JSON.stringify(mockPatientBase));
  p.past_medical_history_and_presentation.oxygen_saturation_pct = 87;
  const result = evaluatePatientCDS(p);
  assert(result.regimen_clinical_status === "Suboptimized Therapy", "Test Case 6: SpO2 < 90% should yield 'Suboptimized Therapy'.");
  assert(result.identified_clinical_deviations.some(d => d.includes("Hypoxia detected")), "Test Case 6: Should note SpO2 deviation.");
} catch (e) {
  console.error('[ERROR] Test Case 6 crashed: ', e);
}

// Test Case 7: Suboptimized - BP Not Recorded
try {
  const p = JSON.parse(JSON.stringify(mockPatientBase));
  p.past_medical_history_and_presentation.systolic_blood_pressure_mmhg = "Not Recorded";
  const result = evaluatePatientCDS(p);
  assert(result.regimen_clinical_status === "Suboptimized Therapy", "Test Case 7: BP Not Recorded should trigger 'Suboptimized Therapy'.");
} catch (e) {
  console.error('[ERROR] Test Case 7 crashed: ', e);
}

// Test Case 8: Elderly patient (>= 75 years) on Moderate-Intensity Statin is acceptable
try {
  const p = JSON.parse(JSON.stringify(mockPatientBase));
  p.past_medical_history_and_presentation.age_group = "75 Years and Older";
  p.current_hospital_prescriptions.statin_therapy_intensity = "Moderate-Intensity";
  const result = evaluatePatientCDS(p);
  assert(result.regimen_clinical_status === "Optimized", "Test Case 8: Elderly patient (>= 75) on Moderate-Intensity statin should be 'Optimized'.");
} catch (e) {
  console.error('[ERROR] Test Case 8 crashed: ', e);
}

// Test Case 9: Elderly patient (>= 75 years) on No Statin is suboptimized
try {
  const p = JSON.parse(JSON.stringify(mockPatientBase));
  p.past_medical_history_and_presentation.age_group = "75 Years and Older";
  p.current_hospital_prescriptions.statin_therapy_intensity = "None";
  const result = evaluatePatientCDS(p);
  assert(result.regimen_clinical_status === "Suboptimized Therapy", "Test Case 9: Elderly patient (>= 75) on No Statin should be 'Suboptimized Therapy'.");
  assert(result.identified_clinical_deviations.some(d => d.includes("Moderate-Intensity acceptable for age >= 75")), "Test Case 9: Should show moderate statin acceptable deviation.");
} catch (e) {
  console.error('[ERROR] Test Case 9 crashed: ', e);
}

console.log('\n==================================================');
console.log(`  RESULTS: ${passedTests} / ${totalTests} TESTS PASSED`);
console.log('==================================================');

if (passedTests === totalTests) {
  process.exit(0);
} else {
  process.exit(1);
}
