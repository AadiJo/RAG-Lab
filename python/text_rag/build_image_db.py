#!/usr/bin/env python3
"""
Build a vector database with image embeddings from PDFs.

This script processes PDFs and creates embeddings for images using
configurable models and context extraction strategies.
"""

import argparse
import json
import os
import sys
import time
import glob
from typing import Dict, Any, List, Optional, Tuple
from dataclasses import asdict

try:
    import fitz  # PyMuPDF
except ImportError:
    print("ERROR: PyMuPDF (fitz) not installed", file=sys.stderr)
    sys.exit(1)

# Add project root to path for module imports
project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

try:
    from rag_bench.modules import get_registry
except ImportError:
    print("WARNING: Could not import module registry. Image filters will not be available.", file=sys.stderr)
    get_registry = None

# Note: This is a placeholder implementation
# In a real implementation, you would:
# 1. Load the embedding model (CLIP, BLIP, etc.)
# 2. Extract images from PDFs
# 3. Extract surrounding context based on config
# 4. Generate embeddings
# 5. Store in Chroma with metadata

def load_config(config_path: str) -> Dict[str, Any]:
    """Load image embedding configuration."""
    with open(config_path, 'r', encoding='utf-8') as f:
        return json.load(f)


def extract_page_text(page, start_char: int = 0, end_char: Optional[int] = None) -> str:
    """Extract text from a page, optionally with character limits."""
    text = page.get_text()
    if end_char:
        return text[start_char:end_char]
    return text[start_char:]


