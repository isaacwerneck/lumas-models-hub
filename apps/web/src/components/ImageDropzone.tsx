import { useRef } from "react";

type ImageDropzoneProps = {
  id?: string;
  title: string;
  fileName: string | null;
  status: "idle" | "uploading" | "ready" | "error";
  error?: string | null;
  advisory?: string | null;
  onFile: (file: File) => void;
  active?: boolean;
  onActivate?: () => void;
};

export const ImageDropzone = ({ id, title, fileName, status, error, advisory, onFile, active = false, onActivate }: ImageDropzoneProps) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const pickFile = () => {
    inputRef.current?.click();
  };

  return (
    <div
      id={id}
      className={`dropzone${active ? " is-paste-target" : ""}${status === "ready" ? " is-ready" : ""}${status === "error" ? " has-error" : ""}`}
      role="button"
      tabIndex={0}
      aria-busy={status === "uploading"}
      aria-invalid={status === "error" || Boolean(error)}
      aria-describedby={(error || advisory) && id ? `${id}-feedback` : undefined}
      onClick={() => {
        onActivate?.();
        pickFile();
      }}
      onFocus={onActivate}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          pickFile();
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
        onActivate?.();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(event) => {
        event.preventDefault();
        const file = Array.from(event.dataTransfer.files).find((candidate) =>
          candidate.type.toLowerCase().startsWith("image/")
        );
        if (file) {
          onActivate?.();
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
        {status === "uploading"
          ? "Enviando imagem…"
          : status === "error"
            ? "Falha no envio — clique para tentar novamente"
            : status === "ready"
              ? "Imagem enviada — clique para trocar"
              : "Clique, arraste a imagem ou pressione Ctrl+V"}
      </span>
      {error || advisory ? <span id={id ? `${id}-feedback` : undefined} className={error ? "dz-feedback error" : "dz-feedback"}>{error ?? advisory}</span> : null}
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
