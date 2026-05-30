(function () {
  "use strict";

  const charset = {
    availableChars: "",
    characters: {},
    letterSpacing: 0,
    forceMultiplier: 1.0,
  };

  const settings = {
    fontSize: 1.0,
    lineSpacing: 34,
    textColor: "#2c2c2e",
    writingStyle: "pen",
  };

  const PAGE_W = 960;
  const MARGIN_LEFT = 80;
  const MARGIN_RIGHT = 80;
  const MARGIN_TOP = 48;

  // iOS uses -32 * fillingScale as Y offset. The 32 is in post-PK-transform space.
  const BASELINE_REF = 32;

  let text = "";
  let cursorPos = 0;
  let renderSeed = {};
  let ghostCompletion = "";
  let renderQueued = false;
  let layoutRanges = [];
  let selectionRects = [];
  let isDraggingSelection = false;
  let selectionAnchor = 0;
  const boundsCache = new WeakMap();
  const strokeIds = new WeakMap();
  const glyphCache = new Map();
  let nextStrokeId = 1;

  function parseMarkdown(raw) {
    const tokens = [];
    let isBold = false, isUnderline = false, isStrikethrough = false;
    let i = 0;
    while (i < raw.length) {
      if (i + 1 < raw.length && raw[i] === "*" && raw[i + 1] === "*") {
        isBold = !isBold;
        i += 2;
        continue;
      }
      if (i + 1 < raw.length && raw[i] === "_" && raw[i + 1] === "_") {
        isUnderline = !isUnderline;
        i += 2;
        continue;
      }
      if (i + 1 < raw.length && raw[i] === "~" && raw[i + 1] === "~") {
        isStrikethrough = !isStrikethrough;
        i += 2;
        continue;
      }
      tokens.push({ char: raw[i], bold: isBold, underline: isUnderline, strikethrough: isStrikethrough, srcIndex: i });
      i++;
    }
    return tokens;
  }

  const pageCanvas = document.getElementById("page");
  const pageCtx = pageCanvas.getContext("2d", { alpha: false, desynchronized: true });
  const baseCanvas = document.createElement("canvas");
  const baseCtx = baseCanvas.getContext("2d", { alpha: false, desynchronized: true });
  let lastCursorRect = null;
  const hiddenInput = document.getElementById("hidden-input");
  const toolbar = document.getElementById("toolbar");
  const selectionTooltip = document.getElementById("selection-tooltip");
  const btnBold = document.getElementById("btn-bold");
  const btnUnderline = document.getElementById("btn-underline");

  // --- Focus / selection ---

  function syncSelectionFromInput() {
    cursorPos = hiddenInput.selectionStart;
    updateSelectionTooltip();
    scheduleRender();
  }

  function canvasPointFromEvent(e) {
    const rect = pageCanvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (PAGE_W / rect.width),
      y: (e.clientY - rect.top) * (pageCanvas.height / (window.devicePixelRatio || 1) / rect.height),
    };
  }

  function indexFromCanvasPoint(point) {
    if (!layoutRanges.length) return 0;
    let nearest = { index: text.length, dist: Infinity };
    for (const r of layoutRanges) {
      const sameLine = point.y >= r.top - settings.lineSpacing * 0.35 && point.y <= r.bottom + settings.lineSpacing * 0.35;
      const xHit = point.x < (r.left + r.right) / 2 ? r.start : r.end;
      const dx = point.x < r.left ? r.left - point.x : point.x > r.right ? point.x - r.right : 0;
      const dy = point.y < r.top ? r.top - point.y : point.y > r.bottom ? point.y - r.bottom : 0;
      const dist = sameLine ? Math.abs(dx) : Math.hypot(dx, dy);
      if (dist < nearest.dist) nearest = { index: xHit, dist };
    }
    return nearest.index;
  }

  function clampTextIndex(index) {
    return Math.max(0, Math.min(index, text.length));
  }

  function setNativeSelection(anchor, focus) {
    hiddenInput.focus({ preventScroll: true });
    anchor = clampTextIndex(anchor);
    focus = clampTextIndex(focus);
    hiddenInput.setSelectionRange(Math.min(anchor, focus), Math.max(anchor, focus));
    cursorPos = focus;
    updateSelectionTooltip();
    scheduleRender();
  }

  pageCanvas.addEventListener("pointerdown", (e) => {
    const idx = indexFromCanvasPoint(canvasPointFromEvent(e));
    isDraggingSelection = true;
    selectionAnchor = idx;
    pageCanvas.setPointerCapture(e.pointerId);
    setNativeSelection(idx, idx);
    e.preventDefault();
  });

  pageCanvas.addEventListener("pointermove", (e) => {
    if (!isDraggingSelection) return;
    setNativeSelection(selectionAnchor, indexFromCanvasPoint(canvasPointFromEvent(e)));
    e.preventDefault();
  });

  pageCanvas.addEventListener("pointerup", (e) => {
    isDraggingSelection = false;
    updateSelectionTooltip();
    e.preventDefault();
  });

  hiddenInput.addEventListener("input", () => {
    text = hiddenInput.value;
    cursorPos = hiddenInput.selectionStart;
    ghostCompletion = "";
    updateSelectionTooltip();
    scheduleRender();
    requestCompletion();
  });

  hiddenInput.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
      e.preventDefault();
      toggleWrappedSelection("**");
      return;
    }
    if (e.key === "Tab" && ghostCompletion) {
      e.preventDefault();
      const before = text.slice(0, cursorPos);
      const after = text.slice(cursorPos);
      text = before + ghostCompletion + after;
      cursorPos += ghostCompletion.length;
      hiddenInput.value = text;
      hiddenInput.selectionStart = hiddenInput.selectionEnd = cursorPos;
      ghostCompletion = "";
      scheduleRender();
    }
  });

  hiddenInput.addEventListener("keyup", syncSelectionFromInput);
  hiddenInput.addEventListener("click", syncSelectionFromInput);
  hiddenInput.addEventListener("select", syncSelectionFromInput);

  btnBold.addEventListener("click", (e) => {
    e.preventDefault();
    toggleWrappedSelection("**");
  });

  btnUnderline.addEventListener("click", (e) => {
    e.preventDefault();
    toggleWrappedSelection("__");
  });

  // Show toolbar on mouse near bottom
  document.addEventListener("mousemove", (e) => {
    if (e.clientY > window.innerHeight - 80) {
      toolbar.classList.add("visible");
    } else {
      toolbar.classList.remove("visible");
    }
  });

  function toggleWrappedSelection(marker) {
    const a = hiddenInput.selectionStart;
    const b = hiddenInput.selectionEnd;
    if (a === b) return;
    const start = Math.min(a, b);
    const end = Math.max(a, b);
    const selected = text.slice(start, end);
    const alreadyWrapped = text.slice(start - marker.length, start) === marker && text.slice(end, end + marker.length) === marker;
    if (alreadyWrapped) {
      text = text.slice(0, start - marker.length) + selected + text.slice(end + marker.length);
      hiddenInput.value = text;
      hiddenInput.setSelectionRange(start - marker.length, end - marker.length);
    } else {
      text = text.slice(0, start) + marker + selected + marker + text.slice(end);
      hiddenInput.value = text;
      hiddenInput.setSelectionRange(start + marker.length, end + marker.length);
    }
    cursorPos = hiddenInput.selectionStart;
    renderSeed = {};
    updateSelectionTooltip();
    scheduleRender();
  }

  function updateSelectionTooltip() {
    const start = Math.min(hiddenInput.selectionStart || 0, hiddenInput.selectionEnd || 0);
    const end = Math.max(hiddenInput.selectionStart || 0, hiddenInput.selectionEnd || 0);
    if (!selectionTooltip || start === end || !layoutRanges.length) {
      selectionTooltip?.classList.remove("visible");
      return;
    }
    const selected = layoutRanges.filter(r => r.end > start && r.start < end);
    if (!selected.length) {
      selectionTooltip.classList.remove("visible");
      return;
    }
    const rect = pageCanvas.getBoundingClientRect();
    const top = Math.min(...selected.map(r => r.top));
    const left = Math.min(...selected.map(r => r.left));
    const right = Math.max(...selected.map(r => r.right));
    selectionTooltip.style.left = rect.left + ((left + right) / 2 / PAGE_W) * rect.width + "px";
    selectionTooltip.style.top = rect.top + (top / (pageCanvas.height / (window.devicePixelRatio || 1))) * rect.height + "px";
    selectionTooltip.classList.add("visible");
  }

  // --- Autocomplete (disabled — needs better model or API) ---

  function requestCompletion() {
    ghostCompletion = "";
  }

  // --- Character lookup ---

  function getCharDrawing(char, index) {
    const samples = charset.characters[char];
    if (!samples || samples.length === 0) return null;
    let seed = renderSeed[index];
    if (seed === undefined) {
      seed = Math.floor(Math.random() * samples.length);
      renderSeed[index] = seed;
    }
    return samples[seed % samples.length];
  }

  function getStrokeId(strokes) {
    let id = strokeIds.get(strokes);
    if (!id) {
      id = nextStrokeId++;
      strokeIds.set(strokes, id);
    }
    return id;
  }

  function clearGlyphCache() {
    glyphCache.clear();
  }

  function getStrokeBounds(strokes) {
    const cached = boundsCache.get(strokes);
    if (cached) return cached;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const stroke of strokes) {
      for (const p of stroke) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
    }
    const bounds = { minX, minY, maxX, maxY, width: maxX - minX || 1, height: maxY - minY || 1 };
    boundsCache.set(strokes, bounds);
    return bounds;
  }

  function seededRandom(index, salt) {
    let h = index * 2654435761 + salt * 340573321;
    h = ((h >>> 16) ^ h) * 0x45d9f3b;
    h = ((h >>> 16) ^ h) * 0x45d9f3b;
    h = (h >>> 16) ^ h;
    return (h & 0xffff) / 0xffff;
  }

  // --- iOS-matching scale ---
  // iOS: fillingScale = 1.8 * fontSize, then scale by lineSpacing/256
  // Our coords are post-PK-transform, so effective scale = 1.8 * fontSize * lineSpacing / 256

  function charScale() {
    return (1.8 * settings.fontSize * settings.lineSpacing) / 256;
  }

  // --- Render ---

  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      render();
    });
  }

  function render() {
    const { lineSpacing, textColor, writingStyle } = settings;
    const scale = charScale();
    const spaceW = lineSpacing * 0.5;
    const letterSp = charset.letterSpacing;

    const pageHeight = computePageHeight();
    const dpr = window.devicePixelRatio || 1;
    const targetWidth = Math.ceil(PAGE_W * dpr);
    const targetHeight = Math.ceil(pageHeight * dpr);
    if (pageCanvas.width !== targetWidth || pageCanvas.height !== targetHeight) {
      pageCanvas.width = targetWidth;
      pageCanvas.height = targetHeight;
      baseCanvas.width = targetWidth;
      baseCanvas.height = targetHeight;
      pageCanvas.style.width = PAGE_W + "px";
      pageCanvas.style.height = pageHeight + "px";
    }
    pageCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    pageCtx.fillStyle = "#fff";
    pageCtx.fillRect(0, 0, PAGE_W, pageHeight);

    const tokens = parseMarkdown(text);
    layoutRanges = [];
    selectionRects = [];
    const selStart = Math.min(hiddenInput.selectionStart || 0, hiddenInput.selectionEnd || 0);
    const selEnd = Math.max(hiddenInput.selectionStart || 0, hiddenInput.selectionEnd || 0);

    let x = MARGIN_LEFT;
    let y = MARGIN_TOP + lineSpacing;
    let lineOffset = 0;
    let cursorX = x, cursorY = y, cursorLineOffset = 0;

    let underlinePath = [];
    let underlinePathY = 0;
    let strikethroughPath = [];
    let strikethroughPathY = 0;
    let wasUnderline = false;
    let wasStrikethrough = false;
    const decorationLines = [];

    function flushUnderline() {
      if (underlinePath.length >= 2) decorationLines.push({ points: underlinePath.slice(), type: "underline" });
      underlinePath = [];
      underlinePathY = 0;
    }

    function flushStrikethrough() {
      if (strikethroughPath.length >= 2) decorationLines.push({ points: strikethroughPath.slice(), type: "strikethrough" });
      strikethroughPath = [];
      strikethroughPathY = 0;
    }

    // Map from srcIndex to token index for cursor positioning
    let cursorMapped = false;

    for (let ti = 0; ti < tokens.length; ti++) {
      const tok = tokens[ti];
      const c = tok.char;
      const i = tok.srcIndex;

      if (!cursorMapped && i >= cursorPos) {
        cursorX = x;
        cursorY = y;
        cursorLineOffset = lineOffset;
        cursorMapped = true;
      }

      if (!tok.underline && wasUnderline) flushUnderline();
      if (!tok.strikethrough && wasStrikethrough) flushStrikethrough();
      wasUnderline = tok.underline;
      wasStrikethrough = tok.strikethrough;

      if (c === "\n") {
        if (tok.underline) flushUnderline();
        if (tok.strikethrough) flushStrikethrough();
        x = MARGIN_LEFT + (seededRandom(i, 1) - 0.5) * lineSpacing * 0.08;
        y += lineSpacing;
        lineOffset = 0;
        continue;
      }

      if (c === " ") {
        const w = spaceW;
        addLayoutRange(i, i + 1, x, y, w, scale, selStart, selEnd);
        x += w;
        continue;
      }

      if (c === "\t") {
        const w = spaceW * 4;
        addLayoutRange(i, i + 1, x, y, w, scale, selStart, selEnd);
        x += w;
        continue;
      }

      // Word wrap
      if (ti === 0 || tokens[ti - 1].char === " " || tokens[ti - 1].char === "\n" || tokens[ti - 1].char === "\t") {
        const wordW = measureWordTokens(tokens, ti, scale, spaceW, letterSp);
        if (x + wordW > PAGE_W - MARGIN_RIGHT && x > MARGIN_LEFT + 10) {
          if (tok.underline) flushUnderline();
          if (tok.strikethrough) flushStrikethrough();
          x = MARGIN_LEFT + (seededRandom(i, 2) - 0.5) * lineSpacing * 0.08;
          y += lineSpacing;
          lineOffset = 0;
        }
      }

      const strokes = getCharDrawing(c, i);
      if (strokes) {
        const bounds = getStrokeBounds(strokes);
        const drawX = x - bounds.minX * scale;
        const drawY = y + lineOffset - BASELINE_REF * scale;

        addLayoutRange(i, i + 1, x, y, bounds.width * scale, scale, selStart, selEnd);

        const boldFactor = tok.bold ? 1.5 : 1.0;
        drawGlyph(pageCtx, strokes, drawX, drawY, scale,
          charset.forceMultiplier * boldFactor, textColor, writingStyle, 1.0);

        const charW = bounds.width * scale;
        const charMidX = x + charW * 0.5;
        const charMaxY = drawY + bounds.maxY * scale;
        const charMidY = drawY + (bounds.minY + bounds.height * 0.5) * scale;

        if (tok.underline) {
          const idealY = charMaxY + 4;
          if (underlinePathY === 0) underlinePathY = idealY;
          else underlinePathY = underlinePathY * 0.9 + idealY * 0.1 + (seededRandom(i, 7) - 0.5) * 2;
          underlinePath.push({ x: charMidX, y: underlinePathY });
        }

        if (tok.strikethrough) {
          const idealY = charMidY;
          if (strikethroughPathY === 0) strikethroughPathY = idealY;
          else strikethroughPathY = strikethroughPathY * 0.9 + idealY * 0.1 + (seededRandom(i, 8) - 0.5) * 2;
          strikethroughPath.push({ x: charMidX, y: strikethroughPathY });
        }

        x += charW + letterSp + (seededRandom(i, 3) - 0.5) * 1.5;
        lineOffset += (seededRandom(i, 4) - 0.5) * 0.4;
        lineOffset = Math.max(-lineSpacing * 0.06, Math.min(lineSpacing * 0.06, lineOffset));
      } else {
        x += spaceW;
      }
    }

    if (wasUnderline) flushUnderline();
    if (wasStrikethrough) flushStrikethrough();

    drawSelectionHighlights();
    updateSelectionTooltip();

    // Draw decoration lines
    for (const line of decorationLines) {
      pageCtx.strokeStyle = textColor;
      pageCtx.lineWidth = Math.max(1.2, charset.forceMultiplier * scale * 2.1);
      pageCtx.lineCap = "round";
      pageCtx.lineJoin = "round";
      pageCtx.globalAlpha = 1.0;
      pageCtx.beginPath();
      pageCtx.moveTo(line.points[0].x, line.points[0].y);
      for (let pi = 1; pi < line.points.length; pi++) {
        pageCtx.lineTo(line.points[pi].x, line.points[pi].y);
      }
      pageCtx.stroke();
    }

    if (!cursorMapped) {
      cursorX = x;
      cursorY = y;
      cursorLineOffset = lineOffset;
    }

    // Cursor: match the same baseline as characters
    const cursorBaseY = cursorY + cursorLineOffset - BASELINE_REF * scale;
    const cursorTop = cursorBaseY + 20 * scale;
    const cursorHeight = 180 * scale;

    lastCursorRect = { x: cursorX, y: cursorTop, w: 1.5, h: cursorHeight, color: textColor };

    // Ghost autocomplete: render predicted text at low opacity after cursor
    if (ghostCompletion && cursorPos === text.length) {
      let gx = cursorX + 3;
      const gy = cursorY;
      const gLineOffset = cursorLineOffset;
      const ghostColor = "#9aa0aa";
      for (let gi = 0; gi < ghostCompletion.length; gi++) {
        const gc = ghostCompletion[gi];
        const gStrokes = getCharDrawing(gc, text.length + gi);
        if (gStrokes) {
          const gBounds = getStrokeBounds(gStrokes);
          const gDrawX = gx - gBounds.minX * scale;
          const gDrawY = gy + gLineOffset - BASELINE_REF * scale;
          drawGlyph(pageCtx, gStrokes, gDrawX, gDrawY, scale,
            charset.forceMultiplier, ghostColor, writingStyle, 0.35);
          gx += gBounds.width * scale + letterSp;
        } else {
          gx += spaceW;
        }
      }
    }

    snapshotBase();
    drawCursorOverlay();
  }

  function snapshotBase() {
    baseCtx.setTransform(1, 0, 0, 1, 0, 0);
    baseCtx.drawImage(pageCanvas, 0, 0);
  }

  function drawCursorOverlay() {
    pageCtx.setTransform(1, 0, 0, 1, 0, 0);
    pageCtx.drawImage(baseCanvas, 0, 0);
    pageCtx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
    if (document.activeElement === hiddenInput && lastCursorRect && Math.floor(Date.now() / 530) % 2 === 0) {
      pageCtx.fillStyle = lastCursorRect.color;
      pageCtx.fillRect(lastCursorRect.x, lastCursorRect.y, lastCursorRect.w, lastCursorRect.h);
    }
  }

  function addLayoutRange(start, end, x, y, width, scale, selStart, selEnd) {
    const top = y - BASELINE_REF * scale + 14 * scale;
    const bottom = y - BASELINE_REF * scale + 205 * scale;
    const range = { start, end, left: x, right: x + Math.max(width, 3), top, bottom };
    layoutRanges.push(range);

    if (selEnd > start && selStart < end) {
      const lineKey = Math.round(range.top / 4) * 4;
      const existing = selectionRects.find(r => r.lineKey === lineKey);
      if (existing) {
        existing.left = Math.min(existing.left, range.left);
        existing.right = Math.max(existing.right, range.right);
        existing.top = Math.min(existing.top, range.top);
        existing.bottom = Math.max(existing.bottom, range.bottom);
      } else {
        selectionRects.push({
          lineKey,
          left: range.left,
          right: range.right,
          top: range.top,
          bottom: range.bottom,
        });
      }
    }
  }

  function drawSelectionHighlights() {
    if (!selectionRects.length) return;
    pageCtx.save();
    pageCtx.fillStyle = "rgba(0, 122, 255, 0.14)";
    for (const r of selectionRects) {
      const radius = 4;
      const x = r.left - 3;
      const y = r.top;
      const w = r.right - r.left + 6;
      const h = r.bottom - r.top;
      pageCtx.beginPath();
      pageCtx.moveTo(x + radius, y);
      pageCtx.lineTo(x + w - radius, y);
      pageCtx.quadraticCurveTo(x + w, y, x + w, y + radius);
      pageCtx.lineTo(x + w, y + h - radius);
      pageCtx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
      pageCtx.lineTo(x + radius, y + h);
      pageCtx.quadraticCurveTo(x, y + h, x, y + h - radius);
      pageCtx.lineTo(x, y + radius);
      pageCtx.quadraticCurveTo(x, y, x + radius, y);
      pageCtx.fill();
    }
    pageCtx.restore();
  }

  function measureWord(startIdx, scale, spaceW, letterSp) {
    let w = 0;
    let j = startIdx;
    while (j < text.length && text[j] !== " " && text[j] !== "\n" && text[j] !== "\t") {
      if (j + 1 < text.length && "*_~".includes(text[j]) && text[j] === text[j + 1]) {
        j += 2;
        continue;
      }
      const strokes = getCharDrawing(text[j], j);
      if (strokes) {
        const bounds = getStrokeBounds(strokes);
        w += bounds.width * scale + letterSp;
      } else {
        w += spaceW;
      }
      j++;
    }
    return w;
  }

  function measureWordTokens(tokens, startTi, scale, spaceW, letterSp) {
    let w = 0;
    let j = startTi;
    while (j < tokens.length && tokens[j].char !== " " && tokens[j].char !== "\n" && tokens[j].char !== "\t") {
      const strokes = getCharDrawing(tokens[j].char, tokens[j].srcIndex);
      if (strokes) {
        const bounds = getStrokeBounds(strokes);
        w += bounds.width * scale + letterSp;
      } else {
        w += spaceW;
      }
      j++;
    }
    return w;
  }

  function computePageHeight() {
    const { lineSpacing } = settings;
    const scale = charScale();
    const spaceW = lineSpacing * 0.5;
    const letterSp = charset.letterSpacing;
    const tokens = parseMarkdown(text);

    let x = MARGIN_LEFT;
    let lines = 1;

    for (let ti = 0; ti < tokens.length; ti++) {
      const c = tokens[ti].char;
      if (c === "\n") { x = MARGIN_LEFT; lines++; continue; }
      if (c === " ") { x += spaceW; continue; }
      if (c === "\t") { x += spaceW * 4; continue; }

      if (ti === 0 || tokens[ti - 1].char === " " || tokens[ti - 1].char === "\n" || tokens[ti - 1].char === "\t") {
        const wordW = measureWordTokens(tokens, ti, scale, spaceW, letterSp);
        if (x + wordW > PAGE_W - MARGIN_RIGHT && x > MARGIN_LEFT + 10) {
          x = MARGIN_LEFT;
          lines++;
        }
      }

      const strokes = getCharDrawing(c, tokens[ti].srcIndex);
      if (strokes) {
        const bounds = getStrokeBounds(strokes);
        x += bounds.width * scale + letterSp;
      } else {
        x += spaceW;
      }
    }

    return Math.max(600, MARGIN_TOP + (lines + 2) * lineSpacing + 80);
  }

  function drawGlyph(ctx, strokes, offsetX, offsetY, scale, thicknessFactor, color, style, opacity) {
    const dpr = window.devicePixelRatio || 1;
    const bounds = getStrokeBounds(strokes);
    const pad = Math.ceil(10 * scale + 4);
    const w = Math.max(1, Math.ceil(bounds.width * scale + pad * 2));
    const h = Math.max(1, Math.ceil(bounds.height * scale + pad * 2));
    const alpha = opacity === undefined ? 1 : opacity;
    const key = [getStrokeId(strokes), scale.toFixed(4), thicknessFactor.toFixed(3), color, style, alpha.toFixed(2), dpr].join("|");
    let cached = glyphCache.get(key);

    if (!cached) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(w * dpr);
      canvas.height = Math.ceil(h * dpr);
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      const cctx = canvas.getContext("2d", { alpha: true });
      cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawCharacter(cctx, strokes, pad - bounds.minX * scale, pad - bounds.minY * scale, scale, thicknessFactor, color, style, alpha);
      cached = { canvas, x: bounds.minX * scale - pad, y: bounds.minY * scale - pad, lastUsed: performance.now() };
      glyphCache.set(key, cached);

      // Hard cap: enough for all visible variants, prevents mobile memory blowups.
      if (glyphCache.size > 900) {
        const doomed = glyphCache.keys().next().value;
        glyphCache.delete(doomed);
      }
    } else {
      cached.lastUsed = performance.now();
    }

    ctx.drawImage(cached.canvas, offsetX + cached.x, offsetY + cached.y, w, h);
  }

  function drawCharacter(ctx, strokes, offsetX, offsetY, scale, thicknessFactor, color, style, opacity) {
    const baseOpacity = opacity !== undefined ? opacity : 1.0;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (const stroke of strokes) {
      if (stroke.length < 2) continue;
      for (let i = 1; i < stroke.length; i++) {
        const prev = stroke[i - 1];
        const cur = stroke[i];
        let width = Math.max(0.3, cur.width * thicknessFactor * scale);

        ctx.globalAlpha = baseOpacity;
        if (style === "pencil") {
          ctx.globalAlpha = 0.45 * baseOpacity;
          width *= 0.7;
        } else if (style === "marker") {
          ctx.globalAlpha = 0.65 * baseOpacity;
          width *= 2.0;
        }

        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(prev.x * scale + offsetX, prev.y * scale + offsetY);
        ctx.lineTo(cur.x * scale + offsetX, cur.y * scale + offsetY);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1.0;
  }

  // Cursor blink: redraw only the tiny overlay, not the whole page/layout.
  setInterval(() => {
    if (document.activeElement === hiddenInput && lastCursorRect) drawCursorOverlay();
  }, 530);

  // --- Settings ---

  document.getElementById("btn-settings").addEventListener("click", () => {
    document.getElementById("settings-panel").classList.toggle("open");
  });

  document.getElementById("btn-close-settings").addEventListener("click", () => {
    document.getElementById("settings-panel").classList.remove("open");
  });

  const sliders = [
    { id: "font-size", key: "fontSize", valueId: "font-size-value", parse: parseFloat },
    { id: "line-spacing", key: "lineSpacing", valueId: "line-spacing-value", parse: parseInt },
  ];

  sliders.forEach(({ id, key, valueId, parse }) => {
    document.getElementById(id).addEventListener("input", (e) => {
      settings[key] = parse(e.target.value);
      document.getElementById(valueId).textContent = e.target.value;
      renderSeed = {};
      clearGlyphCache();
      scheduleRender();
    });
  });

  document.getElementById("text-color").addEventListener("input", (e) => {
    settings.textColor = e.target.value;
    clearGlyphCache();
    scheduleRender();
  });

  document.getElementById("writing-style").addEventListener("change", (e) => {
    settings.writingStyle = e.target.value;
    clearGlyphCache();
    scheduleRender();
  });

  // --- Export ---

  document.getElementById("btn-download").addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = pageCanvas.toDataURL("image/png");
    a.download = "handwriting.png";
    a.click();
  });

  // --- Init ---

  async function init() {
    try {
      const resp = await fetch("default-charset.json");
      if (resp.ok) {
        const data = await resp.json();
        charset.availableChars = data.availableChars || "";
        charset.characters = data.characters || {};
        charset.letterSpacing = data.letterSpacing ?? 0;
        charset.forceMultiplier = data.forceMultiplier ?? 1.0;
      }
    } catch (e) {
      console.error("Failed to load default charset:", e);
    }

    scheduleRender();
    hiddenInput.focus();
  }

  init();
})();
