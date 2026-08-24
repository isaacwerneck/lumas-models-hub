import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Wifi } from "lucide-react";
import { io, type Socket } from "socket.io-client";
import { api, getAccessToken } from "../lib/api";
import type { ChatRoom } from "../types";
import { useToast } from "../components/Toast";
import { getApiErrorMessage } from "../lib/apiError";

type Cell = { rowIndex: number; columnIndex: number; value: string; valueType: "TEXT" | "NUMBER"; deleted?: boolean };
type Sheet = { id: string; modelTagId: string; rowCount: number; columnCount: number; revision: number; cells: Cell[] };
type ResizeTarget = { axis: "column" | "row"; index: number; start: number; size: number };

const MAX_ROWS = 20;
const MAX_COLUMNS = 6;
const DEFAULT_COLUMN_WIDTH = 160;
const DEFAULT_ROW_HEIGHT = 38;
const MIN_COLUMN_WIDTH = 104;
const MAX_COLUMN_WIDTH = 480;
const MIN_ROW_HEIGHT = 38;
const MAX_ROW_HEIGHT = 360;
const keyOf = (row: number, column: number) => `${row}:${column}`;
const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));
const columnName = (index: number) => String.fromCharCode(65 + index);

const readSizes = (key: string) => {
  try {
    const stored = JSON.parse(window.localStorage.getItem(key) ?? "{}") as { columns?: number[]; rows?: number[] };
    return {
      columns: Array.from({ length: MAX_COLUMNS }, (_, index) => clamp(stored.columns?.[index] ?? DEFAULT_COLUMN_WIDTH, MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH)),
      rows: Array.from({ length: MAX_ROWS }, (_, index) => clamp(stored.rows?.[index] ?? DEFAULT_ROW_HEIGHT, MIN_ROW_HEIGHT, MAX_ROW_HEIGHT))
    };
  } catch {
    return { columns: Array(MAX_COLUMNS).fill(DEFAULT_COLUMN_WIDTH), rows: Array(MAX_ROWS).fill(DEFAULT_ROW_HEIGHT) };
  }
};

type WorksheetCellProps = {
  row: number;
  column: number;
  value: string;
  onCommit: (row: number, column: number, value: string) => void;
  onPaste: (event: ClipboardEvent<HTMLTextAreaElement>, row: number, column: number) => void;
};

const WorksheetCell = memo(({ row, column, value, onCommit, onPaste }: WorksheetCellProps) => {
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fitHeight = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.minHeight = "0px";
    input.style.minHeight = `${Math.max(MIN_ROW_HEIGHT, input.scrollHeight)}px`;
  }, []);

  useEffect(() => setDraft(value), [value]);
  useLayoutEffect(() => { fitHeight(); }, [draft, fitHeight]);

  return <textarea
    ref={inputRef}
    className="sheet-cell"
    aria-label={`Célula ${columnName(column)}${row + 1}`}
    value={draft}
    rows={1}
    onChange={(event) => setDraft(event.target.value)}
    onBlur={() => onCommit(row, column, draft)}
    onPaste={(event) => onPaste(event, row, column)}
    onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") event.currentTarget.blur(); }}
  />;
});

WorksheetCell.displayName = "WorksheetCell";

