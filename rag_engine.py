"""
RAG Engine — Layer 3: Hybrid Retrieval
Combines embedding-based semantic search with Knowledge Graph structural search.
"""

import chromadb
from sentence_transformers import SentenceTransformer
from data_loader import DataLoader, Patient
from knowledge_graph import ClinicalKnowledgeGraph
from config import EMBEDDING_MODEL, CHROMA_DB_PATH, CHROMA_COLLECTION


class RAGEngine:
    def __init__(self, loader: DataLoader, kg: ClinicalKnowledgeGraph):
        self.loader = loader
        self.kg = kg
        self.embed_model = None
        self.collection = None

    def build(self) -> "RAGEngine":
        print("Building RAG Engine...")
        print("  Loading embedding model...")
        self.embed_model = SentenceTransformer(EMBEDDING_MODEL)

        print("  Building ChromaDB index...")
        client = chromadb.PersistentClient(path=CHROMA_DB_PATH)

        # Delete existing collection if exists, rebuild fresh
        try:
            client.delete_collection(CHROMA_COLLECTION)
        except Exception:
            pass

        self.collection = client.create_collection(
            name=CHROMA_COLLECTION,
            metadata={"hnsw:space": "cosine"},
        )

        patients = self.loader.get_all_patients()
        batch_size = 100

        for i in range(0, len(patients), batch_size):
            batch = patients[i:i + batch_size]
            docs = []
            ids = []
            metadatas = []

            for p in batch:
                # Create a rich text representation for embedding
                text = self._build_embedding_text(p)
                docs.append(text)
                ids.append(p.case_id)
                metadatas.append({
                    "hadm_id": p.hadm_id,
                    "age": p.age,
                    "gender": p.gender,
                    "admission_diagnosis": p.admission_diagnosis,
                })

            embeddings = self.embed_model.encode(docs).tolist()
            self.collection.add(
                documents=docs,
                embeddings=embeddings,
                ids=ids,
                metadatas=metadatas,
            )

        print(f"  Indexed {len(patients)} patients.")
        return self

    def _build_embedding_text(self, p: Patient) -> str:
        """Build a rich text for embedding that combines all data sources."""
        parts = [
            f"Age: {p.age}, Gender: {p.gender}",
            f"Admission Diagnosis: {p.admission_diagnosis}",
        ]

        # Add diagnosis names
        dx_names = p.get_diagnosis_names()[:10]
        if dx_names:
            parts.append(f"Diagnoses: {', '.join(dx_names)}")

        # Add drug names
        drugs = p.get_drug_names()[:15]
        if drugs:
            parts.append(f"Medications: {', '.join(drugs)}")

        # Add first 2000 chars of discharge summary
        if p.discharge_summary:
            parts.append(f"Summary: {p.discharge_summary[:2000]}")

        return "\n".join(parts)

    def search(self, query: str, top_k: int = 5, exclude_case_id: str = None) -> list[dict]:
        """Semantic search over patient records."""
        query_embedding = self.embed_model.encode(query).tolist()

        results = self.collection.query(
            query_embeddings=[query_embedding],
            n_results=top_k + (1 if exclude_case_id else 0),
        )

        output = []
        for i in range(len(results["ids"][0])):
            case_id = results["ids"][0][i]
            if case_id == exclude_case_id:
                continue

            meta = results["metadatas"][0][i]
            hadm_id = meta["hadm_id"]
            patient = self.loader.patients.get(hadm_id)
            if patient:
                output.append({
                    "patient": patient,
                    "semantic_score": 1 - results["distances"][0][i],  # cosine similarity
                })

            if len(output) >= top_k:
                break

        return output

    def hybrid_search(
        self,
        target_patient: Patient,
        query: str = None,
        top_k: int = 5,
    ) -> list[dict]:
        """
        Hybrid search combining:
        1. Knowledge Graph structural similarity
        2. Embedding semantic similarity
        """
        # Path A: Knowledge Graph search
        kg_results = self.kg.find_similar_patients(target_patient.hadm_id, top_k=top_k * 2)

        # Path B: Semantic search
        search_query = query or f"{target_patient.age} {target_patient.gender} {target_patient.admission_diagnosis}"
        sem_results = self.search(search_query, top_k=top_k * 2, exclude_case_id=target_patient.case_id)

        # Merge scores
        combined = {}
        kg_max = max((r["score"] for r in kg_results), default=1)
        for r in kg_results:
            hadm_id = r["patient"].hadm_id
            combined[hadm_id] = {
                "patient": r["patient"],
                "kg_score": r["score"] / kg_max if kg_max > 0 else 0,
                "semantic_score": 0,
                "shared_diagnoses": r["shared_diagnoses"],
                "shared_drugs": r["shared_drugs"],
                "shared_labs": r["shared_labs"],
            }

        for r in sem_results:
            hadm_id = r["patient"].hadm_id
            if hadm_id in combined:
                combined[hadm_id]["semantic_score"] = r["semantic_score"]
            else:
                combined[hadm_id] = {
                    "patient": r["patient"],
                    "kg_score": 0,
                    "semantic_score": r["semantic_score"],
                    "shared_diagnoses": [],
                    "shared_drugs": [],
                    "shared_labs": [],
                }

        # Weighted final score: KG 60%, Semantic 40%
        for v in combined.values():
            v["final_score"] = v["kg_score"] * 0.6 + v["semantic_score"] * 0.4

        ranked = sorted(combined.values(), key=lambda x: -x["final_score"])[:top_k]
        return ranked


if __name__ == "__main__":
    loader = DataLoader().load()
    kg = ClinicalKnowledgeGraph(loader).build()
    rag = RAGEngine(loader, kg).build()

    # Test hybrid search
    p = loader.get_patient_by_case_id("CASE_00001")
    if p:
        print(f"\nHybrid search for {p.case_id} ({p.admission_diagnosis}):")
        results = rag.hybrid_search(p, top_k=3)
        for r in results:
            rp = r["patient"]
            print(f"  {rp.case_id} ({rp.age}{rp.gender}, {rp.admission_diagnosis})")
            print(f"    KG={r['kg_score']:.2f} Semantic={r['semantic_score']:.2f} "
                  f"Final={r['final_score']:.2f}")
            if r["shared_diagnoses"]:
                print(f"    Shared Dx: {r['shared_diagnoses'][:3]}")

    # Test semantic search
    print("\nSemantic search: 'elderly patient with sepsis and kidney failure'")
    results = rag.search("elderly patient with sepsis and kidney failure", top_k=3)
    for r in results:
        rp = r["patient"]
        print(f"  {rp.case_id} ({rp.age}{rp.gender}, {rp.admission_diagnosis}) "
              f"score={r['semantic_score']:.3f}")
