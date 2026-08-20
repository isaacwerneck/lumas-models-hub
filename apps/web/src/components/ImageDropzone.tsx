import { useRef } from "react";

type ImageDropzoneProps = {
  title: string;
  fileName: string | null;
  reading: boolean;
  onFile: (file: File) => void;
};

export const ImageDropzone = ({ title, fileName, reading, onFile }: ImageDropzoneProps) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const pickFile = () => {
    inputRef.current?.click();
  };

  return (
    <div
      className="dropzone"
      role="button"
      tabIndex={0}
      onClick={pickFile}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          pickFile();
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(event) => {
        event.preventDefault();
        const file = Array.from(event.dataTransfer.files).find((candidate) =>
          candidate.type.toLowerCase().startsWith("image/")
        );
        if (file) {
          onFile(file);
        }
      }}
    >
      <svg
        className="dz-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
        <circle cx="12" cy="13" r="4" />
      </svg>
      <span className="dz-title">{title}</span>
      {fileName ? <span className="dz-file">{fileName}</span> : null}
      <span className="dz-hint">
        {reading
          ? "Lendo com OCR..."
          : fileName
            ? "Clique, arraste ou Ctrl+V para trocar"
            : "Clique, arraste a imagem ou pressione Ctrl+V"}
      </span>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            onFile(file);
          }
          event.target.value = "";
        }}
      />
    </div>
  );
};