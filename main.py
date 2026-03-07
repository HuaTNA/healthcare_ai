from huggingface_hub import hf_hub_download
import pandas as pd

repo_id = "bavehackathon/2026-healthcare-ai"

clinical_cases = pd.read_csv(
    hf_hub_download(repo_id=repo_id, filename="clinical_cases.csv.gz", repo_type="dataset")
)

labs = pd.read_csv(
    hf_hub_download(repo_id=repo_id, filename="labs_subset.csv.gz", repo_type="dataset")
)
