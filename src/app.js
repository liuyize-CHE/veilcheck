import { detectOcrWords, detectSensitiveText, redactText } from "./detectors.js";
import * as pdfjsLib from "/vendor/pdfjs/pdf.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.mjs";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const state = {
  image: null,
  sourceCanvas: null,
  fileName: "",
  boxes: [],
  selectedIndex: -1,
  interaction: null,
  draftBox: null,
  manualMode: false,
  undoStack: [],
  redoStack: [],
  lastOutput: null,
  fileType: "image",
  pdfDocument: null,
  pdfPages: [],
  pdfPageNumber: 1,
  pdfRenderScale: 1
};
const canvas = $("#image-canvas");
const context = canvas.getContext("2d");

function parseKeywords(value) {
  return [...new Set(value.split(/[,，、;；\n]/).map((item) => item.trim()).filter(Boolean))].slice(0, 20);
}

function cloneBoxes(boxes = state.boxes) {
  return boxes.map((box) => ({ ...box }));
}

function sameBoxes(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function updateHistoryButtons() {
  $("#undo-boxes").disabled = !state.undoStack.length;
  $("#redo-boxes").disabled = !state.redoStack.length;
}

function syncCurrentPdfBoxes() {
  if (state.fileType === "pdf" && state.pdfPages.length) {
    state.pdfPages[state.pdfPageNumber - 1] = cloneBoxes();
  }
}

function invalidateOutput() {
  if (state.lastOutput?.url) URL.revokeObjectURL(state.lastOutput.url);
  if (state.lastOutput?.previewUrl) URL.revokeObjectURL(state.lastOutput.previewUrl);
  state.lastOutput = null;
  $("#output-review")?.classList.add("hidden");
}

function commitBoxes(previousBoxes) {
  if (sameBoxes(previousBoxes, state.boxes)) return;
  state.undoStack.push(previousBoxes);
  if (state.undoStack.length > 50) state.undoStack.shift();
  state.redoStack = [];
  syncCurrentPdfBoxes();
  invalidateOutput();
  updateHistoryButtons();
}

function restoreBoxes(boxes) {
  state.boxes = cloneBoxes(boxes);
  syncCurrentPdfBoxes();
  state.selectedIndex = -1;
  invalidateOutput();
  render();
  renderFindings();
  updateHistoryButtons();
}

function undoBoxes() {
  if (!state.undoStack.length) return;
  state.redoStack.push(cloneBoxes());
  restoreBoxes(state.undoStack.pop());
}

function redoBoxes() {
  if (!state.redoStack.length) return;
  state.undoStack.push(cloneBoxes());
  restoreBoxes(state.redoStack.pop());
}

$$('.tab').forEach((tab) => tab.addEventListener('click', () => {
  $$('.tab').forEach((item) => item.classList.toggle('active', item === tab));
  $$('.mode-panel').forEach((panel) => panel.classList.toggle('active', panel.id === `${tab.dataset.mode}-mode`));
}));

function loadImage(file) {
  if (!file?.type?.startsWith("image/")) return;
  invalidateOutput();
  state.pdfDocument?.destroy();
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    URL.revokeObjectURL(url);
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = image.naturalWidth;
    sourceCanvas.height = image.naturalHeight;
    sourceCanvas.getContext("2d").drawImage(image, 0, 0);
    Object.assign(state, {
      image,
      sourceCanvas,
      fileName: file.name || "clipboard-image.png",
      boxes: [],
      selectedIndex: -1,
      interaction: null,
      draftBox: null,
      undoStack: [],
      redoStack: [],
      lastOutput: null,
      fileType: "image",
      pdfDocument: null,
      pdfPages: [],
      pdfPageNumber: 1,
      pdfRenderScale: 1
    });
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    $("#file-name").textContent = state.fileName;
    $("#image-status").textContent = `${image.naturalWidth} × ${image.naturalHeight} · 点击右侧开始检查`;
    $("#drop-zone").classList.add("hidden");
    $("#image-editor").classList.remove("hidden");
    $("#pdf-toolbar").classList.add("hidden");
    $("#export-image").textContent = "生成并预览安全副本";
    render();
    renderFindings();
    updateHistoryButtons();
  };
  image.src = url;
}

function canvasToImage(sourceCanvas) {
  return new Promise((resolve, reject) => {
    sourceCanvas.toBlob((blob) => {
      if (!blob) return reject(new Error("页面图像生成失败"));
      const url = URL.createObjectURL(blob);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = reject;
      image.src = url;
    }, "image/png");
  });
}

