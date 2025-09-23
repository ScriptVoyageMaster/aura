export function applyStagePadding(){
  const controls = document.getElementById('controls');
  const stage = document.getElementById('stage');
  const h = controls.getBoundingClientRect().height;
  stage.style.paddingTop = `${Math.ceil(h + 10)}px`;
}

export function attachLayoutObservers(){
  applyStagePadding();
  window.addEventListener('resize', applyStagePadding, { passive:true });
  // Додатково спостерігаємо за зміненням висоти шапки, якщо це підтримує браузер
  if('ResizeObserver' in window){
    const ro = new ResizeObserver(()=> applyStagePadding());
    ro.observe(document.getElementById('controls'));
  }
}
