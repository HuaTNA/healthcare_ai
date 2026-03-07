"""Validate data integrity: compare Patient objects against raw CSV tables."""
import pandas as pd
import random
from data_loader import DataLoader

loader = DataLoader().load()
patients = loader.get_all_patients()

cc = loader.raw_tables['clinical_cases']
diag = loader.raw_tables['diagnoses_subset']
labs = loader.raw_tables['labs_subset']
presc = loader.raw_tables['prescriptions_subset']

dx_err, lab_err, rx_err, val_err = 0, 0, 0, 0

# 1. Check record counts for ALL 2000 patients
for p in patients:
    h = p.hadm_id
    expected_dx = len(diag[diag['hadm_id'] == h])
    expected_labs = len(labs[labs['hadm_id'] == h])
    expected_rx = len(presc[presc['hadm_id'] == h])

    if expected_dx != len(p.diagnoses):
        dx_err += 1
    if expected_labs != len(p.labs):
        lab_err += 1
    if expected_rx != len(p.prescriptions):
        rx_err += 1

# 2. Spot-check 200 random lab values
random.seed(42)
sample = random.sample(patients, 200)
for p in sample:
    h = p.hadm_id
    raw = labs[labs['hadm_id'] == h]
    if len(raw) == 0:
        continue
    idx = random.randint(0, len(raw) - 1)
    raw_val = raw.iloc[idx]['value']
    raw_str = str(raw_val) if pd.notna(raw_val) else ''
    our_str = p.labs[idx]['value']
    if raw_str != our_str:
        val_err += 1
        print(f"  Value mismatch {p.case_id}: raw=\"{raw_str}\" ours=\"{our_str}\"")

# 3. Print report
total = len(patients)
raw_dx = len(diag)
raw_labs = len(labs)
raw_rx = len(presc)
our_dx = sum(len(p.diagnoses) for p in patients)
our_labs = sum(len(p.labs) for p in patients)
our_rx = sum(len(p.prescriptions) for p in patients)

print("=" * 50)
print("DATA INTEGRITY VALIDATION REPORT")
print("=" * 50)
print(f"Patients loaded: {total}")
print()
print("Record Count Verification (all 2000 patients):")
print(f"  Diagnoses:     {dx_err} mismatches out of {total}  -> {'PASS' if dx_err == 0 else 'FAIL'}")
print(f"  Labs:          {lab_err} mismatches out of {total}  -> {'PASS' if lab_err == 0 else 'FAIL'}")
print(f"  Prescriptions: {rx_err} mismatches out of {total}  -> {'PASS' if rx_err == 0 else 'FAIL'}")
print()
print("Total Record Counts:")
print(f"  Diagnoses:     raw={raw_dx:,}  loaded={our_dx:,}  match={raw_dx == our_dx}")
print(f"  Labs:          raw={raw_labs:,}  loaded={our_labs:,}  match={raw_labs == our_labs}")
print(f"  Prescriptions: raw={raw_rx:,}  loaded={our_rx:,}  match={raw_rx == our_rx}")
print()
print(f"Lab Value Spot-Check: {val_err} mismatches out of 200  -> {'PASS' if val_err == 0 else 'FAIL'}")
print("=" * 50)