async function renderPdfPage(pageNumber) {
  if (!state.pdfDocument) return;
  syncCurrentPdfBoxes();
  const previousStatus = $("#image-status").textContent;
  $("#image-status").textContent = `正在渲染第 ${pageNumber} 页…`;
  $("#run-ocr").disabled = true;
  $("#pdf-prev").disabled = true;
  $("#pdf-next").disabled = true;
  try {
    const page = await state.pdfDocument.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = Math.min(2, 2200 / Math.max(baseViewport.width, baseViewport.height));
    const viewport = page.getViewport({ scale });
    const pageCanvas = document.createElement("canvas");
    pageCanvas.width = Math.ceil(viewport.width);
    pageCanvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: pageCanvas.getContext("2d", { alpha: false }), viewport }).promise;
    state.image = await canvasToImage(pageCanvas);
    state.sourceCanvas = pageCanvas;
    state.pdfPageNumber = pageNumber;
    state.pdfRenderScale = scale;
    state.boxes = cloneBoxes(state.pdfPages[pageNumber - 1] || []);
    state.selectedIndex = -1;
    state.interaction = null;
    state.draftBox = null;
    state.undoStack = [];
    state.redoStack = [];
    canvas.width = pageCanvas.width;
    canvas.height = pageCanvas.height;
    $("#pdf-page-label").textContent = `第 ${pageNumber} / ${state.pdfDocument.numPages} 页`;
    $("#image-status").textContent = `PDF · 第 ${pageNumber} 页 · ${pageCanvas.width} × ${pageCanvas.height} · 点击开始检查`;
    render();
    renderFindings();
    updateHistoryButtons();
  } catch (error) {
    console.error(error);
    $("#image-status").textContent = previousStatus;
    alert("PDF 页面渲染失败，请尝试重新选择文件。");
  } finally {
    $("#pdf-prev").disabled = pageNumber <= 1;
    $("#pdf-next").disabled = pageNumber >= state.pdfDocument.numPages;
    $("#run-ocr").disabled = !state.image;
  }
}

async function loadPdf(file) {
  if (!file || (file.type !== "application/pdf" && !file.name?.toLowerCase().endsWith(".pdf"))) return;
  invalidateOutput();
  state.pdfDocument?.destroy();
  $("#drop-zone").classList.add("hidden");
  $("#image-editor").classList.remove("hidden");
  $("#pdf-toolbar").classList.remove("hidden");
  $("#file-name").textContent = file.name;
  $("#image-status").textContent = "正在本地读取 PDF…";
  $("#pdf-page-label").textContent = "正在读取…";
  $("#run-ocr").disabled = true;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdfDocument = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
    Object.assign(state, {
      image: null,
      sourceCanvas: null,
      fileName: file.name || "document.pdf",
      boxes: [],
      selectedIndex: -1,
      interaction: null,
      draftBox: null,
      undoStack: [],
      redoStack: [],
      lastOutput: null,
      fileType: "pdf",
      pdfDocument,
      pdfPages: Array.from({ length: pdfDocument.numPages }, () => []),
      pdfPageNumber: 1,
      pdfRenderScale: 1
    });
    $("#export-image").textContent = "生成并预览安全 PDF";
    await renderPdfPage(1);
  } catch (error) {
    console.error(error);
    alert("无法打开这个 PDF。文件可能已损坏、加密或使用了暂不支持的格式。");
    resetImage();
  }
}

function loadFile(file) {
  if (file?.type === "application/pdf" || file?.name?.toLowerCase().endsWith(".pdf")) loadPdf(file);
  else loadImage(file);
}

function render() {
  if (!state.image) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(state.image, 0, 0);
  state.boxes.forEach((box, index) => drawEditorBox(box, index === state.selectedIndex));
  if (state.draftBox) drawEditorBox(state.draftBox, true);
}

function handleSize() {
  return Math.max(7, canvas.width / 120);
}

function boxHandles(box) {
  return {
    nw: { x: box.x, y: box.y },
    ne: { x: box.x + box.width, y: box.y },
    sw: { x: box.x, y: box.y + box.height },
    se: { x: box.x + box.width, y: box.y + box.height }
  };
}

function drawEditorBox(box, selected) {
    context.save();
    context.fillStyle = selected ? "rgba(84, 211, 255, .18)" : "rgba(201, 255, 98, .18)";
    context.strokeStyle = selected ? "#54d3ff" : "#c9ff62";
    context.lineWidth = Math.max(2, canvas.width / 700);
    context.setLineDash(selected ? [] : [8, 6]);
    context.fillRect(box.x, box.y, box.width, box.height);
    context.strokeRect(box.x, box.y, box.width, box.height);
    if (selected) {
      const size = handleSize();
      context.fillStyle = "#f4f7fb";
      context.strokeStyle = "#087ca5";
      context.lineWidth = Math.max(1, canvas.width / 1200);
      for (const point of Object.values(boxHandles(box))) {
        context.beginPath();
        context.rect(point.x - size / 2, point.y - size / 2, size, size);
        context.fill();
        context.stroke();
      }
    }
    context.restore();
}

function maskValue(value) {
  if (value.length <= 4) return "•".repeat(value.length);
  return `${value.slice(0, 2)}${"•".repeat(Math.min(8, value.length - 4))}${value.slice(-2)}`;
}

function setExportVerification(message, tone) {
  const verification = $("#export-verification");
  verification.textContent = message;
  verification.className = `verification ${tone}`;
}

