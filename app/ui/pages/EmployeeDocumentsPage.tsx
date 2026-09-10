"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import { Archive, CheckCircle2, Download, Eye, FileText, Folder, Pencil, Plus, RotateCcw, Search, ShieldCheck, Trash2, Upload, Users, X } from "lucide-react";
import type { DocumentCategory, Employee, EmployeeDocument, EmployeeDocumentStatus, EmployeeStatus } from "../../../src/types";
import { formatCpf } from "../../../src/utils/cpf";
import { downloadFile, formatFileSize } from "../../../src/utils/download";
import {
  downloadEmployeeDocumentBlob,
  employeeDocumentAccept,
  employeeDocumentMaxSize,
  getEmployeeDocumentUrl,
  listDocumentCategories,
  listEmployeeDocuments,
  listEmployees,
  purgeEmployeeDocument,
  restoreEmployeeDocument,
  reviewEmployeeDocument,
  saveEmployee,
  trashEmployeeDocument,
  uploadEmployeeDocument,
} from "../../../src/services/employee-documents";
import { ConfirmationModal, EmptyState, MetricCard, StatusBadge } from "../components/Common";
import { useApp } from "../state/AppContext";

type CenterView = "documents" | "employees" | "trash";
type EmployeeForm = { name: string; cpf: string; registration: string; department: string; jobTitle: string; status: EmployeeStatus };
type UploadForm = { employeeId: string; categoryId: string; competence: string; title: string; notes: string };

