// Гліф Майя: Cauac (Буря). Нормалізована система 1000x1000, центр (0,0).
// Малюємо поетапно: 1) картуш, 2) хмарні дуги, 3) блискавка, 4) тон.
export default function drawCauac(ctx, progress, style, extras){
  const { stroke = '#cfeef7', glowColor = 'rgba(40,164,201,.35)', lineWidth = 12, shadowBlur = 8 } = style || {};
  const tone = extras?.tone ?? 5;

  const p1 = Math.min(progress, 0.45) / 0.45;      // картуш
  const p2 = progress < 0.45 ? 0 : Math.min((progress-0.45)/0.25, 1); // хмари
  const p3 = progress < 0.70 ? 0 : Math.min((progress-0.70)/0.20, 1); // блискавка
  const p4 = progress < 0.90 ? 0 : Math.min((progress-0.90)/0.10, 1); // тон

  ctx.save();
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = stroke;
  ctx.shadowBlur = shadowBlur;
  ctx.shadowColor = glowColor;

  // 1) Картуш (округлений прямокутник)
  if (p1 > 0){
    roundedPartialRect(ctx, -420, -380, 840, 760, 90, p1);
  }

  // 2) Хмарні дуги (три сегменти усередині)
  if (p2 > 0){
    const cloud = [
      { cx:-220, cy:-30, r:120, start: Math.PI*1.1, end: Math.PI*1.95 },
      { cx:   0, cy: -60, r:150, start: Math.PI*1.15, end: Math.PI*1.95 },
      { cx: 220, cy: -30, r:120, start: Math.PI*1.1, end: Math.PI*1.95 }
    ];
    cloud.forEach(({cx,cy,r,start,end})=>{
      arcPartial(ctx, cx, cy, r, start, end, p2);
    });
  }

  // 3) Блискавка (знизу)
  if (p3 > 0){
    const zz = [
      {x:-80, y:120}, {x:-140, y:240}, {x:-40, y:240}, {x:-120, y:360}
    ];
    polylinePartial(ctx, zz, p3);
  }

  // 4) Тон — шапка зверху
  if (p4 > 0){
    ctx.globalAlpha = p4;
    // намалюємо поверх stroke — використається загальний стиль сцени через data/tone.js
    // тут лише місце-планка (щоб не класти залежність напряму)
    // (реальний рендер тону робить сцена після виклику цього гліфа)
  }

  ctx.restore();
}

// Допоміжні — часткове малювання
function roundedPartialRect(ctx, x, y, w, h, r, t){
  // 4 сторони + 4 кути = 8 сегментів. Малюємо від верх-ліво по год.стрілці.
  const segs = [];
  const right = x + w, bottom = y + h;
  // Вершини кутів
  const TL = {x:x+r, y:y}; const TR={x:right-r, y:y}; const BR={x:right, y:bottom-r}; const BL={x:x+r, y:bottom};
  // Верхня пряма
  segs.push({type:'line', from:{x:TL.x, y:TL.y}, to:{x:TR.x, y:TR.y}});
  // Верхній правий кут
  segs.push({type:'arc', cx:right-r, cy:y+r, r, start: -Math.PI/2, end: 0});
  // Права пряма
  segs.push({type:'line', from:{x:right, y:y+r}, to:{x:right, y:bottom-r}});
  // Нижній правий кут
  segs.push({type:'arc', cx:right-r, cy:bottom-r, r, start: 0, end: Math.PI/2});
  // Нижня пряма
  segs.push({type:'line', from:{x:TR.x, y:bottom}, to:{x:BL.x, y:bottom}});
  // Нижній лівий кут
  segs.push({type:'arc', cx:x+r, cy:bottom-r, r, start: Math.PI/2, end: Math.PI});
  // Ліва пряма
  segs.push({type:'line', from:{x:x, y:bottom-r}, to:{x:x, y:y+r}});
  // Верхній лівий кут
  segs.push({type:'arc', cx:x+r, cy:y+r, r, start: Math.PI, end: Math.PI*1.5});

  drawSegmentsPartial(ctx, segs, t);
}

function arcPartial(ctx, cx, cy, r, a0, a1, t){
  const seg = [{type:'arc', cx, cy, r, start:a0, end:a1}];
  drawSegmentsPartial(ctx, seg, t);
}

function polylinePartial(ctx, pts, t){
  const segs = [];
  for(let i=0;i<pts.length-1;i++){
    segs.push({type:'line', from:pts[i], to:pts[i+1]});
  }
  drawSegmentsPartial(ctx, segs, t, pts[0]);
}

function drawSegmentsPartial(ctx, segs, t, moveToFirst){
  // оцінка загальної довжини
  const lengths = segs.map(s=> segLength(s));
  const total = lengths.reduce((a,b)=>a+b,0);
  const target = total * t;
  let acc = 0;

  ctx.beginPath();
  if (moveToFirst){ ctx.moveTo(moveToFirst.x, moveToFirst.y); }

  for(let i=0;i<segs.length;i++){
    const s = segs[i], L = lengths[i];
    if (acc + L <= target){
      drawSeg(ctx, s, 1);
      acc += L;
    } else if (acc < target){
      const remain = target - acc;
      const frac = Math.max(0, Math.min(1, remain / L));
      drawSeg(ctx, s, frac);
      acc = target; break;
    } else {
      break;
    }
  }
  ctx.stroke();
}

function segLength(s){
  if (s.type==='line'){
    const dx = s.to.x - s.from.x, dy = s.to.y - s.from.y;
    return Math.hypot(dx, dy);
  }
  if (s.type==='arc'){
    const sweep = Math.abs(s.end - s.start);
    return Math.abs(s.r * sweep);
  }
  return 0;
}
function drawSeg(ctx, s, frac){
  if (s.type==='line'){
    const x = s.from.x + (s.to.x - s.from.x)*frac;
    const y = s.from.y + (s.to.y - s.from.y)*frac;
    ctx.moveTo(s.from.x, s.from.y);
    ctx.lineTo(x, y);
  } else if (s.type==='arc'){
    const ang = s.start + (s.end - s.start)*frac;
    ctx.arc(s.cx, s.cy, s.r, s.start, ang, s.end < s.start);
  }
}
