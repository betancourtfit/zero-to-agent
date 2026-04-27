"use client";
import { Button } from "@/components/ui/button";

interface Props {
  onChip: (text: string) => void;
}

export function QuickReplyChips({ onChip }: Props) {
  function handleExtend() {
    onChip("dame 5 más");
    // Belt-and-suspenders: record intent in localStorage so reload-during-action preserves context (D-06)
    localStorage.setItem("restaurant_queue:lastIntent", "extend");
  }

  function handleCancel() {
    onChip("no voy a ir");
    localStorage.setItem("restaurant_queue:lastIntent", "cancel");
  }

  return (
    <div className="flex gap-2 px-4 py-2 overflow-x-auto">
      <Button
        variant="outline"
        size="sm"
        onClick={handleExtend}
        className="min-h-[44px] rounded-full shrink-0"
      >
        Pedir más tiempo
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={handleCancel}
        className="min-h-[44px] rounded-full shrink-0"
      >
        Cancelar
      </Button>
    </div>
  );
}
