/**
 * Ischemic Heart Disease (IHD) Clinical Decision Support System - Rules Engine
 * Evaluates patient records against evidence-based cardiology guidelines.
 */

function evaluatePatientCDS(patient) {
  // Safe extraction with default fallbacks for robust error tolerance
  const pmh = patient.past_medical_history_and_presentation || {};
  const findings = patient.diagnostic_findings || {};
  const rx = patient.current_hospital_prescriptions || {};
  const audit = patient.clinical_decision_support_audit || {};

  // Extract variables
  const ageGroup = pmh.age_group || "Under 75 Years";
  const chestPain = pmh.chest_pain_presentation || "Typical Angina";
  const sbpVal = pmh.systolic_blood_pressure_mmhg !== undefined ? pmh.systolic_blood_pressure_mmhg : "Not Recorded";
  const spo2Val = pmh.oxygen_saturation_pct !== undefined ? pmh.oxygen_saturation_pct : 95;
  const hasDiabetes = pmh.history_of_diabetes === "Yes";
  const hasStrokeTia = pmh.history_of_stroke_tia === "Yes";
  const hasCKD = pmh.chronic_kidney_disease === "Yes";

  const primaryDiagnosis = findings.primary_diagnosis || "Undetermined";
  const troponinStatus = findings.cardiac_troponin_biomarker || "Negative / Normal";

  const reperfusionStrategy = rx.assigned_reperfusion_strategy || "Conservative Medical Management";
  const activeP2Y12 = rx.p2y12_inhibitor_active || "None";
  const bleedingRisk = rx.high_bleeding_risk_status || "Standard/Low Risk Margins";
  const statinIntensity = rx.statin_therapy_intensity || "None";
  const hasPPI = rx.proton_pump_inhibitor_prescribed === "Yes";
  const hasAnticoagulant = rx.concurrent_oral_anticoagulation === "Yes";

  // 1. Calculate Risk Drivers and Risk Tier
  const riskDrivers = [];
  
  if (primaryDiagnosis === "STEMI") {
    riskDrivers.push("STEMI Presentation");
  } else if (primaryDiagnosis === "NSTEMI") {
    riskDrivers.push("NSTEMI Presentation");
  } else if (primaryDiagnosis === "Unstable Angina (UA)") {
    riskDrivers.push("Unstable Angina (UA) Diagnosis");
  }

  if (troponinStatus === "Positive / Elevated") {
    riskDrivers.push("Elevated Cardiac Biomarkers (Troponin Positive)");
  }
  if (hasDiabetes) {
    riskDrivers.push("Comorbidity: Active Diabetes Mellitus");
  }
  if (hasStrokeTia) {
    riskDrivers.push("Comorbidity: History of Stroke/TIA");
  }
  if (hasCKD) {
    riskDrivers.push("Comorbidity: Chronic Kidney Disease (CKD)");
  }

  // Calculate risk tier based on risk drivers or preserve if low/high risk
  let riskTier = "Low Risk";
  if (primaryDiagnosis === "STEMI" || primaryDiagnosis === "NSTEMI" || hasDiabetes || hasStrokeTia || hasCKD || riskDrivers.length > 0) {
    riskTier = "High Risk";
  }

  // 2. Initialize Audit Outputs
  let regimenStatus = "Optimized"; // Default compliance
  const deviations = [];
  const interventions = [];
  let stopDirective = "No immediate changes required.";

  // Rule A: Statin Therapy Intensity (Secondary Prevention)
  // Class I recommendation: High-Intensity statin is indicated for all ACS / CAD patients unless contraindicated
  // Exception: In patients aged >= 75 years, moderate-intensity statin is acceptable due to safety/tolerability guidelines.
  const isElderly = ageGroup === "75 Years and Older";
  if (statinIntensity === "None") {
    if (isElderly) {
      deviations.push("Patient is missing a statin foundation for secondary disease prevention (Moderate-Intensity acceptable for age >= 75).");
      interventions.push("Initiate moderate to high-intensity statin daily (e.g., Atorvastatin 20-80mg or Rosuvastatin 10-40mg).");
    } else {
      deviations.push("Patient is missing a high-intensity statin foundation for secondary disease prevention.");
      interventions.push("Initiate Atorvastatin 40-80mg or Rosuvastatin 20-40mg daily.");
    }
    regimenStatus = "Suboptimized Therapy";
  } else if (statinIntensity === "Moderate-Intensity") {
    if (!isElderly) {
      deviations.push("Patient is on moderate-intensity statin. High-intensity statin is recommended for secondary disease prevention unless contraindicated.");
      interventions.push("Titrate statin to high-intensity (e.g., Atorvastatin 80mg or Rosuvastatin 40mg daily) as tolerated.");
      regimenStatus = "Suboptimized Therapy";
    }
  }

  // Rule B: P2Y12 Active Agent Missing in ACS (Suboptimized)
  // ACS patients should be on dual antiplatelet therapy (DAPT) with Aspirin + P2Y12 inhibitor
  const isACS = ["STEMI", "NSTEMI", "Unstable Angina (UA)"].includes(primaryDiagnosis);
  if (isACS && activeP2Y12 === "None") {
    deviations.push("Patient with ACS is missing active P2Y12 receptor inhibitor therapy for Dual Antiplatelet Therapy (DAPT).");
    interventions.push("Initiate active P2Y12 inhibitor therapy (e.g., Ticagrelor 90mg BID or Clopidogrel 75mg daily).");
    if (regimenStatus !== "Critical Safety Violation") {
      regimenStatus = "Suboptimized Therapy";
    }
  }

  // Rule C: Prasugrel Contraindication in Patients with History of Stroke/TIA (Critical Safety Violation)
  // Prasugrel carries a boxed warning and is contraindicated in patients with a history of stroke or TIA
  if (activeP2Y12 === "Prasugrel" && hasStrokeTia) {
    regimenStatus = "Critical Safety Violation";
    deviations.push("CRITICAL CONTRAINDICATION: Prasugrel is prescribed to a patient with a prior history of Stroke/TIA.");
    stopDirective = "STOP Prasugrel immediately! Prasugrel is contraindicated due to a history of stroke or TIA, which increases intracranial hemorrhage risks.";
    interventions.unshift("Discontinue Prasugrel immediately and switch to Ticagrelor 90mg BID (or Clopidogrel 75mg daily if bleeding risk is very high).");
  }

  // Rule D: Triple/Dual Therapy Bleeding Risk (No PPI) (Critical Safety Violation)
  // Patients taking both antiplatelet(s) and an oral anticoagulant have a very high bleeding risk.
  // Co-prescription of a PPI is recommended/required to reduce GI bleeding risk.
  if (activeP2Y12 !== "None" && hasAnticoagulant && !hasPPI) {
    regimenStatus = "Critical Safety Violation";
    deviations.push("HIGH BLEEDING RISK: Patient is on concurrent oral anticoagulation and antiplatelet therapy without a Proton Pump Inhibitor (PPI) for gastroprotection.");
    stopDirective = "Safety directive: Initiate Proton Pump Inhibitor (PPI) therapy immediately.";
    interventions.push("Prescribe PPI co-therapy (e.g., Pantoprazole 40mg daily or Omeprazole 20mg daily) to minimize upper GI hemorrhage risk.");
  }

  // Rule E: Presenting Oxygen Saturation (Hypoxia)
  // SpO2 < 90% in ACS should be managed with supplemental oxygen
  const sPo2Num = parseFloat(spo2Val);
  if (!isNaN(sPo2Num) && sPo2Num < 90) {
    deviations.push(`Hypoxia detected: Patient presenting SpO2 is ${spo2Val}% (< 90%).`);
    interventions.push("Initiate supplemental oxygen therapy immediately to maintain SpO2 >= 90%.");
    if (regimenStatus === "Optimized") {
      regimenStatus = "Suboptimized Therapy";
    }
  }

  // Rule F: Systolic Blood Pressure Checks (Hypotension / Hypertension)
  if (sbpVal === "Not Recorded") {
    deviations.push("Systolic blood pressure not recorded. Hemodynamic stability assessment is required.");
    interventions.push("Measure and document systolic blood pressure immediately.");
    if (regimenStatus === "Optimized") {
      regimenStatus = "Suboptimized Therapy";
    }
  } else {
    const sbpNum = parseFloat(sbpVal);
    if (!isNaN(sbpNum)) {
      if (sbpNum < 90) {
        deviations.push(`Hypotension detected: Systolic blood pressure is ${sbpNum} mmHg (< 90 mmHg).`);
        interventions.push("Evaluate patient for cardiogenic shock or clinical hypovolemia. Consider holding vasodilators/beta-blockers.");
        if (regimenStatus === "Optimized") {
          regimenStatus = "Suboptimized Therapy";
        }
      } else if (sbpNum > 140) {
        deviations.push(`Elevated blood pressure: Systolic blood pressure is ${sbpNum} mmHg (> 140 mmHg).`);
        interventions.push("Optimize guideline-directed medical therapy (GDMT) for blood pressure control (e.g., Beta-blockers, ACE inhibitors).");
        if (regimenStatus === "Optimized") {
          regimenStatus = "Suboptimized Therapy";
        }
      }
    }
  }

  // Final adjustments for deviations and interventions
  const finalDeviations = deviations.length > 0 ? deviations : ["None"];
  const finalInterventions = interventions.length > 0 
    ? interventions 
    : ["Regimen is optimized. Monitor patient compliance, tolerability, and follow up LDL-C in 4-8 weeks."];

  return {
    calculated_risk_tier: riskTier,
    identified_risk_drivers: riskDrivers.length > 0 ? riskDrivers : ["None Standardized"],
    regimen_clinical_status: regimenStatus,
    identified_clinical_deviations: finalDeviations,
    immediate_medication_stop_directive: stopDirective,
    required_pharmacist_interventions: finalInterventions
  };
}

// Support browser and Node environment
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { evaluatePatientCDS };
}
if (typeof window !== 'undefined') {
  window.evaluatePatientCDS = evaluatePatientCDS;
}
