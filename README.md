# THABBET (ثَبَّتْ) - Document Compliance Made Simple

**THABBET** is an AI-powered automated document compliance and OCR verification platform tailored for compliance check workflows (including RNE Extracts, Tax Cards, and CIN Identity documents).

---

## Key Features

- **Automated OCR Extraction**: Real-time text, field, and bounding box extraction powered by Tesseract OCR & OpenCV.
- **Dynamic Template Builder**: Create document folders, configure required document types, and attach rule constraints.
- **Batch & Directory Upload**: Upload entire folder directories (`webkitdirectory`) with automatic document type classification and folder slot routing.
- **Rule Verification Engine**: Validate cross-document consistency, required field presence, exact length constraints, and regex formatting.
- **Detailed Decision Reports**: Visual compliance breakdown displaying pass/fail indicators, rule severities, and source vs. target field comparison.

---

## Tech Stack

- **Frontend**: Next.js 15, TypeScript, Vanilla CSS design system (`Plus Jakarta Sans`, `Space Grotesk`, `Amiri`).
- **Backend**: FastAPI (Python), OpenCV, Pytesseract, Pydantic.

---

## Running Locally

### 1. Backend Setup

```bash
cd backend
python -m venv .venv
# On Windows:
.venv\Scripts\Activate.ps1
# On macOS/Linux:
source .venv/bin/activate

pip install -r requirements.txt
uvicorn app.main:app --reload --port 8001
```

> **Note**: Ensure [Tesseract OCR](https://github.com/UB-Mannheim/tesseract/wiki) is installed on your machine. On Windows, it defaults to `C:\Program Files\Tesseract-OCR\tesseract.exe`.

### 2. Frontend Setup

In a new terminal window:

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.