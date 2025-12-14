#!/usr/bin/env python3
"""
Extract images and metadata from a PDF file.

Outputs JSON with image information including:
- Page number
- Image index on page
- Bounding box
- Image size
- Base64 encoded image (optional)
"""

import argparse
import json
import sys
import base64
from typing import List, Dict, Any

try:
    import fitz  # PyMuPDF
except ImportError:
    print("ERROR: PyMuPDF (fitz) not installed. Install with: pip install pymupdf", file=sys.stderr)
    sys.exit(1)


def extract_images(pdf_path: str, include_base64: bool = False) -> List[Dict[str, Any]]:
    """
    Extract all images from a PDF file.
    
    Args:
        pdf_path: Path to the PDF file
        include_base64: Whether to include base64-encoded image data
    
    Returns:
        List of image dictionaries with metadata
    """
    images = []
    pdf = fitz.open(pdf_path)
    
    if not pdf:
        return images
    
    try:
        for page_num in range(len(pdf)):
            page = pdf[page_num]
            image_list = page.get_images()
            
            for img_idx, img in enumerate(image_list):
                xref = img[0]
                base_image = pdf.extract_image(xref)
                image_bytes = base_image["image"]
                image_ext = base_image["ext"]
                
                # Get image position on page
                image_rects = page.get_image_rects(xref)
                bbox = image_rects[0] if image_rects else None
                
                image_info = {
                    "page": page_num + 1,
                    "index": img_idx,
                    "xref": xref,
                    "width": base_image["width"],
                    "height": base_image["height"],
                    "format": image_ext,
                    "size_bytes": len(image_bytes),
                    "bbox": {
                        "x0": float(bbox.x0) if bbox else None,
                        "y0": float(bbox.y0) if bbox else None,
                        "x1": float(bbox.x1) if bbox else None,
                        "y1": float(bbox.y1) if bbox else None,
                    } if bbox else None,
                }
                
                if include_base64:
                    image_info["base64"] = base64.b64encode(image_bytes).decode("utf-8")
                
                images.append(image_info)
    finally:
        pdf.close()
    
    return images


def main():
    parser = argparse.ArgumentParser(description="Extract images from a PDF")
    parser.add_argument("--pdf", required=True, help="Path to PDF file")
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    parser.add_argument("--include-base64", action="store_true", help="Include base64-encoded images")
    
    args = parser.parse_args()
    
    try:
        images = extract_images(args.pdf, include_base64=args.include_base64)
        
        if args.json:
            print(json.dumps({"images": images, "count": len(images)}, indent=2))
        else:
            print(f"Found {len(images)} images in {args.pdf}")
            for img in images:
                print(f"  Page {img['page']}, Image {img['index']}: {img['width']}x{img['height']} ({img['format']})")
    except Exception as e:
        print(json.dumps({"error": str(e), "images": []}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()

