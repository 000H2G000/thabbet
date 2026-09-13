from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import unicodedata
from datetime import date
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


class FieldDefinition(BaseModel):
    id: str
    label: str
    type: str
    required: bool = False
    bbox: dict[str, float] = Field(default_factory=dict)


class DocumentType(BaseModel):
    id: str
    code: str
    name: str
    description: str
    fields: list[FieldDefinition]


class Rule(BaseModel):
    id: str
    name: str
    document_type: str
    kind: str
    source_field: str
    target_document_type: str | None = None
    target_field: str | None = None
    severity: str = "medium"
    status: str = "published"
    config: dict[str, Any] = Field(default_factory=dict)


class ValidationRequest(BaseModel):
    documents: dict[str, dict[str, str]]


class RuleCreateRequest(BaseModel):
    name: str
    document_type: str
    kind: str
    source_field: str
    target_document_type: str | None = None
    target_field: str | None = None
    severity: str = "medium"
    config: dict[str, Any] = Field(default_factory=dict)


class RuleTestRequest(BaseModel):
    source_document_type: str
    source_field: str
    source_value: str | None = None
    target_document_type: str
    target_field: str
    target_value: str | None = None


class RuleConstraintTestRequest(BaseModel):
    value: str | None = None
    config: dict[str, Any] = Field(default_factory=dict)


class Template(BaseModel):
    id: str
    name: str
    description: str = ""
    document_types: list[str]
    rule_ids: list[str] = Field(default_factory=list)
    documents: list[dict[str, Any]] = Field(default_factory=list)
    status: str = "draft"


class TemplateCreateRequest(BaseModel):
    name: str
    description: str = ""
    document_types: list[str]
    rule_ids: list[str] = Field(default_factory=list)
    documents: list[dict[str, Any]] = Field(default_factory=list)


class RuleResult(BaseModel):
    rule_id: str
    rule_name: str
    status: str
    severity: str
    reason: str
    source_value: str | None = None
    target_value: str | None = None
    normalized_source: str | None = None
    normalized_target: str | None = None
    confidence: float = 1.0


def normalize(value: str | None) -> str:
    decomposed = unicodedata.normalize("NFKD", value or "")
    without_accents = "".join(character for character in decomposed if not unicodedata.combining(character))
    return " ".join(without_accents.casefold().strip().split())


