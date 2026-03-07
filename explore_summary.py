from huggingface_hub import hf_hub_download
import pandas as pd

repo_id = "bavehackathon/2026-healthcare-ai"

files = [
    "clinical_cases.csv.gz",
    "diagnoses_subset.csv.gz",
    "diagnosis_dictionary.csv.gz",
    "labs_subset.csv.gz",
    "lab_dictionary.csv.gz",
    "prescriptions_subset.csv.gz",
]

dfs = {}
for f in files:
    name = f.replace(".csv.gz", "")
    path = hf_hub_download(repo_id=repo_id, filename=f, repo_type="dataset")
    dfs[name] = pd.read_csv(path)

print("=" * 60)
for name, df in dfs.items():
    print(f"\n## {name}")
    print(f"   Shape: {df.shape}")
    print(f"   Columns: {list(df.columns)}")
    print(f"   Nulls: {df.isnull().sum().to_dict()}")

# clinical_cases
cc = dfs["clinical_cases"]
print("\n" + "=" * 60)
print("## CLINICAL CASES DETAILS")
print(f"   Patients: {cc['subject_id'].nunique()}")
print(f"   Admissions: {cc['hadm_id'].nunique()}")
print(f"   Age: {cc['age'].min()}-{cc['age'].max()}, mean={cc['age'].mean():.1f}")
print(f"   Gender:\n{cc['gender'].value_counts().to_string()}")
print(f"\n   Top 15 diagnoses:")
for diag, cnt in cc['admission_diagnosis'].value_counts().head(15).items():
    print(f"     {cnt:4d} | {diag}")
print(f"\n   Avg discharge_summary length: {cc['discharge_summary'].str.len().mean():.0f} chars")

# diagnoses
diag = dfs["diagnoses_subset"]
print("\n" + "=" * 60)
print("## DIAGNOSES DETAILS")
print(f"   Records: {len(diag)}")
print(f"   Columns: {list(diag.columns)}")
print(f"   Sample:\n{diag.head(5).to_string()}")
print(f"   Unique ICD9 codes: {diag['icd9_code'].nunique() if 'icd9_code' in diag.columns else 'N/A'}")

# diagnosis dictionary
dd = dfs["diagnosis_dictionary"]
print("\n" + "=" * 60)
print("## DIAGNOSIS DICTIONARY")
print(f"   Records: {len(dd)}")
print(f"   Columns: {list(dd.columns)}")
print(f"   Sample:\n{dd.head(5).to_string()}")

# labs
labs = dfs["labs_subset"]
print("\n" + "=" * 60)
print("## LABS DETAILS")
print(f"   Records: {len(labs)}")
print(f"   Columns: {list(labs.columns)}")
print(f"   Sample:\n{labs.head(5).to_string()}")

# lab dictionary
ld = dfs["lab_dictionary"]
print("\n" + "=" * 60)
print("## LAB DICTIONARY")
print(f"   Records: {len(ld)}")
print(f"   Columns: {list(ld.columns)}")
print(f"   Sample:\n{ld.head(5).to_string()}")

# prescriptions
presc = dfs["prescriptions_subset"]
print("\n" + "=" * 60)
print("## PRESCRIPTIONS DETAILS")
print(f"   Records: {len(presc)}")
print(f"   Columns: {list(presc.columns)}")
print(f"   Sample:\n{presc.head(5).to_string()}")
if 'drug' in presc.columns:
    print(f"\n   Top 10 drugs:")
    for drug, cnt in presc['drug'].value_counts().head(10).items():
        print(f"     {cnt:4d} | {drug}")
