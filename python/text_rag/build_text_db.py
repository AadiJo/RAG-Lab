#!/usr/bin/env python3
"""
Build a text-only Chroma DB from PDFs.

This is an independent ingestion/build pipeline meant for fast ablation testing
in `rag-lab` (without modifying the external `frc-rag` repo).

Inputs:
- A directory of PDFs

Outputs:
- A persisted Chroma DB in output dir
- A `_manifest.json` capturing build configuration and basic stats

Key knobs:
- chunk_size / chunk_overlap
- representation: raw vs structured
- embedding model/device4
"""

import argparse
import glob
import json
import os
import sys
import time
import re
from dataclasses import asdict, dataclass
from typing import Any, Dict, List, Optional, Tuple

import fitz  # PyMuPDF
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_chroma import Chroma
from langchain_huggingface import HuggingFaceEmbeddings


@dataclass
class BuildConfig:
    input_dir: str
    output_dir: str
    representation: str
    chunk_size: int
    chunk_overlap: int
    separators: List[str]
    embedding_model: str
    embedding_device: str
    include_filename_banner: bool


def _safe_mkdir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def _list_pdfs(input_dir: str) -> List[str]:
    patterns = [
        os.path.join(input_dir, "*.pdf"),
        os.path.join(input_dir, "**", "*.pdf"),
    ]
    out: List[str] = []
    for p in patterns:
        out.extend(glob.glob(p, recursive=True))
    # de-dupe while keeping deterministic order
    out = sorted(set(out))
    return out


def _extract_raw_text(page: fitz.Page) -> str:
    return page.get_text() or ""


def _detect_header(text: str) -> bool:
    t = (text or "").strip()
    if not t:
        return False
    if "\n" not in t and t.isupper() and 3 <= len(t) <= 50:
        return True
    # simple heuristic: short line ending with colon
    if len(t) < 80 and t.endswith(":"):
        return True
    return False


def _extract_structured_text(page: fitz.Page) -> Tuple[str, bool]:
    """
    A lightweight structured extraction inspired by frc-rag's enhanced extraction:
    - extract blocks with positions
    - emit headers distinctly
    """
    try:
        blocks = page.get_text("dict")
        sorted_blocks: List[Dict[str, Any]] = []
        for block in blocks.get("blocks", []):
            if block.get("type") != 0:
                continue
            block_text = ""
            for line in block.get("lines", []):
                line_text = ""
                for span in line.get("spans", []):
                    line_text += span.get("text", "")
                if line_text.strip():
                    block_text += line_text + "\n"
            if block_text.strip():
                bbox = block.get("bbox", [0, 0, 0, 0])
                sorted_blocks.append(
                    {
                        "text": block_text.strip(),
                        "bbox": bbox,
                        "position": (bbox[1], bbox[0]),
                    }
                )

        sorted_blocks.sort(key=lambda x: (x["position"][0], x["position"][1]))

        parts: List[str] = []
        for b in sorted_blocks:
            t = b["text"]
            # split into lines and treat each line as candidate header
            lines = [ln.strip() for ln in t.splitlines() if ln.strip()]
            for ln in lines:
                if _detect_header(ln):
                    parts.append(f"## {ln}")
                else:
                    parts.append(ln)
            parts.append("")  # paragraph break

        structured = "\n".join(parts).strip()
        if not structured:
            return _extract_raw_text(page), False
        return structured, True
    except Exception:
        return _extract_raw_text(page), False


def _make_documents(pdf_path: str, representation: str, include_filename_banner: bool) -> List[Document]:
    docs: List[Document] = []
    pdf = fitz.open(pdf_path)
    base = os.path.basename(pdf_path)
    pdf_base = os.path.splitext(base)[0]
    # Extract common metadata from filenames like:
    # - 2056-2025.pdf -> team=2056 season=2025
    # - 4607-1-2024.pdf -> team=4607 season=2024
    team = None
    season = None
    try:
        m_year = re.search(r"(19|20)\d{2}", pdf_base)
        if m_year:
            season = m_year.group(0)
        m_team = re.match(r"^(\d{2,5})", pdf_base)
        if m_team:
            team = m_team.group(1)
    except Exception:
        pass
    try:
        for page_idx in range(len(pdf)):
            page = pdf[page_idx]
            if representation == "structured":
                text, preserved = _extract_structured_text(page)
            else:
                text = _extract_raw_text(page)
                preserved = False

            text = (text or "").strip()
            if not text:
                continue

            if include_filename_banner:
                text = f"=== DOCUMENT: {base} | PAGE: {page_idx + 1} ===\n\n{text}"

            docs.append(
                Document(
                    page_content=text,
                    metadata={
                        "source": pdf_path,
                        "doc_name": base,
                        "doc_id": pdf_base,
                        "season": season or "",
                        "team": team or "",
                        "page": page_idx + 1,
                        "type": "text_page",
                        "representation": representation,
                        "layout_preserved": bool(preserved),
                    },
                )
            )
    finally:
        pdf.close()
    return docs