def extract_configured_fields(lines: list[dict[str, Any]], document_type: str = "RNE") -> list[dict[str, Any]]:
    aliases = {
        "company_name": ["denomination sociale", "company name", "الاسم التجاري"],
        "legal_representative": ["nom et prenom", "legal representative", "الممثل القانوني"],
        "status": ["statut de l entreprise", "statut", "status", "وضعية المؤسسة"],
        "unique_id": ["identifiant unique", "numero unique", "المعرف الوحيد"],
        "registration_date": ["date d immatriculation", "registration date", "تاريخ التسجيل"],
        "address": ["adresse", "العنوان"],
        "activity": ["libelle de l activite", "activity", "تسمية النشاط"],
        "activity_code": ["code d activite", "activity code", "رمز النشاط"],
        "full_name": ["full name", "name and surname", "الاسم واللقب"],
        "father_name": ["nom du pere", "father name", "اسم الاب"],
        "mother_name": ["nom de la mere", "mother name", "اسم الام"],
        "date_of_birth": ["date de naissance", "date of birth", "تاريخ الولادة"],
        "place_of_birth": ["lieu de naissance", "place of birth", "مكان الولادة"],
        "profession": ["profession", "المهنة"],
    }
    if document_type == "CIN":
        aliases.pop("legal_representative", None)
        aliases["full_name"].insert(0, "nom et prenom")
    extracted = []
    for field_id, field_aliases in aliases.items():
        for index, line in enumerate(lines):
            line_key = normalize(line["text"]).replace("'", "").replace("-", " ")
            matched_alias = next((alias for alias in field_aliases if normalize(alias) in line_key), None)
            if not matched_alias:
                continue
            remainder = line_key.split(normalize(matched_alias), 1)[-1].strip(" :|-")
            value = remainder or (lines[index + 1]["text"] if index + 1 < len(lines) else "")
            value = value.strip()
            if value and value != line["text"]:
                extracted.append({"id": field_id, "label": field_id.replace("_", " ").title(), "value": value, "confidence": line["confidence"], "bbox": line["bbox"], "source": "ocr"})
            break
    cin_number = next((line for line in lines if re.fullmatch(r"\d{8}", line["text"].replace(" ", ""))), None)
    if cin_number:
        extracted.append({"id": "cin_number", "label": "CIN Number", "value": cin_number["text"].replace(" ", ""), "confidence": cin_number["confidence"], "bbox": cin_number["bbox"], "source": "ocr"})
    if document_type == "CIN":
        existing_ids = {field["id"] for field in extracted}
        name_lines = [line for line in lines if re.search(r"\bben\b|\bbent\b", normalize(line["text"])) and 2 <= len(line["text"].split()) <= 6]
        for field_id, label, line in zip(("full_name", "father_name", "mother_name"), ("Full Name", "Father Name", "Mother Name"), name_lines[:3]):
            if field_id not in existing_ids:
                extracted.append({"id": field_id, "label": label, "value": line["text"], "confidence": line["confidence"], "bbox": line["bbox"], "source": "ocr_pattern"})
        date_line = next((line for line in lines if re.search(r"\b\d{2}/\d{2}/\d{4}\b", line["text"])), None)
        if date_line and "date_of_birth" not in existing_ids:
            date_value = re.search(r"\d{2}/\d{2}/\d{4}", date_line["text"]).group(0)
            extracted.append({"id": "date_of_birth", "label": "Date Of Birth", "value": date_value, "confidence": date_line["confidence"], "bbox": date_line["bbox"], "source": "ocr_pattern"})
        address_line = next((line for line in lines if re.search(r"avenue|avenu|bourguiba|tunis", normalize(line["text"])) and len(line["text"].split()) >= 2), None)
        if address_line and "address" not in existing_ids:
            extracted.append({"id": "address", "label": "Address", "value": address_line["text"], "confidence": address_line["confidence"], "bbox": address_line["bbox"], "source": "ocr_pattern"})
        profession_line = next((line for line in lines if re.search(r"employ|profession|employee", normalize(line["text"]))), None)
        if profession_line and "profession" not in existing_ids:
            extracted.append({"id": "profession", "label": "Profession", "value": profession_line["text"], "confidence": profession_line["confidence"], "bbox": profession_line["bbox"], "source": "ocr_pattern"})
    return extracted


def perform_ocr(image_path: Path, document_id: str, document_type: str = "RNE") -> dict[str, Any]:
    try:
        import cv2
        import pytesseract
    except ModuleNotFoundError as error:
        raise HTTPException(status_code=503, detail="OCR dependencies are not installed in the active Python environment.") from error

    if not shutil.which(pytesseract.pytesseract.tesseract_cmd):
        potential_paths = [
            os.getenv("TESSERACT_CMD", ""),
            r"C:\Program Files\Tesseract-OCR\tesseract.exe",
            r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
            Path.home() / "AppData" / "Local" / "Programs" / "Tesseract-OCR" / "tesseract.exe",
            "/usr/bin/tesseract",
            "/usr/local/bin/tesseract",
            "/opt/homebrew/bin/tesseract",
        ]
        for candidate in potential_paths:
            candidate_str = str(candidate)
            if candidate_str and Path(candidate_str).exists():
                pytesseract.pytesseract.tesseract_cmd = candidate_str
                break

    image = cv2.imread(str(image_path))
    if image is None:
        raise HTTPException(status_code=400, detail="The image could not be decoded")
    try:
        data = pytesseract.image_to_data(image, output_type=pytesseract.Output.DICT, config="--psm 6")
    except pytesseract.TesseractNotFoundError as error:
        raise HTTPException(status_code=503, detail="Local OCR is not configured. Install Tesseract and add it to PATH, then restart the API.") from error
    words = []
    lines_by_id: dict[tuple[int, int, int], list[dict[str, Any]]] = {}
    for index, text in enumerate(data["text"]):
        value = text.strip()
        if value and float(data["conf"][index]) >= 0:
            word = {"text": value, "confidence": round(float(data["conf"][index]) / 100, 3), "bbox": {"x": data["left"][index], "y": data["top"][index], "width": data["width"][index], "height": data["height"][index]}}
            words.append(word)
            line_key = (data["block_num"][index], data["par_num"][index], data["line_num"][index])
            lines_by_id.setdefault(line_key, []).append(word)
    lines = []
    for line_words in lines_by_id.values():
        lines.append({"text": " ".join(word["text"] for word in line_words), "confidence": round(sum(word["confidence"] for word in line_words) / len(line_words), 3), "bbox": {"x": min(word["bbox"]["x"] for word in line_words), "y": min(word["bbox"]["y"] for word in line_words), "width": max(word["bbox"]["x"] + word["bbox"]["width"] for word in line_words) - min(word["bbox"]["x"] for word in line_words), "height": max(word["bbox"]["y"] + word["bbox"]["height"] for word in line_words) - min(word["bbox"]["y"] for word in line_words)}})
    lines.sort(key=lambda line: (line["bbox"]["y"], line["bbox"]["x"]))
    return {"id": document_id, "document_type": document_type, "status": "ocr_complete", "text": " ".join(word["text"] for word in words), "words": words, "lines": lines, "fields": extract_configured_fields(lines, document_type), "average_confidence": round(sum(word["confidence"] for word in words) / len(words), 3) if words else 0}


