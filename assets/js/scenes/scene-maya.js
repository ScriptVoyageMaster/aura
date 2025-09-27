// Нова сцена "Maya" — анімація майянського гліфа з промальовуванням контурів і числом Цолькін.
// Весь код супроводжується докладними українськими коментарями, щоб його легко було підтримувати.
(() => {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const svgCache = new Map();

  /**
   * Акуратно обрізаємо значення до діапазону 0..1, щоб уникнути артефактів у прогресі.
   */
  function clamp01(value) {
    if (value <= 0) return 0;
    if (value >= 1) return 1;
    return value;
  }

  /**
   * Універсальний clamp, щоб обмежувати значення у заданому інтервалі.
   */
  function clamp(value, min, max) {
    if (value < min) {
      return min;
    }
    if (value > max) {
      return max;
    }
    return value;
  }

  /**
   * Евристика сортування контурів залежно від статі: лінійне для чоловічої, вертикальне/центрове для жіночої.
   */
  function sortContours(contours, gender, center) {
    if (!Array.isArray(contours)) {
      return [];
    }

    if (gender === "male") {
      return [...contours].sort((a, b) => {
        const ax = a.bbox.x + a.bbox.width / 2;
        const bx = b.bbox.x + b.bbox.width / 2;
        if (Math.abs(ax - bx) > 1) {
          return ax - bx;
        }
        const ay = a.bbox.y + a.bbox.height / 2;
        const by = b.bbox.y + b.bbox.height / 2;
        return ay - by;
      });
    }

    if (gender === "female") {
      return [...contours].sort((a, b) => {
        const ay = a.bbox.y + a.bbox.height / 2;
        const by = b.bbox.y + b.bbox.height / 2;
        if (Math.abs(ay - by) > 1) {
          return ay - by;
        }
        const da = Math.hypot(a.bbox.x + a.bbox.width / 2 - center.x, a.bbox.y + a.bbox.height / 2 - center.y);
        const db = Math.hypot(b.bbox.x + b.bbox.width / 2 - center.x, b.bbox.y + b.bbox.height / 2 - center.y);
        return da - db;
      });
    }

    return [...contours];
  }

  /**
   * Підготовка Path2D з урахуванням трансформацій SVG (translate/scale).
   */
  function buildTransformedPath(d, ctm) {
    const basePath = new Path2D(d);
    if (typeof Path2D === "undefined") {
      return basePath;
    }
    const finalPath = new Path2D();
    if (typeof finalPath.addPath === "function" && ctm) {
      const domMatrix = typeof DOMMatrix === "function" ? new DOMMatrix([ctm.a, ctm.b, ctm.c, ctm.d, ctm.e, ctm.f]) : null;
      if (domMatrix) {
        finalPath.addPath(basePath, domMatrix);
        return finalPath;
      }
    }
    finalPath.addPath(basePath);
    return finalPath;
  }

  /**
   * Збираємо трансформації з усіх батьківських елементів для точного відтворення геометрії.
   */
  function collectTransformChain(element, stopNode) {
    const transforms = [];
    let current = element;
    while (current && current !== stopNode) {
      if (current.getAttribute) {
        const transform = current.getAttribute("transform");
        if (transform) {
          transforms.push(transform);
        }
      }
      current = current.parentNode;
    }
    if (transforms.length === 0) {
      return "";
    }
    return transforms.reverse().join(" ");
  }

  /**
   * Визначаємо семантичну групу (outline/details/fills) або повертаємо fallback.
   */
  function detectGroup(element, stopNode) {
    let current = element;
    while (current && current !== stopNode) {
      if (current.tagName && current.tagName.toLowerCase() === "g") {
        const id = current.getAttribute("id");
        if (id === "outline" || id === "details" || id === "fills") {
          return id;
        }
      }
      current = current.parentNode;
    }
    return "fallback";
  }

  /**
   * Допоміжна функція, що перетворює SVG-полігон чи полілінію на path-рядок.
   */
  function pointsToPath(pointsString, close = false) {
    if (!pointsString) {
      return "";
    }
    const coords = pointsString
      .trim()
      .split(/\s+|,|\t/)
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value));
    if (coords.length < 4) {
      return "";
    }
    const pairs = [];
    for (let i = 0; i < coords.length; i += 2) {
      pairs.push({ x: coords[i], y: coords[i + 1] });
    }
    const start = pairs[0];
    const commands = [`M ${start.x} ${start.y}`];
    for (let i = 1; i < pairs.length; i += 1) {
      const pt = pairs[i];
      commands.push(`L ${pt.x} ${pt.y}`);
    }
    if (close) {
      commands.push("Z");
    }
    return commands.join(" ");
  }

  /**
   * Створюємо набір Path2D із урахуванням трансформацій та семантичних груп.
   */
  function parseSvgText(svgText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, "image/svg+xml");
    const svgRoot = doc.documentElement;
    const viewBoxAttr = svgRoot.getAttribute("viewBox");

    let viewBox = { x: 0, y: 0, width: 0, height: 0 };
    if (viewBoxAttr) {
      const parts = viewBoxAttr
        .trim()
        .split(/\s+/)
        .map((value) => Number(value));
      if (parts.length === 4) {
        viewBox = { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
      }
    } else {
      const width = Number(svgRoot.getAttribute("width")) || 0;
      const height = Number(svgRoot.getAttribute("height")) || 0;
      viewBox = { x: 0, y: 0, width, height };
    }

    const tempSvg = document.createElementNS(SVG_NS, "svg");
    tempSvg.setAttribute("xmlns", SVG_NS);
    tempSvg.setAttribute("viewBox", `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`);
    tempSvg.setAttribute("width", String(viewBox.width));
    tempSvg.setAttribute("height", String(viewBox.height));
    tempSvg.style.position = "absolute";
    tempSvg.style.width = "0";
    tempSvg.style.height = "0";
    tempSvg.style.opacity = "0";
    document.body.appendChild(tempSvg);

    const groups = { outline: [], details: [], fills: [], fallback: [] };
    const elements = svgRoot.querySelectorAll("path,line,polyline,polygon");

    elements.forEach((element) => {
      const tag = element.tagName.toLowerCase();
      let d = "";
      if (tag === "path") {
        d = element.getAttribute("d") || "";
      } else if (tag === "line") {
        const x1 = Number(element.getAttribute("x1")) || 0;
        const y1 = Number(element.getAttribute("y1")) || 0;
        const x2 = Number(element.getAttribute("x2")) || 0;
        const y2 = Number(element.getAttribute("y2")) || 0;
        d = `M ${x1} ${y1} L ${x2} ${y2}`;
      } else if (tag === "polyline") {
        d = pointsToPath(element.getAttribute("points"), false);
      } else if (tag === "polygon") {
        d = pointsToPath(element.getAttribute("points"), true);
      }

      if (!d) {
        return;
      }

      const transform = collectTransformChain(element, svgRoot);
      const measurement = document.createElementNS(SVG_NS, "path");
      measurement.setAttribute("d", d);
      if (transform) {
        measurement.setAttribute("transform", transform);
      }
      tempSvg.appendChild(measurement);

      let length = 0;
      try {
        length = measurement.getTotalLength();
      } catch (error) {
        length = Math.max(Math.hypot(viewBox.width, viewBox.height) * 0.05, 1);
      }

      const bboxRaw = measurement.getBBox();
      const bbox = {
        x: bboxRaw.x,
        y: bboxRaw.y,
        width: bboxRaw.width,
        height: bboxRaw.height,
      };

      const ctm = measurement.getCTM();
      const path = buildTransformedPath(d, ctm);
      tempSvg.removeChild(measurement);

      const groupName = detectGroup(element, svgRoot);
      const bucket = groups[groupName] || groups.fallback;
      bucket.push({
        path,
        length,
        bbox,
        group: groupName,
      });
    });

    document.body.removeChild(tempSvg);

    return { viewBox, groups };
  }

  /**
   * Легке клонування даних, щоб не мутувати кеш.
   */
  function cloneGroups(original) {
    return {
      outline: original.outline.map((item) => ({ ...item })),
      details: original.details.map((item) => ({ ...item })),
      fills: original.fills.map((item) => ({ ...item })),
      fallback: original.fallback.map((item) => ({ ...item })),
    };
  }

  class MayaScene {
    constructor() {
      this.width = CONFIG.global.DESIGN_WIDTH;
      this.height = CONFIG.global.DESIGN_HEIGHT;
      this.viewBox = { x: 0, y: 0, width: 1, height: 1 };
      this.gender = "unspecified";
      this.tone = 1;
      this.signIndex = 1;
      this.signName = "Imix";
      this.paths = { outline: [], details: [], fills: [], fallback: [] };
      this.layout = null;
      this.strokeBase = 6;
      this.palette = this.pickPalette("unspecified");
      this.animation = { segments: [], elapsed: 0, totalDuration: 0, easing: "linear" };
      this.isReady = false;
      this.isLoading = false;
      this.canvasElement = document.getElementById("scene");
      this.intersectionObserver = null;
      this.isInView = true;
      this.shouldReduceMotion = false;
      this.matchMediaQuery = null;
      this.loadingPromise = null;
      this.state = "idle"; // Стейт-машина: idle → drawing → done.
      this.cachedSegments = []; // Кешуємо сегменти анімації, щоб швидко перемальовувати фінальні кадри.
      this.toneStrokeBase = 4; // Референтна товщина штрихів для числа (оновлюємо під час розкладки).

      this.handleVisibility = this.handleVisibility.bind(this);
      this.setupReducedMotionListener();
      this.ensureObserver();
    }

    /**
     * Налаштовуємо слухача для prefers-reduced-motion, щоб одразу вимикати анімацію.
     */
    setupReducedMotionListener() {
      if (typeof window.matchMedia !== "function") {
        return;
      }
      this.matchMediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
      this.shouldReduceMotion = this.matchMediaQuery.matches;
      const handler = (event) => {
        this.shouldReduceMotion = event.matches;
        if (this.shouldReduceMotion) {
          const endTime = this.animation.segments.reduce((acc, segment) => Math.max(acc, segment.start + segment.duration), 0);
          this.animation.elapsed = endTime;
          this.animation.totalDuration = endTime;
          this.state = "done";
        } else {
          this.animation.elapsed = 0;
          if (this.cachedSegments.length > 0) {
            this.state = "drawing";
          }
        }
      };
      if (typeof this.matchMediaQuery.addEventListener === "function") {
        this.matchMediaQuery.addEventListener("change", handler);
      } else if (typeof this.matchMediaQuery.addListener === "function") {
        this.matchMediaQuery.addListener(handler);
      }
    }

    /**
     * Запускаємо IntersectionObserver, щоб зупиняти малювання, коли канвас не у в'юпорті.
     */
    ensureObserver() {
      if (this.intersectionObserver || typeof IntersectionObserver !== "function") {
        return;
      }
      this.canvasElement = document.getElementById("scene");
      if (!this.canvasElement) {
        return;
      }
      this.intersectionObserver = new IntersectionObserver(this.handleVisibility, { threshold: 0.15 });
      this.intersectionObserver.observe(this.canvasElement);
    }

    handleVisibility(entries) {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      this.isInView = entry.isIntersecting;
    }

    /**
     * Добираємо палітру кольорів і параметри таймінгу залежно від статі.
     */
    pickPalette(gender) {
      if (gender === "male") {
        return {
          outline: "#2c3a5e",
          details: "#46a1b5",
          fills: "rgba(75, 148, 173, 0.2)",
          numberStroke: "#f1efe4",
          numberAccent: "#cbe7f1",
          backdrop: "rgba(23, 36, 60, 0.28)",
          easing: "linear",
        };
      }
      if (gender === "female") {
        return {
          outline: "#a14832",
          details: "#c4742f",
          fills: "rgba(193, 82, 74, 0.24)",
          numberStroke: "#f7e6d6",
          numberAccent: "#f0b288",
          backdrop: "rgba(69, 24, 18, 0.26)",
          easing: "easeOut",
        };
      }
      return {
        outline: "#6f5b49",
        details: "#b28f63",
        fills: "rgba(149, 112, 70, 0.22)",
        numberStroke: "#f6eddc",
        numberAccent: "#e7cfa6",
        backdrop: "rgba(56, 42, 32, 0.25)",
        easing: "easeInOut",
      };
    }

    /**
     * Акуратно оновлюємо тему кольорів без перезапуску таймлайну анімації.
     */
    updateTheme({ gender } = {}) {
      const nextGender = gender === "male" || gender === "female" ? gender : "unspecified";
      if (nextGender === this.gender && this.palette) {
        return;
      }
      this.gender = nextGender;
      this.palette = this.pickPalette(this.gender);

      const recolorSegment = (segment) => {
        if (!segment || typeof segment !== "object") {
          return;
        }
        if (segment.groupName === "outline") {
          segment.color = this.palette.outline;
        } else if (segment.groupName === "details") {
          segment.color = this.palette.details;
        } else if (segment.groupName === "fills") {
          segment.color = this.palette.fills;
        }
      };

      if (this.animation && Array.isArray(this.animation.segments)) {
        this.animation.segments.forEach(recolorSegment);
      }

      if (Array.isArray(this.cachedSegments) && this.cachedSegments !== this.animation.segments) {
        this.cachedSegments.forEach(recolorSegment);
      }

      if (this.animation && typeof this.animation === "object") {
        this.animation.easing = this.palette.easing || this.animation.easing;
      }
    }

    /**
     * Основний метод ініціалізації сцени: готуємо дату, палітру та завантажуємо SVG.
     */
    init(seedStr, prng, context = {}) {
      this.gender = context.gender === "male" || context.gender === "female" ? context.gender : "unspecified";
      this.palette = this.pickPalette(this.gender);
      this.canvasElement = document.getElementById("scene");
      this.ensureObserver();

      const fallbackDate = new Date(Date.UTC(2012, 11, 21));
      const dob = context.dob instanceof Date && !Number.isNaN(context.dob.getTime()) ? context.dob : fallbackDate;
      let tone = 1;
      let signIndex = 1;
      let signName = "Imix";
      try {
        const data = window.tzolkinFromDate ? window.tzolkinFromDate(dob) : { tone: 1, signIndex: 1, signName: "Imix" };
        tone = data.tone;
        signIndex = data.signIndex;
        signName = data.signName;
      } catch (error) {
        console.error("Помилка під час обчислення Цолькін:", error);
      }
      this.tone = tone;
      this.signIndex = signIndex;
      this.signName = signName;

      const svgUrl = window.mayaSvgPathFor ? window.mayaSvgPathFor(this.signIndex) : null;
      if (!svgUrl) {
        console.error("Не вдалося визначити шлях до SVG для знаку", this.signIndex);
        this.isReady = false;
        return;
      }

      this.isLoading = true;
      this.isReady = false;
      this.animation = { segments: [], elapsed: 0, totalDuration: 0, easing: this.palette.easing };
      this.cachedSegments = [];
      this.state = "idle";

      const cached = svgCache.get(svgUrl);
      const loadPromise = cached
        ? Promise.resolve(cached)
        : fetch(svgUrl)
            .then((response) => {
              if (!response.ok) {
                throw new Error(`Не вдалося завантажити SVG (${response.status})`);
              }
              return response.text();
            })
            .then((text) => {
              const parsed = parseSvgText(text);
              svgCache.set(svgUrl, parsed);
              return parsed;
            });

      this.loadingPromise = loadPromise
        .then((parsed) => {
          this.viewBox = parsed.viewBox;
          this.paths = cloneGroups(parsed.groups);
          this.isReady = true;
          this.isLoading = false;
          this.computeLayout();
          this.prepareAnimationPlan();
          this.updateAriaLabel();
        })
        .catch((error) => {
          console.error("Не вдалося опрацювати майянський гліф:", error);
          this.isReady = false;
          this.isLoading = false;
          this.state = "idle";
        });
    }

    /**
     * Оновлюємо aria-опис канви, щоб користувачі зі скрінрідерами розуміли зміст зображення.
     */
    updateAriaLabel() {
      if (!this.canvasElement) {
        return;
      }
      const genderLabel = this.gender === "male" ? "чоловічий ритм" : this.gender === "female" ? "жіночий ритм" : "нейтральний ритм";
      const label = `Майянський гліф ${this.signName} (знак ${this.signIndex}) з тоном ${this.tone}, ${genderLabel}.`;
      this.canvasElement.setAttribute("role", "img");
      this.canvasElement.setAttribute("aria-hidden", "false");
      this.canvasElement.setAttribute("aria-label", label);
    }

    /**
     * Обчислюємо розкладку сцени: область для числа та область для гліфа.
     */
    computeLayout() {
      if (!this.viewBox) {
        return;
      }
      const padding = Math.min(this.width, this.height) * 0.06;
      const availableWidth = Math.max(this.width - padding * 2, 0);
      const availableHeight = Math.max(this.height - padding * 2, 0);

      const toneGap = clamp(this.height * 0.03, 6, 16); // Адаптивний проміжок між числом і гліфом.
      const normalizedToneHeight = 24; // Нормалізована висота двох рисок і крапок у вихідному SVG.
      const toneHeightFactor = this.viewBox.width * (normalizedToneHeight / 40);

      // Обчислюємо масштаб гліфа так, щоб разом з числом він умістився в робочу область.
      const heightWithoutGap = Math.max(availableHeight - toneGap, 0);
      const scaleByWidth = this.viewBox.width > 0 ? availableWidth / this.viewBox.width : 1;
      const scaleByHeight = this.viewBox.height + toneHeightFactor > 0 ? heightWithoutGap / (this.viewBox.height + toneHeightFactor) : scaleByWidth;
      let glyphScale = Math.min(scaleByWidth, scaleByHeight);
      if (!Number.isFinite(glyphScale) || glyphScale <= 0) {
        glyphScale = Math.max(scaleByWidth, scaleByHeight, 0.001);
      }

      const glyphWidth = this.viewBox.width * glyphScale;
      const glyphHeight = this.viewBox.height * glyphScale;
      const toneHeight = toneHeightFactor * glyphScale;
      const totalBlockHeight = toneHeight + toneGap + glyphHeight;
      const remainingHeight = Math.max(availableHeight - totalBlockHeight, 0);
      const blockTop = padding + remainingHeight / 2;

      const glyphX = (this.width - glyphWidth) / 2;
      const toneCenterX = glyphX + glyphWidth / 2;
      const toneX = toneCenterX - glyphWidth / 2;
      const toneY = blockTop;
      const toneBottom = toneY + toneHeight;
      const glyphY = toneBottom + toneGap;

      const toneBox = {
        x: toneX,
        y: toneY,
        w: glyphWidth,
        h: toneHeight,
      };

      this.layout = {
        padding,
        glyphBox: { x: glyphX, y: glyphY, w: glyphWidth, h: glyphHeight },
        toneBox,
        toneGap,
        scale: glyphScale,
      };
      this.strokeBase = Math.max(4, glyphWidth * 0.014);
      this.toneStrokeBase = Math.max(1.5, glyphWidth * 0.014);
    }

    /**
     * Визначаємо послідовність малювання контурів і тривалість анімації.
     */
    prepareAnimationPlan() {
      if (!this.layout) {
        return;
      }
      const outlines = this.paths.outline.length > 0 ? this.paths.outline : this.paths.fallback;
      const details = this.paths.outline.length > 0 ? this.paths.details : [];
      const fills = this.paths.fills;

      const center = { x: this.viewBox.x + this.viewBox.width / 2, y: this.viewBox.y + this.viewBox.height / 2 };
      const sortedOutlines = sortContours(outlines, this.gender, center);
      const sortedDetails = sortContours(details, this.gender, center);
      const sortedFills = sortContours(fills, this.gender, center);

      const sequence = [];
      if (sortedOutlines.length) {
        sequence.push({ name: "outline", items: sortedOutlines, color: this.palette.outline, kind: "stroke", widthFactor: 1 });
      }
      if (sortedDetails.length) {
        sequence.push({ name: "details", items: sortedDetails, color: this.palette.details, kind: "stroke", widthFactor: 0.75 });
      }
      if (sortedFills.length) {
        sequence.push({ name: "fills", items: sortedFills, color: this.palette.fills, kind: "fill", widthFactor: 1 });
      }

      const totalPaths = sequence.reduce((acc, group) => acc + group.items.length, 0);
      let totalDuration;
      if (this.shouldReduceMotion || totalPaths === 0) {
        totalDuration = 0;
      } else if (this.gender === "male") {
        totalDuration = Math.min(5.4, Math.max(2.4, 1.5 + totalPaths * 0.22));
      } else if (this.gender === "female") {
        totalDuration = Math.min(6.0, Math.max(3.0, 2.2 + totalPaths * 0.26));
      } else {
        totalDuration = Math.min(5.8, Math.max(2.6, 1.8 + totalPaths * 0.24));
      }

      const weights = sequence.map((group) => {
        const base = group.items.length || 1;
        if (group.name === "outline") return base * 1.3;
        if (group.name === "details") return base * 0.9;
        return base * 0.7;
      });
      const totalWeight = weights.reduce((acc, value) => acc + value, 0) || 1;

      const segments = [];
      let currentTime = 0;

      sequence.forEach((group, index) => {
        const groupDuration = this.shouldReduceMotion ? 0 : (totalDuration * weights[index]) / totalWeight;
        const totalLength = group.items.reduce((acc, item) => acc + (item.length || 1), 0) || group.items.length;
        group.items.forEach((item) => {
          const share = totalLength > 0 ? (item.length || 1) / totalLength : 1 / group.items.length;
          const duration = this.shouldReduceMotion ? 0 : Math.max(groupDuration * share, 0.08);
          const segmentStart = this.shouldReduceMotion ? 0 : currentTime;
          segments.push({
            item,
            start: segmentStart,
            duration,
            kind: group.kind,
            color: group.color,
            widthFactor: group.widthFactor,
            groupName: group.name,
          });
          if (!this.shouldReduceMotion) {
            currentTime += duration;
          }
        });
        if (!this.shouldReduceMotion && index < sequence.length - 1) {
          const pause = Math.min(0.35, groupDuration * 0.18);
          currentTime += pause;
        }
      });

      const finalTime = segments.reduce((acc, segment) => Math.max(acc, segment.start + segment.duration), 0);
      this.animation = {
        segments,
        elapsed: this.shouldReduceMotion ? finalTime : 0,
        totalDuration: finalTime,
        easing: this.palette.easing,
      };
      this.cachedSegments = segments; // Зберігаємо чергу малювання, щоб можна було миттєво відновити фінальний кадр.
      if (this.shouldReduceMotion || finalTime === 0) {
        this.state = "done";
      } else {
        this.state = "drawing";
      }
    }

    /**
     * Застосовуємо узгоджене прискорення для різних палітр.
     */
    easeProgress(value) {
      const v = clamp01(value);
      if (this.animation.easing === "easeOut") {
        return 1 - (1 - v) * (1 - v);
      }
      if (this.animation.easing === "easeInOut") {
        if (v < 0.5) {
          return 2 * v * v;
        }
        return 1 - Math.pow(-2 * v + 2, 2) / 2;
      }
      return v;
    }

    update(dt) {
      // Керуємо перебігом анімації через просту стейт-машину, щоб можна було зупинятися та відновлюватися без перезапуску.
      if (!this.isReady) {
        return;
      }
      if (this.state === "done") {
        this.animation.elapsed = this.animation.totalDuration;
        return;
      }
      if (this.shouldReduceMotion) {
        this.animation.elapsed = this.animation.totalDuration;
        this.state = "done";
        return;
      }
      if (!this.isInView || this.state !== "drawing") {
        return;
      }
      this.animation.elapsed = Math.min(this.animation.elapsed + dt, this.animation.totalDuration);
      if (this.animation.elapsed >= this.animation.totalDuration) {
        this.animation.elapsed = this.animation.totalDuration;
        this.state = "done";
      }
    }

    draw(ctx) {
      if (!this.layout) {
        return;
      }

      // Очищаємо канву у координатах сцени, щоб не залишалось артефактів від попередніх кадрів.
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, this.width, this.height);

      if (!this.isReady) {
        // Якщо SVG ще не завантажено — показуємо легке повідомлення і припиняємо малювання на цьому кадрі.
        this.drawLoading(ctx);
        ctx.restore();
        return;
      }

      this.drawGlyph(ctx);

      if (this.state === "done") {
        // Число Цолькін промальовуємо вже після завершення контурної анімації, щоб акцент не розсіювався.
        this.drawTone(ctx);
      }

      ctx.restore();
    }

    drawLoading(ctx) {
      ctx.save();
      ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
      ctx.font = "28px 'Inter', 'Segoe UI', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Завантаження гліфа Майя…", this.width / 2, this.height / 2);
      ctx.restore();
    }

    drawGlyph(ctx) {
      const scale = this.layout.scale;
      const strokeScale = scale === 0 ? 1 : 1 / scale;
      const elapsed = this.animation.elapsed;

      ctx.save();
      ctx.translate(this.layout.glyphBox.x, this.layout.glyphBox.y);
      ctx.scale(scale, scale);
      ctx.translate(-this.viewBox.x, -this.viewBox.y);

      for (let i = 0; i < this.animation.segments.length; i += 1) {
        const segment = this.animation.segments[i];
        const { item, start, duration, kind, color, widthFactor } = segment;
        const rawProgress = duration > 0 ? (elapsed - start) / duration : 1;
        const easedProgress = this.state === "done" ? 1 : this.easeProgress(rawProgress);
        const progress = this.state === "done" ? 1 : easedProgress;
        if (progress <= 0) {
          continue;
        }
        ctx.save();
        if (kind === "fill") {
          ctx.globalAlpha = Math.min(progress, 1);
          ctx.fillStyle = color;
          ctx.fill(item.path);
        } else {
          ctx.strokeStyle = color;
          ctx.lineWidth = (this.strokeBase * (widthFactor || 1)) * strokeScale;
          ctx.lineJoin = "round";
          ctx.lineCap = "round";
          if (progress < 1 && !this.shouldReduceMotion && this.state === "drawing") {
            const dash = item.length || 1;
            ctx.setLineDash([dash, dash]);
            ctx.lineDashOffset = (1 - progress) * dash;
          } else {
            ctx.setLineDash([]);
          }
          ctx.stroke(item.path);
        }
        ctx.restore();
      }

      ctx.restore();
    }

    drawTone(ctx) {
      if (typeof window.drawTzolkinNumber !== "function") {
        return;
      }

      ctx.save();
      const toneBox = this.layout.toneBox;
      const estimatedNormalizedHeight = 24; // Сумарна висота двох барів і крапок у вихідному SVG (10.5..34.5).
      // Оцінюємо масштаб, у якому буде рендеритись число, щоб підігнати товщину рисок під товщину контурів гліфа.
      const baseScaleGuess = Math.min(
        toneBox.w / 40,
        toneBox.h / estimatedNormalizedHeight
      );
      const desiredLineWidth = Math.max(1.5, this.toneStrokeBase * 0.85);
      let lineWidthFactor = 1;
      if (baseScaleGuess > 0) {
        lineWidthFactor = desiredLineWidth / (4 * baseScaleGuess);
      }
      lineWidthFactor = Math.min(Math.max(lineWidthFactor, 0.6), 1.35);
      // Крапки робимо трошки компактнішими за риски, але зберігаємо пропорційність.
      const dotRadiusFactor = Math.min(Math.max(lineWidthFactor * 0.9, 0.75), 1.4);

      // Передаємо у візерунок колір контуру гліфа, щоб композиція виглядала цілісно.
      window.drawTzolkinNumber(ctx, this.tone, toneBox, {
        strokeColor: this.palette.outline,
        accentColor: this.palette.numberAccent || this.palette.outline,
        lineWidthFactor,
        dotRadiusFactor,
      });
      ctx.restore();
    }

    resize(width, height) {
      this.width = Math.max(width, 200);
      this.height = Math.max(height, 200);
      this.computeLayout();
    }

    relayout(width, height) {
      // Метод-зручність: дозволяє менеджеру сцен просто перерахувати геометрію без перезапуску анімації.
      this.resize(width, height);
    }

    // Сцена повністю 2D, тож методи керування режимом стають заглушками.
    force2dMode() {}
    resetModeLock() {}
    getMode() {
      return "2d";
    }
    isModeLockedTo2d() {
      return true;
    }
  }

  window.mayaScene = new MayaScene();
})();
