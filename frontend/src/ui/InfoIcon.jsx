import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export default function InfoIcon({ label, text }) {
  const id = useId();
  const iconRef = useRef(null);
  const [position, setPosition] = useState(null);
  const show = element => {
    const rect = element.getBoundingClientRect();
    const width = Math.min(300, window.innerWidth - 16);
    setPosition({ width, left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      ...(rect.top > 150 ? { bottom: window.innerHeight - rect.top + 8 } : { top: rect.bottom + 8 }) });
  };
  useEffect(() => {
    if (!position) return;
    const close = () => {
      if (document.activeElement === iconRef.current) show(iconRef.current);
      else setPosition(null);
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
  }, [position]);
  if (!text) return null;
  return <>
    <span ref={iconRef} className="info-icon" role="button" tabIndex={0} aria-label={`About ${label}`}
      aria-describedby={position ? id : undefined}
      onMouseEnter={event => show(event.currentTarget)} onMouseLeave={event => { if (document.activeElement !== event.currentTarget) setPosition(null); }}
      onFocus={event => show(event.currentTarget)} onBlur={() => setPosition(null)}
      onClick={event => { event.preventDefault(); event.stopPropagation(); show(event.currentTarget); }}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.stopPropagation(); setPosition(null); }
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); show(event.currentTarget); }
      }}>
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" />
        <path d="M8 7v4M8 4.5v.5" /></svg>
    </span>
    {position && createPortal(<span id={id} role="tooltip" className="parameter-tooltip" style={position}>{text}</span>, document.body)}
  </>;
}

export function ParameterLabel({ label, help }) {
  return <span className="parameter-label"><span>{label}</span><InfoIcon label={label} text={help} /></span>;
}