def _split_documents(documents: List[Document], chunk_size: int, chunk_overlap: int, separators: List[str]) -> List[Document]:
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        length_function=len,
        add_start_index=True,
        separators=separators,
    )
    return splitter.split_documents(documents)


def _simplify_metadata(doc: Document) -> Document:
    simple: Dict[str, Any] = {}
    for k, v in (doc.metadata or {}).items():
        if isinstance(v, (str, int, float, bool)):
            simple[k] = v
        elif isinstance(v, list):
            simple[k] = json.dumps(v)
        else:
            simple[k] = str(v)
    return Document(page_content=doc.page_content, metadata=simple)


def _write_manifest(output_dir: str, cfg: BuildConfig, stats: Dict[str, Any]) -> None:
    manifest = {
        "schema": "rag-lab.textdb.manifest.v1",
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "config": asdict(cfg),
        "stats": stats,
    }
    with open(os.path.join(output_dir, "_manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--input-dir", required=True)
    p.add_argument("--output-dir", required=True)
    p.add_argument("--representation", choices=["raw", "structured"], default="structured")
    p.add_argument("--chunk-size", type=int, default=800)
    p.add_argument("--chunk-overlap", type=int, default=200)
    p.add_argument("--embedding-model", default=os.getenv("TEXT_EMBEDDING_MODEL", "BAAI/bge-large-en-v1.5"))
    p.add_argument("--embedding-device", default=os.getenv("TEXT_EMBEDDING_DEVICE", "cpu"))
    p.add_argument("--include-filename-banner", action="store_true")
    args = p.parse_args()

    input_dir = os.path.abspath(args.input_dir)
    output_dir = os.path.abspath(args.output_dir)

    _safe_mkdir(output_dir)

    pdfs = _list_pdfs(input_dir)
    if not pdfs:
        print(json.dumps({"error": f"No PDFs found in: {input_dir}"}))
        sys.exit(2)

    separators = ["\n\n", "\n", ". ", "! ", "? ", " ", ""]
    cfg = BuildConfig(
        input_dir=input_dir,
        output_dir=output_dir,
        representation=args.representation,
        chunk_size=args.chunk_size,
        chunk_overlap=args.chunk_overlap,
        separators=separators,
        embedding_model=args.embedding_model,
        embedding_device=args.embedding_device,
        include_filename_banner=bool(args.include_filename_banner),
    )

    start = time.time()
    all_docs: List[Document] = []

    for i, pdf_path in enumerate(pdfs, 1):
        docs = _make_documents(pdf_path, cfg.representation, cfg.include_filename_banner)
        all_docs.extend(docs)
        print(f"PROGRESS: pdf {i}/{len(pdfs)} pages_docs={len(docs)} file={os.path.basename(pdf_path)}", flush=True)

    chunks = _split_documents(all_docs, cfg.chunk_size, cfg.chunk_overlap, cfg.separators)
    chunks = [_simplify_metadata(d) for d in chunks]

    embeddings = HuggingFaceEmbeddings(
        model_name=cfg.embedding_model,
        model_kwargs={"device": cfg.embedding_device},
    )

    # Build DB (overwrite output_dir contents)
    # Chroma persists multiple files; if output_dir is reused, delete it first for clean experiments.
    for child in os.listdir(output_dir):
        if child == "_manifest.json":
            continue
        path = os.path.join(output_dir, child)
        try:
            if os.path.isdir(path):
                import shutil

                shutil.rmtree(path)
            else:
                os.remove(path)
        except Exception:
            pass

    Chroma.from_documents(chunks, embeddings, persist_directory=output_dir)

    elapsed = time.time() - start
    stats = {
        "pdfCount": len(pdfs),
        "pageDocs": len(all_docs),
        "chunks": len(chunks),
        "seconds": elapsed,
    }
    _write_manifest(output_dir, cfg, stats)

    print(json.dumps({"ok": True, "output_dir": output_dir, "stats": stats}))


if __name__ == "__main__":
    main()


