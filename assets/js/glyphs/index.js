// Реєстр гліфів Цолькін. Тут централізуємо всі імпорти, щоб зручно працювати з ними в інтерфейсі.
// На даному етапі файли містять тільки заглушки, але структура вже готова для розширення.

// Імпорти 20 гліфів:
import { glyph as IMIX } from './tzolkin/imix.js';
import { glyph as IK } from './tzolkin/ik.js';
import { glyph as AKBAL } from './tzolkin/akbal.js';
import { glyph as KAN } from './tzolkin/kan.js';
import { glyph as CHICCHAN } from './tzolkin/chicchan.js';
import { glyph as CIMI } from './tzolkin/cimi.js';
import { glyph as MANIK } from './tzolkin/manik.js';
import { glyph as LAMAT } from './tzolkin/lamat.js';
import { glyph as MULUC } from './tzolkin/muluc.js';
import { glyph as OC } from './tzolkin/oc.js';
import { glyph as CHUEN } from './tzolkin/chuen.js';
import { glyph as EB } from './tzolkin/eb.js';
import { glyph as BEN } from './tzolkin/ben.js';
import { glyph as IX } from './tzolkin/ix.js';
import { glyph as MEN } from './tzolkin/men.js';
import { glyph as CIB } from './tzolkin/cib.js';
import { glyph as CABAN } from './tzolkin/caban.js';
import { glyph as ETZNAB } from './tzolkin/etznab.js';
import { glyph as CAUAC } from './tzolkin/cauac.js';
import { glyph as AHAU } from './tzolkin/ahau.js';

// Мапа за ID (верхній регістр) → об’єкт гліфа
export const TZOLKIN_GLYPHS = {
  [IMIX.id]: IMIX,
  [IK.id]: IK,
  [AKBAL.id]: AKBAL,
  [KAN.id]: KAN,
  [CHICCHAN.id]: CHICCHAN,
  [CIMI.id]: CIMI,
  [MANIK.id]: MANIK,
  [LAMAT.id]: LAMAT,
  [MULUC.id]: MULUC,
  [OC.id]: OC,
  [CHUEN.id]: CHUEN,
  [EB.id]: EB,
  [BEN.id]: BEN,
  [IX.id]: IX,
  [MEN.id]: MEN,
  [CIB.id]: CIB,
  [CABAN.id]: CABAN,
  [ETZNAB.id]: ETZNAB,
  [CAUAC.id]: CAUAC,
  [AHAU.id]: AHAU
};

// Упорядкований список (1..20) — зручно для UI/перемикання:
export const TZOLKIN_ORDER = Object
  .values(TZOLKIN_GLYPHS)
  .sort((a, b) => a.order - b.order);