function renderFindings() {
  const list = $("#findings-list");
  $("#finding-count").textContent = String(state.boxes.length);
  const totalBoxes = state.fileType === "pdf"
    ? state.pdfPages.reduce((total, boxes) => total + boxes.length, 0)
    : state.boxes.length;
  $("#export-image").disabled = !totalBoxes;
  if (!state.lastOutput) setExportVerification(state.boxes.length ? "待生成并验证安全副本" : "尚未生成安全副本", "neutral");
  if (!state.boxes.length) {
    list.className = "findings-list empty-state";
    list.textContent = "扫描后，敏感信息会显示在这里。你也可以直接在图片上拖动画框。";
    return;
  }
  list.className = "findings-list";
  list.replaceChildren(...state.boxes.map((box, index) => {
    const item = document.createElement("article");
    item.className = `finding${index === state.selectedIndex ? " selected" : ""}`;
    item.dataset.x = String(box.x);
    item.dataset.y = String(box.y);
    item.dataset.width = String(box.width);
    item.dataset.height = String(box.height);
    item.addEventListener("click", () => {
      state.selectedIndex = index;
      render();
      renderFindings();
    });
    const title = document.createElement("strong");
    title.textContent = box.type || "手动遮挡";
    const detail = document.createElement("small");
    detail.textContent = box.value ? `${maskValue(box.value)} · 置信度 ${box.confidence || "—"}%` : `${Math.round(box.width)} × ${Math.round(box.height)} px`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.setAttribute("aria-label", `删除${title.textContent}`);
    remove.textContent = "×";
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      const previous = cloneBoxes();
      state.boxes.splice(index, 1);
      state.selectedIndex = -1;
      commitBoxes(previous);
      render();
      renderFindings();
    });
    item.append(title, detail, remove);
    return item;
  }));
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(canvas.width, (event.clientX - rect.left) * canvas.width / rect.width)),
    y: Math.max(0, Math.min(canvas.height, (event.clientY - rect.top) * canvas.height / rect.height))
  };
}

function hitHandle(point, box) {
  const radius = handleSize() * 1.2;
  for (const [name, handle] of Object.entries(boxHandles(box))) {
    if (Math.abs(point.x - handle.x) <= radius && Math.abs(point.y - handle.y) <= radius) return name;
  }
  return null;
}

function hitBox(point) {
  for (let index = state.boxes.length - 1; index >= 0; index -= 1) {
    const box = state.boxes[index];
    if (point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height) return index;
  }
  return -1;
}

function resizedBox(origin, handle, dx, dy) {
  let left = origin.x;
  let top = origin.y;
  let right = origin.x + origin.width;
  let bottom = origin.y + origin.height;
  if (handle.includes("w")) left = Math.min(right - 8, Math.max(0, left + dx));
  if (handle.includes("e")) right = Math.max(left + 8, Math.min(canvas.width, right + dx));
  if (handle.includes("n")) top = Math.min(bottom - 8, Math.max(0, top + dy));
  if (handle.includes("s")) bottom = Math.max(top + 8, Math.min(canvas.height, bottom + dy));
  return { ...origin, x: left, y: top, width: right - left, height: bottom - top };
}

canvas.addEventListener("pointerdown", (event) => {
  if (!state.image) return;
  const point = canvasPoint(event);
  canvas.setPointerCapture(event.pointerId);
  if (state.manualMode) {
    state.interaction = { mode: "draw", start: point, before: cloneBoxes() };
    state.draftBox = { x: point.x, y: point.y, width: 0, height: 0, type: "手动遮挡" };
    return;
  }
  const selected = state.boxes[state.selectedIndex];
  const handle = selected ? hitHandle(point, selected) : null;
  if (handle) {
    state.interaction = { mode: "resize", start: point, origin: { ...selected }, handle, before: cloneBoxes() };
    return;
  }
  const index = hitBox(point);
  state.selectedIndex = index;
  if (index >= 0) state.interaction = { mode: "move", start: point, origin: { ...state.boxes[index] }, before: cloneBoxes() };
  render();
  renderFindings();
});

canvas.addEventListener("pointermove", (event) => {
  const point = canvasPoint(event);
  if (!state.interaction) {
    if (state.manualMode) canvas.style.cursor = "crosshair";
    else {
      const selected = state.boxes[state.selectedIndex];
      const handle = selected ? hitHandle(point, selected) : null;
      canvas.style.cursor = handle === "nw" || handle === "se" ? "nwse-resize"
        : handle === "ne" || handle === "sw" ? "nesw-resize"
        : hitBox(point) >= 0 ? "move" : "default";
    }
    return;
  }
  const { mode, start } = state.interaction;
  const dx = point.x - start.x;
  const dy = point.y - start.y;
  if (mode === "draw") {
    state.draftBox = {
      x: Math.min(start.x, point.x), y: Math.min(start.y, point.y),
      width: Math.abs(point.x - start.x), height: Math.abs(point.y - start.y), type: "手动遮挡"
    };
  } else if (mode === "move") {
    const origin = state.interaction.origin;
    state.boxes[state.selectedIndex] = {
      ...origin,
      x: Math.max(0, Math.min(canvas.width - origin.width, origin.x + dx)),
      y: Math.max(0, Math.min(canvas.height - origin.height, origin.y + dy))
    };
  } else if (mode === "resize") {
    state.boxes[state.selectedIndex] = resizedBox(state.interaction.origin, state.interaction.handle, dx, dy);
  }
  render();
});

function finishPointerInteraction() {
  if (!state.interaction) return;
  const { mode, before } = state.interaction;
  if (mode === "draw" && state.draftBox?.width > 5 && state.draftBox?.height > 5) {
    state.boxes.push(state.draftBox);
    state.selectedIndex = state.boxes.length - 1;
  }
  state.draftBox = null;
  state.interaction = null;
  commitBoxes(before);
  render();
  renderFindings();
}

canvas.addEventListener("pointerup", finishPointerInteraction);
canvas.addEventListener("pointercancel", finishPointerInteraction);

$("#add-box").addEventListener("click", () => {
  state.manualMode = !state.manualMode;
  state.selectedIndex = -1;
  $("#add-box").textContent = state.manualMode ? "完成画框" : "手动画框";
  $("#add-box").classList.toggle("primary", state.manualMode);
  canvas.style.cursor = state.manualMode ? "crosshair" : "default";
  render();
  renderFindings();
});