DOCUMENT_TYPES = [
    DocumentType(
        id="dt_rne",
        code="RNE",
        name="RNE Extract",
        description="Company registration extract",
        fields=[
            FieldDefinition(id="company_name", label="Company name", type="company_name", required=True, bbox={"x": 0.18, "y": 0.22, "width": 0.64, "height": 0.08}),
            FieldDefinition(id="legal_representative", label="Legal representative", type="person_name", required=True, bbox={"x": 0.18, "y": 0.43, "width": 0.64, "height": 0.08}),
            FieldDefinition(id="status", label="Status", type="status", required=True, bbox={"x": 0.18, "y": 0.62, "width": 0.3, "height": 0.08}),
        ],
    ),
    DocumentType(
        id="dt_tax",
        code="TAX_CARD",
        name="Tax Identification Card",
        description="Tax registration card",
        fields=[
            FieldDefinition(id="company_name", label="Company name", type="company_name", required=True, bbox={"x": 0.15, "y": 0.25, "width": 0.7, "height": 0.08}),
            FieldDefinition(id="legal_representative", label="Legal representative", type="person_name", required=True, bbox={"x": 0.15, "y": 0.45, "width": 0.7, "height": 0.08}),
            FieldDefinition(id="matricule_fiscal", label="Tax identifier", type="identifier", required=True, bbox={"x": 0.15, "y": 0.65, "width": 0.5, "height": 0.08}),
        ],
    ),
    DocumentType(
        id="dt_cin",
        code="CIN",
        name="National Identity Card",
        description="National identity document",
        fields=[
            FieldDefinition(id="full_name", label="Full name", type="person_name", required=True, bbox={"x": 0.42, "y": 0.28, "width": 0.48, "height": 0.1}),
            FieldDefinition(id="father_name", label="Father name", type="person_name", required=True, bbox={"x": 0.42, "y": 0.4, "width": 0.48, "height": 0.1}),
            FieldDefinition(id="mother_name", label="Mother name", type="person_name", required=True, bbox={"x": 0.42, "y": 0.52, "width": 0.48, "height": 0.1}),
            FieldDefinition(id="date_of_birth", label="Date of birth", type="date", required=True, bbox={"x": 0.42, "y": 0.63, "width": 0.48, "height": 0.08}),
            FieldDefinition(id="place_of_birth", label="Place of birth", type="address", bbox={"x": 0.42, "y": 0.72, "width": 0.48, "height": 0.08}),
            FieldDefinition(id="address", label="Address", type="address", bbox={"x": 0.42, "y": 0.81, "width": 0.48, "height": 0.1}),
            FieldDefinition(id="profession", label="Profession", type="text", bbox={"x": 0.42, "y": 0.91, "width": 0.48, "height": 0.08}),
            FieldDefinition(id="cin_number", label="CIN number", type="identifier", required=True, bbox={"x": 0.3, "y": 0.92, "width": 0.4, "height": 0.07}),
        ],
    ),
]

