// Controlled numeric field that tolerates partial input ("", "-", "-1.").
// type="number" reports badInput as "" (the minus vanishes), which made
// negative bounds impossible to type; plain text + our own parse fixes it.
import { ParameterLabel } from './InfoIcon.jsx';
import { labelHelp } from './parameterHelp.js';
import { useEffect, useRef, useState } from 'react';

export default function NumField({ label, value, onChange, title, help }) {
  const [text, setText] = useState(String(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);

  const commit = (raw) => {
    if (!/^-?\d*\.?\d*$/.test(raw)) return; // digits, optional '-', one '.'
    setText(raw);
    const n = Number(raw);
    if (raw.trim() !== '' && Number.isFinite(n)) onChange(n);
  };

  return (
    <label>
      <ParameterLabel label={label} help={help || title || labelHelp(label)} />
      <input
        type="text"
        inputMode="decimal"
        value={text}
        onChange={(e) => commit(e.target.value)}
        onFocus={() => { focused.current = true; }}
        onBlur={() => {
          focused.current = false;
          const n = Number(text);
          setText(text.trim() !== '' && Number.isFinite(n) ? String(n) : String(value));
        }}
      />
    </label>
  );
}
