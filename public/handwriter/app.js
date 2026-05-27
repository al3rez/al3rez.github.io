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
  const pageCtx = pageCanvas.getContext("2d");
  const hiddenInput = document.getElementById("hidden-input");
  const toolbar = document.getElementById("toolbar");

  // --- Focus ---

  pageCanvas.addEventListener("click", () => hiddenInput.focus());

  hiddenInput.addEventListener("input", () => {
    text = hiddenInput.value;
    cursorPos = hiddenInput.selectionStart;
    ghostCompletion = "";
    render();
    requestCompletion();
  });

  hiddenInput.addEventListener("keydown", (e) => {
    if (e.key === "Tab" && ghostCompletion) {
      e.preventDefault();
      const before = text.slice(0, cursorPos);
      const after = text.slice(cursorPos);
      text = before + ghostCompletion + after;
      cursorPos += ghostCompletion.length;
      hiddenInput.value = text;
      hiddenInput.selectionStart = hiddenInput.selectionEnd = cursorPos;
      ghostCompletion = "";
      render();
    }
  });

  hiddenInput.addEventListener("keyup", () => {
    cursorPos = hiddenInput.selectionStart;
    render();
  });

  hiddenInput.addEventListener("click", () => {
    cursorPos = hiddenInput.selectionStart;
    render();
  });

  // Show toolbar on mouse near bottom
  document.addEventListener("mousemove", (e) => {
    if (e.clientY > window.innerHeight - 80) {
      toolbar.classList.add("visible");
    } else {
      toolbar.classList.remove("visible");
    }
  });

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

  function getStrokeBounds(strokes) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const stroke of strokes) {
      for (const p of stroke) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
    }
    return { minX, minY, maxX, maxY, width: maxX - minX || 1, height: maxY - minY || 1 };
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

  function render() {
    const { lineSpacing, textColor, writingStyle } = settings;
    const scale = charScale();
    const spaceW = lineSpacing * 0.5;
    const letterSp = charset.letterSpacing;

    const pageHeight = computePageHeight();
    const dpr = window.devicePixelRatio || 1;
    pageCanvas.width = PAGE_W * dpr;
    pageCanvas.height = pageHeight * dpr;
    pageCanvas.style.width = PAGE_W + "px";
    pageCanvas.style.height = pageHeight + "px";
    pageCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    pageCtx.fillStyle = "#fff";
    pageCtx.fillRect(0, 0, PAGE_W, pageHeight);

    const tokens = parseMarkdown(text);

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
        x += spaceW;
        continue;
      }

      if (c === "\t") {
        x += spaceW * 4;
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

        const boldFactor = tok.bold ? 1.5 : 1.0;
        drawCharacter(pageCtx, strokes, drawX, drawY, scale,
          charset.forceMultiplier * boldFactor, textColor, writingStyle);

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

    // Draw decoration lines
    for (const line of decorationLines) {
      pageCtx.strokeStyle = textColor;
      pageCtx.lineWidth = scale * 1.2;
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

    if (document.activeElement === hiddenInput) {
      if (Math.floor(Date.now() / 530) % 2 === 0) {
        pageCtx.fillStyle = textColor;
        pageCtx.fillRect(cursorX, cursorTop, 1.5, cursorHeight);
      }
    }

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
          drawCharacter(pageCtx, gStrokes, gDrawX, gDrawY, scale,
            charset.forceMultiplier, ghostColor, writingStyle, 0.35);
          gx += gBounds.width * scale + letterSp;
        } else {
          gx += spaceW;
        }
      }
    }
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

  // Cursor blink
  setInterval(() => {
    if (document.activeElement === hiddenInput) render();
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
      render();
    });
  });

  document.getElementById("text-color").addEventListener("input", (e) => {
    settings.textColor = e.target.value;
    render();
  });

  document.getElementById("writing-style").addEventListener("change", (e) => {
    settings.writingStyle = e.target.value;
    render();
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

    render();
    hiddenInput.focus();
  }

  init();
})();
