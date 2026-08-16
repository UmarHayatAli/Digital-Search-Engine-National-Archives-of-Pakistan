import os
import sys
from xhtml2pdf import pisa
from io import BytesIO
import json
import sqlite3
import asyncio
import re
import time
import collections
import threading
import subprocess
import uuid
import csv
from datetime import datetime, timedelta
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, Response, Depends, HTTPException, status, File, UploadFile, Form, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel
from passlib.context import CryptContext
from jose import jwt, JWTError, ExpiredSignatureError
from fastapi.responses import JSONResponse, FileResponse

# --- Pydantic Models for Downloader ---
class DownloadBookItem(BaseModel):
    title: str
    url: str
    book_id: str

class DownloadPayload(BaseModel):
    books: list[DownloadBookItem]

# --- Pydantic Models for OCR Editing ---
class WordCoordinate(BaseModel):
    word: str
    left: int
    top: int
    width: int
    height: int

class EditSuggestionPayload(BaseModel):
    book_id: str
    page_number: str
    suggested_text: str

class ResolveEditPayload(BaseModel):
    edit_id: int
    action: str # "approve" or "reject"

class UpdateCredentialsPayload(BaseModel):
    new_username: str
    new_password: str

# --- Subprocess & State Tracking ---
active_subprocesses = {}
subprocess_registry_lock = threading.Lock()
scan_lock = threading.Lock()
scan_status = {"running": False, "last_run": None, "message": "Never run"}
download_lock = threading.Lock()
download_status = {"running": False, "last_run": None, "message": "Never run", "stats": {}}

# --- Subprocess & State Tracking for PDF Ingestion ---
pdf_lock = threading.Lock()
pdf_status = {"running": False, "last_run": None, "message": "Never run"}

# --- Security & JWT Config ---
import secrets
SECRET_KEY = os.environ.get("JWT_SECRET_KEY", secrets.token_hex(32))
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 120 
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=4)
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="admin/login")

def sanitize_book_id(filename: str) -> str:
    # Only allow letters, numbers, dashes, and underscores. Strips out dangerous dots and slashes.
    return re.sub(r'[^a-zA-Z0-9_-]', '', filename)
