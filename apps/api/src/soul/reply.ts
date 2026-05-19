import { SOUL_LABELS_PT } from "./labels";
import { missingSoulFields, type SoulProfile } from "./soul";

const joinPt = (labels: ReadonlyArray<string>): string => {
  if (labels.length === 0) {
    return "";
  }
  if (labels.length === 1) {
    return labels[0] ?? "";
  }
  const head = labels.slice(0, -1).join(", ");
  const last = labels.at(-1) ?? "";
  return `${head} e ${last}`;
};

const buildReply = (
  newProfile: SoulProfile,
  capturedFields: ReadonlyArray<keyof SoulProfile>,
): string => {
  const missing = missingSoulFields(newProfile);
  const capturedLabels = capturedFields.map((f) => SOUL_LABELS_PT[f]);
  const missingLabels = missing.map((f) => SOUL_LABELS_PT[f]);

  if (capturedFields.length > 0 && missing.length > 0) {
    return `Anotei: ${joinPt(capturedLabels)}. Ainda preciso saber: ${joinPt(missingLabels)}.`;
  }
  if (capturedFields.length > 0 && missing.length === 0) {
    return "Tudo capturado! Você pode me corrigir a qualquer momento.";
  }
  if (capturedFields.length === 0 && missing.length > 0) {
    const first = missingLabels[0] ?? "";
    return `Não consegui captar nada útil dessa mensagem. Pode tentar descrever ${first}?`;
  }
  return "Tudo certo, nada novo por aqui.";
};

export { buildReply };
