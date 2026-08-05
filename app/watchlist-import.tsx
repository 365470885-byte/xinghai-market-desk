"use client";

import { ChangeEvent, DragEvent, useCallback, useEffect, useRef, useState } from "react";

export type ImportedStock = { code: string; market: number; name: string };

type UploadItem = { id: string; file: File; previewUrl: string };
type ImportPhase = "select" | "recognizing" | "review";
type OcrWorker = { terminate: () => Promise<unknown> };

const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const STOCK_PREFIXES = [
  "000", "001", "002", "003", "300", "301", "600", "601", "603", "605", "688",
  "510", "511", "512", "513", "515", "516", "517", "518", "520", "560", "561", "562", "563", "588", "589",
];

const keyOf = (stock: ImportedStock) => `${stock.market}.${stock.code}`;
const validStockCode = (code: string) => code.length === 6 && STOCK_PREFIXES.some((prefix) => code.startsWith(prefix));

export function extractStockCodes(text: string) {
  const found: string[] = [];
  const seen = new Set<string>();
  const tokens = text.match(/\d{5,12}/g) || [];

  tokens.forEach((token) => {
    const normalized = token.length === 5 ? `0${token}` : token;
    const lastSix = normalized.slice(-6);
    let match = validStockCode(lastSix) ? lastSix : "";

    if (!match) {
      for (let index = 0; index <= normalized.length - 6; index += 1) {
        const candidate = normalized.slice(index, index + 6);
        if (validStockCode(candidate)) { match = candidate; break; }
      }
    }

    if (match && !seen.has(match)) {
      seen.add(match);
      found.push(match);
    }
  });

  return found;
}

async function loadImage(file: File) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("图片无法读取"));
      element.src = objectUrl;
    });
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function prepareStockCodeColumn(file: File) {
  const image = await loadImage(file);
  const sourceTop = Math.round(image.naturalHeight * 0.04);
  const sourceWidth = Math.max(1, Math.round(image.naturalWidth * 0.34));
  const sourceHeight = Math.max(1, image.naturalHeight - sourceTop);
  const scale = Math.min(3.2, Math.max(0.5, Math.min(480 / sourceWidth, 12_000 / sourceHeight)));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("当前浏览器无法处理图片");

  context.drawImage(image, 0, sourceTop, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let offset = 0; offset < pixels.data.length; offset += 4) {
    const luminance = pixels.data[offset] * 0.299 + pixels.data[offset + 1] * 0.587 + pixels.data[offset + 2] * 0.114;
    const tone = luminance < 185 ? 0 : 255;
    pixels.data[offset] = tone;
    pixels.data[offset + 1] = tone;
    pixels.data[offset + 2] = tone;
  }
  context.putImageData(pixels, 0, 0);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => result ? resolve(result) : reject(new Error("图片处理失败")), "image/png");
  });
  canvas.width = 1;
  canvas.height = 1;
  return blob;
}

async function resolveStocks(codes: string[]) {
  const resolved = new Map<string, ImportedStock>();
  for (let start = 0; start < codes.length; start += 6) {
    const batch = codes.slice(start, start + 6);
    const rows = await Promise.all(batch.map(async (code) => {
      try {
        const response = await fetch(`/api/market?action=search&q=${encodeURIComponent(code)}`);
        if (!response.ok) return null;
        const payload = await response.json();
        const exact = (payload.items || []).find((item: ImportedStock) => item.code === code && (item.market === 0 || item.market === 1));
        return exact || null;
      } catch { return null; }
    }));
    rows.forEach((stock) => { if (stock) resolved.set(stock.code, stock); });
  }
  return codes.map((code) => resolved.get(code)).filter((stock): stock is ImportedStock => Boolean(stock));
}

