import path from "node:path";

const encodeExtendedFilename = (value: string) =>
  encodeURIComponent(value).replace(/['()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );

export const inlineContentDisposition = (originalName: string) => {
  const fileName = path.basename(originalName.replaceAll("\\", "/"))
    .replace(/[\r\n]/g, "_")
    .slice(0, 255) || "arquivo";
  const asciiFallback = fileName
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .replace(/[^\x20-\x7E]+/gu, "_")
    .replace(/["\\]/g, "_");

  return `inline; filename="${asciiFallback}"; filename*=UTF-8''${encodeExtendedFilename(fileName)}`;
};
