// Розміщення «тонів» 1..13 у нормалізованій системі (1000x1000).
// Для спрощення: малюємо на «шапці» гліфа, y = -560..-520
export function drawMayanTone(ctx, tone){
  const baseY = -560;
  const dotR = 24;
  const gap = 30;

  ctx.save();
  ctx.lineWidth = 26;

  const drawDot = (x)=>{ ctx.beginPath(); ctx.arc(x, baseY, dotR, 0, Math.PI*2); ctx.stroke(); };
  const drawBar = (yOffset=0)=>{ ctx.beginPath(); ctx.moveTo(-160, baseY + yOffset); ctx.lineTo(160, baseY + yOffset); ctx.stroke(); };

  // Тони майя: 1..4 точки; 5 — риска; 6..9 — риска + 1..4 точки; 10 — 2 риски; 11..13 — 2 риски + точки
  if (tone >=1 && tone <=4){
    const start = -((tone-1)*gap)/2;
    for(let i=0;i<tone;i++){ drawDot(start + i*gap); }
  } else if (tone === 5){
    drawBar(0);
  } else if (tone >=6 && tone <=9){
    drawBar(0);
    const dots = tone-5;
    const start = -((dots-1)*gap)/2;
    for(let i=0;i<dots;i++){ drawDot(start + i*gap); }
  } else if (tone === 10){
    drawBar(-28); drawBar(28);
  } else if (tone >=11 && tone <=13){
    drawBar(-28); drawBar(28);
    const dots = tone-10;
    const start = -((dots-1)*gap)/2;
    for(let i=0;i<dots;i++){ drawDot(start + i*gap); }
  }

  ctx.restore();
}
