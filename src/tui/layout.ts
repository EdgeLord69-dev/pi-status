import type { FooterLayoutItem } from "./render.ts";

export function fitFooterRow<T extends FooterLayoutItem>(
  left: readonly T[],
  right: readonly T[],
  width: number,
  separator: string,
  visibleWidth: (text: string) => number,
): { left: T[]; right: T[] } {
  const fittedLeft = [...left];
  const fittedRight = [...right];
  if (width <= 0) return { left: [], right: [] };

  const rowWidth = () =>
    visibleWidth(fittedLeft.map((item) => item.text).join(separator)) +
    visibleWidth(fittedRight.map((item) => item.text).join(separator)) +
    (fittedLeft.length && fittedRight.length ? 1 : 0);

  while (rowWidth() > width && fittedLeft.length + fittedRight.length > 1) {
    const extensionIndex = fittedRight.findIndex((item) => item.key === "extension-status");
    if (extensionIndex >= 0) {
      fittedRight.splice(extensionIndex, 1);
    } else if (fittedRight.length > 0) {
      fittedRight.pop();
    } else {
      fittedLeft.pop();
    }
  }

  return { left: fittedLeft, right: fittedRight };
}