const currentCompetence = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};
const emptyEmployeeForm = (): EmployeeForm => ({ name: "", cpf: "", registration: "", department: "", jobTitle: "", status: "ATIVO" });
const emptyUploadForm = (competence: string): UploadForm => ({ employeeId: "", categoryId: "", competence, title: "", notes: "" });
const competenceLabel = (value: string) => value ? `${value.slice(5, 7)}/${value.slice(0, 4)}` : "—";
const archiveSafeName = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[<>:"/\\|?*]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 140) || "Documento";
const displayDate = (value: string | null) => value ? new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";

export function EmployeeDocumentsPage() {
  const app = useApp();
  const { toast } = app;
  const canManage = app.user.role === "ADMINISTRADOR" || app.user.role === "RH";
  const isAdmin = app.user.role === "ADMINISTRADOR";
  const [view, setView] = useState<CenterView>("documents");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [categories, setCategories] = useState<DocumentCategory[]>([]);
  const [documents, setDocuments] = useState<EmployeeDocument[]>([]);
  const [trash, setTrash] = useState<EmployeeDocument[]>([]);
  const [competence, setCompetence] = useState(currentCompetence);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [showVersions, setShowVersions] = useState(false);
  const [loadingBase, setLoadingBase] = useState(true);
  const [loadingDocuments, setLoadingDocuments] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [employeeOpen, setEmployeeOpen] = useState(false);
  const [editingEmployeeId, setEditingEmployeeId] = useState<string | null>(null);
  const [employeeForm, setEmployeeForm] = useState<EmployeeForm>(emptyEmployeeForm);
  const [savingEmployee, setSavingEmployee] = useState(false);
  const [uploadForm, setUploadForm] = useState<UploadForm>(() => emptyUploadForm(currentCompetence()));
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const [busyId, setBusyId] = useState("");
  const [packaging, setPackaging] = useState(false);
  const [packageProgress, setPackageProgress] = useState("");
  const [trashTarget, setTrashTarget] = useState<EmployeeDocument | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<EmployeeDocument | null>(null);

  const employeeById = useMemo(() => new Map(employees.map(employee => [employee.id, employee])), [employees]);
  const categoryById = useMemo(() => new Map(categories.map(category => [category.id, category])), [categories]);

  const loadBase = useCallback(async () => {
    setLoadingBase(true);
    try {
      const [nextEmployees, nextCategories] = await Promise.all([listEmployees(), listDocumentCategories()]);
      setEmployees(nextEmployees);
      setCategories(nextCategories);
    } catch (caught) {
      toast("error", "Não foi possível abrir a Central de Documentos", caught instanceof Error ? caught.message : "Verifique a conexão.");
    } finally {
      setLoadingBase(false);
    }
  }, [toast]);

  const loadDocuments = useCallback(async () => {
    setLoadingDocuments(true);
    try {
      setDocuments(await listEmployeeDocuments(competence));
    } catch (caught) {
      toast("error", "Não foi possível carregar os documentos", caught instanceof Error ? caught.message : "Verifique a conexão.");
    } finally {
      setLoadingDocuments(false);
    }
  }, [competence, toast]);

  const loadTrash = useCallback(async () => {
    if (!canManage) return;
    try { setTrash(await listEmployeeDocuments(competence, true)); }
    catch (caught) { toast("error", "Não foi possível carregar a lixeira", caught instanceof Error ? caught.message : "Verifique a conexão."); }
  }, [canManage, competence, toast]);

  useEffect(() => { const timer = window.setTimeout(() => void loadBase(), 0); return () => window.clearTimeout(timer); }, [loadBase]);
  useEffect(() => { const timer = window.setTimeout(() => void loadDocuments(), 0); return () => window.clearTimeout(timer); }, [loadDocuments]);
  useEffect(() => { if (view !== "trash") return; const timer = window.setTimeout(() => void loadTrash(), 0); return () => window.clearTimeout(timer); }, [loadTrash, view]);

  const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
  const matchesFilters = (document: EmployeeDocument) => {
    const employee = employeeById.get(document.employeeId);
    const category = categoryById.get(document.categoryId);
    return (!employeeFilter || document.employeeId === employeeFilter)
      && (!categoryFilter || document.categoryId === categoryFilter)
      && (!normalizedQuery || [document.title, document.fileName, document.notes, employee?.name, employee?.cpf, employee?.registration, category?.label].join(" ").toLocaleLowerCase("pt-BR").includes(normalizedQuery));
  };
  const visibleDocuments = documents.filter(document => (showVersions || document.isCurrent) && matchesFilters(document));
  const visibleTrash = trash.filter(matchesFilters);
  const activeEmployees = employees.filter(employee => employee.status === "ATIVO");
  const requiredCategories = categories.filter(category => category.monthlyRequired);
  const currentDocuments = documents.filter(document => document.isCurrent);
  const receivedKeys = new Set(currentDocuments.map(document => `${document.employeeId}:${document.categoryId}`));
  const requiredTotal = activeEmployees.length * requiredCategories.length;
  const receivedRequired = activeEmployees.reduce((total, employee) => total + requiredCategories.filter(category => receivedKeys.has(`${employee.id}:${category.id}`)).length, 0);
  const pendingRequired = Math.max(0, requiredTotal - receivedRequired);
  const reviewedCount = currentDocuments.filter(document => document.reviewStatus === "CONFERIDO").length;

  const openEmployee = (employee?: Employee) => {
    setEditingEmployeeId(employee?.id ?? null);
    setEmployeeForm(employee ? { name: employee.name, cpf: employee.cpf, registration: employee.registration, department: employee.department, jobTitle: employee.jobTitle, status: employee.status } : emptyEmployeeForm());
    setEmployeeOpen(true);
  };

  const submitEmployee = async () => {
    setSavingEmployee(true);
    try {
      const saved = await saveEmployee(employeeForm, editingEmployeeId ?? undefined);
      setEmployees(current => [...current.filter(employee => employee.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")));
      app.addAudit({ operation: editingEmployeeId ? "Atualizou funcionário" : "Cadastrou funcionário", module: "Documentos", result: saved.name, status: "SUCESSO" });
      app.toast("success", editingEmployeeId ? "Funcionário atualizado" : "Funcionário cadastrado", saved.name);
      setEmployeeOpen(false);
    } catch (caught) {
      app.toast("error", "Não foi possível salvar o funcionário", caught instanceof Error ? caught.message : "Revise os dados.");
    } finally { setSavingEmployee(false); }
  };

  const openUpload = () => {
    const firstEmployee = activeEmployees[0]?.id ?? employees[0]?.id ?? "";
    const firstCategory = categories[0]?.id ?? "";
    setUploadForm({ employeeId: employeeFilter || firstEmployee, categoryId: categoryFilter || firstCategory, competence, title: "", notes: "" });
    setUploadFiles([]);
    setUploadProgress("");
    setUploadOpen(true);
  };

  const submitUpload = async () => {
    if (!uploadForm.employeeId || !uploadForm.categoryId || !uploadFiles.length) {
      app.toast("warning", "Preencha funcionário, categoria e arquivo");
      return;
    }
    setUploading(true);
    let uploaded = 0;
    const failures: string[] = [];
    try {
      for (const [index, file] of uploadFiles.entries()) {
        setUploadProgress(`Enviando ${index + 1} de ${uploadFiles.length}: ${file.name}`);
        try {
          await uploadEmployeeDocument(file, {
            ...uploadForm,
            title: uploadFiles.length === 1 ? uploadForm.title : file.name.replace(/\.[^.]+$/, ""),
          });
          uploaded += 1;
        } catch (caught) {
          failures.push(`${file.name}: ${caught instanceof Error ? caught.message : "falha no envio"}`);
        }
      }
      if (uploaded) {
        const employee = employeeById.get(uploadForm.employeeId);
        app.addAudit({ operation: "Arquivou documentos", module: "Documentos", result: `${uploaded} arquivo(s) · ${employee?.name ?? "Funcionário"} · ${competenceLabel(uploadForm.competence)}`, status: failures.length ? "AVISO" : "SUCESSO", processedCount: uploaded });
        app.toast("success", `${uploaded} documento(s) arquivado(s)`, "Os arquivos estão no cofre privado do RH.");
        setCompetence(uploadForm.competence);
        await loadDocuments();
      }
      if (failures.length) app.toast("warning", `${failures.length} arquivo(s) não foram enviados`, failures[0]);
      if (!failures.length) setUploadOpen(false);
    } finally {
      setUploading(false);
      setUploadProgress("");
    }
  };

  const openDocument = async (document: EmployeeDocument) => {
    setBusyId(document.id);
    const preview = window.open("", "_blank");
    try {
      const url = await getEmployeeDocumentUrl(document);
      if (!preview) throw new Error("O navegador bloqueou a nova aba. Permita pop-ups para este site e tente novamente.");
      preview.opener = null;
      preview.location.replace(url);
      app.addAudit({ operation: "Visualizou documento", module: "Documentos", result: document.fileName, status: "SUCESSO", fileName: document.fileName });
    } catch (caught) {
      preview?.close();
      app.toast("error", "Não foi possível abrir o documento", caught instanceof Error ? caught.message : "Tente novamente.");
    } finally { setBusyId(""); }
  };

  const downloadDocument = async (document: EmployeeDocument) => {
    setBusyId(document.id);
    try {
      downloadFile(await downloadEmployeeDocumentBlob(document), document.fileName, document.mimeType);
      app.addAudit({ operation: "Baixou documento", module: "Documentos", result: document.fileName, status: "SUCESSO", fileName: document.fileName });
    } catch (caught) {
      app.toast("error", "Não foi possível baixar o documento", caught instanceof Error ? caught.message : "Tente novamente.");
    } finally { setBusyId(""); }
  };

  const updateReview = async (document: EmployeeDocument, status: EmployeeDocumentStatus) => {
    setBusyId(document.id);
    try {
      const updated = await reviewEmployeeDocument(document.id, status);
      setDocuments(current => current.map(item => item.id === document.id ? updated : item));
      app.addAudit({ operation: status === "CONFERIDO" ? "Conferiu documento" : "Reabriu conferência", module: "Documentos", result: document.fileName, status: "SUCESSO", fileName: document.fileName });
      app.toast("success", status === "CONFERIDO" ? "Documento conferido" : "Documento marcado como recebido");
    } catch (caught) {
      app.toast("error", "Não foi possível atualizar a conferência", caught instanceof Error ? caught.message : "Tente novamente.");
    } finally { setBusyId(""); }
  };

  const moveToTrash = async (document: EmployeeDocument) => {
    setBusyId(document.id);
    try {
      await trashEmployeeDocument(document.id);
      await Promise.all([loadDocuments(), loadTrash()]);
      app.addAudit({ operation: "Moveu documento para a lixeira", module: "Documentos", result: document.fileName, status: "AVISO", fileName: document.fileName });
      app.toast("success", "Documento movido para a lixeira", "O arquivo ainda pode ser restaurado.");
    } catch (caught) {
      app.toast("error", "Não foi possível mover o documento", caught instanceof Error ? caught.message : "Tente novamente.");
    } finally { setBusyId(""); }
  };

  const restoreDocument = async (document: EmployeeDocument) => {
    setBusyId(document.id);
    try {
      await restoreEmployeeDocument(document.id);
      await Promise.all([loadDocuments(), loadTrash()]);
      app.addAudit({ operation: "Restaurou documento", module: "Documentos", result: document.fileName, status: "SUCESSO", fileName: document.fileName });
      app.toast("success", "Documento restaurado");
    } catch (caught) {
      app.toast("error", "Não foi possível restaurar", caught instanceof Error ? caught.message : "Tente novamente.");
    } finally { setBusyId(""); }
  };

  const purgeDocument = async (document: EmployeeDocument) => {
    setBusyId(document.id);
    try {
      await purgeEmployeeDocument(document);
      setTrash(current => current.filter(item => item.id !== document.id));
      app.addAudit({ operation: "Excluiu documento definitivamente", module: "Documentos", result: document.fileName, status: "AVISO", fileName: document.fileName });
      app.toast("success", "Documento excluído definitivamente");
    } catch (caught) {
      app.toast("error", "Não foi possível excluir definitivamente", caught instanceof Error ? caught.message : "Tente novamente.");
    } finally { setBusyId(""); }
  };

  const makeMonthlyPackage = async () => {
    const exportDocuments = currentDocuments;
    if (!exportDocuments.length) {
      app.toast("warning", "Nenhum documento nesta competência", "Arquive os documentos antes de gerar o pacote.");
      return;
    }
    setPackaging(true);
    try {
      const [{ utils, write }, zip] = await Promise.all([import("xlsx"), Promise.resolve(new JSZip())]);
      const rows = exportDocuments.map(document => {
        const employee = employeeById.get(document.employeeId);
        const category = categoryById.get(document.categoryId);
        return {
          Funcionário: employee?.name ?? "Não localizado", CPF: employee ? formatCpf(employee.cpf) : "",
          Matrícula: employee?.registration ?? "", Setor: employee?.department ?? "", Categoria: category?.label ?? document.categoryId,
          Competência: competenceLabel(document.competence), Documento: document.title, Arquivo: document.fileName,
          Versão: document.version, Situação: document.reviewStatus, "Enviado por": document.uploadedByName,
          "Enviado em": displayDate(document.createdAt), SHA256: document.sha256,
        };
      });
      const missing = activeEmployees.flatMap(employee => requiredCategories
        .filter(category => !receivedKeys.has(`${employee.id}:${category.id}`))
        .map(category => ({ Funcionário: employee.name, CPF: formatCpf(employee.cpf), Matrícula: employee.registration, Categoria: category.label, Competência: competenceLabel(competence), Situação: "PENDENTE" })));
      const workbook = utils.book_new();
      utils.book_append_sheet(workbook, utils.json_to_sheet(rows), "Documentos");
      utils.book_append_sheet(workbook, utils.json_to_sheet(missing.length ? missing : [{ Situação: "Nenhuma pendência" }]), "Pendências");
      zip.file("Relacao_de_documentos.xlsx", write(workbook, { type: "array", bookType: "xlsx" }));
      zip.file("LEIA-ME.txt", `Pacote mensal de auditoria RH Control\r\nCompetência: ${competenceLabel(competence)}\r\nGerado por: ${app.user.name}\r\nGerado em: ${new Date().toLocaleString("pt-BR")}\r\nDocumentos: ${exportDocuments.length}\r\nPendências obrigatórias: ${missing.length}\r\n`);

      for (const [index, document] of exportDocuments.entries()) {
        const employee = employeeById.get(document.employeeId);
        const category = categoryById.get(document.categoryId);
        setPackageProgress(`Incluindo ${index + 1} de ${exportDocuments.length}: ${document.fileName}`);
        const folder = archiveSafeName(`${employee?.name ?? "Funcionario"} - CPF ${employee?.cpf ?? "sem-cpf"}`);
        const name = archiveSafeName(`${category?.label ?? document.categoryId} - v${document.version} - ${document.fileName}`);
        zip.file(`${folder}/${name}`, await downloadEmployeeDocumentBlob(document));
      }
      setPackageProgress("Compactando o pacote...");
      const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
      downloadFile(blob, `Auditoria_Claro_${competence}.zip`, "application/zip");
      app.addAudit({ operation: "Gerou pacote mensal de auditoria", module: "Documentos", result: `${competenceLabel(competence)} · ${exportDocuments.length} documento(s) · ${missing.length} pendência(s)`, status: missing.length ? "AVISO" : "SUCESSO", processedCount: exportDocuments.length, missingCount: missing.length });
      app.toast("success", "Pacote mensal gerado", `${exportDocuments.length} documento(s) e ${missing.length} pendência(s).`);
    } catch (caught) {
      app.toast("error", "Não foi possível gerar o pacote", caught instanceof Error ? caught.message : "Verifique os documentos e tente novamente.");
    } finally {
      setPackaging(false);
      setPackageProgress("");
    }
  };

  const documentTable = (items: EmployeeDocument[], deleted = false) => items.length ? <div className="table-scroll"><table className="data-table documents-table"><thead><tr><th>Documento</th><th>Funcionário</th><th>Categoria</th><th>Competência</th><th>Versão</th><th>Situação</th><th>{deleted ? "Excluído em" : "Arquivado em"}</th><th className="right">Ações</th></tr></thead><tbody>{items.map(document => {
    const employee = employeeById.get(document.employeeId);
    const category = categoryById.get(document.categoryId);
    return <tr key={document.id} className={!document.isCurrent && !deleted ? "document-old-version" : ""}><td><div className="document-name-cell"><span><FileText /></span><div><strong>{document.title}</strong><small>{document.fileName} · {formatFileSize(document.sizeBytes)}</small></div></div></td><td><strong>{employee?.name ?? "Funcionário não localizado"}</strong><small className="block-muted">{employee ? formatCpf(employee.cpf, app.settings.maskCpf) : "—"}{employee?.registration ? ` · Mat. ${employee.registration}` : ""}</small></td><td>{category?.label ?? document.categoryId}</td><td>{competenceLabel(document.competence)}</td><td><span className="version-pill">v{document.version}{document.isCurrent ? " · atual" : ""}</span></td><td><StatusBadge status={deleted ? "NA LIXEIRA" : document.reviewStatus} /></td><td>{displayDate(deleted ? document.deletedAt : document.createdAt)}<small className="block-muted">{deleted ? document.deletedByName : document.uploadedByName}</small></td><td><div className="row-actions document-actions">{deleted ? <><button disabled={busyId === document.id} title="Restaurar" onClick={() => void restoreDocument(document)}><RotateCcw /></button>{isAdmin && <button className="danger-action" disabled={busyId === document.id} title="Excluir definitivamente" onClick={() => setPurgeTarget(document)}><Trash2 /></button>}</> : <><button disabled={busyId === document.id} title="Visualizar" onClick={() => void openDocument(document)}><Eye /></button><button disabled={busyId === document.id} title="Baixar" onClick={() => void downloadDocument(document)}><Download /></button>{canManage && <button disabled={busyId === document.id} title={document.reviewStatus === "CONFERIDO" ? "Reabrir conferência" : "Marcar como conferido"} onClick={() => void updateReview(document, document.reviewStatus === "CONFERIDO" ? "RECEBIDO" : "CONFERIDO")}><CheckCircle2 /></button>}{canManage && <button className="danger-action" disabled={busyId === document.id} title="Mover para lixeira" onClick={() => setTrashTarget(document)}><Trash2 /></button>}</>}</div></td></tr>;
  })}</tbody></table></div> : <EmptyState icon={deleted ? <Archive /> : <Folder />} title={loadingDocuments ? "Carregando documentos..." : deleted ? "A lixeira está vazia" : "Nenhum documento encontrado"} description={deleted ? "Documentos removidos aparecerão aqui e poderão ser restaurados." : `Nenhum arquivo corresponde aos filtros da competência ${competenceLabel(competence)}.`} />;

  return <>
    <div className="page-heading documents-heading"><div><h2>Documentos dos Funcionários</h2><p>Cofre privado para documentos trabalhistas e pacotes mensais de auditoria.</p></div><div>{canManage && <button className="button secondary" onClick={() => openEmployee()}><Plus /> Novo funcionário</button>}<button className="button primary" disabled={!canManage || !employees.length} onClick={openUpload}><Upload /> Enviar documentos</button></div></div>
    <div className="documents-security-note"><ShieldCheck /><span><strong>Arquivos privados e rastreáveis</strong><small>O acesso exige login; visualizações, downloads, alterações e exclusões são registrados no histórico.</small></span></div>
    <div className="metrics-grid documents-metrics"><MetricCard label="FUNCIONÁRIOS ATIVOS" value={loadingBase ? "—" : activeEmployees.length} detail="cadastrados para auditoria"/><MetricCard label={`DOCUMENTOS · ${competenceLabel(competence)}`} value={loadingDocuments ? "—" : currentDocuments.length} detail={`${reviewedCount} conferido(s)`} tone="success"/><MetricCard label="OBRIGATÓRIOS RECEBIDOS" value={loadingDocuments ? "—" : `${receivedRequired}/${requiredTotal}`} detail="ponto e holerite por funcionário" tone={pendingRequired ? "warning" : "success"}/><MetricCard label="PENDÊNCIAS DO MÊS" value={loadingDocuments ? "—" : pendingRequired} detail={pendingRequired ? "documentos obrigatórios ausentes" : "competência completa"} tone={pendingRequired ? "warning" : "success"}/></div>
    <div className="tabs documents-tabs"><button className={view === "documents" ? "active" : ""} onClick={() => setView("documents")}>Documentos</button><button className={view === "employees" ? "active" : ""} onClick={() => setView("employees")}>Funcionários</button>{canManage && <button className={view === "trash" ? "active" : ""} onClick={() => setView("trash")}>Lixeira</button>}</div>

    {view === "documents" && <section className="surface table-surface documents-surface"><div className="documents-toolbar"><div className="search-box"><Search /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Pesquisar documento, funcionário, CPF ou matrícula" /></div><label><span>Competência</span><input type="month" value={competence} onChange={event => setCompetence(event.target.value)} /></label><label><span>Funcionário</span><select value={employeeFilter} onChange={event => setEmployeeFilter(event.target.value)}><option value="">Todos</option>{employees.map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label><label><span>Categoria</span><select value={categoryFilter} onChange={event => setCategoryFilter(event.target.value)}><option value="">Todas</option>{categories.map(category => <option key={category.id} value={category.id}>{category.label}</option>)}</select></label></div><div className="documents-subtoolbar"><label className="checkbox-line"><input type="checkbox" checked={showVersions} onChange={event => setShowVersions(event.target.checked)} /> Mostrar versões anteriores</label><span>{visibleDocuments.length} documento(s)</span><button className="button secondary" disabled={packaging || !currentDocuments.length} onClick={() => void makeMonthlyPackage()}><Archive /> {packaging ? packageProgress || "Gerando pacote..." : "Gerar pacote mensal"}</button></div>{documentTable(visibleDocuments)}</section>}

    {view === "employees" && <section className="surface table-surface documents-surface"><div className="section-header"><div><h3>Cadastro de funcionários</h3><p>Funcionários são diferentes dos usuários que acessam o sistema.</p></div>{canManage && <button className="button primary" onClick={() => openEmployee()}><Plus /> Cadastrar funcionário</button>}</div>{employees.length ? <div className="table-scroll"><table className="data-table employees-table"><thead><tr><th>Funcionário</th><th>CPF</th><th>Matrícula</th><th>Setor / cargo</th><th>Status</th>{canManage && <th className="right">Ações</th>}</tr></thead><tbody>{employees.map(employee => <tr key={employee.id}><td><strong>{employee.name}</strong></td><td className="mono">{formatCpf(employee.cpf, app.settings.maskCpf)}</td><td>{employee.registration || "—"}</td><td>{employee.department || "—"}<small className="block-muted">{employee.jobTitle || "Sem cargo informado"}</small></td><td><StatusBadge status={employee.status} /></td>{canManage && <td><div className="row-actions document-actions"><button title="Editar funcionário" onClick={() => openEmployee(employee)}><Pencil /></button></div></td>}</tr>)}</tbody></table></div> : <EmptyState icon={<Users />} title={loadingBase ? "Carregando funcionários..." : "Nenhum funcionário cadastrado"} description="Cadastre o primeiro funcionário para começar a arquivar documentos." action={canManage ? <button className="button primary" onClick={() => openEmployee()}><Plus /> Cadastrar funcionário</button> : undefined} />}</section>}

    {view === "trash" && canManage && <section className="surface table-surface documents-surface"><div className="section-header"><div><h3>Lixeira de documentos</h3><p>RH pode restaurar arquivos. Apenas Administradores podem excluí-los definitivamente.</p></div><span>{visibleTrash.length} item(ns)</span></div>{documentTable(visibleTrash, true)}</section>}

    {employeeOpen && <EmployeeModal form={employeeForm} setForm={setEmployeeForm} editing={Boolean(editingEmployeeId)} busy={savingEmployee} onClose={() => setEmployeeOpen(false)} onSave={() => void submitEmployee()} />}
    {uploadOpen && <UploadModal form={uploadForm} setForm={setUploadForm} employees={employees} categories={categories} files={uploadFiles} setFiles={setUploadFiles} busy={uploading} progress={uploadProgress} onClose={() => setUploadOpen(false)} onUpload={() => void submitUpload()} />}
    <ConfirmationModal open={Boolean(trashTarget)} danger title="Mover documento para a lixeira?" description="O documento deixará de aparecer na competência, mas poderá ser restaurado depois." confirmLabel="Mover para lixeira" onClose={() => setTrashTarget(null)} onConfirm={() => { if (trashTarget) void moveToTrash(trashTarget); }} />
    <ConfirmationModal open={Boolean(purgeTarget)} danger title="Excluir documento definitivamente?" description="O arquivo e seus metadados serão removidos do cofre. Esta ação não pode ser desfeita." confirmLabel="Excluir definitivamente" onClose={() => setPurgeTarget(null)} onConfirm={() => { if (purgeTarget) void purgeDocument(purgeTarget); }} />
  </>;
}

function EmployeeModal({ form, setForm, editing, busy, onClose, onSave }: { form: EmployeeForm; setForm: (form: EmployeeForm) => void; editing: boolean; busy: boolean; onClose: () => void; onSave: () => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}><div className="modal form-modal employee-modal" role="dialog" aria-modal="true"><h3>{editing ? "Editar funcionário" : "Novo funcionário"}</h3><p>Estes dados organizam os documentos e não criam acesso ao sistema.</p><label className="field"><span>Nome completo</span><input value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label><div className="two-fields"><label className="field grow"><span>CPF</span><input inputMode="numeric" value={form.cpf} onChange={event => setForm({ ...form, cpf: event.target.value })} placeholder="000.000.000-00" /></label><label className="field grow"><span>Matrícula</span><input value={form.registration} onChange={event => setForm({ ...form, registration: event.target.value })} /></label></div><div className="two-fields"><label className="field grow"><span>Setor</span><input value={form.department} onChange={event => setForm({ ...form, department: event.target.value })} /></label><label className="field grow"><span>Cargo</span><input value={form.jobTitle} onChange={event => setForm({ ...form, jobTitle: event.target.value })} /></label></div><label className="field"><span>Situação</span><select value={form.status} onChange={event => setForm({ ...form, status: event.target.value as EmployeeStatus })}><option value="ATIVO">Ativo</option><option value="DESLIGADO">Desligado</option></select></label><div className="modal-actions"><button className="button secondary" disabled={busy} onClick={onClose}>Cancelar</button><button className="button primary" disabled={busy} onClick={onSave}>{busy ? "Salvando..." : "Salvar funcionário"}</button></div></div></div>;
}

function UploadModal({ form, setForm, employees, categories, files, setFiles, busy, progress, onClose, onUpload }: { form: UploadForm; setForm: (form: UploadForm) => void; employees: Employee[]; categories: DocumentCategory[]; files: File[]; setFiles: (files: File[]) => void; busy: boolean; progress: string; onClose: () => void; onUpload: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const addFiles = (list: FileList | null) => { if (list) setFiles([...files, ...Array.from(list)]); };
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}><div className="modal form-modal document-upload-modal" role="dialog" aria-modal="true"><h3>Enviar documentos</h3><p>Os arquivos serão armazenados no cofre privado e vinculados ao funcionário.</p><div className="two-fields"><label className="field grow"><span>Funcionário</span><select value={form.employeeId} onChange={event => setForm({ ...form, employeeId: event.target.value })}><option value="">Selecione</option>{employees.map(employee => <option key={employee.id} value={employee.id}>{employee.name}{employee.status === "DESLIGADO" ? " · desligado" : ""}</option>)}</select></label><label className="field grow"><span>Categoria</span><select value={form.categoryId} onChange={event => setForm({ ...form, categoryId: event.target.value })}><option value="">Selecione</option>{categories.map(category => <option key={category.id} value={category.id}>{category.label}</option>)}</select></label></div><div className="two-fields"><label className="field grow"><span>Competência</span><input type="month" value={form.competence} onChange={event => setForm({ ...form, competence: event.target.value })} /></label><label className="field grow"><span>Título do documento</span><input value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} placeholder="Opcional; usado quando houver um arquivo" /></label></div><label className="field"><span>Observações</span><textarea value={form.notes} onChange={event => setForm({ ...form, notes: event.target.value })} placeholder="Informação opcional para a auditoria" /></label><button type="button" className={`document-dropzone ${dragging ? "dragging" : ""}`} onClick={() => input.current?.click()} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files); }}><Upload /><strong>Arraste os documentos para cá</strong><span>ou clique para selecionar · até 50 MB por arquivo</span><small>PDF, imagens, Word, Excel, CSV ou ZIP</small></button><input ref={input} hidden type="file" accept={employeeDocumentAccept} multiple onChange={event => { addFiles(event.target.files); event.target.value = ""; }} />{files.length > 0 && <div className="document-selected-files">{files.map((file, index) => <div key={`${file.name}-${file.lastModified}-${index}`} className={file.size > employeeDocumentMaxSize ? "invalid" : ""}><FileText /><span><strong>{file.name}</strong><small>{formatFileSize(file.size)}{file.size > employeeDocumentMaxSize ? " · excede 50 MB" : ""}</small></span><button disabled={busy} onClick={() => setFiles(files.filter((_, current) => current !== index))} aria-label={`Remover ${file.name}`}><X /></button></div>)}</div>}{progress && <div className="upload-progress"><i /><span>{progress}</span></div>}<div className="modal-actions"><button className="button secondary" disabled={busy} onClick={onClose}>Cancelar</button><button className="button primary" disabled={busy || !files.length || files.some(file => file.size > employeeDocumentMaxSize)} onClick={onUpload}>{busy ? "Enviando..." : `Arquivar ${files.length || ""} documento(s)`}</button></div></div></div>;
}
