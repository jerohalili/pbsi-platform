import { Button } from '@/components/ui/button.tsx';
import { Label } from '@/components/ui/label.tsx';
import type { Delivery } from '@/components/assignments/types.ts';

interface DeliveryToggleProps {
  value: Delivery;
  onChange: (value: Delivery) => void;
  /** One line under the buttons for each choice. */
  hints: Record<Delivery, string>;
  disabled?: boolean;
}

/** "How is it given?": online as before, or announced here and done in person. Chosen when creating. */
export function DeliveryToggle({ value, onChange, hints, disabled }: DeliveryToggleProps) {
  return (
    <div className="space-y-2">
      <Label>How is it given?</Label>
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="How is it given?">
        {(['online', 'in_person'] as const).map((option) => (
          <Button
            key={option}
            type="button"
            variant={value === option ? 'default' : 'outline'}
            aria-pressed={value === option}
            disabled={disabled}
            onClick={() => onChange(option)}
          >
            {option === 'online' ? 'Online' : 'In person'}
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{hints[value]}</p>
    </div>
  );
}
