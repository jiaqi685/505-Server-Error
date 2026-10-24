import { Minus, Plus } from "lucide-react";

interface Props {
  id: string;
  value: string;
  min: number;
  unit: string;
  step?: number;
  onChange: (v: string) => void;
}

export function QtyStepper({ id, value, min, unit, step: increment = 1, onChange }: Props) {
  const step = (dir: number) => {
    const n = Math.round(Number(value) || min);
    onChange(String(Math.max(min, n + dir * increment)));
  };
  return (
    <div className="stepper">
      <button type="button" onClick={() => step(-1)} aria-label="Decrease quantity" data-testid={`button-${id}-decrease`}>
        <Minus size={16} style={{ margin: "auto" }} />
      </button>
      <input
        id={id}
        type="number"
        min={min}
        step={increment}
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`Quantity in ${unit}s`}
        data-testid={`input-${id}`}
      />
      <button type="button" onClick={() => step(1)} aria-label="Increase quantity" data-testid={`button-${id}-increase`}>
        <Plus size={16} style={{ margin: "auto" }} />
      </button>
    </div>
  );
}