# --- Database Helper ---
def get_db_connection(db_path='archives.db'):
    conn = sqlite3.connect(db_path, timeout=15, check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL;")
    return conn

def init_admin_db():
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS admin_users (
                id INTEGER PRIMARY KEY,
                username TEXT UNIQUE,
                hashed_password TEXT
            )
        ''')
        
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS pending_edits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                book_id TEXT,
                page_number TEXT,
                proposed_layout_data TEXT,
                status TEXT DEFAULT 'pending',
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        cursor.execute("SELECT COUNT(*) FROM admin_users")
        if cursor.fetchone()[0] == 0:
            hashed_pw = pwd_context.hash("admin123")
            cursor.execute("INSERT INTO admin_users (username, hashed_password) VALUES (?, ?)", ("admin", hashed_pw))
            
        conn.commit()
    finally:
        conn.close()

# ==========================================
# WEBSOCKET MANAGER (Global Real-Time Updates)
# ==========================================
class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                pass # Ignore broken pipes from disconnected users

manager = ConnectionManager()

# ==========================================
# LIFESPAN 
# ==========================================
@asynccontextmanager
async def lifespan(app: FastAPI):
    init_admin_db()
    print("Database connected. FTS5 Search Engine Active.")
    yield 
    print("Shutting down cleanly.")

app = FastAPI(lifespan=lifespan)

# --- Middleware & Static Files ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows your Vercel/Cloud frontend to enter
    allow_credentials=False, # Must be False when origins is "*"
    allow_methods=["*"],
    allow_headers=["*"],
)

os.makedirs('Archive_Images', exist_ok=True)
os.makedirs('logs', exist_ok=True)

app.mount('/images', StaticFiles(directory='Archive_Images'), name='images')

# --- WebSocket Endpoint ---
@app.websocket("/ws/updates")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text() # Keeps the connection open
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# --- Admin Auth Routes ---
@app.post("/admin/login")
def login_admin(req: OAuth2PasswordRequestForm = Depends()):
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT hashed_password FROM admin_users WHERE username = ?", (req.username,))
        row = cursor.fetchone()
        
        if not row or not pwd_context.verify(req.password, row[0]):
            raise HTTPException(status_code=401, detail="Incorrect username or password")
        
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
        to_encode = {"sub": req.username, "exp": expire}
        encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
        
        return {"access_token": encoded_jwt, "token_type": "bearer"}
    finally:
        conn.close()

def get_current_admin(token: str = Depends(oauth2_scheme)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM], options={"leeway": 60})
        username: str = payload.get("sub")
        if username is None:
            raise HTTPException(status_code=401, detail="Invalid token.")
        return username
    except ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired — please log in again.")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token.")

@app.post("/admin/credentials/update")
def update_admin_credentials(payload: UpdateCredentialsPayload, current_admin: str = Depends(get_current_admin)):
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        hashed_pw = pwd_context.hash(payload.new_password)
        cursor.execute(
            "UPDATE admin_users SET username = ?, hashed_password = ? WHERE username = ?",
            (payload.new_username, hashed_pw, current_admin)
        )
        conn.commit()
        return {"status": "success", "message": "Credentials updated successfully."}
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=400, detail="Username already exists.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

# --- PDF Ingestion Routes ---
def _run_pdf_processor(pdf_path: str, book_id: str, status_file: str):
    import shutil
    was_cancelled = False
    try:
        proc = subprocess.Popen(
            [sys.executable, "pdf_processor.py", "--pdf-path", pdf_path, "--book-id", book_id, "--status-file", status_file],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8"
        )
        with subprocess_registry_lock:
            active_subprocesses["pdf_upload"] = proc
        
        stdout_data, stderr_data = proc.communicate()
        
        with pdf_lock:
            was_cancelled = pdf_status.get("cancelled", False)
            
        if was_cancelled:
            msg = "Upload cancelled. Cleaning up files..."
        elif proc.returncode == 0:
            msg = f"Book '{book_id}' successfully uploaded and indexed!"
        else:
            msg = f"PDF Processing failed: {stderr_data[:200]}"
            
    except Exception as e:
        msg = f"Failed to launch PDF processor: {str(e)}"
    finally:
        with subprocess_registry_lock:
            active_subprocesses.pop("pdf_upload", None)
        
        for tmp_file in [pdf_path, status_file]:
            if os.path.exists(tmp_file):
                try: os.remove(tmp_file)
                except: pass
        
        if was_cancelled:
            try:
                safe_book_id = sanitize_book_id(book_id)
                image_dir = os.path.join("Archive_Images", safe_book_id)
                if os.path.exists(image_dir):
                    shutil.rmtree(image_dir)
                
                conn = sqlite3.connect('archives.db', timeout=15)
                conn.execute("PRAGMA journal_mode=WAL;")
                cursor = conn.cursor()
                cursor.execute("DELETE FROM archives WHERE book_id = ?", (book_id.strip(),))
                conn.commit()
                conn.close()
                msg = "Processing forcefully cancelled by admin. All files rolled back."
            except Exception as cleanup_err:
                msg = f"Cancelled, but cleanup failed: {str(cleanup_err)}"
                
        with pdf_lock:
            pdf_status["running"] = False
            pdf_status["last_run"] = datetime.utcnow().isoformat()
            pdf_status["message"] = msg

@app.post("/admin/upload-pdf")
async def upload_pdf_book(
    book_id: str = Form(...),
    file: UploadFile = File(...),
    admin: str = Depends(get_current_admin)
):
    if not file.filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed.")
    
    with pdf_lock:
        if pdf_status.get("running"):
            return JSONResponse(status_code=409, content={"status": "already_running", "message": "A PDF is currently being processed."})
        pdf_status["running"] = True
        pdf_status["cancelled"] = False 
        pdf_status["message"] = f"Starting processing for '{book_id}'..."
        
    os.makedirs("tmp_payloads", exist_ok=True)
    job_id = uuid.uuid4().hex
    temp_pdf_path = f"tmp_payloads/upload_{job_id}.pdf"
    status_file = f"tmp_payloads/pdf_status_{job_id}.json"
    pdf_status["current_status_file"] = status_file
    
    with open(status_file, 'w', encoding='utf-8') as f:
        json.dump({"step": "Uploading file...", "progress": 0}, f)
        
    with open(temp_pdf_path, "wb") as buffer:
        content = await file.read()
        buffer.write(content)
        
    threading.Thread(target=_run_pdf_processor, args=(temp_pdf_path, book_id, status_file), daemon=True).start()
    return JSONResponse(status_code=202, content={"status": "accepted", "message": f"PDF upload started."})

@app.post("/admin/upload-pdf/cancel")
def cancel_pdf_upload(admin: str = Depends(get_current_admin)):
    with pdf_lock:
        if not pdf_status.get("running"):
            return {"status": "idle", "message": "No process is currently running."}
        pdf_status["cancelled"] = True
        pdf_status["message"] = "Cancelling and rolling back files..."
        
    with subprocess_registry_lock:
        proc = active_subprocesses.get("pdf_upload")
        if proc:
            try:
                proc.terminate()
            except Exception:
                pass
                
    return {"status": "cancelled", "message": "Process terminated. Cleanup initiated."}

@app.get("/admin/upload-pdf/status")
async def get_pdf_upload_status(response: Response, admin: str = Depends(get_current_admin)):
    response.headers["Cache-Control"] = "no-store"
    current_progress = 0
    current_step = pdf_status["message"]
    
    if pdf_status.get("running") and "current_status_file" in pdf_status:
        try:
            with open(pdf_status["current_status_file"], 'r', encoding='utf-8') as f:
                live_data = json.load(f)
                current_step = live_data.get("step", current_step)
                current_progress = live_data.get("progress", 0)
        except Exception:
            pass
            
    return {
        "running": pdf_status.get("running", False),
        "message": current_step,
        "progress": current_progress
    }

class DeleteBooksPayload(BaseModel):
    books: list[str]
    password: str
def parse_ocr_to_html(page_data):
    """Python port of the frontend JS layout parser."""
    words = [w for w in page_data if str(w.get('word', '')).strip()]
    if not words: return ""

    heights = sorted([w['height'] for w in words])
    medH = heights[len(heights)//2] if heights else 15
    widths = sorted([w['width'] for w in words])
    medW = widths[len(widths)//2] if widths else medH

    words.sort(key=lambda x: (x['top'], x['left']))

    clean_words = []
    for i, w in enumerate(words):
        if re.match(r'^[0-9ivxlcdm]{1,3}[.)]?$', w['word'].strip(), re.IGNORECASE):
            nearest_gap = float('inf')
            for j, other in enumerate(words):
                if i == j: continue
                if abs(other['top'] - w['top']) > medH * 0.6: continue
                
                if other['left'] > w['left']:
                    gap = other['left'] - (w['left'] + w['width'])
                else:
                    gap = w['left'] - (other['left'] + other['width'])
                    
                if 0 <= gap < nearest_gap:
                    nearest_gap = gap
            if nearest_gap == float('inf') or nearest_gap > medW * 2.5:
                continue
        clean_words.append(w)
    if not clean_words: clean_words = words

    lines = []
    current_line = []
    anchor_top = None
    for w in clean_words:
        if anchor_top is None or abs(w['top'] - anchor_top) <= medH * 0.5:
            current_line.append(w)
            if anchor_top is None: anchor_top = w['top']
        else:
            lines.append(current_line)
            current_line = [w]
            anchor_top = w['top']
    if current_line: lines.append(current_line)

    for line in lines:
        line.sort(key=lambda x: x['left'])
    lines.sort(key=lambda x: min([w['top'] for w in x]))

    line_metrics = []
    for line in lines:
        line_metrics.append({
            'words': line,
            'top': min([w['top'] for w in line]),
            'left': min([w['left'] for w in line]),
            'right': max([w['left'] + w['width'] for w in line]),
            'wordCount': len(line)
        })

    body_lines = [l for l in line_metrics if l['wordCount'] > 2]
    ref_lines = body_lines if body_lines else line_metrics
    lefts = sorted([l['left'] for l in ref_lines])
    std_left = lefts[len(lefts)//2] if lefts else 0
    rights = sorted([l['right'] for l in ref_lines])
    std_right = rights[int(len(rights)*0.9)] if rights else 0

    paragraphs = []
    curr_para = []
    for i, line in enumerate(line_metrics):
        curr_para.extend(line['words'])
        force_break = False
        if i < len(line_metrics) - 1:
            next_line = line_metrics[i+1]
            if (next_line['top'] - line['top'] > medH * 1.5) or \
               (next_line['left'] - std_left > medH * 1.5) or \
               (std_right - line['right'] > medH * 1.5):
                force_break = True
        if i == len(line_metrics) - 1 or force_break:
            paragraphs.append(curr_para)
            curr_para = []

    html_out = ""
    for para in paragraphs:
        html_out += '<p>' + " ".join([w['word'] for w in para]) + '</p>'
    return html_out

@app.get("/admin/books/download/{book_id}")
def download_book_pdf(book_id: str, admin: str = Depends(get_current_admin)):
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT page_number, word, left, top, width, height FROM archives WHERE book_id = ?", (book_id,))
        rows = cursor.fetchall()
        
        if not rows:
            raise HTTPException(status_code=404, detail="Book not found or empty.")
        
        pages = collections.defaultdict(list)
        for row in rows:
            p_num = int(row[0]) if str(row[0]).isdigit() else row[0]
            pages[p_num].append({
                "word": row[1], 
                "left": int(float(row[2])), 
                "top": int(float(row[3])),
                "width": int(float(row[4])), 
                "height": int(float(row[5]))
            })
        
        sorted_page_keys = sorted(pages.keys(), key=lambda x: int(x) if str(x).isdigit() else x)
        
        html_content = """
        <html>
        <head>
        <style>
            @page { size: A4; margin: 2cm; }
            body { font-family: Helvetica, sans-serif; font-size: 13pt; line-height: 1.6; color: #111; }
            p { margin-bottom: 1.2rem; text-align: justify; }
            .page-break { page-break-after: always; }
        </style>
        </head>
        <body>
        """
        
        html_content += f"<h1 style='text-align:center; margin-bottom: 80px; font-size: 24pt;'>{book_id.replace('_', ' ')}</h1>"
        html_content += "<div class='page-break'></div>"
        
        for p_key in sorted_page_keys:
            page_data = pages[p_key]
            
            # Identify if it is an Admin-Approved Edit or Raw OCR
            if len(page_data) == 1 and page_data[0]["left"] == 0 and page_data[0]["top"] == 0:
                html_content += page_data[0]["word"]
            else:
                html_content += parse_ocr_to_html(page_data)
            
            # Replaced the page break with a small invisible gap so pages flow continuously
            html_content += "<div style='margin-bottom: 1.5rem;'></div>"
        
        html_content += "</body></html>"
        
        # Compile HTML to PDF in memory
        pdf_buffer = BytesIO()
        pisa_status = pisa.CreatePDF(BytesIO(html_content.encode('utf-8')), dest=pdf_buffer)
        
        if pisa_status.err:
            raise HTTPException(status_code=500, detail="PDF generation failed.")
            
        pdf_buffer.seek(0)
        from fastapi.responses import StreamingResponse
        headers = {'Content-Disposition': f'attachment; filename="{book_id}.pdf"'}
        return StreamingResponse(pdf_buffer, media_type="application/pdf", headers=headers)
        
    finally:
        conn.close()
@app.get("/admin/books")
def get_all_books():
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT DISTINCT book_id FROM archives ORDER BY book_id ASC")
        books = [row[0] for row in cursor.fetchall()]
        return {"books": books}
    finally:
        conn.close()

@app.delete("/admin/books")
def delete_selected_books(payload: DeleteBooksPayload, admin: str = Depends(get_current_admin)):
    import shutil
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT hashed_password FROM admin_users WHERE username = ?", (admin,))
        row = cursor.fetchone()
        if not row or not pwd_context.verify(payload.password, row[0]):
            raise HTTPException(status_code=401, detail="Incorrect admin password.")
        
        deleted_count = 0
        for book_id in payload.books:
            safe_book_id = sanitize_book_id(book_id)
            cursor.execute("DELETE FROM archives WHERE book_id = ?", (safe_book_id,))
            
            image_dir = os.path.join("Archive_Images", safe_book_id)
            if os.path.exists(image_dir):
                try: shutil.rmtree(image_dir)
                except: pass
            deleted_count += 1
            
        conn.commit()
        return {"status": "success", "message": f"Successfully deleted {deleted_count} book(s) and their images."}
    except HTTPException:
        raise
    except Exception as e:
        return JSONResponse(status_code=500, content={"status": "error", "message": str(e)})
    finally:
        conn.close()

# --- Global Rate Limiter ---
reader_rate_limiter = collections.defaultdict(collections.deque)
reader_rate_limiter_lock = threading.Lock()

@app.get("/search")
def search_archives(query: str = "", book_id: str = "all", page: str = ""):
    clean_query = re.sub(r'[*^""\-()]', '', query).strip()
    clean_book = book_id.strip()
    clean_page = page.strip()

    # If absolutely nothing is provided, return empty
    if not clean_query and not clean_page:
        return []

    results = []
    conn = None

    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # 1. Build the dynamic filters for Book and Page
        filters = []
        filter_params = []

        if clean_book != "all":
            filters.append("book_id = ?")
            filter_params.append(clean_book)

        if clean_page:
            filters.append("page_number = ?")
            filter_params.append(clean_page)

        filter_sql = (" AND " + " AND ".join(filters)) if filters else ""

        # 2. Execute Query depending on whether there's a keyword
        if clean_query:
            # --- EXACT MATCH ATTEMPT ---
            exact_fts_query = f'"{clean_query}"'
            sql_exact = f"""
                SELECT book_id, page_number, word, left, top, width, height 
                FROM archives 
                WHERE word MATCH ? {filter_sql}
                LIMIT 500
            """
            cursor.execute(sql_exact, [exact_fts_query] + filter_params)
            rows = cursor.fetchall()

            # --- FALLBACK: MULTI-WORD INTERSECT ---
            if not rows and len(clean_query.split()) > 1:
                terms = clean_query.split()
                intersect_queries = [f"SELECT book_id, page_number FROM archives WHERE word MATCH ? {filter_sql}"] * len(terms)
                
                intersect_params = []
                for term in terms:
                    intersect_params.append(f'"{term}"*')
                    intersect_params.extend(filter_params)

                intersect_sql = " INTERSECT ".join(intersect_queries) + " LIMIT 50"
                cursor.execute(intersect_sql, intersect_params)
                valid_pages = cursor.fetchall()

                if valid_pages:
                    page_conditions = ["(book_id = ? AND page_number = ?)"] * len(valid_pages)
                    page_params = []
                    for b_id, p_num in valid_pages:
                        page_params.extend([b_id, p_num])

                    page_filter = " OR ".join(page_conditions)
                    or_query = " OR ".join([f'"{term}"*' for term in terms])

                    final_sql = f"""
                        SELECT book_id, page_number, word, left, top, width, height 
                        FROM archives 
                        WHERE word MATCH ? 
                        AND ({page_filter})
                        LIMIT 1000
                    """
                    cursor.execute(final_sql, [or_query] + page_params)
                    rows = cursor.fetchall()
        else:
            # --- NO KEYWORD, ONLY PAGE NUMBER (AND POSSIBLY BOOK) ---
            sql_page_only = f"""
                SELECT book_id, page_number, word, left, top, width, height 
                FROM archives 
                WHERE 1=1 {filter_sql}
                ORDER BY book_id ASC, CAST(page_number AS INTEGER) ASC, top ASC, left ASC
                LIMIT 1500
            """
            cursor.execute(sql_page_only, filter_params)
            rows = cursor.fetchall()

        # 3. Format Results
        for row in rows:
            b_id, p_num, word, left, top, width, height = row
            raw_path = os.path.join(b_id, f"page_{p_num}.jpg")
            normalized_path = raw_path.replace('\\', '/')

            results.append({
                "book_id": b_id,
                "page_number": str(p_num),
                "word": word,
                "left": int(left),
                "top": int(top),
                "width": int(width),
                "height": int(height),
                "image_url": f"/images/{normalized_path}"
            })

    except Exception as e:
        print(f"Search API Error: {str(e)}")
    finally:
        if conn is not None:
            conn.close()

    return results

@app.get("/api/page/{book_id}/{page_num}")
async def get_digital_page(request: Request, response: Response, book_id: str, page_num: str):
    ip = request.client.host
    current_time = time.time()
    
    with reader_rate_limiter_lock:
        while reader_rate_limiter[ip] and current_time - reader_rate_limiter[ip][0] > 60:
            reader_rate_limiter[ip].popleft()
        if not reader_rate_limiter[ip]:
            del reader_rate_limiter[ip]
        if ip in reader_rate_limiter and len(reader_rate_limiter[ip]) >= 60:
            return JSONResponse(status_code=429, content={"error": "Rate limit exceeded. Try again later."})
        reader_rate_limiter[ip].append(current_time)
        
    page_clean = page_num.lower().replace('page_', '').replace('.jpg', '')
    try:
        page_int = int(page_clean)
        if page_int <= 0:
            return JSONResponse(status_code=400, content={"error": "Invalid page number"})
    except ValueError:
        return JSONResponse(status_code=400, content={"error": "Invalid page number"})
    
    response.headers["Cache-Control"] = "no-store"
    
    def blocking_db_func():
        conn = sqlite3.connect('archives.db', timeout=15, check_same_thread=False)
        conn.execute("PRAGMA journal_mode=WAL;")
        try:
            cursor = conn.cursor()
            sql = """
                SELECT word, left, top, width, height 
                FROM archives 
                WHERE book_id = ? AND page_number = ?
                ORDER BY top ASC, left ASC
            """
            cursor.execute(sql, (book_id, str(page_int)))
            rows = cursor.fetchall()
            
            page_data = []
            for row in rows:
                word, left, top, width, height = row
                page_data.append({
                    "word": word, "left": int(left), "top": int(top),
                    "width": int(width), "height": int(height)
                })
            return page_data
        except Exception:
            return None
        finally:
            conn.close()
            
    page_data = await asyncio.get_event_loop().run_in_executor(None, blocking_db_func)
    
    if page_data is None:
        return JSONResponse(status_code=500, content={"error": "Internal server error"})
    if len(page_data) == 0:
        return JSONResponse(status_code=404, content={"error": "Page not found"})
        
    return page_data

# ==========================================
# MAKER-CHECKER MODERATION ENDPOINTS
# ==========================================
@app.post("/api/edits/suggest")
async def submit_edit_suggestion(payload: EditSuggestionPayload):
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO pending_edits (book_id, page_number, proposed_layout_data, status) VALUES (?, ?, ?, 'pending')",
            (payload.book_id, payload.page_number, payload.suggested_text)
        )
        conn.commit()
        
        # NEW: Broadcast to all connected Admins that a new edit is in the queue!
        await manager.broadcast({
            "event": "NEW_EDIT_SUGGESTED"
        })
        
        return {"status": "success", "message": "Edit submitted for review."}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})
    finally:
        conn.close()

@app.get("/admin/edits/pending")
def get_pending_edits(admin: str = Depends(get_current_admin)):
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id, book_id, page_number, timestamp, proposed_layout_data FROM pending_edits WHERE status = 'pending' ORDER BY timestamp ASC")
        rows = cursor.fetchall()
        
        edits = []
        for row in rows:
            edits.append({
                "id": row[0], "book_id": row[1], "page_number": row[2],
                "timestamp": row[3], "suggested_text": row[4] 
            })
        return edits
    finally:
        conn.close()

@app.post("/admin/edits/resolve")
async def resolve_edit(payload: ResolveEditPayload, admin: str = Depends(get_current_admin)):
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        if payload.action == "reject":
            cursor.execute("UPDATE pending_edits SET status = 'rejected' WHERE id = ?", (payload.edit_id,))
            conn.commit()
            return {"status": "rejected"}
            
        elif payload.action == "approve":
            cursor.execute("SELECT book_id, page_number, proposed_layout_data FROM pending_edits WHERE id = ?", (payload.edit_id,))
            row = cursor.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Edit not found")
                
            book_id, page_number, html_text = row[0], row[1], row[2]
            
            cursor.execute("DELETE FROM archives WHERE book_id = ? AND page_number = ?", (book_id, page_number))
            cursor.execute(
                "INSERT INTO archives (book_id, page_number, word, left, top, width, height) VALUES (?, ?, ?, 0, 0, 0, 0)",
                (book_id, page_number, html_text)
            )
            cursor.execute("UPDATE pending_edits SET status = 'approved' WHERE id = ?", (payload.edit_id,))
            conn.commit()
            
            # BROADCAST TO ALL GLOBAL USERS IN REAL-TIME
            await manager.broadcast({
                "event": "EDIT_APPROVED",
                "book_id": book_id,
                "page_number": page_number
            })
            
            return {"status": "approved"}
    except Exception as e:
        conn.rollback()
        return JSONResponse(status_code=500, content={"error": str(e)})
    finally:
        conn.close()
# --- PRODUCTION CACHE CONTROL ROUTE ---
# --- SECURE FRONTEND ROUTES ---
@app.get("/")
async def serve_index():
    response = FileResponse("index.html")
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

@app.get("/styles.css")
async def serve_css():
    return FileResponse("styles.css")

@app.get("/app.js")
async def serve_js():
    return FileResponse("app.js")
if __name__ == "__main__":
    import uvicorn
    # 1. host="0.0.0.0" allows the secure Cloudflare tunnel to enter
    # 2. workers=4 "clones the chef" so your CPU can handle 1000 users at once
    # 3. reload=True is removed because it slows down production
    uvicorn.run("main:app", host="0.0.0.0", port=8000, workers=1)