def extract_context_around_image(
    pdf_path: str,
    page_num: int,
    image_bbox: Dict[str, float],
    config: Dict[str, Any]
) -> str:
    """Extract surrounding text context for an image."""
    pdf = fitz.open(pdf_path)
    try:
        page = pdf[page_num - 1]  # 0-indexed
        
        if config.get('contextSource') == 'none' or not config.get('includeContext', True):
            return ""
        
        context_chars = config.get('contextChars', 500)
        
        # Get all text on the page
        page_text = page.get_text()
        
        # For simplicity, extract text before/after based on image position
        # In a real implementation, you'd extract text based on bbox coordinates
        if config.get('contextSource') == 'before':
            # Extract text before image (approximate)
            return page_text[:context_chars]
        elif config.get('contextSource') == 'after':
            # Extract text after image (approximate)
            return page_text[-context_chars:] if len(page_text) > context_chars else page_text
        elif config.get('contextSource') == 'both':
            # Extract text around image
            mid = len(page_text) // 2
            start = max(0, mid - context_chars // 2)
            end = min(len(page_text), mid + context_chars // 2)
            return page_text[start:end]
        elif config.get('contextSource') == 'page':
            # Extract all page text
            return page_text[:context_chars] if len(page_text) > context_chars else page_text
        else:
            return ""
    finally:
        pdf.close()


def get_image_filters(config: Dict[str, Any]) -> List[Any]:
    """Get enabled image filters from the module registry."""
    if get_registry is None:
        return []
    
    try:
        registry = get_registry()
        image_filters_config = config.get("imageFilters", {})
        return registry.get_enabled_image_filters(image_filters_config)
    except Exception as e:
        print(f"WARNING: Failed to load image filters: {e}", file=sys.stderr)
        return []


def should_exclude_image(
    image: Dict[str, Any],
    context: Dict[str, Any],
    filters: List[Any]
) -> Tuple[bool, Dict[str, Any]]:
    """
    Check if an image should be excluded using all enabled filters.
    
    Returns:
        (should_exclude, exclusion_metadata)
    """
    if not filters:
        return False, {}
    
    exclusion_metadata = {}
    for filter_instance in filters:
        try:
            should_exclude, reason = filter_instance.should_exclude(image, context)
            if should_exclude:
                exclusion_metadata.update(reason)
                exclusion_metadata["filter_id"] = filter_instance.MODULE_ID
                return True, exclusion_metadata
        except Exception as e:
            print(f"WARNING: Image filter '{filter_instance.MODULE_ID}' failed: {e}", file=sys.stderr)
    
    return False, {}


def process_pdf(
    pdf_path: str,
    config: Dict[str, Any],
    output_dir: str,
    filters: Optional[List[Any]] = None
) -> Dict[str, Any]:
    """Process a single PDF and extract images with embeddings."""
    pdf = fitz.open(pdf_path)
    pdf_name = os.path.basename(pdf_path)
    images_processed = 0
    images_excluded = 0
    excluded_images = []
    
    try:
        for page_num in range(len(pdf)):
            page = pdf[page_num]
            page_text = page.get_text()
            image_list = page.get_images()
            
            for img_idx, img in enumerate(image_list):
                xref = img[0]
                base_image = pdf.extract_image(xref)
                image_bytes = base_image["image"]
                
                # Get image position
                image_rects = page.get_image_rects(xref)
                bbox = image_rects[0] if image_rects else None
                
                # Build image dict
                image_dict = {
                    "page": page_num + 1,
                    "index": img_idx,
                    "xref": xref,
                    "width": base_image["width"],
                    "height": base_image["height"],
                    "format": base_image["ext"],
                    "size_bytes": len(image_bytes),
                    "bbox": {
                        "x0": float(bbox.x0),
                        "y0": float(bbox.y0),
                        "x1": float(bbox.x1),
                        "y1": float(bbox.y1),
                    } if bbox else None,
                }
                
                # Extract context
                context_text = ""
                if bbox:
                    bbox_dict = {
                        "x0": float(bbox.x0),
                        "y0": float(bbox.y0),
                        "x1": float(bbox.x1),
                        "y1": float(bbox.y1),
                    }
                    context_text = extract_context_around_image(
                        pdf_path, page_num + 1, bbox_dict, config
                    )
                
                # Build context for filters
                filter_context = {
                    "pdf_path": pdf_path,
                    "pdf_name": pdf_name,
                    "page_text": page_text,
                    "image_context": context_text,
                    "config": config,
                }
                
                # Apply image filters
                if filters:
                    should_exclude, exclusion_metadata = should_exclude_image(
                        image_dict, filter_context, filters
                    )
                    if should_exclude:
                        images_excluded += 1
                        excluded_images.append({
                            "page": page_num + 1,
                            "index": img_idx,
                            "width": image_dict["width"],
                            "height": image_dict["height"],
                            "exclusion_reason": exclusion_metadata.get("reason", "filtered"),
                            "exclusion_metadata": exclusion_metadata,
                        })
                        continue
                
                # TODO: Generate embedding using the configured model
                # For now, we'll just log the image info
                images_processed += 1
                
    finally:
        pdf.close()
    
    result = {
        "pdf": pdf_name,
        "images_processed": images_processed,
        "images_excluded": images_excluded,
    }
    
    if excluded_images:
        result["excluded_images"] = excluded_images
    
    return result


def main():
    parser = argparse.ArgumentParser(description="Build image embedding database")
    parser.add_argument("--input-dir", required=True, help="Input directory with PDFs")
    parser.add_argument("--output-dir", required=True, help="Output directory for database")
    parser.add_argument("--config", required=True, help="Path to image embedding config JSON")
    
    args = parser.parse_args()
    
    # Load config
    config = load_config(args.config)
    
    # Load image filters
    filters = get_image_filters(config)
    if filters:
        filter_names = [f.MODULE_ID for f in filters]
        print(f"INFO: Enabled image filters: {', '.join(filter_names)}", flush=True)
    
    # Find all PDFs
    pdf_pattern = os.path.join(args.input_dir, "*.pdf")
    pdf_files = sorted(glob.glob(pdf_pattern))
    
    if not pdf_files:
        print(f"ERROR: No PDFs found in {args.input_dir}", file=sys.stderr)
        sys.exit(1)
    
    total = len(pdf_files)
    processed = 0
    total_images_processed = 0
    total_images_excluded = 0
    
    print(f"PROGRESS: pdf 0/{total} Starting...", flush=True)
    
    for pdf_path in pdf_files:
        pdf_name = os.path.basename(pdf_path)
        try:
            result = process_pdf(pdf_path, config, args.output_dir, filters)
            processed += 1
            total_images_processed += result.get("images_processed", 0)
            total_images_excluded += result.get("images_excluded", 0)
            print(f"PROGRESS: pdf {processed}/{total} {pdf_name}", flush=True)
        except Exception as e:
            print(f"ERROR: Failed to process {pdf_name}: {e}", file=sys.stderr)
            continue
    
    print(f"PROGRESS: pdf {processed}/{total} Complete", flush=True)
    print(f"Processed {processed} PDFs", flush=True)
    print(f"Total images processed: {total_images_processed}", flush=True)
    if total_images_excluded > 0:
        print(f"Total images excluded: {total_images_excluded}", flush=True)


if __name__ == "__main__":
    main()