export function WatchlistImportDialog({
  open,
  groupLabel,
  onClose,
  onImport,
}: {
  open: boolean;
  groupLabel: string;
  onClose: () => void;
  onImport: (stocks: ImportedStock[]) => void;
}) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [phase, setPhase] = useState<ImportPhase>("select");
  const [message, setMessage] = useState("请选择同花顺自选股截图");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<ImportedStock[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const itemsRef = useRef<UploadItem[]>([]);
  const workerRef = useRef<OcrWorker | null>(null);
  const runRef = useRef(0);

  useEffect(() => { itemsRef.current = items; }, [items]);

  const clearItems = useCallback(() => {
    itemsRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    itemsRef.current = [];
    setItems([]);
  }, []);

  const reset = useCallback(() => {
    runRef.current += 1;
    workerRef.current?.terminate().catch(() => undefined);
    workerRef.current = null;
    clearItems();
    setPhase("select");
    setMessage("请选择同花顺自选股截图");
    setError("");
    setProgress(0);
    setResults([]);
    setSelected(new Set());
  }, [clearItems]);

  const closeDialog = useCallback(() => { reset(); onClose(); }, [onClose, reset]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => closeRef.current?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") closeDialog(); };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [closeDialog, open]);

  useEffect(() => () => {
    runRef.current += 1;
    workerRef.current?.terminate().catch(() => undefined);
    itemsRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
  }, []);

  if (!open) return null;

  const addFiles = (incoming: File[]) => {
    setError("");
    const existing = new Set(items.map((item) => `${item.file.name}:${item.file.size}:${item.file.lastModified}`));
    const valid = incoming.filter((file) => file.type.startsWith("image/") && file.size <= MAX_IMAGE_BYTES && !existing.has(`${file.name}:${file.size}:${file.lastModified}`));
    const capacity = MAX_IMAGES - items.length;
    const accepted = valid.slice(0, Math.max(0, capacity));
    if (incoming.some((file) => !file.type.startsWith("image/"))) setError("仅支持 JPG、PNG、WEBP 等图片格式");
    else if (incoming.some((file) => file.size > MAX_IMAGE_BYTES)) setError("单张图片不能超过 15MB");
    else if (valid.length > capacity) setError("最多上传 5 张图片，超出的图片未加入");
    if (!accepted.length) return;
    setItems((current) => [...current, ...accepted.map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}`,
      file,
      previewUrl: URL.createObjectURL(file),
    }))]);
    setPhase("select");
    setResults([]);
    setSelected(new Set());
    setMessage(`已选择 ${items.length + accepted.length} 张图片`);
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(event.target.files || []));
    event.target.value = "";
  };

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    addFiles(Array.from(event.dataTransfer.files || []));
  };

  const removeItem = (id: string) => {
    setItems((current) => {
      const target = current.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      const next = current.filter((item) => item.id !== id);
      setMessage(next.length ? `已选择 ${next.length} 张图片` : "请选择同花顺自选股截图");
      return next;
    });
    setError("");
  };

  const recognize = async () => {
    if (!items.length || phase === "recognizing") return;
    const runId = ++runRef.current;
    setPhase("recognizing");
    setError("");
    setProgress(0.02);
    setMessage("正在加载本地识别组件，首次使用需要一点时间");
    let worker: Awaited<ReturnType<(typeof import("tesseract.js"))["createWorker"]>> | null = null;

    try {
      const { createWorker, PSM } = await import("tesseract.js");
      if (runRef.current !== runId) return;
      worker = await createWorker("eng", 1, {
        logger: (status) => {
          if (runRef.current !== runId || typeof status.progress !== "number") return;
          setProgress((current) => Math.max(current, Math.min(0.92, current + status.progress * 0.006)));
        },
      });
      workerRef.current = worker;
      await worker.setParameters({
        tessedit_char_whitelist: "0123456789",
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      });

      const codes: string[] = [];
      const seen = new Set<string>();
      for (let index = 0; index < items.length; index += 1) {
        if (runRef.current !== runId) return;
        setMessage(`正在识别第 ${index + 1} / ${items.length} 张图片`);
        setProgress(0.08 + (index / items.length) * 0.7);
        const prepared = await prepareStockCodeColumn(items[index].file);
        const result = await worker.recognize(prepared);
        extractStockCodes(result.data.text).forEach((code) => {
          if (!seen.has(code)) { seen.add(code); codes.push(code); }
        });
      }

      if (!codes.length) throw new Error("没有识别到股票代码，请上传包含名称和六位代码的自选股截图");
      setMessage(`正在校验 ${codes.length} 个股票代码`);
      setProgress(0.86);
      const stocks = await resolveStocks(codes);
      if (runRef.current !== runId) return;
      if (!stocks.length) throw new Error("识别到了数字，但没有找到有效股票，请更换清晰截图后重试");
      setResults(stocks);
      setSelected(new Set(stocks.map(keyOf)));
      setPhase("review");
      setProgress(1);
      setMessage(`识别完成，共找到 ${stocks.length} 只股票`);
    } catch (recognitionError) {
      if (runRef.current === runId) {
        setPhase("select");
        setProgress(0);
        setError(recognitionError instanceof Error ? recognitionError.message : "识别失败，请检查网络后重试");
        setMessage("图片仍然保留，可以直接重试");
      }
    } finally {
      if (worker) await worker.terminate().catch(() => undefined);
      if (runRef.current === runId) workerRef.current = null;
    }
  };

  const toggleStock = (stock: ImportedStock) => {
    const key = keyOf(stock);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const confirmImport = () => {
    const chosen = results.filter((stock) => selected.has(keyOf(stock)));
    if (!chosen.length) { setError("请至少选择一只股票"); return; }
    onImport(chosen);
    reset();
  };

  return <div className="import-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && phase !== "recognizing") closeDialog(); }}>
    <section className="import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-title" aria-describedby="import-description">
      <header className="import-header">
        <div><strong id="import-title">从截图导入股票</strong><span id="import-description">识别后加入“{groupLabel}”，最多上传 5 张</span></div>
        <button ref={closeRef} type="button" className="import-close" onClick={closeDialog} aria-label="关闭截图导入">×</button>
      </header>

      <div className="import-body">
        <label className={`import-dropzone ${phase === "recognizing" ? "disabled" : ""}`} onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
          <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={onFileChange} disabled={phase === "recognizing" || items.length >= MAX_IMAGES} />
          <span className="import-mark" aria-hidden="true">＋</span>
          <strong>{items.length >= MAX_IMAGES ? "已达到 5 张上限" : "选择或拖入同花顺截图"}</strong>
          <small>建议使用完整长截图；图片只在本机识别，不会上传服务器</small>
        </label>

        {items.length > 0 && <div className="import-previews" aria-label={`已选择 ${items.length} 张图片`}>
          {items.map((item, index) => <div className="import-preview" key={item.id}>
            {/* Blob previews are local-only and cannot use the Next image optimizer. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.previewUrl} alt={`待识别截图 ${index + 1}`} />
            <span>{index + 1}</span>
            <button type="button" onClick={() => removeItem(item.id)} disabled={phase === "recognizing"} aria-label={`移除第 ${index + 1} 张截图`}>×</button>
          </div>)}
          {items.length < MAX_IMAGES && phase !== "recognizing" && <button type="button" className="import-add-more" onClick={() => inputRef.current?.click()}>继续添加<small>{items.length} / {MAX_IMAGES}</small></button>}
        </div>}

        <div className={`import-status ${error ? "error" : ""}`} role="status" aria-live="polite">
          <span>{error || message}</span>
          {phase === "recognizing" && <div className="import-progress" aria-label="识别进度"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>}
        </div>

        {phase === "review" && <div className="import-review">
          <div className="import-review-head"><strong>识别结果</strong><button type="button" onClick={() => setSelected((current) => current.size === results.length ? new Set() : new Set(results.map(keyOf)))}>{selected.size === results.length ? "取消全选" : "全部选择"}</button></div>
          <div className="import-results">
            {results.map((stock) => {
              const key = keyOf(stock);
              return <label key={key} className={selected.has(key) ? "selected" : ""}>
                <input type="checkbox" checked={selected.has(key)} onChange={() => toggleStock(stock)} />
                <span><strong>{stock.name}</strong><small>{stock.code}</small></span>
              </label>;
            })}
          </div>
        </div>}
      </div>

      <footer className="import-footer">
        <button type="button" className="secondary" onClick={closeDialog} disabled={phase === "recognizing"}>取消</button>
        {phase === "review"
          ? <button type="button" className="primary" onClick={confirmImport}>加入 {groupLabel}（{selected.size}）</button>
          : <button type="button" className="primary" onClick={recognize} disabled={!items.length || phase === "recognizing"}>{phase === "recognizing" ? "正在识别…" : "开始识别"}</button>}
      </footer>
    </section>
  </div>;
}
