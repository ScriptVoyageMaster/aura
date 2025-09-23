import { initControls } from './src/ui/controls.js';
import { attachLayoutObservers } from './src/ui/layout.js';
import { SymbolScene } from './src/scenes/SymbolScene.js';

const canvas = document.getElementById('canvas');
const desc = document.getElementById('desc');
const scene = new SymbolScene(canvas, desc);

function resize(){
  scene.resize();
  scene.draw();
}
attachLayoutObservers();
window.addEventListener('resize', resize, { passive:true });
resize();

const controls = initControls({
  onRun: (dateStr)=> {
    scene.start(dateStr);
  },
  onLangChange: (lang)=> {
    scene.setLang(lang);
  },
  onHelp: ()=> {
    alert('Введи дату народження, обери мову та натисни «Запустити». Знак Майя промалюється анімовано. Єгипет і Кельти — найближчим часом.');
  }
});

// автозапуск для демо
scene.setLang(controls.getLang());
scene.start(controls.getDate());