export const ModelWorksheetPage = () => {
  const toast = useToast();
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [modelTagId, setModelTagId] = useState("");
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [columnWidths, setColumnWidths] = useState<number[]>(Array(MAX_COLUMNS).fill(DEFAULT_COLUMN_WIDTH));
  const [rowHeights, setRowHeights] = useState<number[]>(Array(MAX_ROWS).fill(DEFAULT_ROW_HEIGHT));
  const resizeTargetRef = useRef<ResizeTarget | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const pendingResizeRef = useRef<{ target: ResizeTarget; size: number } | null>(null);

  useEffect(() => {
    void api.get("/chat/rooms").then((response) => { setRooms(response.data.rooms); setModelTagId((current) => current || response.data.rooms[0]?.id || ""); }).finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (!modelTagId) return;
    setLoading(true);
    void api.get(`/model-workspaces/${modelTagId}/sheet`).then((response) => {
      const responseSheet = response.data.sheet as Sheet;
      const next = { ...responseSheet, rowCount: MAX_ROWS, columnCount: MAX_COLUMNS };
      setSheet(next);
      setValues(Object.fromEntries(next.cells.map((cell) => [keyOf(cell.rowIndex, cell.columnIndex), cell.value])));
    }).catch((error) => toast.error(getApiErrorMessage(error, "Não foi possível abrir a planilha."))).finally(() => setLoading(false));
  }, [modelTagId]);
  useEffect(() => {
    if (!modelTagId || !sheet) return;
    const sizes = readSizes(`lumas:worksheet-sizes:${modelTagId}`);
    setColumnWidths(sizes.columns);
    setRowHeights(sizes.rows);
  }, [modelTagId, sheet?.id]);
  useEffect(() => {
    if (!modelTagId || !sheet) return;
    const timer = window.setTimeout(() => {
      window.localStorage.setItem(`lumas:worksheet-sizes:${modelTagId}`, JSON.stringify({ columns: columnWidths, rows: rowHeights }));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [columnWidths, modelTagId, rowHeights, sheet?.id]);
  useEffect(() => {
    const token = getAccessToken(); if (!token) return;
    const instance = io(import.meta.env.VITE_API_URL ?? "http://localhost:3333", { auth: { token }, reconnection: true });
    instance.on("connect", () => setConnected(true)); instance.on("disconnect", () => setConnected(false)); setSocket(instance);
    return () => { instance.disconnect(); };
  }, []);
  useEffect(() => {
    if (!socket) return;
    const update = (payload: { modelTagId: string; revision: number; cells: Cell[] }) => {
      if (payload.modelTagId !== modelTagId) return;
      setValues((current) => {
        let changed = false;
        const next = { ...current };
        payload.cells.forEach((cell) => {
          const key = keyOf(cell.rowIndex, cell.columnIndex);
          if (cell.deleted) {
            if (key in next) { delete next[key]; changed = true; }
          } else if (next[key] !== cell.value) {
            next[key] = cell.value;
            changed = true;
          }
        });
        return changed ? next : current;
      });
      setSheet((current) => current && current.revision !== payload.revision ? { ...current, revision: payload.revision } : current);
    };
    const dimensions = (payload: { modelTagId: string; revision: number }) => { if (payload.modelTagId === modelTagId) setSheet((current) => current ? { ...current, rowCount: MAX_ROWS, columnCount: MAX_COLUMNS, revision: payload.revision } : current); };
    socket.on("worksheet:updated", update); socket.on("worksheet:dimensions", dimensions);
    return () => { socket.off("worksheet:updated", update); socket.off("worksheet:dimensions", dimensions); };
  }, [socket, modelTagId]);

  const saveCells = useCallback(async (cells: Cell[]) => {
    if (!modelTagId) return;
    try { await api.patch(`/model-workspaces/${modelTagId}/sheet/cells`, { cells: cells.map((cell) => ({ ...cell, valueType: /^-?\d+(?:[.,]\d+)?$/.test(cell.value.trim()) ? "NUMBER" : "TEXT" })) }); }
    catch (error) { toast.error(getApiErrorMessage(error, "Não foi possível salvar a planilha.")); }
  }, [modelTagId, toast]);
  const commitCell = useCallback((row: number, column: number, value: string) => {
    const key = keyOf(row, column);
    setValues((current) => current[key] === value ? current : { ...current, [key]: value });
    void saveCells([{ rowIndex: row, columnIndex: column, value, valueType: "TEXT" }]);
  }, [saveCells]);
  const paste = useCallback((event: ClipboardEvent<HTMLTextAreaElement>, startRow: number, startColumn: number) => {
    const matrix = event.clipboardData.getData("text").replace(/\r/g, "").split("\n").filter((line, index, rows) => line.length || index < rows.length - 1).map((line) => line.split("\t"));
    if (matrix.length === 1 && matrix[0].length === 1) return;
    event.preventDefault();
    const cells: Cell[] = [];
    matrix.forEach((row, rowOffset) => row.forEach((value, columnOffset) => { if (startRow + rowOffset < MAX_ROWS && startColumn + columnOffset < MAX_COLUMNS) cells.push({ rowIndex: startRow + rowOffset, columnIndex: startColumn + columnOffset, value, valueType: "TEXT" }); }));
    setValues((current) => ({ ...current, ...Object.fromEntries(cells.map((cell) => [keyOf(cell.rowIndex, cell.columnIndex), cell.value])) })); void saveCells(cells);
  }, [saveCells]);

  const applyResize = useCallback((target: ResizeTarget, size: number) => {
    if (target.axis === "column") {
      setColumnWidths((current) => current[target.index] === size ? current : current.map((value, index) => index === target.index ? size : value));
    } else {
      setRowHeights((current) => current[target.index] === size ? current : current.map((value, index) => index === target.index ? size : value));
    }
  }, []);

  useEffect(() => {
    const flushResize = () => {
      if (!pendingResizeRef.current) return;
      const { target, size } = pendingResizeRef.current;
      pendingResizeRef.current = null;
      resizeFrameRef.current = null;
      applyResize(target, size);
    };
    const onPointerMove = (event: PointerEvent) => {
      const target = resizeTargetRef.current;
      if (!target) return;
      const delta = (target.axis === "column" ? event.clientX : event.clientY) - target.start;
      const size = clamp(target.size + delta, target.axis === "column" ? MIN_COLUMN_WIDTH : MIN_ROW_HEIGHT, target.axis === "column" ? MAX_COLUMN_WIDTH : MAX_ROW_HEIGHT);
      pendingResizeRef.current = { target, size };
      if (resizeFrameRef.current === null) resizeFrameRef.current = window.requestAnimationFrame(flushResize);
    };
    const onPointerUp = () => {
      if (!resizeTargetRef.current) return;
      if (resizeFrameRef.current !== null) window.cancelAnimationFrame(resizeFrameRef.current);
      flushResize();
      resizeTargetRef.current = null;
      document.body.classList.remove("worksheet-resizing");
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      if (resizeFrameRef.current !== null) window.cancelAnimationFrame(resizeFrameRef.current);
      document.body.classList.remove("worksheet-resizing");
    };
  }, [applyResize]);

  const beginResize = useCallback((axis: ResizeTarget["axis"], index: number, event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    resizeTargetRef.current = {
      axis,
      index,
      start: axis === "column" ? event.clientX : event.clientY,
      size: axis === "column" ? columnWidths[index] : rowHeights[index]
    };
    document.body.classList.add("worksheet-resizing");
  }, [columnWidths, rowHeights]);

  const gridTemplateColumns = useMemo(() => `44px ${columnWidths.map((width) => `${width}px`).join(" ")}`, [columnWidths]);
  const gridTemplateRows = useMemo(() => `34px ${rowHeights.map((height) => `minmax(${height}px, auto)`).join(" ")}`, [rowHeights]);

  return <section className="worksheet-section">
    <div className="worksheet-toolbar">
      <label>Planilha do modelo<select value={modelTagId} onChange={(event) => setModelTagId(event.target.value)}>{rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label>
      <span className={`conn-badge ${connected ? "online" : "offline"}`}><Wifi size={14} /> {connected ? "Sincronizada" : "Reconectando"}</span>
    </div>
    {loading ? <div className="card skeleton-list"><div className="skeleton" /><div className="skeleton" /></div> : null}
    {!loading && !rooms.length ? <div className="card empty-hint">Você ainda não tem acesso à planilha de nenhum modelo.</div> : null}
    {sheet ? <div className="worksheet-frame" role="grid" aria-label="Planilha de personalizados. Use as alças nos cabeçalhos para redimensionar linhas e colunas.">
      <div className="worksheet-grid" style={{ gridTemplateColumns, gridTemplateRows }}>
        <div className="sheet-corner" />
        {Array.from({ length: MAX_COLUMNS }, (_, column) => <div className="sheet-column-header" key={`h-${column}`}>
          {columnName(column)}
          <button type="button" className="sheet-resize-handle column" aria-label={`Redimensionar coluna ${columnName(column)}`} onPointerDown={(event) => beginResize("column", column, event)} />
        </div>)}
        {Array.from({ length: MAX_ROWS }, (_, row) => <div className={`sheet-row ${row === 0 ? "sheet-row-first" : ""}`} key={`r-${row}`} style={{ display: "contents" }}>
          <div className="sheet-row-header">
            {row + 1}
            <button type="button" className="sheet-resize-handle row" aria-label={`Redimensionar linha ${row + 1}`} onPointerDown={(event) => beginResize("row", row, event)} />
          </div>
          {Array.from({ length: MAX_COLUMNS }, (_, column) => {
            const key = keyOf(row, column);
            return <WorksheetCell key={key} row={row} column={column} value={values[key] ?? ""} onCommit={commitCell} onPaste={paste} />;
          })}
        </div>)}
      </div>
    </div> : null}
  </section>;
};