RULES = [
    Rule(id="rule_rne_tax_rep", name="Representative consistency", document_type="RNE", kind="cross_document_match", source_field="legal_representative", target_document_type="TAX_CARD", target_field="legal_representative", severity="critical"),
    Rule(id="rule_rne_tax_company", name="Company name consistency", document_type="RNE", kind="cross_document_match", source_field="company_name", target_document_type="TAX_CARD", target_field="company_name", severity="high"),
    Rule(id="rule_rne_status", name="RNE status is present", document_type="RNE", kind="required", source_field="status", severity="medium"),
    Rule(id="rule_tax_id", name="Tax identifier is present", document_type="TAX_CARD", kind="required", source_field="matricule_fiscal", severity="high"),
]
TEMPLATES = [Template(id="template_business_identity", name="Business identity pack", description="RNE, tax card, and identity checks", document_types=["RNE", "TAX_CARD", "CIN"], rule_ids=[rule.id for rule in RULES], status="published")]

STATE_PATH = Path(__file__).resolve().parents[1] / "data" / "docuguard_state.json"
STATE_PATH.parent.mkdir(parents=True, exist_ok=True)


def load_state() -> None:
    if not STATE_PATH.exists():
        return
    try:
        state = json.loads(STATE_PATH.read_text(encoding="utf-8"))
        RULES[:] = [Rule.model_validate(rule) for rule in state.get("rules", [])]
        TEMPLATES[:] = [Template.model_validate(template) for template in state.get("templates", [])]
    except (OSError, ValueError):
        return


def save_state() -> None:
    STATE_PATH.write_text(json.dumps({"rules": [rule.model_dump() for rule in RULES], "templates": [template.model_dump() for template in TEMPLATES]}, indent=2), encoding="utf-8")


load_state()

app = FastAPI(title="DocuGuard API", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
STORAGE_ROOT = Path(__file__).resolve().parents[2] / ".." / "storage" / "originals"
STORAGE_ROOT.mkdir(parents=True, exist_ok=True)


@app.get("/api/v1/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "docuguard-api"}


@app.get("/api/v1/document-types", response_model=list[DocumentType])
def list_document_types() -> list[DocumentType]:
    return DOCUMENT_TYPES


@app.get("/api/v1/rules", response_model=list[Rule])
def list_rules(search: str | None = None, document_type: str | None = None) -> list[Rule]:
    rules = RULES
    if search:
        query = normalize(search)
        rules = [rule for rule in rules if query in normalize(rule.name) or query in normalize(rule.source_field) or query in normalize(rule.kind)]
    if document_type:
        rules = [rule for rule in rules if rule.document_type == document_type]
    return rules


@app.get("/api/v1/templates", response_model=list[Template])
def list_templates() -> list[Template]:
    return TEMPLATES


@app.post("/api/v1/templates", response_model=Template)
def create_template(request: TemplateCreateRequest) -> Template:
    unknown_rules = [rule_id for rule_id in request.rule_ids if not any(rule.id == rule_id for rule in RULES)]
    if unknown_rules:
        raise HTTPException(status_code=400, detail=f"Unknown rule IDs: {', '.join(unknown_rules)}")
    template = Template(id=f"template_{uuid4().hex[:10]}", **request.model_dump())
    TEMPLATES.append(template)
    save_state()
    return template


@app.patch("/api/v1/templates/{template_id}", response_model=Template)
def update_template(template_id: str, request: TemplateCreateRequest) -> Template:
    unknown_rules = [rule_id for rule_id in request.rule_ids if not any(rule.id == rule_id for rule in RULES)]
    if unknown_rules:
        raise HTTPException(status_code=400, detail=f"Unknown rule IDs: {', '.join(unknown_rules)}")
    template = next((item for item in TEMPLATES if item.id == template_id), None)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    updated = Template(id=template.id, status=template.status, **request.model_dump())
    TEMPLATES[TEMPLATES.index(template)] = updated
    save_state()
    return updated


@app.post("/api/v1/documents/scan")
async def scan_document(file: UploadFile = File(...)) -> dict[str, Any]:
    if file.content_type not in {"image/jpeg", "image/png", "application/pdf"}:
        raise HTTPException(status_code=415, detail="Only JPEG, PNG, and PDF documents are supported")
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="The uploaded document is empty")
    document_id = f"doc_{uuid4().hex[:10]}"
    original_path = STORAGE_ROOT / f"{document_id}_{Path(file.filename or 'capture').name}"
    original_path.write_bytes(content)
    return {"id": document_id, "filename": file.filename, "status": "ready_for_processing", "original_path": str(original_path), "bytes": len(content)}


@app.post("/api/v1/documents/{document_id}/ocr")
async def run_ocr(document_id: str, file: UploadFile = File(...), document_type: str = Form("RNE")) -> dict[str, Any]:
    if file.content_type not in {"image/jpeg", "image/png"}:
        raise HTTPException(status_code=415, detail="OCR currently accepts JPEG and PNG images")
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="The uploaded document is empty")
    image_path = STORAGE_ROOT / f"{document_id}_{Path(file.filename or 'capture').name}"
    image_path.write_bytes(content)
    return perform_ocr(image_path, document_id, document_type)