$("#pick-image").addEventListener("click", (event) => { event.stopPropagation(); $("#image-input").click(); });
$("#image-input").addEventListener("change", (event) => loadFile(event.target.files[0]));
$("#drop-zone").addEventListener("click", () => $("#image-input").click());
$("#drop-zone").addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") $("#image-input").click(); });
$("#drop-zone").addEventListener("dragover", (event) => { event.preventDefault(); $("#drop-zone").classList.add("dragover"); });
$("#drop-zone").addEventListener("dragleave", () => $("#drop-zone").classList.remove("dragover"));
$("#drop-zone").addEventListener("drop", (event) => { event.preventDefault(); $("#drop-zone").classList.remove("dragover"); loadFile(event.dataTransfer.files[0]); });
document.addEventListener("paste", (event) => {
  const item = [...(event.clipboardData?.items || [])].find((entry) => entry.type.startsWith("image/"));
  if (item) loadImage(item.getAsFile());
});

function resetImage() {
  invalidateOutput();
  state.pdfDocument?.destroy();
  Object.assign(state, {
    image: null, sourceCanvas: null, boxes: [], manualMode: false, selectedIndex: -1,
    interaction: null, draftBox: null, undoStack: [], redoStack: [], lastOutput: null,
    fileType: "image", pdfDocument: null, pdfPages: [], pdfPageNumber: 1, pdfRenderScale: 1
  });
  $("#add-box").textContent = "手动画框";
  $("#add-box").classList.remove("primary");
  $("#image-input").value = "";
  $("#image-editor").classList.add("hidden");
  $("#pdf-toolbar").classList.add("hidden");
  $("#drop-zone").classList.remove("hidden");
  setExportVerification("尚未生成安全副本", "neutral");
  updateHistoryButtons();
}

$("#pdf-prev").addEventListener("click", () => renderPdfPage(state.pdfPageNumber - 1));
$("#pdf-next").addEventListener("click", () => renderPdfPage(state.pdfPageNumber + 1));

$("#reset-image").addEventListener("click", resetImage);
$("#clear-boxes").addEventListener("click", () => {
  if (!state.boxes.length) return;
  const previous = cloneBoxes();
  state.boxes = [];
  state.selectedIndex = -1;
  commitBoxes(previous);
  render();
  renderFindings();
});
$("#undo-boxes").addEventListener("click", undoBoxes);
$("#redo-boxes").addEventListener("click", redoBoxes);

document.addEventListener("keydown", (event) => {
  const editingText = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !editingText) {
    event.preventDefault();
    event.shiftKey ? redoBoxes() : undoBoxes();
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y" && !editingText) {
    event.preventDefault();
    redoBoxes();
  } else if ((event.key === "Delete" || event.key === "Backspace") && !editingText && state.selectedIndex >= 0) {
    event.preventDefault();
    const previous = cloneBoxes();
    state.boxes.splice(state.selectedIndex, 1);
    state.selectedIndex = -1;
    commitBoxes(previous);
    render();
    renderFindings();
  } else if (event.key === "Escape") {
    state.selectedIndex = -1;
    state.manualMode = false;
    $("#add-box").textContent = "手动画框";
    $("#add-box").classList.remove("primary");
    render();
    renderFindings();
  }
});

function selectedStyle() {
  return $('input[name="redaction-style"]:checked').value;
}

function strengthLabel(value) {
  if (value >= 90) return "极强";
  if (value >= 70) return "强";
  if (value >= 45) return "中";
  return "弱";
}

function updateStyleControls() {
  invalidateOutput();
  const style = selectedStyle();
  const adjustable = style === "pixelate" || style === "blur";
  $("#effect-controls").classList.toggle("hidden", !adjustable);
  $(".color-control").classList.toggle("hidden", style !== "solid");
  if (style === "pixelate") setExportVerification("马赛克已默认设为强；仍可能保留可推断特征，不适合最高敏感信息。", "warning");
  else if (style === "blur") setExportVerification("模糊可能被增强或推断，仅用于低敏内容。", "warning");
  else if (style === "label") setExportVerification("隐私标签使用不透明底层覆盖，导出时会验证写入。", "neutral");
  else setExportVerification("实心遮挡安全级别最高，导出时会验证写入。", "neutral");
}

$$('input[name="redaction-style"]').forEach((input) => input.addEventListener("change", updateStyleControls));
$("#effect-strength").addEventListener("input", (event) => {
  invalidateOutput();
  $("#strength-label").textContent = strengthLabel(Number(event.target.value));
  setExportVerification("效果参数已改变，请重新生成安全副本。", "neutral");
});
$("#redaction-color").addEventListener("input", () => {
  invalidateOutput();
  setExportVerification("实色颜色已改变，请重新生成安全副本。", "neutral");
});
updateStyleControls();

function intersectionOverUnion(left, right) {
  const x0 = Math.max(left.x, right.x);
  const y0 = Math.max(left.y, right.y);
  const x1 = Math.min(left.x + left.width, right.x + right.width);
  const y1 = Math.min(left.y + left.height, right.y + right.height);
  const intersection = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const union = left.width * left.height + right.width * right.height - intersection;
  return union > 0 ? intersection / union : 0;
}

function intersectionOverSmaller(left, right) {
  const width = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const height = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  const smaller = Math.min(left.width * left.height, right.width * right.height);
  return smaller > 0 ? (width * height) / smaller : 0;
}

