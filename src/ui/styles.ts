import { css } from 'lit';

/** Controls shared by the shell and the side panel (shadow DOM needs them per component). */
export const controls = css`
  :host { color: var(--text); font: 13px/1.4 var(--font); }
  .icon { flex: none; }
  button {
    font: inherit; color: var(--text); background: var(--btn); border: 1px solid var(--border);
    border-radius: 6px; padding: 6px 10px; cursor: pointer; display: inline-flex; align-items: center;
    justify-content: center; gap: 6px; min-height: 30px;
  }
  button:hover:not(:disabled) { background: var(--btn-hover); }
  button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  button:disabled { opacity: 0.45; cursor: default; }
  button.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); font-weight: 600; }
  button.primary:hover:not(:disabled) { background: var(--accent-hover); }
  button.ghost { background: transparent; border-color: transparent; }
  button.ghost:hover:not(:disabled) { background: var(--btn-hover); }
  button[aria-pressed='true'] { background: var(--accent-subtle); border-color: var(--accent); color: var(--text-strong); }
  input[type='number'], input[type='text'], select {
    font: inherit; color: var(--text); background: var(--input); border: 1px solid var(--border);
    border-radius: 6px; padding: 5px 8px; min-height: 30px; box-sizing: border-box; width: 100%;
  }
  input[type='range'] { width: 100%; accent-color: var(--accent); }
  input[type='color'] { width: 38px; height: 30px; padding: 2px; border: 1px solid var(--border); border-radius: 6px; background: var(--input); }
  input[type='checkbox'] { accent-color: var(--accent); width: 15px; height: 15px; margin: 0; }
  label { color: var(--muted); font-size: 12px; }
  .muted { color: var(--muted); }
  kbd {
    font: 11px/1 var(--mono); padding: 2px 5px; border: 1px solid var(--border); border-bottom-width: 2px;
    border-radius: 4px; color: var(--muted); background: var(--input);
  }
`;