@app.post("/api/v1/documents/batch-ocr")
async def batch_ocr(files: list[UploadFile] = File(...), document_type: str = Form("RNE")) -> dict[str, Any]:
    if not files:
        raise HTTPException(status_code=400, detail="Select at least one image")
    async def process_one(file: UploadFile) -> dict[str, Any]:
        if file.content_type not in {"image/jpeg", "image/png"}:
            return {"filename": file.filename, "status": "failed", "error": "Only JPEG and PNG images are supported"}
        content = await file.read()
        if not content:
            return {"filename": file.filename, "status": "failed", "error": "The uploaded document is empty"}
        document_id = f"doc_{uuid4().hex[:10]}"
        image_path = STORAGE_ROOT / f"{document_id}_{Path(file.filename or 'capture').name}"
        image_path.write_bytes(content)
        try:
            result = await asyncio.to_thread(perform_ocr, image_path, document_id, document_type)
            return {"filename": file.filename, **result}
        except HTTPException as error:
            return {"filename": file.filename, "status": "failed", "error": error.detail}
    results = await asyncio.gather(*(process_one(file) for file in files))
    return {"status": "batch_complete", "total": len(files), "completed": sum(result["status"] == "ocr_complete" for result in results), "results": results}


@app.post("/api/v1/rules", response_model=Rule)
def create_rule(request: RuleCreateRequest) -> Rule:
    rule = Rule(id=f"rule_{uuid4().hex[:10]}", **request.model_dump())
    RULES.append(rule)
    save_state()
    return rule


@app.post("/api/v1/rules/test", response_model=dict[str, Any])
def test_rule(request: RuleTestRequest) -> dict[str, Any]:
    source_normalized = normalize(request.source_value)
    target_normalized = normalize(request.target_value)
    passed = bool(source_normalized and target_normalized and source_normalized == target_normalized)
    return {"status": "PASS" if passed else "FAIL", "reason": "Normalized values match" if passed else "Values do not match after normalization", "source_document_type": request.source_document_type, "source_field": request.source_field, "target_document_type": request.target_document_type, "target_field": request.target_field, "source_value": request.source_value, "target_value": request.target_value, "normalized_source": source_normalized, "normalized_target": target_normalized}


@app.post("/api/v1/rules/test-constraint", response_model=dict[str, Any])
def test_constraint(request: RuleConstraintTestRequest) -> dict[str, Any]:
    value = request.value or ""
    config = request.config
    if config.get("exact_length") is not None:
        expected = int(config["exact_length"])
        passed = len(value) == expected
        return {"status": "PASS" if passed else "FAIL", "reason": f"Value has {len(value)} characters; expected exactly {expected}"}
    if config.get("regex"):
        passed = re.fullmatch(str(config["regex"]), value) is not None
        return {"status": "PASS" if passed else "FAIL", "reason": "Value matches the configured format" if passed else "Value does not match the configured format"}
    return {"status": "FAIL", "reason": "No constraint configured"}


