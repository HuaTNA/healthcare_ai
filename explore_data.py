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

dataframes = {}
for f in files:
    name = f.replace(".csv.gz", "")
    print(f"\n{'='*60}")
    print(f"Downloading: {f}")
    path = hf_hub_download(repo_id=repo_id, filename=f, repo_type="dataset")
    df = pd.read_csv(path)
    dataframes[name] = df
    print(f"Shape: {df.shape}")
    print(f"\nColumns: {list(df.columns)}")
    print(f"\nDtypes:\n{df.dtypes}")
    print(f"\nFirst 3 rows:")
    print(df.head(3).to_string())
    print(f"\nNull counts:\n{df.isnull().sum()}")

# Show relationships
print("\n" + "="*60)
print("KEY STATISTICS")
print("="*60)
cc = dataframes["clinical_cases"]
print(f"\nUnique patients: {cc['subject_id'].nunique()}")
print(f"Unique admissions: {cc['hadm_id'].nunique()}")
print(f"Age range: {cc['age'].min()} - {cc['age'].max()}")
print(f"Gender distribution:\n{cc['gender'].value_counts()}")
print(f"\nTop 10 admission diagnoses:\n{cc['admission_diagnosis'].value_counts().head(10)}")

labs = dataframes["labs_subset"]
print(f"\nUnique lab items: {labs.shape[1]} columns -> {list(labs.columns)}")

diag = dataframes["diagnoses_subset"]
print(f"\nTotal diagnosis records: {len(diag)}")
print(f"Unique ICD9 codes: {diag['icd9_code'].nunique() if 'icd9_code' in diag.columns else 'N/A'}")

presc = dataframes["prescriptions_subset"]
print(f"\nTotal prescription records: {len(presc)}")
print(f"Prescription columns: {list(presc.columns)}")
