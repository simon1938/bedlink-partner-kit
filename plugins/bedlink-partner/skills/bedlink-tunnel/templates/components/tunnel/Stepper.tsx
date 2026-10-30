"use client";

// Square numbered steps joined by a line (Alexian, Yenna). The labels show only
// for the current step on a phone, all of them when the tunnel is wide.

export function Stepper(props: { steps: string[]; current: number }) {
  return (
    <ol className="bt-stepper-bar" aria-label="Étapes">
      {props.steps.map((label, i) => {
        const state = i < props.current ? "is-done" : i === props.current ? "is-on" : "";
        return (
          <li key={label} className={"bt-st " + state} aria-current={i === props.current ? "step" : undefined}>
            {i > 0 ? <span className={i <= props.current ? "bt-st-line is-done" : "bt-st-line"} aria-hidden="true" /> : null}
            <i>{i < props.current ? "✓" : i + 1}</i>
            <span className="bt-st-label">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