function comparableValue(value) {
  return String(value || "").toUpperCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function uniqueNewBoxes(candidates) {
  const accepted = [];
  for (const candidate of candidates) {
    const duplicate = [...state.boxes, ...accepted].some((box) => {
      const leftValue = comparableValue(box.value);
      const rightValue = comparableValue(candidate.value);
      const sameValue = leftValue.length >= 4 && rightValue.length >= 4 &&
        (leftValue === rightValue || leftValue.includes(rightValue) || rightValue.includes(leftValue));
      return intersectionOverUnion(box, candidate) > 0.35 ||
        intersectionOverSmaller(box, candidate) > 0.6 ||
        (box.label === candidate.label && sameValue);
    });
    if (!duplicate) accepted.push(candidate);
  }
  return accepted;
}

function flattenOcrWords(result) {
  return result.data.blocks?.flatMap((block, blockIndex) =>
    block.paragraphs.flatMap((paragraph, paragraphIndex) =>
      paragraph.lines.flatMap((line, lineIndex) => line.words.map((word) => ({
        ...word, block_num: blockIndex, par_num: paragraphIndex, line_num: lineIndex
      })))
    )
  ) || [];
}

async function createLocalOcrWorker(logger = () => {}) {
  const worker = await Tesseract.createWorker(["chi_sim", "eng"], 1, {
    workerPath: "/node_modules/tesseract.js/dist/worker.min.js",
    corePath: "/node_modules/tesseract.js-core",
    langPath: "/vendor/lang",
    logger
  });
  await worker.setParameters({ preserve_interword_spaces: "1" });
  return worker;
}

async function detectBarcodes(source) {
  if (!("BarcodeDetector" in globalThis)) return [];
  try {
    const supported = await BarcodeDetector.getSupportedFormats?.() || [];
    const wanted = ["qr_code", "data_matrix", "pdf417", "aztec", "code_128"];
    const formats = wanted.filter((format) => supported.includes(format));
    const detector = formats.length ? new BarcodeDetector({ formats }) : new BarcodeDetector();
    const results = await detector.detect(source);
    return results.map((item) => ({
      x0: item.boundingBox.x,
      y0: item.boundingBox.y,
      x1: item.boundingBox.x + item.boundingBox.width,
      y1: item.boundingBox.y + item.boundingBox.height,
      type: "二维码 / 条码",
      label: "BARCODE",
      value: item.rawValue || "包含机器可读数据",
      confidence: 100,
      noPadding: true
    }));
  } catch (error) {
    console.warn("Barcode detection unavailable", error);
    return [];
  }
}

const barcodeCapability = $("#barcode-capability");
if ("BarcodeDetector" in globalThis) {
  barcodeCapability.textContent = "支持二维码 / 条码本地检测";
  barcodeCapability.classList.add("supported");
} else {
  barcodeCapability.textContent = "当前浏览器不支持二维码自动检测，可使用手动画框";
}

$("#run-ocr").addEventListener("click", async () => {
  if (!state.image || !globalThis.Tesseract) return;
  $("#scan-overlay").classList.remove("hidden");
  $("#run-ocr").disabled = true;
  $("#image-status").textContent = "正在本地扫描";
  let worker;
  try {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(state.image, 0, 0);
    worker = await createLocalOcrWorker((message) => {
        $("#scan-progress").textContent = typeof message.progress === "number"
          ? `${message.status} · ${Math.round(message.progress * 100)}%`
          : message.status || "处理中";
    });
    const result = await worker.recognize(canvas, {}, { blocks: true });
    const words = flattenOcrWords(result);
    const regions = detectOcrWords(words, { customKeywords: parseKeywords($("#image-custom-keywords").value) });
    const barcodeRegions = await detectBarcodes(state.image);
    const candidateBoxes = [...regions, ...barcodeRegions].map((item) => {
      const sourceHeight = Math.max(1, item.y1 - item.y0);
      const padLeft = item.noPadding ? 0 : Math.max(12, sourceHeight * 0.9);
      const padRight = item.noPadding ? 0 : item.contextual
        ? Math.max(32, sourceHeight * 7)
        : padLeft;
      const padY = item.noPadding ? 0 : Math.max(6, sourceHeight * 0.24);
      const x = Math.max(0, item.x0 - padLeft);
      const y = Math.max(0, item.y0 - padY);
      return {
        ...item, x, y,
        width: Math.min(canvas.width - x, item.x1 - item.x0 + padLeft + padRight),
        height: Math.min(canvas.height - y, item.y1 - item.y0 + padY * 2)
      };
    });
    const additions = uniqueNewBoxes(candidateBoxes);
    if (additions.length) {
      const previous = cloneBoxes();
      state.boxes.push(...additions);
      commitBoxes(previous);
    }
    const skipped = candidateBoxes.length - additions.length;
    $("#image-status").textContent = additions.length
      ? `新增 ${additions.length} 项${skipped ? `，跳过 ${skipped} 项重复结果` : ""}，请人工复核`
      : candidateBoxes.length ? `未新增结果，已跳过 ${skipped} 项重复检测` : "未发现明确敏感信息，仍需人工检查";
    render();
    renderFindings();
  } catch (error) {
    console.error(error);
    $("#image-status").textContent = "扫描失败，可继续手动画框";
    alert("本地 OCR 启动失败。请确认依赖已完整安装，或使用手动画框完成处理。");
  } finally {
    if (worker) await worker.terminate();
    render();
    $("#scan-overlay").classList.add("hidden");
    $("#run-ocr").disabled = false;
  }
});

function fillBoxes(ctx, boxes, color) {
  ctx.save();
  ctx.fillStyle = color;
  for (const box of boxes) ctx.fillRect(box.x, box.y, box.width, box.height);
  ctx.restore();
}

function hexRgb(hex) {
  const value = hex.replace("#", "");
  return [Number.parseInt(value.slice(0, 2), 16), Number.parseInt(value.slice(2, 4), 16), Number.parseInt(value.slice(4, 6), 16)];
}

function verifyOpaqueRedactions(ctx, boxes, color) {
  const expected = hexRgb(color);
  return boxes.every((box) => {
    const left = Math.max(0, Math.ceil(box.x));
    const top = Math.max(0, Math.ceil(box.y));
    const right = Math.min(ctx.canvas.width - 1, Math.floor(box.x + box.width - 1));
    const bottom = Math.min(ctx.canvas.height - 1, Math.floor(box.y + box.height - 1));
    if (right < left || bottom < top) return false;
    const samples = [[left, top], [right, top], [left, bottom], [right, bottom], [Math.floor((left + right) / 2), Math.floor((top + bottom) / 2)]];
    return samples.every(([x, y]) => {
      const [red, green, blue, alpha] = ctx.getImageData(x, y, 1, 1).data;
      return red === expected[0] && green === expected[1] && blue === expected[2] && alpha === 255;
    });
  });
}

function decorateLabels(ctx, boxes) {
  for (const box of boxes) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.width, box.height);
    ctx.clip();
    ctx.strokeStyle = "rgba(255,255,255,.18)";
    ctx.lineWidth = Math.max(1, Math.min(box.width, box.height) / 18);
    for (let offset = -box.height; offset < box.width; offset += Math.max(10, box.height / 4)) {
      ctx.beginPath();
      ctx.moveTo(box.x + offset, box.y + box.height);
      ctx.lineTo(box.x + offset + box.height, box.y);
      ctx.stroke();
    }
    if (box.width > 54 && box.height > 20) {
      const fontSize = Math.max(10, Math.min(20, box.height * 0.34, box.width / 5));
      ctx.fillStyle = "#ffffff";
      ctx.font = `700 ${fontSize}px "Microsoft YaHei", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("已隐藏", box.x + box.width / 2, box.y + box.height / 2);
    }
    ctx.restore();
  }
}

function pixelate(ctx, box, strength) {
  const ratio = 0.12 + (strength / 100) * 0.38;
  const blockSize = Math.max(4, Math.floor(Math.min(box.width, box.height) * ratio));
  const temp = document.createElement("canvas");
  temp.width = Math.max(1, Math.ceil(box.width / blockSize));
  temp.height = Math.max(1, Math.ceil(box.height / blockSize));
  const tempContext = temp.getContext("2d");
  tempContext.imageSmoothingEnabled = false;
  tempContext.drawImage(ctx.canvas, box.x, box.y, box.width, box.height, 0, 0, temp.width, temp.height);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(temp, 0, 0, temp.width, temp.height, box.x, box.y, box.width, box.height);
  ctx.restore();
}

function blurRegion(ctx, box, strength) {
  const scale = Math.max(0.02, 0.12 - strength / 1000);
  const temp = document.createElement("canvas");
  temp.width = Math.max(1, Math.ceil(box.width * scale));
  temp.height = Math.max(1, Math.ceil(box.height * scale));
  const tempContext = temp.getContext("2d");
  tempContext.drawImage(ctx.canvas, box.x, box.y, box.width, box.height, 0, 0, temp.width, temp.height);
  const pixels = tempContext.getImageData(0, 0, temp.width, temp.height).data;
  let red = 0, green = 0, blue = 0;
  const pixelCount = Math.max(1, pixels.length / 4);
  for (let index = 0; index < pixels.length; index += 4) {
    red += pixels[index]; green += pixels[index + 1]; blue += pixels[index + 2];
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.width, box.height);
  ctx.clip();
  ctx.fillStyle = `rgb(${Math.round(red / pixelCount)}, ${Math.round(green / pixelCount)}, ${Math.round(blue / pixelCount)})`;
  ctx.fillRect(box.x, box.y, box.width, box.height);
  ctx.filter = `blur(${Math.max(6, strength / 2)}px)`;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(temp, 0, 0, temp.width, temp.height, box.x, box.y, box.width, box.height);
  ctx.restore();
}

function canvasToBlob(sourceCanvas, type = "image/png") {
  return new Promise((resolve, reject) => sourceCanvas.toBlob((blob) => {
    if (blob) resolve(blob);
    else reject(new Error("无法生成输出文件"));
  }, type));
}

function applyRedactions(outputContext, boxes, style, strength, opaqueColor) {
  if (style === "solid" || style === "label") {
    fillBoxes(outputContext, boxes, opaqueColor);
    if (!verifyOpaqueRedactions(outputContext, boxes, opaqueColor)) return false;
    if (style === "label") decorateLabels(outputContext, boxes);
  } else if (style === "pixelate") {
    for (const box of boxes) pixelate(outputContext, box, strength);
  } else {
    for (const box of boxes) blurRegion(outputContext, box, strength);
  }
  return true;
}

async function renderPdfSourcePage(pageNumber) {
  const page = await state.pdfDocument.getPage(pageNumber);
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = Math.min(2, 2200 / Math.max(baseViewport.width, baseViewport.height));
  const viewport = page.getViewport({ scale });
  const pageCanvas = document.createElement("canvas");
  pageCanvas.width = Math.ceil(viewport.width);
  pageCanvas.height = Math.ceil(viewport.height);
  await page.render({ canvasContext: pageCanvas.getContext("2d", { alpha: false }), viewport }).promise;
  return { pageCanvas, baseViewport };
}

async function showGeneratedOutput({ blob, previewCanvas, fileName, style, strength, format, totalBoxes, pdfBytes = null }) {
  invalidateOutput();
  const url = URL.createObjectURL(blob);
  const previewBlob = await canvasToBlob(previewCanvas);
  const previewUrl = URL.createObjectURL(previewBlob);
  state.lastOutput = {
    blob, url, previewUrl, canvas: previewCanvas, fileName, style, strength,
    format, pdfBytes, totalBoxes, recheck: null
  };
  $("#output-preview").src = previewUrl;
  const pageMeta = format === "pdf" ? `${state.pdfDocument.numPages} 页 · ` : `${previewCanvas.width} × ${previewCanvas.height} · `;
  $("#output-meta").textContent = `${pageMeta}${(blob.size / 1024).toFixed(1)} KB`;
  $("#output-review").classList.remove("hidden");
  const recheckResult = $("#recheck-result");
  recheckResult.textContent = "尚未执行二次复检";
  recheckResult.className = "recheck-result neutral";
  if (style === "solid" || style === "label") {
    setExportVerification(`已验证 ${totalBoxes} 个区域使用不透明像素覆盖；仍请人工复核预览。`, "success");
  } else {
    const effectName = style === "pixelate" ? "马赛克" : "模糊";
    setExportVerification(`已生成${effectName}副本（强度：${strengthLabel(strength)}）；高敏信息建议改用实心或隐私标签。`, "warning");
  }
  $("#image-status").textContent = format === "pdf"
    ? "安全 PDF 已重建，请预览第一页或执行整份复检"
    : "安全副本已生成，请预览或执行二次复检";
}

async function exportImageOutput(style, strength, opaqueColor) {
  const output = document.createElement("canvas");
  output.width = state.image.naturalWidth;
  output.height = state.image.naturalHeight;
  const outputContext = output.getContext("2d");
  outputContext.drawImage(state.image, 0, 0);
  if (!applyRedactions(outputContext, state.boxes, style, strength, opaqueColor)) throw new Error("opaque-verification");
  const blob = await canvasToBlob(output);
  await showGeneratedOutput({
    blob, previewCanvas: output,
    fileName: `${state.fileName.replace(/\.[^.]+$/, "")}.veilcheck.png`,
    style, strength, format: "image", totalBoxes: state.boxes.length
  });
}

async function exportPdfOutput(style, strength, opaqueColor) {
  syncCurrentPdfBoxes();
  const totalBoxes = state.pdfPages.reduce((total, boxes) => total + boxes.length, 0);
  const securePdf = await PDFLib.PDFDocument.create();
  securePdf.setProducer("VeilCheck local privacy preflight");
  securePdf.setCreator("VeilCheck");
  let previewCanvas = null;
  for (let pageNumber = 1; pageNumber <= state.pdfDocument.numPages; pageNumber += 1) {
    $("#scan-progress").textContent = `正在安全重建第 ${pageNumber} / ${state.pdfDocument.numPages} 页`;
    const { pageCanvas, baseViewport } = await renderPdfSourcePage(pageNumber);
    const boxes = state.pdfPages[pageNumber - 1] || [];
    if (!applyRedactions(pageCanvas.getContext("2d"), boxes, style, strength, opaqueColor)) {
      throw new Error("opaque-verification");
    }
    const pngBlob = await canvasToBlob(pageCanvas);
    const png = await securePdf.embedPng(await pngBlob.arrayBuffer());
    const outputPage = securePdf.addPage([baseViewport.width, baseViewport.height]);
    outputPage.drawImage(png, { x: 0, y: 0, width: baseViewport.width, height: baseViewport.height });
    if (!previewCanvas) previewCanvas = pageCanvas;
  }
  const pdfBytes = await securePdf.save({ useObjectStreams: true });
  const blob = new Blob([pdfBytes], { type: "application/pdf" });
  await showGeneratedOutput({
    blob, previewCanvas,
    fileName: `${state.fileName.replace(/\.[^.]+$/, "")}.veilcheck.pdf`,
    style, strength, format: "pdf", totalBoxes, pdfBytes
  });
}

$("#export-image").addEventListener("click", async () => {
  if (!state.image) return;
  const button = $("#export-image");
  const style = selectedStyle();
  const strength = Number($("#effect-strength").value);
  const opaqueColor = style === "solid" ? $("#redaction-color").value : "#080a0d";
  button.disabled = true;
  $("#scan-overlay").classList.remove("hidden");
  $("#scan-progress").textContent = "正在生成安全副本";
  try {
    if (state.fileType === "pdf") await exportPdfOutput(style, strength, opaqueColor);
    else await exportImageOutput(style, strength, opaqueColor);
  } catch (error) {
    console.error(error);
    const opaqueFailure = error.message === "opaque-verification";
    setExportVerification(opaqueFailure
      ? "验证失败：至少一个遮挡区域没有完整写入，已阻止下载。"
      : "生成失败，请重试或减少 PDF 页数。", "error");
    $("#image-status").textContent = "安全副本生成失败";
  } finally {
    $("#scan-overlay").classList.add("hidden");
    button.disabled = false;
  }
});

$("#download-output").addEventListener("click", () => {
  if (!state.lastOutput) return;
  const anchor = document.createElement("a");
  anchor.href = state.lastOutput.url;
  anchor.download = state.lastOutput.fileName;
  anchor.click();
});

$("#recheck-output").addEventListener("click", async () => {
  if (!state.lastOutput || !globalThis.Tesseract) return;
  const button = $("#recheck-output");
  const resultBox = $("#recheck-result");
  button.disabled = true;
  resultBox.textContent = "正在对安全副本重新执行 OCR…";
  resultBox.className = "recheck-result neutral";
  let worker;
  try {
    worker = await createLocalOcrWorker();
    const customKeywords = parseKeywords($("#image-custom-keywords").value);
    const allFindings = [];
    if (state.lastOutput.format === "pdf") {
      const outputPdf = await pdfjsLib.getDocument({ data: state.lastOutput.pdfBytes.slice() }).promise;
      for (let pageNumber = 1; pageNumber <= outputPdf.numPages; pageNumber += 1) {
        resultBox.textContent = `正在复检安全 PDF：第 ${pageNumber} / ${outputPdf.numPages} 页…`;
        const page = await outputPdf.getPage(pageNumber);
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = Math.min(2, 2200 / Math.max(baseViewport.width, baseViewport.height));
        const viewport = page.getViewport({ scale });
        const pageCanvas = document.createElement("canvas");
        pageCanvas.width = Math.ceil(viewport.width);
        pageCanvas.height = Math.ceil(viewport.height);
        await page.render({ canvasContext: pageCanvas.getContext("2d", { alpha: false }), viewport }).promise;
        const pageResult = await worker.recognize(pageCanvas, {}, { blocks: true });
        const textFindings = detectOcrWords(flattenOcrWords(pageResult), { customKeywords });
        const barcodeFindings = await detectBarcodes(pageCanvas);
        allFindings.push(...textFindings, ...barcodeFindings);
      }
      await outputPdf.destroy();
    } else {
      const result = await worker.recognize(state.lastOutput.canvas, {}, { blocks: true });
      const findings = detectOcrWords(flattenOcrWords(result), { customKeywords });
      const barcodeFindings = await detectBarcodes(state.lastOutput.canvas);
      allFindings.push(...findings, ...barcodeFindings);
    }
    state.lastOutput.recheck = {
      status: allFindings.length ? "attention" : "clear",
      count: allFindings.length,
      categories: [...new Set(allFindings.map((item) => item.type))]
    };
    if (!allFindings.length) {
      resultBox.textContent = "复检未再次识别出敏感字段；仍建议人工查看预览。";
      resultBox.className = "recheck-result success";
    } else {
      const types = [...new Set(allFindings.map((item) => item.type))].join("、");
      resultBox.textContent = `复检仍识别出 ${allFindings.length} 项（${types}），建议扩大遮挡框或改用不透明遮挡。`;
      resultBox.className = "recheck-result warning";
    }
  } catch (error) {
    console.error(error);
    if (state.lastOutput) state.lastOutput.recheck = { status: "failed", count: null, categories: [] };
    resultBox.textContent = "二次复检失败，请人工检查预览后再下载。";
    resultBox.className = "recheck-result error";
  } finally {
    if (worker) await worker.terminate();
    button.disabled = false;
  }
});

$("#download-report").addEventListener("click", () => {
  if (!state.lastOutput) return;
  const reportBoxes = state.fileType === "pdf" ? state.pdfPages.flat() : state.boxes;
  const categoryCounts = reportBoxes.reduce((counts, box) => {
    const category = box.type || "手动遮挡";
    counts[category] = (counts[category] || 0) + 1;
    return counts;
  }, {});
  const report = {
    product: "VeilCheck",
    reportVersion: 2,
    generatedAt: new Date().toISOString(),
    privacyNote: "报告不包含识别出的原始敏感值、图片内容或位置坐标。",
    document: {
      format: state.lastOutput.format,
      pages: state.lastOutput.format === "pdf" ? state.pdfDocument.numPages : 1,
      previewWidth: state.lastOutput.canvas.width,
      previewHeight: state.lastOutput.canvas.height
    },
    redaction: {
      regionCount: reportBoxes.length,
      categories: categoryCounts,
      style: state.lastOutput.style,
      strength: ["pixelate", "blur"].includes(state.lastOutput.style) ? state.lastOutput.strength : null,
      opaquePixelVerification: ["solid", "label"].includes(state.lastOutput.style) ? "passed" : "not_applicable"
    },
    secondaryCheck: state.lastOutput.recheck || { status: "not_run", count: null, categories: [] }
  };
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${state.fileName.replace(/\.[^.]+$/, "")}.veilcheck-report.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

$("#scan-text").addEventListener("click", () => {
  const source = $("#source-text").value;
  const findings = detectSensitiveText(source, { customKeywords: parseKeywords($("#text-custom-keywords").value) });
  $("#safe-text").value = redactText(source, findings);
  $("#copy-text").disabled = !source;
  const counts = findings.reduce((map, item) => map.set(item.type, (map.get(item.type) || 0) + 1), new Map());
  $("#text-summary").textContent = findings.length
    ? `发现 ${findings.length} 项：${[...counts].map(([type, count]) => `${type} ${count}`).join("、")}。请在复制前人工复核。`
    : "未发现明确敏感信息，仍请人工检查姓名、地址和业务机密。";
});

$("#copy-text").addEventListener("click", async () => {
  await navigator.clipboard.writeText($("#safe-text").value);
  $("#copy-text").textContent = "已复制";
  setTimeout(() => { $("#copy-text").textContent = "复制"; }, 1500);
});
