import os
import sys
import time
import re
import argparse
import sqlite3
import cv2
import json
import numpy as np
import fitz  # PyMuPDF
from paddleocr import PaddleOCR

# 1. Initialize PaddleOCR Engine
ocr = PaddleOCR(use_angle_cls=True, lang='en')

def update_progress(status_file, step_msg, progress_pct):
    """Writes the current progress to a temporary JSON file for the frontend to read."""
    if status_file:
        try:
            with open(status_file, 'w', encoding='utf-8') as f:
                json.dump({"step": step_msg, "progress": progress_pct}, f)
        except Exception:
            pass

def preprocess_image(image_path):
    """Applies grayscale conversion, CLAHE contrast enhancement, and denoising."""
    img = cv2.imread(image_path)
    if img is None:
        return image_path
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)
    denoised = cv2.fastNlMeansDenoising(enhanced, h=10)
    return cv2.cvtColor(denoised, cv2.COLOR_GRAY2BGR)

def rip_pdf_to_images(pdf_path, output_dir, status_file):
    """Rips every PDF page into a JPEG file inside output_dir."""
    os.makedirs(output_dir, exist_ok=True)
    doc = fitz.open(pdf_path)
    total_pages = len(doc)
    print(f"[PDF Processor] Total pages to rip: {total_pages}")
    
    saved_images = []
    # High resolution scale factor (2.0 = 144 DPI)
    zoom = 2.0 
    mat = fitz.Matrix(zoom, zoom)

    for i, page in enumerate(doc):
        page_num = i + 1
        pix = page.get_pixmap(matrix=mat)
        img_filename = f"page_{page_num}.jpg"
        img_path = os.path.join(output_dir, img_filename)
        pix.save(img_path)
        saved_images.append((page_num, img_path))
        
        # Ripping takes up the first 15% of the progress bar
        progress = int((page_num / total_pages) * 15)
        update_progress(status_file, f"Ripping PDF pages... ({page_num}/{total_pages})", progress)
        print(f"  [Ripped] Page {page_num}/{total_pages} -> {img_filename}")

    doc.close()
    return saved_images
def get_robust_connection(db_path, retries=5):
    """Attempts to connect to SQLite safely, retrying if the file is locked."""
    for i in range(retries):
        try:
            conn = sqlite3.connect(db_path, timeout=30)
            conn.execute("PRAGMA journal_mode=WAL;")
            return conn
        except sqlite3.OperationalError as e:
            if "locked" in str(e).lower() and i < retries - 1:
                time.sleep(2)  # Wait 2 seconds and try again
            else:
                raise e
def process_pdf(pdf_path, book_id, status_file, db_path="archives.db"):
    """Full Pipeline: Rip PDF -> Run OCR -> Bulk Insert into SQLite archives table."""
    safe_book_id = book_id.strip()
    image_dir = os.path.join("Archive_Images", safe_book_id)
    
    # Step A: Rip PDF
    update_progress(status_file, "Initializing PDF engine...", 2)
    print(f"\n[PDF Processor] Starting rasterization for book: '{safe_book_id}'")
    page_files = rip_pdf_to_images(pdf_path, image_dir, status_file)
    
    # Step B: Connect to Database
    update_progress(status_file, "Connecting to database...", 16)
    conn = get_robust_connection(db_path)
    cursor = conn.cursor()

    # Clear old entries for this book if re-uploading
    cursor.execute("DELETE FROM archives WHERE book_id = ?", (safe_book_id,))
    conn.commit()

    total_inserted = 0
    total_pages = len(page_files)

    # Step C: OCR & Direct Ingestion
    for idx, (page_num, img_path) in enumerate(page_files):
        # OCR takes up the remaining 15% to 100% of the progress bar
        current_progress = 15 + int(((idx) / total_pages) * 85)
        update_progress(status_file, f"Scanning text with AI... (Page {page_num}/{total_pages})", current_progress)
        
        print(f"\n[PDF Processor] OCR Processing: {img_path}...")
        processed_img = preprocess_image(img_path)
        
        result_iterable = ocr.predict(processed_img)
        result = list(result_iterable) if result_iterable else []
        
        page_batch = []
        if result and len(result) > 0:
            page_data = result[0]
            extracted_lines = []
            
            try:
                # Modern PaddleOCR 3.7+ Format
                boxes = page_data['dt_polys']
                texts = page_data['rec_texts']
                for box, text in zip(boxes, texts):
                    extracted_lines.append((box, text))
            except (KeyError, TypeError, Exception):
                # Legacy PaddleOCR Format Fallback
                for line in page_data:
                    if line:
                        extracted_lines.append((line[0], line[1][0]))

            for box, text_string in extracted_lines:
                text_cleaned = text_string.strip()
                if not text_cleaned:
                    continue
                
                x_coords = [p[0] for p in box]
                y_coords = [p[1] for p in box]
                left = int(min(x_coords))
                top = int(min(y_coords))
                width = int(max(x_coords) - left)
                height = int(max(y_coords) - top)

                # Append matching the 7-column schema
                page_batch.append((safe_book_id, str(page_num), text_cleaned, left, top, width, height))

        if page_batch:
            cursor.executemany(
                "INSERT INTO archives VALUES (?, ?, ?, ?, ?, ?, ?)",
                page_batch
            )
            conn.commit()
            total_inserted += len(page_batch)
            print(f"  [DB Ingested] Page {page_num}: {len(page_batch)} word entries inserted.")

    conn.close()
    update_progress(status_file, f"Complete! Indexed {total_inserted} words.", 100)
    print(f"\n[PDF Processor SUCCESS] Book '{safe_book_id}' completely processed! Total rows: {total_inserted}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Process uploaded PDF into images & FTS5 database entries.")
    parser.add_argument("--pdf-path", required=True, help="Path to raw uploaded PDF file")
    parser.add_argument("--book-id", required=True, help="Unique identifier/title for the book")
    parser.add_argument("--status-file", required=False, default="", help="Path to JSON file for progress tracking")
    args = parser.parse_args()

    process_pdf(args.pdf_path, args.book_id, args.status_file)