def evaluate_rules(rules: list[Rule], documents: dict[str, dict[str, str]]) -> list[RuleResult]:
    results: list[RuleResult] = []
    for rule in rules:
        source_value = documents.get(rule.document_type, {}).get(rule.source_field)
        if rule.kind == "required":
            passed = bool(normalize(source_value))
            results.append(RuleResult(rule_id=rule.id, rule_name=rule.name, status="PASS" if passed else "FAIL", severity=rule.severity, reason="Value is present" if passed else "Required field is empty", source_value=source_value, normalized_source=normalize(source_value)))
        elif rule.kind in {"exact_length", "regex"}:
            constraint = test_constraint(RuleConstraintTestRequest(value=source_value, config=rule.config))
            results.append(RuleResult(rule_id=rule.id, rule_name=rule.name, status=constraint["status"], severity=rule.severity, reason=constraint["reason"], source_value=source_value, normalized_source=normalize(source_value)))
        else:
            target_value = documents.get(rule.target_document_type or "", {}).get(rule.target_field or "")
            source_normalized, target_normalized = normalize(source_value), normalize(target_value)
            passed = bool(source_normalized and target_normalized and source_normalized == target_normalized)
            results.append(RuleResult(rule_id=rule.id, rule_name=rule.name, status="PASS" if passed else "FAIL", severity=rule.severity, reason="Normalized values match" if passed else "Values do not match after normalization", source_value=source_value, target_value=target_value, normalized_source=source_normalized, normalized_target=target_normalized))
    return results


@app.post("/api/v1/validation-runs", response_model=dict[str, Any])
def validate(request: ValidationRequest) -> dict[str, Any]:
    results = evaluate_rules(RULES, request.documents)
    failed = [result for result in results if result.status == "FAIL"]
    status = "NON_COMPLIANT" if failed else "COMPLIANT"
    return {"id": f"run_{uuid4().hex[:10]}", "status": status, "checked_at": date.today().isoformat(), "summary": {"passed": len(results) - len(failed), "failed": len(failed), "total": len(results)}, "results": results}


@app.post("/api/v1/review-queue", response_model=dict[str, Any])
async def review_queue(template_id: str = Form(...), files: list[UploadFile] = File(...), document_types: list[str] = Form(...)) -> dict[str, Any]:
    template = next((item for item in TEMPLATES if item.id == template_id), None)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    if len(files) != len(document_types):
        raise HTTPException(status_code=400, detail="Provide one document type for each uploaded file")
    rules = [rule for rule in RULES if rule.id in template.rule_ids]
    documents: dict[str, dict[str, str]] = {}
    documents_output = []
    for file, document_type in zip(files, document_types):
        if document_type not in template.document_types:
            documents_output.append({"filename": file.filename, "status": "failed", "error": "Document type is not included in this template"})
            continue
        content = await file.read()
        document_id = f"doc_{uuid4().hex[:10]}"
        image_path = STORAGE_ROOT / f"{document_id}_{Path(file.filename or 'review').name}"
        image_path.write_bytes(content)
        result = await asyncio.to_thread(perform_ocr, image_path, document_id, document_type)
        if document_type not in documents:
            documents[document_type] = {}
        for field in result.get("fields", []):
            if field.get("id") and field.get("value"):
                documents[document_type][field["id"]] = field["value"]
        documents_output.append({"filename": file.filename, "document_type": document_type, "ocr": result})
    results = evaluate_rules(rules, documents)
    failed = [result for result in results if result.status == "FAIL"]
    return {
        "template_id": template.id,
        "template_name": template.name,
        "status": "NON_COMPLIANT" if failed else "COMPLIANT",
        "summary": {"passed": len(results) - len(failed), "failed": len(failed), "total": len(results)},
        "documents": documents_output,
        "results": [result.model_dump() for result in results],
    }