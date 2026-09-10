"use client";

import { useMemo, useState } from "react";
import JSZip from "jszip";
import { Archive, Download, Eraser, FileArchive, FileDown, Gauge, PackageCheck } from "lucide-react";
import { FileDropzone } from "../../components/FileDropzone";
import { MetricCard, StatusBadge } from "../../components/Common";
import {
  compressPdfFile,
  pdfCompressionPresets,
  pdfCompressionSaving,
  type PdfCompressionPresetId,
  type PdfCompressionResult,
} from "../../../../src/services/pdf";
import { downloadFile, formatFileSize } from "../../../../src/utils/download";
import { useApp } from "../../state/AppContext";

type CompressorMode = "compress" | "zip";

const fileKey = (file: File) => `${file.name}|${file.size}|${file.lastModified}`;
const safeFileName = (value: string) => value.replace(/[\\/:*?"<>|]+/g, "_").trim() || "arquivo";
const savingLabel = (original: number, finalSize: number) => original ? `${pdfCompressionSaving(original, finalSize).toFixed(1)}%` : "—";

export function PdfCompressor() {
  const app = useApp();
  const [mode, setMode] = useState<CompressorMode>("compress");
  const [files, setFiles] = useState<File[]>([]);
  const [results, setResults] = useState<PdfCompressionResult[]>([]);
  const [preset, setPreset] = useState<PdfCompressionPresetId>("readable");
  const [grayscale, setGrayscale] = useState(false);
  const [zipName, setZipName] = useState("pdfs_compactados.zip");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ percent: 0, text: "" });

  const originalSize = useMemo(() => files.reduce((total, file) => total + file.size, 0), [files]);
  const processedOriginalSize = useMemo(() => results.reduce((total, result) => total + result.source.size, 0), [results]);
  const finalSize = useMemo(() => results.reduce((total, result) => total + result.blob.size, 0), [results]);
  const resultByFile = useMemo(() => new Map(results.map(result => [fileKey(result.source), result])), [results]);

  const updateFiles = (next: File[]) => {
    const unique = [...new Map(next.filter(file => file.type === "application/pdf" || /\.pdf$/i.test(file.name)).map(file => [fileKey(file), file])).values()];
    setFiles(unique);
    setResults([]);
    setProgress({ percent: 0, text: "" });
  };

  const clear = () => {
    setFiles([]);
    setResults([]);
    setProgress({ percent: 0, text: "" });
  };

  const buildZip = async (items: PdfCompressionResult[], requestedName: string) => {
    const zip = new JSZip();
    const usedNames = new Set<string>();
    items.forEach(item => {
      const safeName = safeFileName(item.fileName);
      const extensionIndex = safeName.toLowerCase().lastIndexOf(".pdf");
      const base = extensionIndex >= 0 ? safeName.slice(0, extensionIndex) : safeName;
      const extension = extensionIndex >= 0 ? safeName.slice(extensionIndex) : ".pdf";
      let name = `${base}${extension}`;
      let suffix = 2;
      while (usedNames.has(name.toLocaleLowerCase("pt-BR"))) {
        name = `${base} (${suffix})${extension}`;
        suffix += 1;
      }
      usedNames.add(name.toLocaleLowerCase("pt-BR"));
      zip.file(name, item.blob, { binary: true, compression: "DEFLATE", compressionOptions: { level: 9 } });
    });
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 9 } }, metadata => {
      setProgress({ percent: 80 + metadata.percent * 0.2, text: `Criando ZIP final... ${metadata.percent.toFixed(0)}%` });
    });
    const normalizedName = safeFileName(requestedName || "pdfs_compactados.zip");
    downloadFile(blob, /\.zip$/i.test(normalizedName) ? normalizedName : `${normalizedName}.zip`, "application/zip");
    return blob.size;
  };

  const run = async () => {
    if (!files.length) return;
    setBusy(true);
    setResults([]);
    const completed: PdfCompressionResult[] = [];
    const failures: string[] = [];
    try {
      for (const [index, file] of files.entries()) {
        try {
          const result = await compressPdfFile(file, preset, grayscale, page => {
            const percent = (index + page.percent / 100) / files.length * (mode === "zip" ? 78 : 100);
            setProgress({ percent, text: `Compactando ${index + 1} de ${files.length} · página ${page.page}/${page.pageCount} · ${file.name}` });
          });
          completed.push(result);
          setResults([...completed]);
        } catch (caught) {
          failures.push(`${file.name}: ${caught instanceof Error ? caught.message : "falha no processamento"}`);
        }
      }
      if (!completed.length) throw new Error(failures[0] || "Nenhum arquivo pôde ser processado.");
      let zipSize: number | null = null;
      if (mode === "zip") zipSize = await buildZip(completed, zipName);
      const completedOriginal = completed.reduce((total, result) => total + result.source.size, 0);
      const completedFinal = completed.reduce((total, result) => total + result.blob.size, 0);
      setProgress({ percent: 100, text: `Concluído · economia nos PDFs: ${savingLabel(completedOriginal, completedFinal)}` });
      app.addAudit({
        operation: mode === "zip" ? "Compactou PDFs e criou ZIP" : "Compactou PDFs",
        module: "PDF",
        result: `${completed.length} arquivo(s) · ${savingLabel(completedOriginal, completedFinal)} de economia${zipSize ? ` · ZIP ${formatFileSize(zipSize)}` : ""}`,
        status: failures.length ? "AVISO" : "SUCESSO",
        processedCount: completed.length,
        missingCount: failures.length,
      });
      app.toast("success", mode === "zip" ? "ZIP reduzido criado" : "Compactação concluída", `${completed.length} arquivo(s) processado(s).`);
      if (failures.length) app.toast("warning", `${failures.length} arquivo(s) não puderam ser compactados`, failures[0]);
    } catch (caught) {
      setProgress({ percent: 0, text: "Falha ao processar os PDFs." });
      app.toast("error", "Não foi possível compactar os PDFs", caught instanceof Error ? caught.message : "Tente novamente.");
    } finally {
      setBusy(false);
    }
  };

  const downloadResult = (result: PdfCompressionResult) => {
    downloadFile(result.blob, result.fileName, "application/pdf");
    app.addAudit({ operation: "Baixou PDF compactado", module: "PDF", result: result.fileName, status: "SUCESSO", fileName: result.fileName });
  };

  const downloadAll = async () => {
    if (!results.length) return;
    setBusy(true);
    try {
      await buildZip(results, "pdfs_reduzidos.zip");
      setProgress({ percent: 100, text: "ZIP com os PDFs compactados pronto." });
      app.addAudit({ operation: "Baixou ZIP de PDFs compactados", module: "PDF", result: `${results.length} arquivo(s)`, status: "SUCESSO", processedCount: results.length });
      app.toast("success", "ZIP criado com sucesso");
    } catch (caught) {
      app.toast("error", "Não foi possível criar o ZIP", caught instanceof Error ? caught.message : "Tente novamente.");
    } finally {
      setBusy(false);
    }
  };

  return <>
    <div className="page-heading compact"><div><h2>Compactar PDFs</h2><p>Reduza vários documentos ou crie um ZIP menor. O processamento acontece no navegador; a retenção do original segue a política exibida abaixo.</p></div><span className="privacy-pill">Processamento local · LGPD</span></div>
    <div className="mode-tabs compressor-mode-tabs">
      <button className={mode === "compress" ? "active" : ""} onClick={() => setMode("compress")}><FileDown /> Diminuir PDFs</button>
      <button className={mode === "zip" ? "active" : ""} onClick={() => setMode("zip")}><FileArchive /> Criar ZIP menor</button>
    </div>
    <section className="surface import-surface compressor-surface">
      <div className="compressor-grid">
        <div>
          <FileDropzone accept=".pdf" multiple files={files} onFiles={updateFiles} label="Arraste vários PDFs para cá" hint="ou clique para selecionar os documentos" />
        </div>
        <aside className="compressor-settings">
          <div><Gauge /><span><strong>Perfil de redução</strong><small>{pdfCompressionPresets[preset].description}</small></span></div>
          <label className="field"><span>Qualidade</span><select value={preset} disabled={busy} onChange={event => { setPreset(event.target.value as PdfCompressionPresetId); setResults([]); }}><option value="readable">Forte legível · recomendado</option><option value="balanced">Equilibrado · mais nítido</option><option value="quality">Alta qualidade · arquivo maior</option><option value="extreme">Extremo · menor tamanho</option></select></label>
          <div className="compressor-check"><input id="pdf-compressor-grayscale" aria-label="Converter para tons de cinza" type="checkbox" checked={grayscale} disabled={busy} onChange={event => { setGrayscale(event.target.checked); setResults([]); }} /><label htmlFor="pdf-compressor-grayscale"><strong>Converter para tons de cinza</strong><small>Pode reduzir ainda mais documentos coloridos.</small></label></div>
          {mode === "zip" && <label className="field"><span>Nome do ZIP</span><input value={zipName} disabled={busy} onChange={event => setZipName(event.target.value)} /></label>}
          <div className="compressor-warning"><strong>Atenção</strong><span>A compactação recria as páginas como imagens. Não use em PDFs assinados digitalmente, formulários editáveis ou quando precisar pesquisar/copiar o texto.</span></div>
          <div className="form-actions compressor-actions"><button className="button secondary" disabled={!files.length || busy} onClick={clear}><Eraser /> Limpar</button><button className="button primary" disabled={!files.length || busy} onClick={() => void run()}>{mode === "zip" ? <Archive /> : <PackageCheck />}{busy ? "Processando..." : mode === "zip" ? "Reduzir e criar ZIP" : "Compactar todos"}</button></div>
        </aside>
      </div>
    </section>
    <div className="metrics-grid compressor-metrics"><MetricCard label="ARQUIVOS" value={files.length} detail="PDFs selecionados"/><MetricCard label="TAMANHO ORIGINAL" value={formatFileSize(originalSize)} detail="antes da compactação"/><MetricCard label="TAMANHO FINAL" value={results.length ? formatFileSize(finalSize) : "—"} detail={results.length ? `${results.length} processado(s)` : "aguardando"} tone="success"/><MetricCard label="ECONOMIA" value={results.length ? savingLabel(processedOriginalSize, finalSize) : "—"} detail="nos arquivos processados" tone="success"/></div>
    {progress.text && <div className="compressor-progress"><div><i style={{ width: `${Math.max(0, Math.min(100, progress.percent))}%` }} /></div><span>{progress.text}</span></div>}
    {files.length > 0 && <section className="surface compressor-results"><div className="section-header"><div><h3>Arquivos selecionados</h3><p>A versão original é mantida automaticamente quando já for menor.</p></div>{mode === "compress" && <button className="button secondary" disabled={!results.length || busy} onClick={() => void downloadAll()}><FileArchive /> Baixar ZIP</button>}</div><div>{files.map(file => { const result = resultByFile.get(fileKey(file)); return <article key={fileKey(file)}><span className="compressor-file-icon"><FileDown /></span><span><strong>{file.name}</strong><small>{result ? `${formatFileSize(file.size)} → ${formatFileSize(result.blob.size)} · economia ${savingLabel(file.size, result.blob.size)}` : `${formatFileSize(file.size)} · aguardando compactação`}</small></span><StatusBadge status={result ? result.keptOriginal ? "ORIGINAL MENOR" : "CONCLUÍDO" : "AGUARDANDO"}/>{result && mode === "compress" ? <button className="button secondary" disabled={busy} onClick={() => downloadResult(result)}><Download /> Baixar</button> : <span />}</article>; })}</div></section>}
  </>;
}
