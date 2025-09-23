import { getMayanSign, getEgyptSign, getCelticTree, descriptions } from '../data/calendars.js';
import { drawMayanTone } from '../data/tone.js';
import drawCauac from '../glyphs/mayan/cauac.js';

const MAYAN_DRAWERS = {
  cauac: drawCauac
};
const STYLE = {
  stroke: '#cfeef7',
  glowColor: 'var(--accent-glow)',
};

export class SymbolScene{
  constructor(canvas, descNode){
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.descNode = descNode;
    this.w = 0; this.h = 0;
    this.progress = 0;
    this.running = false;
    this.lang = 'uk';
    this.active = null; // { calendar: 'mayan'|'egypt'|'celtic', id, extras }
  }

  setLang(lang){ this.lang = lang || 'uk'; }
  resize(){
    const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
    const rect = this.canvas.getBoundingClientRect();
    this.w = Math.max(200, Math.floor(rect.width * dpr));
    this.h = Math.max(200, Math.floor(rect.height * dpr));
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.ctx.setTransform(1,0,0,1,0,0);
    this.ctx.scale(dpr, dpr);
  }

  start(dateStr){
    // Для MVP — малюємо тільки Майя (реалізовано Cauac)
    const mayan = getMayanSign(dateStr);
    this.active = { calendar:'mayan', id: mayan.signId, extras: { tone: mayan.tone } };
    this.describe('mayan', mayan.signId);

    this.progress = 0;
    this.running = true;
    this._tick();
  }

  describe(cal, id){
    const desc = descriptions?.[cal]?.[id]?.[this.lang] || null;
    if(!desc){ this.descNode.textContent = ''; return; }
    const traits = (desc.traits||[]).map(t=>`<span class="chip">${t}</span>`).join(' ');
    this.descNode.innerHTML = `
      <h3 style="margin:.25rem 0 0.35rem 0">${desc.title}</h3>
      <p style="margin:.25rem 0 .5rem 0; color:var(--muted)">${traits}</p>
      <p style="margin:0">${desc.body}</p>
    `;
  }

  _tick = () =>{
    if(!this.running) return;
    this.progress = Math.min(1, this.progress + 1/60 * 0.8); // ~1.25s
    this.draw();
    if(this.progress < 1) requestAnimationFrame(this._tick);
    else this.running = false;
  }

  draw(){
    const ctx = this.ctx;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;

    ctx.clearRect(0,0,w,h);

    // Нормалізований простір
    ctx.save();
    const target = Math.min(w, h) * 0.72;
    const scale = target / 1000;
    const lw = Math.max(3, Math.min(10, target*0.012));

    ctx.translate(w/2, h/2);
    ctx.scale(scale, scale);

    const style = { stroke: getComputedStyle(document.documentElement).getPropertyValue('--fg') || STYLE.stroke,
                    glowColor: getComputedStyle(document.documentElement).getPropertyValue('--accent-glow') || STYLE.glowColor,
                    lineWidth: lw, shadowBlur: 8 };

    if(this.active?.calendar === 'mayan'){
      const fn = MAYAN_DRAWERS[this.active.id] || null;
      if (fn){
        ctx.strokeStyle = style.stroke; ctx.lineWidth = style.lineWidth; ctx.shadowBlur = style.shadowBlur; ctx.shadowColor = style.glowColor;
        fn(ctx, this.progress, style, this.active.extras);

        // Тон — окремим шаром після гліфа, щоб був поверх
        if (this.progress >= 0.90){
          ctx.strokeStyle = style.stroke;
          drawMayanTone(ctx, this.active.extras.tone);
        }
      } else {
        // fallback — рамка
        ctx.strokeStyle = style.stroke; ctx.lineWidth = lw;
        ctx.strokeRect(-400, -300, 800, 600);
      }
    }
    ctx.restore();
  }
}
