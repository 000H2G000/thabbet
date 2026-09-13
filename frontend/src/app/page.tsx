"use client";

import { useEffect, useRef, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";

type ExtractedField = {
  id: string;
  label: string;
  value: string;
  confidence: number;
  bbox: { x: number; y: number; width: number; height: number };
  source: string;
};
type OcrResult = {
  id: string;
  document_type?: DocumentCode;
  status: string;
  text: string;
  average_confidence: number;
  words: {
    text: string;
    confidence: number;
    bbox: { x: number; y: number; width: number; height: number };
  }[];
  fields: ExtractedField[];
};
type DocumentCode = "RNE" | "TAX_CARD" | "CIN";
type ValidationResult = {
  rule_id?: string;
  rule_name?: string;
  status: string;
  severity?: string;
  reason: string;
  source_value?: string;
  target_value?: string;
  normalized_source?: string;
  normalized_target?: string;
};
type BatchResult = OcrResult & { filename: string };
type Rule = {
  id: string;
  name: string;
  document_type: string;
  kind: string;
  source_field: string;
  target_document_type?: string | null;
  target_field?: string | null;
  severity: string;
  status: string;
  config: Record<string, string | number>;
};
type Template = {
  id: string;
  name: string;
  description: string;
  document_types: string[];
  rule_ids: string[];
  documents?: { name: string; code: string; filename?: string }[];
  status: string;
};
type TemplateDocument = {
  name: string;
  code: string;
  file?: File;
  ocr?: OcrResult;
};

export default function Home() {
  const [ocr, setOcr] = useState<OcrResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [selectedField, setSelectedField] = useState<ExtractedField | null>(
    null,
  );
  const [ruleKind, setRuleKind] = useState("required");
  const [ruleName, setRuleName] = useState("");
  const [ruleSaved, setRuleSaved] = useState(false);
  const [sourceDocumentType, setSourceDocumentType] =
    useState<DocumentCode>("RNE");
  const [targetDocumentType, setTargetDocumentType] =
    useState<DocumentCode>("TAX_CARD");
  const [targetOcr, setTargetOcr] = useState<OcrResult | null>(null);
  const [targetFieldId, setTargetFieldId] = useState("");
  const [ruleTest, setRuleTest] = useState<ValidationResult | null>(null);
  const [activeNav, setActiveNav] = useState("Overview");
  const [batchResults, setBatchResults] = useState<BatchResult[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [ruleSearch, setRuleSearch] = useState("");
  const [constraintValue, setConstraintValue] = useState("");
  const [constraintConfig, setConstraintConfig] = useState<
    Record<string, string | number>
  >({});
  const [constraintTest, setConstraintTest] = useState<ValidationResult | null>(
    null,
  );
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");
  const [reviewTemplateId, setReviewTemplateId] = useState("");
  const [reviewFiles, setReviewFiles] = useState<
    { file: File; type: string; typeName?: string }[]
  >([]);
  const [customReviewType, setCustomReviewType] = useState("DOCUMENT_1");
  const [reviewResult, setReviewResult] = useState<{
    template_id?: string;
    template_name?: string;
    status: string;
    summary: { passed: number; failed: number; total: number };
    results: ValidationResult[];
    documents: { filename: string; document_type: string }[];
  } | null>(null);
  const [templateDocuments, setTemplateDocuments] = useState<
    TemplateDocument[]
  >([]);
  const [templateRuleIds, setTemplateRuleIds] = useState<string[]>([]);
  const [templateSaved, setTemplateSaved] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const selectedReviewTemplate = templates.find(
    (template) => template.id === reviewTemplateId,
  );
  const reviewTemplateDocuments = selectedReviewTemplate
    ? selectedReviewTemplate.documents && selectedReviewTemplate.documents.length > 0
      ? selectedReviewTemplate.documents
      : selectedReviewTemplate.document_types.map((code) => ({
          name:
            code === "TAX_CARD"
              ? "Tax Card"
              : code === "RNE"
              ? "RNE"
              : code === "CIN"
              ? "CIN"
              : code.replace(/_/g, " "),
          code,
        }))
    : [];

  function formatFileSize(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  }

  function removeReviewFile(indexToRemove: number) {
    setReviewFiles((current) =>
      current.filter((_, index) => index !== indexToRemove),
    );
  }

  function handleFolderUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    if (!files.length || !reviewTemplateDocuments.length) return;

    const newFiles: { file: File; type: string; typeName?: string }[] = [];

    files.forEach((file) => {
      const pathLower = (file.webkitRelativePath || file.name).toLowerCase();
      const matchedDoc = reviewTemplateDocuments.find((doc) => {
        const codeLower = doc.code.toLowerCase();
        const nameLower = doc.name.toLowerCase();
        return pathLower.includes(codeLower) || pathLower.includes(nameLower);
      });

      if (matchedDoc) {
        newFiles.push({
          file,
          type: matchedDoc.code,
          typeName: matchedDoc.name,
        });
      } else {
        const fallbackDoc = reviewTemplateDocuments[0];
        newFiles.push({
          file,
          type: fallbackDoc.code,
          typeName: fallbackDoc.name,
        });
      }
    });

    setReviewFiles((current) => [...current, ...newFiles]);
    event.target.value = "";
  }

  useEffect(() => {
    void fetch(`${API_BASE}/api/v1/templates`)
      .then((response) => {
        if (!response.ok) throw new Error("Templates could not be loaded");
        return response.json() as Promise<Template[]>;
      })
      .then((loaded) => {
        setTemplates(loaded);
        if (loaded[0]) setReviewTemplateId(loaded[0].id);
      })
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : "Templates could not be loaded");
      });
  }, []);

  useEffect(() => {
    const query = ruleSearch ? `?search=${encodeURIComponent(ruleSearch)}` : "";
    void fetch(`${API_BASE}/api/v1/rules${query}`)
      .then((response) => response.json())
      .then((loaded: Rule[]) =>
        setRules(
          loaded.map((rule) => {
            const folder = templates.find((template) =>
              template.rule_ids.includes(rule.id),
            );
            return {
              ...rule,
              name: `[${folder?.name || "Unassigned"}] ${rule.name}`,
            };
          }),
        ),
      )
      .catch(() => undefined);
  }, [ruleSearch, templates]);

  useEffect(() => {
    const inputs = Array.from(
      document.querySelectorAll<HTMLInputElement>(
        ".template-upload input[type=file]",
      ),
    );
    const handlers = inputs.map((input) => {
      const handler = () => {
        const file = input.files?.[0];
        const rowInputs = input
          .closest(".template-document-row")
          ?.querySelectorAll("input");
        const documentCode = rowInputs?.[1]?.value;
        if (file && documentCode)
          void extractTemplateReference(file, documentCode);
      };
      input.addEventListener("change", handler);
      return { input, handler };
    });
    return () =>
      handlers.forEach(({ input, handler }) =>
        input.removeEventListener("change", handler),
      );
  }, [templateDocuments.length]);

  useEffect(() => {
    const targetDocument = templateDocuments.find(
      (document) => document.code === targetDocumentType,
    );
    if (targetDocument?.ocr) setTargetOcr(targetDocument.ocr);
    if (
      activeNav === "Templates" &&
      templateDocuments.length > 0 &&
      !templateDocuments.some(
        (document) => document.code === targetDocumentType,
      )
    )
      setTargetDocumentType(templateDocuments[0].code as DocumentCode);
  }, [templateDocuments, targetDocumentType, activeNav]);

  async function processFile(
    file: File,
    documentType: DocumentCode = sourceDocumentType,
    isTarget = false,
  ): Promise<OcrResult | null> {
    setBusy(true);
    setError(null);
    if (!isTarget) setOcr(null);
    if (isTarget) setTargetOcr(null);
    if (!isTarget) setSelectedField(null);
    setRuleSaved(false);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("document_type", documentType);
      const scanned = await fetch(
        `${API_BASE}/api/v1/documents/scan`,
        { method: "POST", body: form },
      );
      const scannedBody = await scanned.json();
      if (!scanned.ok)
        throw new Error(scannedBody.detail || "Document upload failed");
      const result = await fetch(
        `${API_BASE}/api/v1/documents/${scannedBody.id}/ocr`,
        { method: "POST", body: form },
      );
      const resultBody = await result.json();
      if (!result.ok) throw new Error(resultBody.detail || "OCR failed");
      if (isTarget) setTargetOcr(resultBody);
      else setOcr(resultBody);
      return resultBody;
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The document could not be processed",
      );
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function processTargetFile(file: File) {
    await processFile(file, targetDocumentType, true);
  }

  async function processBatch(files: File[]) {
    setBusy(true);
    setError(null);
    setOcr(null);
    setSelectedField(null);
    setBatchResults([]);
    try {
      const form = new FormData();
      files.forEach((file) => form.append("files", file));
      form.append("document_type", sourceDocumentType);
      const response = await fetch(
        "http://localhost:8001/api/v1/documents/batch-ocr",
        { method: "POST", body: form },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail || "Batch OCR failed");
      const completed = body.results.filter(
        (result: BatchResult) => result.status === "ocr_complete",
      );
      setBatchResults(completed);
      if (completed[0]) setOcr(completed[0]);
      const failed = body.results.filter(
        (result: { status: string }) => result.status === "failed",
      );
      if (failed.length)
        setError(`${failed.length} document(s) could not be processed.`);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The documents could not be processed",
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveRule() {
    if (!selectedField) return;
    const targetField = targetOcr?.fields.find(
      (field) => field.id === targetFieldId,
    );
    if (ruleKind === "cross_document_match" && (!targetOcr || !targetField))
      return setError(
        "Upload the target document and choose its matching field before publishing this rule.",
      );
    const response = await fetch(`${API_BASE}/api/v1/rules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: ruleName || `${selectedField.label} is required`,
        document_type: sourceDocumentType,
        kind: ruleKind,
        source_field: selectedField.id,
        target_document_type:
          ruleKind === "cross_document_match" ? targetDocumentType : null,
        target_field:
          ruleKind === "cross_document_match" ? targetFieldId : null,
        severity: "high",
        config:
          ruleKind === "exact_length" || ruleKind === "regex"
            ? constraintConfig
            : {},
      }),
    });
    if (response.ok) {
      const createdRule = (await response.json()) as Rule;
      setRuleSaved(true);
      setRules((current) => [...current, createdRule]);
    }
  }

  async function testConstraint() {
    const response = await fetch(
      `${API_BASE}/api/v1/rules/test-constraint`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          value: constraintValue || selectedField?.value,
          config: constraintConfig,
        }),
      },
    );
    const body = await response.json();
    setConstraintTest({ status: body.status, reason: body.reason });
  }

  async function createTemplate() {
    setTemplateSaved(false);
    if (!templateName.trim()) return setError("Enter a template name first.");
    if (!templateDocuments.length)
      return setError("Add at least one document to this template.");
    let response: Response;
    try {
      response = await fetch(`${API_BASE}/api/v1/templates${editingTemplateId ? `/${editingTemplateId}` : ""}`, {
      method: editingTemplateId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: templateName,
        description: templateDescription,
        document_types: templateDocuments.map((document) => document.code),
        rule_ids: rules.map((rule) => rule.id),
        documents: templateDocuments.map((document) => ({ name: document.name, code: document.code, filename: document.file?.name })),
      }),
      });
    } catch {
      return setError("Could not reach the backend. Start the API on port 8001 and try again.");
    }
    const body = await response.json();
    if (!response.ok)
      return setError(body.detail || "Template could not be created");
    setTemplates((current) => [...current, body]);
    setReviewTemplateId(body.id);
    setTemplateSaved(true);
    setTemplateName("");
    setTemplateDescription("");
    setTemplateDocuments([]);
    setTemplateRuleIds([]);
    setEditingTemplateId(null);
  }

  function editTemplate(template: Template) {
    setEditingTemplateId(template.id);
    setTemplateName(template.name);
    setTemplateDescription(template.description);
    setTemplateDocuments((template.documents || template.document_types.map((code) => ({ name: code, code }))).map((document) => ({ name: document.name, code: document.code })));
    setTemplateRuleIds(template.rule_ids);
    setTemplateSaved(false);
    setActiveNav("Templates");
    document.getElementById("templates-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function addTemplateDocument() {
    const number = templateDocuments.length + 1;
    setTemplateDocuments((current) => [
      ...current,
      { name: `Document ${number}`, code: `DOCUMENT_${number}` },
    ]);
  }

  async function extractTemplateReference(file: File, documentCode: string) {
    const extracted = await processFile(file, documentCode as DocumentCode);
    if (extracted)
      setTemplateDocuments((current) =>
        current.map((document) =>
          document.code === documentCode
            ? { ...document, ocr: extracted }
            : document,
        ),
      );
    setActiveNav("Templates");
  }

  async function submitReview() {
    if (!reviewTemplateId || !reviewFiles.length)
      return setError("Choose a template and upload at least one document.");
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append("template_id", reviewTemplateId);
    reviewFiles.forEach(({ file, type }) => {
      form.append("files", file);
      form.append("document_types", type);
    });
    try {
      const response = await fetch(
        `${API_BASE}/api/v1/review-queue`,
        { method: "POST", body: form },
      );
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.detail || "Review could not be completed");
      setReviewResult(body);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Review could not be completed",
      );
    } finally {
      setBusy(false);
    }
  }

  async function testRule() {
    if (!selectedField || ruleKind !== "cross_document_match") return;
    const targetField = targetOcr?.fields.find(
      (field) => field.id === targetFieldId,
    );
    if (!targetField)
      return setError("Choose a target field before testing the rule.");
    const response = await fetch(`${API_BASE}/api/v1/rules/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source_document_type: sourceDocumentType,
        source_field: selectedField.id,
        source_value: selectedField.value,
        target_document_type: targetDocumentType,
        target_field: targetField.id,
        target_value: targetField.value,
      }),
    });
    const body = await response.json();
    setRuleTest({
      status: body.status,
      reason: body.reason,
      source_value: body.source_value,
      target_value: body.target_value,
    });
  }

  function navigate(item: string) {
    setActiveNav(item);
    const target =
      item === "Scan documents"
        ? "scan-section"
        : item === "Rules"
          ? "rules-library"
          : item === "Templates"
            ? "templates-section"
            : item === "Review queue"
              ? "review-section"
              : item === "Documents"
                ? "extraction-section"
                : "overview-section";
    if (
      [
        "Templates",
        "Review queue",
        "Rules",
        "Scan documents",
        "Documents",
        "Overview",
      ].includes(item)
    )
      setActiveNav(item);
    document
      .getElementById(target)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function startCamera() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOpen(true);
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch {
      setError(
        "Camera access was denied or is unavailable. Use the upload option instead.",
      );
    }
  }

  function capture() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (blob)
          void processFile(
            new File([blob], `camera-${Date.now()}.jpg`, {
              type: "image/jpeg",
            }),
          );
      },
      "image/jpeg",
      0.92,
    );
    streamRef.current?.getTracks().forEach((track) => track.stop());
    setCameraOpen(false);
  }
  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo-card">
            <img
              src="/thabbet-logo.jpg"
              alt="THABBET Logo"
              className="brand-logo-img"
            />
          </div>
          <div className="brand-text">
            <div className="brand-title-row">
              <span className="brand-name">THABBET</span>
              <span className="brand-arabic">ثَبَّتْ</span>
            </div>
            <span className="brand-tagline">Compliance Platform</span>
          </div>
        </div>
        <p className="eyebrow">WORKSPACE</p>
        <nav>
          {[
            "Overview",
            "Scan documents",
            "Documents",
            "Templates",
            "Rules",
            "Review queue",
            "Audit log",
          ].map((item, index) => (
            <button
              className={activeNav === item ? "nav-item active" : "nav-item"}
              key={item}
              onClick={() => navigate(item)}
            >
              <span>{["⌂", "◉", "▣", "⌑", "≡", "✓", "◌"][index]}</span>
              {item}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="avatar">TH</span>
          <div>
            <strong>THABBET Portal</strong>
            <small>Tunisian Verification Hub</small>
          </div>
        </div>
      </aside>
      <section
        className={`content view-${activeNav.toLowerCase().replace(/\s+/g, "-")}`}
      >
        <header id="overview-section">
          <div>
            <p className="eyebrow">MONDAY, SEPTEMBER 13, 2026</p>
            <h1>
              {activeNav === "Overview" ? "Good morning, Amira" : activeNav}
            </h1>
            <p className="muted">
              {activeNav === "Templates"
                ? "Build document folders and attach the rules they must satisfy."
                : activeNav === "Review queue"
                  ? "Review submitted documents against a selected template."
                  : activeNav === "Rules"
                    ? "Find and manage the rules your workspace created."
                    : "Keep every document decision clear, consistent, and reviewable."}
            </p>
          </div>
          <button className="secondary">⌕ Search</button>
        </header>
        <section className="hero" id="scan-section">
          <div>
            <p className="eyebrow light">THABBET AUTOMATED COMPLIANCE</p>
            <h2>Document Compliance Made Simple</h2>
            <p>
              Upload documents, automatically extract field data with AI-powered OCR, and validate against official compliance templates instantly.
            </p>
            <div className="scan-actions">
              <select
                className="document-select"
                value={sourceDocumentType}
                onChange={(event) =>
                  setSourceDocumentType(event.target.value as DocumentCode)
                }
              >
                <option value="RNE">RNE Extract</option>
                <option value="TAX_CARD">Tax Card</option>
                <option value="CIN">CIN</option>
              </select>
              <button className="primary" onClick={startCamera} disabled={busy}>
                ◉ Open camera
              </button>
              <label className="upload-button">
                ▣ Upload documents
                <input
                  type="file"
                  multiple
                  accept="image/jpeg,image/png"
                  capture="environment"
                  onChange={(event) => {
                    const files = Array.from(event.target.files || []);
                    if (files.length > 1) void processBatch(files);
                    else if (files[0]) void processFile(files[0]);
                  }}
                />
              </label>
            </div>
          </div>
          <div className="hero-orbit">
            <div className="orbit-ring ring-one" />
            <div className="orbit-ring ring-two" />
            <div className="orbit-core">OCR</div>
          </div>
        </section>
        {cameraOpen && (
          <section className="camera-panel">
            <video ref={videoRef} autoPlay playsInline />
            <div>
              <button className="primary" onClick={capture}>
                Capture document
              </button>
              <button
                className="secondary"
                onClick={() => {
                  streamRef.current
                    ?.getTracks()
                    .forEach((track) => track.stop());
                  setCameraOpen(false);
                }}
              >
                Cancel
              </button>
            </div>
          </section>
        )}
        {error && (
          <section className="result bad">
            <div>
              <p className="eyebrow">PROCESSING ERROR</p>
              <h2>Document not processed</h2>
              <p>{error}</p>
            </div>
          </section>
        )}
        {batchResults.length > 1 && (
          <section className="panel batch-panel">
            <div className="panel-head">
              <div>
                <p className="eyebrow">BATCH OCR</p>
                <h2>{batchResults.length} documents extracted</h2>
              </div>
            </div>
            <div className="batch-list">
              {batchResults.map((document, index) => (
                <button
                  className={
                    ocr?.id === document.id ? "batch-row selected" : "batch-row"
                  }
                  key={document.id}
                  onClick={() => setOcr(document)}
                >
                  <span className="batch-index">{index + 1}</span>
                  <span>
                    <strong>{document.filename}</strong>
                    <small>
                      {document.fields.length} fields · {document.words.length}{" "}
                      words
                    </small>
                  </span>
                  <em>{Math.round(document.average_confidence * 100)}%</em>
                </button>
              ))}
            </div>
          </section>
        )}
        {ocr && (
          <>
            <section className="result good">
              <div>
                <p className="eyebrow">REAL OCR RESULT</p>
                <h2>Document fields extracted</h2>
                <p>{ocr.text || "No text was detected in this image."}</p>
                <small>
                  Average confidence: {Math.round(ocr.average_confidence * 100)}
                  % · {ocr.words.length} words with bounding boxes
                </small>
              </div>
              <div className="result-count">
                <strong>{ocr.fields.length}</strong>
                <span>fields</span>
              </div>
            </section>
            <section className="extraction-layout" id="extraction-section">
              <article className="panel">
                <div className="panel-head">
                  <div>
                    <p className="eyebrow">
                      {sourceDocumentType} EXTRACTED FIELDS
                    </p>
                    <h2>Select a source field</h2>
                  </div>
                </div>
                {ocr.fields.length === 0 && (
                  <p className="muted">
                    No configured labels were detected. Improve the image
                    quality or add aliases for this document template.
                  </p>
                )}
                <div className="field-list">
                  {ocr.fields.map((field) => (
                    <button
                      className={
                        selectedField?.id === field.id
                          ? "field-row selected"
                          : "field-row"
                      }
                      key={field.id}
                      onClick={() => {
                        setSelectedField(field);
                        setRuleName("");
                        setRuleSaved(false);
                        setRuleTest(null);
                        setConstraintTest(null);
                      }}
                    >
                      <span className="field-symbol">⌑</span>
                      <span>
                        <strong>{field.label}</strong>
                        <small>{field.value}</small>
                      </span>
                      <em>{Math.round(field.confidence * 100)}%</em>
                    </button>
                  ))}
                </div>
              </article>
              <article className="panel rule-panel" id="rule-section">
                <p className="eyebrow">RULE BUILDER</p>
                <h2>
                  {selectedField
                    ? selectedField.label
                    : "Choose an extracted field"}
                </h2>
                {selectedField ? (
                  <>
                    <div className="selected-value">
                      <small>
                        SOURCE: {sourceDocumentType} · EXTRACTED VALUE
                      </small>
                      <strong>{selectedField.value}</strong>
                      <span>
                        OCR confidence{" "}
                        {Math.round(selectedField.confidence * 100)}%
                      </span>
                    </div>
                    <label>
                      Rule name
                      <input
                        value={ruleName}
                        onChange={(event) => setRuleName(event.target.value)}
                        placeholder={`${selectedField.label} is required`}
                      />
                    </label>
                    <label>
                      What should be true?
                      <select
                        value={ruleKind}
                        onChange={(event) => {
                          setRuleKind(event.target.value);
                          setRuleTest(null);
                          setConstraintTest(null);
                        }}
                      >
                        <option value="required">
                          Required / must not be empty
                        </option>
                        <option value="exact_length">
                          Exact number of characters
                        </option>
                        <option value="regex">
                          Follow a format (regular expression)
                        </option>
                        <option value="cross_document_match">
                          Match another document field
                        </option>
                      </select>
                    </label>
                    {(ruleKind === "exact_length" || ruleKind === "regex") && (
                      <div className="constraint-box">
                        <p>
                          Test this rule against the extracted value before
                          publishing.
                        </p>
                        {ruleKind === "exact_length" ? (
                          <label>
                            Required length
                            <input
                              type="number"
                              min="1"
                              value={constraintConfig.exact_length || ""}
                              onChange={(event) =>
                                setConstraintConfig({
                                  exact_length: Number(event.target.value),
                                })
                              }
                              placeholder="8"
                            />
                          </label>
                        ) : (
                          <label>
                            Regular expression
                            <input
                              value={String(constraintConfig.regex || "")}
                              onChange={(event) =>
                                setConstraintConfig({
                                  regex: event.target.value,
                                })
                              }
                              placeholder="^[0-9]{7}[A-Z]/[A-Z]/[0-9]{3}$"
                            />
                          </label>
                        )}
                        <label>
                          Value to test
                          <input
                            value={constraintValue || selectedField.value}
                            onChange={(event) =>
                              setConstraintValue(event.target.value)
                            }
                          />
                        </label>
                        <button
                          className="secondary test-rule"
                          onClick={testConstraint}
                        >
                          Test constraint
                        </button>
                        {constraintTest && (
                          <div
                            className={
                              constraintTest.status === "PASS"
                                ? "rule-test pass"
                                : "rule-test fail"
                            }
                          >
                            <strong>{constraintTest.status}</strong>
                            <span>{constraintTest.reason}</span>
                          </div>
                        )}
                      </div>
                    )}
                    {ruleKind === "cross_document_match" && (
                      <div className="cross-document-box">
                        <p>Link this source field to a field from another document already uploaded in this template.</p>
                        <label>
                          Target document
                          <select
                            value={targetDocumentType}
                            onChange={(event) => {
                              setTargetDocumentType(
                                event.target.value as DocumentCode,
                              );
                              setTargetOcr(null);
                              setTargetFieldId("");
                            }}
                          >
                            {(activeNav === "Templates"
                              ? templateDocuments
                              : [
                                  { code: "TAX_CARD", name: "Tax Card" },
                                  { code: "RNE", name: "RNE Extract" },
                                  { code: "CIN", name: "CIN" },
                                ]
                            ).map((document) => (
                              <option key={document.code} value={document.code}>
                                {document.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        {targetOcr && (
                          <>
                            <label>
                              Target field
                              <select
                                value={targetFieldId}
                                onChange={(event) =>
                                  setTargetFieldId(event.target.value)
                                }
                              >
                                <option value="">Select target field</option>
                                {targetOcr.fields.map((field) => (
                                  <option key={field.id} value={field.id}>
                                    {field.label}: {field.value}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <p className="target-status">
                              Target OCR complete: {targetOcr.fields.length}{" "}
                              fields extracted.
                            </p>
                          </>
                        )}
                      </div>
                    )}
                    <button className="primary" onClick={saveRule}>
                      Publish rule
                    </button>
                    {ruleSaved && (
                      <p className="saved-message">
                        Rule published for {selectedField.label}.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="muted">
                    Select a source field from the extracted document to create
                    a rule tied to its configured field ID.
                  </p>
                )}
              </article>
            </section>
          </>
        )}
        <section className="workflow-grid" id="templates-section">
          <article className="panel">
            <div className="panel-head">
              <div>
                <p className="eyebrow">TEMPLATE BUILDER</p>
                <h2>Create a document folder</h2>
              </div>
            </div>
            <p className="muted">
              Add the document types and names that belong to this folder template.
            </p>

            <label>
              Folder name
              <input
                value={templateName}
                onChange={(event) => setTemplateName(event.target.value)}
                placeholder="e.g. Business identity pack"
              />
            </label>

            <label>
              Description
              <input
                value={templateDescription}
                onChange={(event) => setTemplateDescription(event.target.value)}
                placeholder="e.g. Mandatory documents for commercial registration"
              />
            </label>

            <div className="template-document-section">
              <div className="template-document-header">
                <span className="section-label">Included Document Types</span>
                <span className="doc-count">{templateDocuments.length} document(s)</span>
              </div>
              <div className="template-document-editor">
                {templateDocuments.map((document, index) => (
                  <div
                    className="template-document-row"
                    key={`${document.code}-${index}`}
                  >
                    <div className="doc-field-name">
                      <input
                        value={document.name}
                        onChange={(event) =>
                          setTemplateDocuments((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, name: event.target.value }
                                : item,
                            ),
                          )
                        }
                        placeholder="Document name (e.g. RNE Extract)"
                      />
                    </div>
                    <div className="doc-field-code">
                      <input
                        value={document.code}
                        onChange={(event) =>
                          setTemplateDocuments((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index
                                ? {
                                    ...item,
                                    code: event.target.value
                                      .toUpperCase()
                                      .replace(/\s/g, "_"),
                                  }
                                : item,
                            ),
                          )
                        }
                        placeholder="CODE (e.g. RNE)"
                      />
                    </div>
                    <label className="upload-button template-upload">
                      {document.file ? "✓ Reference" : "+ Upload"}
                      <input
                        type="file"
                        accept="image/jpeg,image/png"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file)
                            setTemplateDocuments((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, file } : item,
                              ),
                            );
                        }}
                      />
                    </label>
                    {templateDocuments.length > 1 && (
                      <button
                        type="button"
                        className="remove-doc-btn"
                        title="Remove document type"
                        onClick={() =>
                          setTemplateDocuments((current) =>
                            current.filter((_, itemIndex) => itemIndex !== index),
                          )
                        }
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="secondary add-document"
                onClick={addTemplateDocument}
              >
                + Add another document type
              </button>
            </div>

            <div className="template-builder-footer">
              <button className="primary" onClick={createTemplate}>
                {editingTemplateId ? "Save template changes" : "Create template"}
              </button>
              {templateSaved && <p className="saved-message">✓ Template saved successfully.</p>}
            </div>
          </article>

          <article className="panel">
            <div className="panel-head">
              <div>
                <p className="eyebrow">TEMPLATES</p>
                <h2>Document folders</h2>
              </div>
            </div>
            <div className="template-list">
              {templates.map((template) => (
                <div className="template-card" key={template.id}>
                  <div className="template-card-header">
                    <strong>{template.name}</strong>
                    <span className="template-card-badge">{template.document_types.length} docs</span>
                  </div>
                  <small>{template.description || "No description provided."}</small>
                  <div className="template-card-tags">
                    {template.document_types.map((type) => (
                      <span className="type-tag" key={type}>{type}</span>
                    ))}
                    <span className="rules-tag">{template.rule_ids.length} rule(s)</span>
                  </div>
                  <button className="secondary template-edit" onClick={() => editTemplate(template)}>
                    ✎ Edit template
                  </button>
                </div>
              ))}
            </div>
          </article>
        </section>
        <section className="template-source-fields panel" id="template-source-fields">
          <div className="panel-head"><div><p className="eyebrow">SOURCE FIELDS</p><h2>Fields from this template</h2></div></div>
          <p className="muted">Choose a field below to define a rule. These values come from the reference documents you uploaded above.</p>
          <div className="template-source-documents">
            {templateDocuments.map((document) => <article className="template-source-document" key={document.code}><div className="panel-head"><div><strong>{document.name}</strong><small>{document.code}</small></div></div>{document.ocr?.fields?.length ? <div className="field-list">{document.ocr.fields.map((field) => <button className={selectedField?.id === field.id && sourceDocumentType === document.code ? "field-row selected" : "field-row"} key={`${document.code}-${field.id}`} onClick={() => { setOcr(document.ocr || null); setSourceDocumentType(document.code as DocumentCode); setSelectedField(field); setRuleName(""); setRuleSaved(false); setRuleTest(null); }}><span className="field-symbol">⌑</span><span><strong>{field.label}</strong><small>{field.value}</small></span><em>{Math.round(field.confidence * 100)}%</em></button>)}</div> : <p className="muted">Upload this reference document to extract its fields.</p>}</article>)}
          </div>
        </section>
        <section className="review-panel panel" id="review-section">
          <div className="panel-head">
            <div>
              <p className="eyebrow">REVIEW QUEUE</p>
              <h2>Check submitted documents</h2>
            </div>
            {reviewFiles.length > 0 && (
              <button
                className="secondary"
                onClick={() => setReviewFiles([])}
                style={{ fontSize: "11px", padding: "6px 12px" }}
              >
                Clear all files
              </button>
            )}
          </div>
          <p className="muted">
            Upload documents directly into their folder cards below, or select a whole folder directory. THABBET will apply template compliance rules across the document collection.
          </p>

          <div className="review-controls" style={{ marginBottom: "16px" }}>
            <label>
              Template
              <select
                value={reviewTemplateId}
                onChange={(event) => {
                  setReviewTemplateId(event.target.value);
                  setReviewFiles([]);
                  setReviewResult(null);
                }}
              >
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </label>

            <div style={{ display: "flex", gap: "8px", alignItems: "end" }}>
              <label
                className="upload-button review-upload secondary"
                style={{ margin: 0, cursor: "pointer" }}
              >
                📁 Upload Entire Folder
                <input
                  type="file"
                  multiple
                  // @ts-expect-error webkitdirectory attribute
                  webkitdirectory=""
                  directory=""
                  onChange={handleFolderUpload}
                />
              </label>

              <button
                className="primary"
                onClick={submitReview}
                disabled={busy || reviewFiles.length === 0}
              >
                Run template review ({reviewFiles.length})
              </button>
            </div>
          </div>

          <div className="review-folders-grid">
            {reviewTemplateDocuments.length > 0 ? (
              reviewTemplateDocuments.map((doc, docIndex) => {
                const folderFiles = reviewFiles.filter(
                  (rf) => rf.type === doc.code,
                );
                return (
                  <div
                    className={`review-folder-card ${
                      folderFiles.length > 0 ? "has-files" : ""
                    }`}
                    key={`${doc.code}-${docIndex}`}
                  >
                    <div>
                      <div className="review-folder-head">
                        <div className="review-folder-title">
                          <span className="review-folder-icon">📁</span>
                          <div>
                            <strong>{doc.name}</strong>
                            <small>{doc.code}</small>
                          </div>
                        </div>
                        <span
                          className={`review-folder-count ${
                            folderFiles.length > 0 ? "active" : ""
                          }`}
                        >
                          {folderFiles.length}{" "}
                          {folderFiles.length === 1 ? "file" : "files"}
                        </span>
                      </div>

                      <div className="review-folder-file-list">
                        {folderFiles.length > 0 ? (
                          folderFiles.map((rf, idx) => {
                            const globalIndex = reviewFiles.indexOf(rf);
                            return (
                              <div
                                className="review-folder-file-item"
                                key={`${rf.file.name}-${idx}`}
                              >
                                <div className="review-folder-file-info">
                                  <span>📄</span>
                                  <div>
                                    <strong title={rf.file.name}>
                                      {rf.file.name}
                                    </strong>
                                    <small>
                                      {formatFileSize(rf.file.size)}
                                    </small>
                                  </div>
                                </div>
                                <button
                                  className="review-file-remove"
                                  title="Remove file"
                                  onClick={() => removeReviewFile(globalIndex)}
                                >
                                  ✕
                                </button>
                              </div>
                            );
                          })
                        ) : (
                          <div className="review-folder-empty">
                            No documents in this folder yet
                          </div>
                        )}
                      </div>
                    </div>

                    <label className="review-folder-upload-btn">
                      + Add file(s) to {doc.name}
                      <input
                        type="file"
                        multiple
                        accept="image/jpeg,image/png"
                        onChange={(event) => {
                          const files = Array.from(event.target.files || []);
                          if (files.length > 0) {
                            setReviewFiles((current) => [
                              ...current,
                              ...files.map((file) => ({
                                file,
                                type: doc.code,
                                typeName: doc.name,
                              })),
                            ]);
                          }
                          event.target.value = "";
                        }}
                      />
                    </label>
                  </div>
                );
              })
            ) : (
              <p className="muted">
                No document folders configured for this template.
              </p>
            )}
          </div>
          {reviewResult && (
            <div className="review-decision-card">
              <div className="review-decision-header">
                <div className="decision-title-group">
                  <span className="eyebrow">COMPLIANCE EVALUATION DECISION</span>
                  <div className="decision-badge-row">
                    <h2 className={reviewResult.status === "COMPLIANT" ? "status-compliant" : "status-noncompliant"}>
                      {reviewResult.status === "COMPLIANT" ? "✓ COMPLIANT" : "⚠ NON-COMPLIANT"}
                    </h2>
                    <span className="template-name-tag">{reviewResult.template_name}</span>
                  </div>
                  <p className="decision-subtitle">
                    {reviewResult.summary.passed} of {reviewResult.summary.total} rules passed across {reviewResult.documents.length} document file(s).
                  </p>
                </div>
                <button className="secondary" onClick={() => setReviewResult(null)}>
                  ✕ Dismiss results
                </button>
              </div>

              <div className="review-rules-grid">
                <h4 className="rules-section-title">Evaluated Compliance Rules</h4>
                {reviewResult.results.map((result, index) => (
                  <div
                    className={`review-rule-item ${result.status.toLowerCase()}`}
                    key={`${result.rule_id || result.reason}-${index}`}
                  >
                    <div className="rule-item-header">
                      <span className={`rule-status-badge ${result.status.toLowerCase()}`}>
                        {result.status}
                      </span>
                      <strong className="rule-item-name">
                        {result.rule_name || "Rule Evaluation"}
                      </strong>
                      {result.severity && (
                        <span className={`severity ${result.severity.toLowerCase()}`}>
                          {result.severity}
                        </span>
                      )}
                    </div>
                    <p className="rule-item-reason">{result.reason}</p>
                    {(result.source_value || result.target_value) && (
                      <div className="rule-values-box">
                        {result.source_value && (
                          <div>
                            <span className="val-label">Source Value:</span>
                            <span className="val-text">{result.source_value}</span>
                          </div>
                        )}
                        {result.target_value && (
                          <div>
                            <span className="val-label">Target Value:</span>
                            <span className="val-text">{result.target_value}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
        <section className="rules-library panel" id="rules-library">
          <div className="panel-head">
            <div>
              <p className="eyebrow">RULES LIBRARY</p>
              <h2>Rules you created</h2>
            </div>
            <span className="rule-count">{rules.length} rules</span>
          </div>
          <div className="rule-search">
            <input
              value={ruleSearch}
              onChange={(event) => setRuleSearch(event.target.value)}
              placeholder="Search by rule name, field, or type"
            />
          </div>
          {rules.length === 0 ? (
            <p className="muted">No rules found.</p>
          ) : (
            <div className="rules-table">
              <div className="rule-table-head">
                <span>RULE</span>
                <span>FIELD</span>
                <span>TYPE</span>
                <span>SEVERITY</span>
              </div>
              {rules.map((rule) => (
                <div className="rule-table-row" key={rule.id}>
                  <span>
                    <strong>{rule.name}</strong>
                    <small>{rule.document_type}</small>
                  </span>
                  <span>
                    {rule.source_field}
                    {rule.target_field
                      ? ` → ${rule.target_document_type}.${rule.target_field}`
                      : ""}
                  </span>
                  <span>
                    {rule.kind === "exact_length"
                      ? `Exactly ${rule.config.exact_length} chars`
                      : rule.kind === "regex"
                        ? "Format / regex"
                        : rule.kind}
                  </span>
                  <span className={`severity ${rule.severity}`}>
                    {rule.severity}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
        <div className="section-heading">
          <div>
            <p className="eyebrow">OVERVIEW</p>
            <h2>Today at a glance</h2>
          </div>
          <button className="link-button">View activity →</button>
        </div>
        <section className="stats">
          <article>
            <span className="stat-icon cyan">◉</span>
            <p>Documents checked</p>
            <strong>—</strong>
            <small className="neutral">Awaiting persisted runs</small>
          </article>
          <article>
            <span className="stat-icon green">✓</span>
            <p>Compliant rate</p>
            <strong>—</strong>
            <small className="neutral">Awaiting persisted runs</small>
          </article>
          <article>
            <span className="stat-icon amber">!</span>
            <p>Needs review</p>
            <strong>—</strong>
            <small className="neutral">Awaiting persisted cases</small>
          </article>
          <article>
            <span className="stat-icon violet">≡</span>
            <p>Published rules</p>
            <strong>—</strong>
            <small className="neutral">Awaiting persisted rules</small>
          </article>
        </section>
        <section className="lower-grid">
          <article className="panel">
            <div className="panel-head">
              <div>
                <p className="eyebrow">RECENT VALIDATION</p>
                <h2>Latest document sets</h2>
              </div>
            </div>
            <p className="muted">
              No validation runs have been persisted yet. Process a real
              document above to begin.
            </p>
          </article>
          <article className="panel activity">
            <div className="panel-head">
              <div>
                <p className="eyebrow">RULE HEALTH</p>
                <h2>Published coverage</h2>
              </div>
            </div>
            <p className="muted">
              Rule coverage will appear after PostgreSQL persistence is
              connected.
            </p>
          </article>
        </section>
      </section>
    </main>
  );
}
