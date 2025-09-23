// Майя: 20 знаків у порядку Цолькін (0..19)
const MAYAN_SIGNS = [
  'imix','ik','akbal','kan','chicchan','kimi','manik','lamat','muluk','ok',
  'chuen','eb','ben','ix','men','cib','caban','etznab','cauac','ahau'
];

// Юліанський день
function toJDN(dateStr){
  const d = new Date(dateStr);
  const a = Math.floor((14 - (d.getMonth()+1))/12);
  const y = d.getFullYear() + 4800 - a;
  const m = (d.getMonth()+1) + 12*a - 3;
  const jdn = d.getDate() + Math.floor((153*m + 2)/5) + 365*y + Math.floor(y/4) - Math.floor(y/100) + Math.floor(y/400) - 32045;
  return jdn;
}

// GMT кореляція 584283
export function getMayanSign(dateStr){
  const jdn = toJDN(dateStr);
  const count = jdn - 584283;
  const signIndex = ((count % 20) + 20) % 20;
  const tone = ((count % 13) + 13) % 13 + 1;
  return {
    signId: MAYAN_SIGNS[signIndex],
    tone
  };
}

// Плейсхолдери для Єгипту/Кельтів — додамо реальні мапи пізніше
export function getEgyptSign(dateStr){
  // Проста демонстраційна група: розіб'ємо місяць на діапазони
  const m = new Date(dateStr).getMonth()+1;
  const signId = (m===8||m===9) ? 'horus' : 'isis'; // тимчасово
  return { signId };
}

export function getCelticTree(dateStr){
  const d = new Date(dateStr);
  const md = `${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  // Умовна перевірка для Pine (24.08–02.09)
  const pine = (md>='08-24' && md<='09-02');
  return { signId: pine ? 'pine' : 'oak' }; // тимчасово
}

// Описові тексти — приклад для демо
export const descriptions = {
  mayan: {
    cauac: {
      uk: {
        title: 'Cauac (Буря)',
        traits: ['Трансформація','Очищення','Сила'],
        body: 'Стихія, що змиває старе й народжує новий порядок. У поєднанні з правильним тоном стає опорою під час змін.'
      },
      en: {
        title: 'Cauac (Storm)',
        traits: ['Transformation','Cleansing','Power'],
        body: 'A force that washes away the old and brings renewal. With the right tone it stabilizes change.'
      }
    }
  },
  egypt: {
    horus: {
      uk:{title:'Гор (Horus)',traits:['Захист','Справедливість','Лідерство'],body:'Сокіл неба. Бачить широку картину, веде до порядку.'},
      en:{title:'Horus',traits:['Protection','Justice','Leadership'],body:'Falcon of the sky. Sees the big picture and leads to order.'}
    }
  },
  celtic: {
    pine: {
      uk:{title:'Сосна (Pine)',traits:['Витривалість','Гармонія','Спокій'],body:'Витримує бурі й час. Символ внутрішньої сили та рівноваги.'},
      en:{title:'Pine',traits:['Endurance','Harmony','Calm'],body:'Withstands storms and time. A sign of inner strength and balance.'}
    }
  }
};
