#!/usr/bin/env python3
"""
Extract text context around an image in a PDF for preview.

This script extracts the surrounding text context based on the image embedding
configuration to show users what context will be included with each image.
"""

import argparse
import json
import sys
from typing import Dict, Any, Optional

try:
    import fitz  # PyMuPDF
except ImportError:
    print("ERROR: PyMuPDF (fitz) not installed", file=sys.stderr)
    sys.exit(1)


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
        
        if not page_text:
            return ""
        
        # For simplicity, extract text before/after based on image position
        # In a real implementation, you'd extract text based on bbox coordinates
        if config.get('contextSource') == 'before':
            # Extract text before image (approximate - first part of page)
            return page_text[:context_chars]
        elif config.get('contextSource') == 'after':
            # Extract text after image (approximate - last part of page)
            return page_text[-context_chars:] if len(page_text) > context_chars else page_text
        elif config.get('contextSource') == 'both':
            # Extract text around image (approximate - middle section)
            mid = len(page_text) // 2
            start = max(0, mid - context_chars // 2)
            end = min(len(page_text), mid + context_chars // 2)
            return page_text[start:end]
        elif config.get('contextSource') == 'page':
            # Extract all page text (up to limit)
            return page_text[:context_chars] if len(page_text) > context_chars else page_text
        else:
            return ""
    finally:
        pdf.close()


def main():
    parser = argparse.ArgumentParser(description="Extract context around an image")
    parser.add_argument("--pdf", required=True, help="Path to PDF file")
    parser.add_argument("--page", type=int, required=True, help="Page number (1-indexed)")
    parser.add_argument("--bbox", required=True, help="Bounding box JSON: {\"x0\":...,\"y0\":...,\"x1\":...,\"y1\":...}")
    parser.add_argument("--config", required=True, help="Image embedding config JSON")
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    
    args = parser.parse_args()
    
    try:
        bbox = json.loads(args.bbox)
        config = json.loads(args.config)
        
        context = extract_context_around_image(
            args.pdf,
            args.page,
            bbox,
            config
        )
        
        if args.json:
            print(json.dumps({"context": context, "length": len(context)}, indent=2))
        else:
            print(context)
    except Exception as e:
        print(json.dumps({"error": str(e), "context": ""}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()

