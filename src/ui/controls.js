export function initControls({ onRun, onLangChange, onHelp }) {
  const birth = document.getElementById('birthdate');
  const run   = document.getElementById('runBtn');
  const help  = document.getElementById('helpBtn');
  const langBtns = [...document.querySelectorAll('.lang-switch .lang')];

  // Значення за замовчуванням: поточна дата (можна змінити на порожнє при потребі)
  if(!birth.value){
    const d = new Date(); const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    birth.value = `${y}-${m}-${day}`;
  }

  // Запуск обчислень за кнопкою
  run.addEventListener('click', ()=> onRun?.(birth.value));
  // Просте модальне вікно підказки
  help.addEventListener('click', ()=> onHelp?.());

  // Перемикання мови — актуалізуємо aria-pressed та викликаємо колбек
  langBtns.forEach(btn=>{
    btn.addEventListener('click', ()=>{
      langBtns.forEach(b=>b.setAttribute('aria-pressed','false'));
      btn.setAttribute('aria-pressed','true');
      onLangChange?.(btn.dataset.lang);
    });
  });

  return {
    getDate: ()=> birth.value,
    getLang: ()=> langBtns.find(b=>b.getAttribute('aria-pressed')==='true')?.dataset.lang || 'uk'
  };
}
