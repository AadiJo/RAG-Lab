#!/usr/bin/env python3
"""
Build a text-only Chroma DB from PDFs.

A domain-agnostic ingestion pipeline for creating vector databases
from PDF documents. Supports document processor modules for domain-specific
metadata extraction and content transformation.

Inputs:
- A directory of PDFs

Outputs:
- A persisted Chroma DB in output dir
- A `_manifest.json` capturing build configuration and basic stats

Key knobs:
- chunk_size / chunk_overlap
- representation: raw vs structured
- embedding model/device
- document processor modules
"""

import argparse
import glob
import json
import os
import sys
import time
import re
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import fitz  # PyMuPDF
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_chroma import Chroma
from langchain_huggingface import HuggingFaceEmbeddings

# Import module system
try:
    from rag_bench.modules import get_registry, ModuleType, DocumentProcessor
    MODULES_AVAILABLE = True
except ImportError:
    MODULES_AVAILABLE = False
    DocumentProcessor = None


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
    enabled_modules: List[str] = field(default_factory=list)
    module_configs: Dict[str, Dict[str, Any]] = field(default_factory=dict)


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
    A lightweight structured extraction with layout preservation:
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
    """
    Extract documents from a PDF file.
    
    Creates one Document per page with standard metadata.
    Domain-specific metadata extraction should be handled by modules.
    """
    docs: List[Document] = []
    pdf = fitz.open(pdf_path)
    base = os.path.basename(pdf_path)
    pdf_base = os.path.splitext(base)[0]
    
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


def _load_document_processors(
    enabled_modules: List[str],
    module_configs: Dict[str, Dict[str, Any]],
) -> List[Any]:
    """
    Load enabled document processor modules.
    
    Args:
        enabled_modules: List of module IDs to enable
        module_configs: Configuration for each module
    
    Returns:
        List of instantiated DocumentProcessor modules
    """
    if not MODULES_AVAILABLE:
        return []
    
    registry = get_registry()
    processors = []
    
    for module_id in enabled_modules:
        module_class = registry.get_module(module_id)
        if module_class is None:
            print(f"WARNING: Module not found: {module_id}", file=sys.stderr)
            continue
        
        if module_class.get_module_type() != ModuleType.DOCUMENT_PROCESSOR:
            continue  # Skip non-document-processor modules
        
        config = module_configs.get(module_id, {})
        try:
            processor = module_class(config)
            processors.append(processor)
            print(f"LOADED: document processor '{module_id}'", flush=True)
        except Exception as e:
            print(f"WARNING: Failed to load module '{module_id}': {e}", file=sys.stderr)
    
    return processors


def _apply_document_processors(
    docs: List[Document],
    processors: List[Any],
    context: Dict[str, Any],
) -> List[Document]:
    """
    Apply document processor modules to documents.
    
    Args:
        docs: List of documents to process
        processors: List of DocumentProcessor instances
        context: Build context
    
    Returns:
        List of processed documents (some may be filtered out)
    """
    if not processors:
        return docs
    
    for processor in processors:
        # Convert to (content, metadata) tuples for the processor
        doc_tuples = [(d.page_content, dict(d.metadata or {})) for d in docs]
        
        try:
            processed_tuples, context = processor.process_documents(doc_tuples, context)
            
            # Convert back to Document objects
            docs = [
                Document(page_content=content, metadata=metadata)
                for content, metadata in processed_tuples
            ]
        except Exception as e:
            print(f"WARNING: Document processor '{processor.MODULE_ID}' failed: {e}", file=sys.stderr)
            # Continue with unmodified docs on error
    
    return docs


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--input-dir", default=os.getenv("TEXTDB_PDF_INPUT_DIR", "./data/pdfs"))
    p.add_argument("--output-dir", required=True)
    p.add_argument("--representation", choices=["raw", "structured"], default="structured")
    p.add_argument("--chunk-size", type=int, default=800)
    p.add_argument("--chunk-overlap", type=int, default=200)
    p.add_argument("--embedding-model", default=os.getenv("TEXT_EMBEDDING_MODEL", "BAAI/bge-large-en-v1.5"))
    p.add_argument("--embedding-device", default=os.getenv("TEXT_EMBEDDING_DEVICE", "cpu"))
    p.add_argument("--include-filename-banner", action="store_true")
    p.add_argument(
        "--modules-json",
        default="",
        help='JSON object with module config: {"enabled": ["mod-id"], "configs": {"mod-id": {...}}}',
    )
    args = p.parse_args()

    input_dir = os.path.abspath(args.input_dir)
    output_dir = os.path.abspath(args.output_dir)

    _safe_mkdir(output_dir)

    pdfs = _list_pdfs(input_dir)
    if not pdfs:
        print(json.dumps({"error": f"No PDFs found in: {input_dir}"}))
        sys.exit(2)

    # Parse module configuration
    enabled_modules: List[str] = []
    module_configs: Dict[str, Dict[str, Any]] = {}
    if args.modules_json:
        try:
            mod_data = json.loads(args.modules_json)
            enabled_modules = mod_data.get("enabled", [])
            module_configs = mod_data.get("configs", {})
        except json.JSONDecodeError as e:
            print(f"WARNING: Invalid --modules-json: {e}", file=sys.stderr)

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
        enabled_modules=enabled_modules,
        module_configs=module_configs,
    )

    # Load document processor modules
    doc_processors = _load_document_processors(enabled_modules, module_configs)

    start = time.time()
    all_docs: List[Document] = []

    for i, pdf_path in enumerate(pdfs, 1):
        docs = _make_documents(pdf_path, cfg.representation, cfg.include_filename_banner)
        all_docs.extend(docs)
        print(f"PROGRESS: pdf {i}/{len(pdfs)} pages_docs={len(docs)} file={os.path.basename(pdf_path)}", flush=True)

    # Apply document processor modules
    if doc_processors:
        print(f"PROGRESS: applying {len(doc_processors)} document processor(s)...", flush=True)
        context = {"config": asdict(cfg)}
        all_docs = _apply_document_processors(all_docs, doc_processors, context)
        print(f"PROGRESS: {len(all_docs)} documents after processing", flush=True)

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


