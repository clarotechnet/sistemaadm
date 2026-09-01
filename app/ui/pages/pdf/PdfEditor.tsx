"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bold, Download, Eraser, FileDown, MousePointer2, Redo2, RectangleHorizontal, RotateCcw, Trash2, Type, Undo2, X, ZoomIn, ZoomOut } from "lucide-react";
import { downloadEditedPdfs, extractPdfTextItems, loadPdfJs, type PdfOverlay, type PdfTextItem } from "../../../../src/services/pdf";
import { FileDropzone } from "../../components/FileDropzone";
import { PdfCanvas } from "../../components/PdfCanvas";
import { useApp } from "../../state/AppContext";

type Tool="select"|"text"|"editText"|"erase"|"rect";
type EditorDoc={id:string;file:File;pageCount:number;page:number;past:PdfOverlay[][];present:PdfOverlay[];future:PdfOverlay[][]};
type TextScanState="idle"|"loading"|"ready"|"empty"|"error";
const FONT_SIZES=[8,9,10,11,12,14,16,18,24,32];

export function PdfEditor({onClose}:{onClose:()=>void}) {
  const app=useApp();
  const[docs,setDocs]=useState<EditorDoc[]>([]);
  const[activeId,setActiveId]=useState("");
  const[tool,setTool]=useState<Tool>("select");
  const[zoom,setZoom]=useState(80);
  const[text,setText]=useState("Novo texto");
  const[fontSize,setFontSize]=useState(12);
  const[color,setColor]=useState("#1f1f1f");
  const[bold,setBold]=useState(false);
  const[selected,setSelected]=useState("");
  const[textItems,setTextItems]=useState<PdfTextItem[]>([]);
  const[textScanState,setTextScanState]=useState<TextScanState>("idle");
  const stage=useRef<HTMLDivElement>(null);
  const dragStart=useRef<{x:number;y:number}|null>(null);
  const active=docs.find(doc=>doc.id===activeId);

  const updateDoc=useCallback((fn:(doc:EditorDoc)=>EditorDoc)=>setDocs(current=>current.map(doc=>doc.id===activeId?fn(doc):doc)),[activeId]);
  const commit=useCallback((next:PdfOverlay[])=>updateDoc(doc=>({...doc,past:[...doc.past,doc.present],present:next,future:[]})),[updateDoc]);

  const addFiles=async(files:File[])=>{
    const created:EditorDoc[]=[];
    for(const file of files){
      try{
        const pdfjs=await loadPdfJs();
        const pdf=await pdfjs.getDocument({data:await file.arrayBuffer()}).promise;
        created.push({id:crypto.randomUUID(),file,pageCount:pdf.numPages,page:0,past:[],present:[],future:[]});
      }catch(error){app.toast("error",`Não foi possível abrir ${file.name}`,error instanceof Error?error.message:undefined)}
    }
    setDocs(current=>[...current,...created]);
    if(!activeId&&created[0])setActiveId(created[0].id);
  };

  const undo=useCallback(()=>updateDoc(doc=>doc.past.length?{...doc,present:doc.past.at(-1)!,past:doc.past.slice(0,-1),future:[doc.present,...doc.future]}:doc),[updateDoc]);
  const redo=useCallback(()=>updateDoc(doc=>doc.future.length?{...doc,past:[...doc.past,doc.present],present:doc.future[0],future:doc.future.slice(1)}:doc),[updateDoc]);
  const removeSelected=useCallback(()=>{
    if(!active||!selected)return;
    const selectedItem=active.present.find(item=>item.id===selected);
    commit(active.present.filter(item=>item.id!==selected&&(!selectedItem?.groupId||item.groupId!==selectedItem.groupId)));
    setSelected("");
  },[active,selected,commit]);

  useEffect(()=>{
    const key=(event:KeyboardEvent)=>{
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="z"){event.preventDefault();undo()}
      else if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="y"){event.preventDefault();redo()}
      else if(event.key==="Delete")removeSelected();
      else if(event.key==="Escape")setTool("select");
    };
    window.addEventListener("keydown",key);
    return()=>window.removeEventListener("keydown",key);
  },[undo,redo,removeSelected]);

  useEffect(()=>{
    let cancelled=false;
    if(tool!=="editText"||!active)return;
    Promise.resolve().then(()=>{
      if(cancelled)return [];
      setTextItems([]);
      setTextScanState("loading");
      return extractPdfTextItems(active.file,active.page);
    }).then(items=>{
      if(cancelled)return;
      setTextItems(items);
      setTextScanState(items.length?"ready":"empty");
    }).catch(()=>{if(!cancelled)setTextScanState("error")});
    return()=>{cancelled=true};
  },[tool,active]);

  const pointer=(event:React.PointerEvent<HTMLDivElement>)=>{
    if(!active||!stage.current||tool==="select"||tool==="editText")return;
    const rect=stage.current.getBoundingClientRect();
    const point={x:(event.clientX-rect.left)/rect.width,y:(event.clientY-rect.top)/rect.height};
    if(event.type==="pointerdown"){
      if(tool==="text"){
        const overlay:PdfOverlay={id:crypto.randomUUID(),page:active.page,type:"text",x:point.x,y:point.y,width:.25,height:.055,text,fontSize,color,bold,coverBackground:false};
        commit([...active.present,overlay]);
        setSelected(overlay.id);
        setTool("select");
      }else dragStart.current=point;
    }else if(event.type==="pointerup"&&dragStart.current){
      const start=dragStart.current;
      dragStart.current=null;
      const overlay:PdfOverlay={id:crypto.randomUUID(),page:active.page,type:tool==="erase"?"erase":"rect",x:Math.min(start.x,point.x),y:Math.min(start.y,point.y),width:Math.abs(point.x-start.x),height:Math.abs(point.y-start.y),color};
      if(overlay.width>.005&&overlay.height>.005)commit([...active.present,overlay]);
    }
  };

  const replaceTextItem=(item:PdfTextItem)=>{
    if(!active)return;
    const groupId=crypto.randomUUID();
    const paddingX=.002;
    const paddingY=.0015;
    const x=Math.max(0,item.x-paddingX);
    const y=Math.max(0,item.y-paddingY);
    const width=Math.min(1-x,item.width+paddingX*2);
    const height=Math.min(1-y,item.height+paddingY*2);
    const size=Math.max(8,Math.min(32,item.fontSize));
    const erase:PdfOverlay={id:crypto.randomUUID(),groupId,page:active.page,type:"erase",x,y,width,height};
    const replacement:PdfOverlay={id:crypto.randomUUID(),groupId,page:active.page,type:"text",x:item.x,y:item.y,width:Math.max(item.width,.02),height:item.height,text:item.text,fontSize:size,color,bold,coverBackground:false};
    commit([...active.present,erase,replacement]);
    setText(item.text);
    setFontSize(size);
    setSelected(replacement.id);
    setTool("select");
    window.setTimeout(()=>document.querySelector<HTMLInputElement>("[data-editor-text-input]")?.select(),0);
  };

  const currentOverlays=active?.present.filter(item=>item.page===active.page)??[];
  const selectedOverlay=active?.present.find(item=>item.id===selected);
  const updateSelected=(patch:Partial<PdfOverlay>)=>{if(!active||!selected)return;commit(active.present.map(item=>item.id===selected?{...item,...patch}:item))};
  const currentText=selectedOverlay?.type==="text"?selectedOverlay.text??"":text;
  const currentFontSize=selectedOverlay?.type==="text"?selectedOverlay.fontSize??fontSize:fontSize;
  const sizeOptions=Array.from(new Set([...FONT_SIZES,currentFontSize])).sort((a,b)=>a-b);

  const download=async(all:boolean)=>{
    if(!active)return;
    try{
      const targets=all?docs:[active];
      await downloadEditedPdfs(targets.map(doc=>({file:doc.file,overlays:doc.present})),all);
      app.addAudit({operation:all?"Baixou todos os PDFs editados":"Baixou PDF editado",module:"Editor de PDF",result:all?`${docs.length} arquivos em ZIP`:active.file.name,status:"SUCESSO",processedCount:all?docs.length:1});
      app.toast("success",all?"ZIP com PDFs separados gerado":"PDF editado baixado");
    }catch(error){app.toast("error","Falha ao exportar PDF",error instanceof Error?error.message:undefined)}
  };

  const closeEditor=()=>{
    if(docs.some(doc=>doc.present.length)&&!window.confirm("Fechar o editor? As edições que ainda não foram baixadas serão descartadas."))return;
    onClose();
  };

  const removeActive=()=>{
    if(!active)return;
    if(!window.confirm(`Remover "${active.file.name}" do editor? O arquivo original no computador não será apagado.`))return;
    const remaining=docs.filter(doc=>doc.id!==active.id);
    setDocs(remaining);
    setActiveId(remaining[0]?.id??"");
    setSelected("");
    setTool("select");
    app.toast("success","PDF removido do editor","O arquivo original no computador não foi apagado.");
  };

  if(!docs.length)return <>
    <div className="page-heading compact"><div><h2>Editor de PDF</h2><p>Cada documento mantém suas próprias páginas, edições e histórico.</p></div><button className="button secondary" onClick={onClose}><X/> Fechar editor</button></div>
    <section className="surface import-surface"><div className="import-form"><FileDropzone accept=".pdf" multiple files={[]} onFiles={addFiles}/></div></section>
  </>;

  const textHint=tool==="editText"?(textScanState==="loading"?"Detectando os textos desta página...":textScanState==="empty"?"Nenhum texto selecionável foi encontrado. Este PDF pode ser uma imagem digitalizada.":textScanState==="error"?"Não foi possível detectar o texto desta página.":"Clique exatamente sobre o texto que deseja substituir."):"";

  return <div className="pdf-editor">
    <div className="editor-heading">
      <div><h2>Editor de PDF</h2><p>{active?.file.name} · página {(active?.page??0)+1} de {active?.pageCount}</p></div>
      <div>
        <button className="button editor-close" onClick={closeEditor}><X/> Fechar editor</button>
        <button className="button editor-remove" onClick={removeActive}><Trash2/> Remover PDF</button>
        <button className="button secondary" onClick={()=>download(false)}><Download/> Baixar atual</button>
        <button className="button primary" onClick={()=>download(true)}><FileDown/> Baixar todos</button>
      </div>
    </div>
    <div className="editor-toolbar">
      <div className="tool-group">
        <ToolButton active={tool==="select"} label="Selecionar" onClick={()=>setTool("select")} icon={<MousePointer2/>}/>
        <ToolButton active={tool==="text"} label="Adicionar texto" onClick={()=>setTool("text")} icon={<Type/>}/>
        <ToolButton active={tool==="editText"} label="Editar texto" onClick={()=>setTool("editText")} icon={<RotateCcw/>}/>
        <ToolButton active={tool==="erase"} label="Apagar área" onClick={()=>setTool("erase")} icon={<Eraser/>}/>
        <ToolButton active={tool==="rect"} label="Retângulo" onClick={()=>setTool("rect")} icon={<RectangleHorizontal/>}/>
      </div>
      <div className="tool-options">
        <input className="toolbar-text" value={currentText} onChange={event=>selectedOverlay?.type==="text"?updateSelected({text:event.target.value}):setText(event.target.value)} aria-label="Texto a inserir"/>
        <select value={currentFontSize} onChange={event=>{const value=Number(event.target.value);setFontSize(value);if(selectedOverlay?.type==="text")updateSelected({fontSize:value})}}>{sizeOptions.map(value=><option key={value}>{value}</option>)}</select>
        <input type="color" value={selectedOverlay?.type==="text"?selectedOverlay.color??color:color} onChange={event=>{setColor(event.target.value);if(selectedOverlay?.type==="text")updateSelected({color:event.target.value})}} aria-label="Cor"/>
        <button className={(selectedOverlay?.type==="text"?selectedOverlay.bold:bold)?"active":""} onClick={()=>{const value=!(selectedOverlay?.type==="text"?selectedOverlay.bold:bold);setBold(value);if(selectedOverlay?.type==="text")updateSelected({bold:value})}}><Bold/></button>
        <button disabled={!active?.past.length} onClick={undo}><Undo2/></button>
        <button disabled={!active?.future.length} onClick={redo}><Redo2/></button>
        <button disabled={!selected} onClick={removeSelected}><Trash2/></button>
      </div>
      <div className="zoom-controls"><button onClick={()=>setZoom(value=>Math.max(40,value-10))}><ZoomOut/></button><span>{zoom}%</span><button onClick={()=>setZoom(value=>Math.min(150,value+10))}><ZoomIn/></button></div>
    </div>
    <div className="editor-body">
      <aside className="editor-sidebar">
        <div className="editor-side-title"><strong>PDFs carregados</strong><label>+<input type="file" accept=".pdf" multiple hidden onChange={event=>addFiles([...(event.target.files??[])])}/></label></div>
        <div className="editor-doc-list">{docs.map(doc=><button className={doc.id===activeId?"active":""} key={doc.id} onClick={()=>{setActiveId(doc.id);setSelected("")}}><span className="document-icon">PDF</span><span><strong>{doc.file.name}</strong><small>{doc.pageCount} página(s)</small></span><i className={doc.present.length?"dirty":""}>{doc.present.length?"Editado":"Sem alterações"}</i></button>)}</div>
        <div className="editor-side-title"><strong>Páginas</strong></div>
        <div className="editor-page-list">{active&&Array.from({length:active.pageCount},(_,index)=><button className={active.page===index?"active":""} key={index} onClick={()=>updateDoc(doc=>({...doc,page:index}))}><div><PdfCanvas file={active.file} pageNumber={index+1} scale={.13}/>{active.present.some(item=>item.page===index)&&<i/>}</div><span>Página {index+1}</span></button>)}</div>
      </aside>
      <section className="editor-workspace">
        {textHint&&<div className={`edit-text-hint ${textScanState}`}>{textHint}</div>}
        <div className={`pdf-stage tool-${tool}`} ref={stage} style={{width:`${zoom}%`}} onPointerDown={pointer} onPointerUp={pointer}>
          {active&&<PdfCanvas file={active.file} pageNumber={active.page+1} scale={1.35} className="main-pdf-canvas"/>}
          <div className="overlay-layer">{currentOverlays.map(overlay=><button key={overlay.id} className={`pdf-overlay ${overlay.type} ${selected===overlay.id?"selected":""}`} style={{left:`${overlay.x*100}%`,top:`${overlay.y*100}%`,width:`${overlay.width*100}%`,height:`${overlay.height*100}%`,borderColor:overlay.color,color:overlay.color,fontSize:`${overlay.fontSize??12}px`,fontWeight:overlay.bold?700:400}} onPointerDown={event=>{if(tool==="select"){event.stopPropagation();setSelected(overlay.id)}}} aria-label={overlay.type==="text"?`Texto: ${overlay.text}`:"Elemento do PDF"}>{overlay.type==="text"?overlay.text:""}</button>)}</div>
          {tool==="editText"&&<div className="pdf-text-selection-layer">{textItems.map(item=><button key={item.id} className="pdf-text-hitbox" style={{left:`${item.x*100}%`,top:`${item.y*100}%`,width:`${item.width*100}%`,height:`${item.height*100}%`}} onPointerDown={event=>event.stopPropagation()} onClick={()=>replaceTextItem(item)} aria-label={`Editar texto: ${item.text}`} title={`Editar: ${item.text}`}/>)}</div>}
        </div>
        {selectedOverlay&&<div className="element-properties"><strong>Propriedades do elemento</strong><label>X <input type="number" step=".01" value={selectedOverlay.x.toFixed(2)} onChange={event=>updateSelected({x:Number(event.target.value)})}/></label><label>Y <input type="number" step=".01" value={selectedOverlay.y.toFixed(2)} onChange={event=>updateSelected({y:Number(event.target.value)})}/></label><label>Largura <input type="number" step=".01" value={selectedOverlay.width.toFixed(2)} onChange={event=>updateSelected({width:Number(event.target.value)})}/></label><label>Altura <input type="number" step=".01" value={selectedOverlay.height.toFixed(2)} onChange={event=>updateSelected({height:Number(event.target.value)})}/></label>{selectedOverlay.type==="text"&&<label>Texto <input data-editor-text-input value={selectedOverlay.text} onChange={event=>updateSelected({text:event.target.value})}/></label>}</div>}
      </section>
    </div>
  </div>;
}

function ToolButton({active,label,onClick,icon}:{active:boolean;label:string;onClick:()=>void;icon:React.ReactNode}){return <button className={active?"active":""} onClick={onClick}>{icon}<span>{label}</span></button>}
