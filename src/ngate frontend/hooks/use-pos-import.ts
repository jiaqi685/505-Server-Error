import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { posDemo } from "@/data";
import type { PosImportKind, PosPreview } from "@/data/pos/types";
import { ngateKeys } from "./use-ngate";

export function usePosImportState() {
  return useQuery({
    queryKey: [...ngateKeys.all, "pos-import"],
    queryFn: () => posDemo.getState(),
  });
}

/** Preview is read-only. File reading and CSV validation never mutate inventory. */
export function usePreviewPosImport() {
  return useMutation({
    mutationFn: (input: { file: File; kind: PosImportKind }) => posDemo.preview(input.file, input.kind),
  });
}

export function useConfirmPosImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (preview: PosPreview) => posDemo.confirm(preview),
    onSuccess: () => qc.invalidateQueries({ queryKey: ngateKeys.all }),
  });
}

/** Resets only POS overlays, never RFQs, quotes, orders, activities or settings. */
export function useResetPosImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (kind?: PosImportKind) => posDemo.reset(kind),
    onSuccess: () => qc.invalidateQueries({ queryKey: ngateKeys.all }),
  });
}
