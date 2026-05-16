export async function writeTextToClipboard(text: string) {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
    throw new Error("Clipboard API is unavailable");
  }

  await navigator.clipboard.writeText(text);
}