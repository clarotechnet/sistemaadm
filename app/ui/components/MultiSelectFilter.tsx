"use client";

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import "./multi-select-filter.css";

type Option = { value: string; label: string };
type Props = { label: string; ariaLabel?: string; allLabel: string; pluralLabel: string; options: Option[]; values: string[]; onChange: (values: string[]) => void };

export function MultiSelectFilter({ label, ariaLabel = label, allLabel, pluralLabel, options, values, onChange }: Props) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false), [position, setPosition] = useState<CSSProperties>({});
  const selected = options.filter(option => values.includes(option.value));
  const summary = !values.length || selected.length === options.length ? allLabel : selected.length === 1 ? selected[0].label : `${selected.length} ${pluralLabel}`;
  const updatePosition = useCallback(() => {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(Math.max(rect.width, 280), window.innerWidth - 24);
    const below = window.innerHeight - rect.bottom - 18, above = rect.top - 18;
    const showAbove = below < 250 && above > below;
    setPosition({ width, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), maxHeight: Math.max(80, Math.min(380, showAbove ? above : below)), ...(showAbove ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }) });
  }, []);
  function close() { setOpen(false); trigger.current?.focus(); }
  useEffect(() => {
    if (!open) return;
    popup.current?.querySelector<HTMLInputElement>("input")?.focus();
    const outside = (event: Event) => {
      if (event.target instanceof Node && !trigger.current?.contains(event.target) && !popup.current?.contains(event.target)) setOpen(false);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
    };
    const scroll = (event: Event) => {
      if (event.target instanceof Node && popup.current?.contains(event.target)) return;
      updatePosition();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", keyboard);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("pointerdown", outside); document.removeEventListener("focusin", outside); document.removeEventListener("keydown", keyboard);
      window.removeEventListener("resize", updatePosition); window.removeEventListener("scroll", scroll, true);
    };
  }, [open, updatePosition]);

  return <div className="meal-filter multi-filter">
    <span id={id + "-label"}>{label}</span>
    <button ref={trigger} type="button" className="multi-filter-trigger" aria-label={ariaLabel} aria-describedby={id + "-summary"} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} disabled={!options.length} title={selected.map(option => option.label).join(", ") || allLabel} onClick={() => { if (open) close(); else { updatePosition(); setOpen(true); } }}>
      <span id={id + "-summary"}>{summary}</span><ChevronDown size={16} aria-hidden="true" />
    </button>
    {open && createPortal(<div ref={popup} id={id} className="multi-filter-popup" style={position} role="dialog" aria-label={`Filtrar por ${ariaLabel}`}>
      <div className="multi-filter-header"><strong>{label}</strong><button type="button" onClick={() => onChange([])}>Mostrar todas</button></div>
      <div className="multi-filter-options" role="group" aria-label={`Opções de ${ariaLabel}`}>
        {options.map(option => <label className="multi-filter-option" key={option.value}>
          <input type="checkbox" checked={values.includes(option.value)} onChange={event => onChange(event.target.checked ? [...values, option.value] : values.filter(value => value !== option.value))} />
          <span>{option.label}</span>
        </label>)}
      </div>
      <div className="multi-filter-footer"><span>{values.length ? `${selected.length} selecionada(s)` : allLabel}</span><button type="button" onClick={close}>Concluir</button></div>
    </div>, document.body)}
  </div>;
}
