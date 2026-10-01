import { Club } from '@phosphor-icons/react/dist/csr/Club';
import { Diamond } from '@phosphor-icons/react/dist/csr/Diamond';
import { Heart } from '@phosphor-icons/react/dist/csr/Heart';
import { Spade } from '@phosphor-icons/react/dist/csr/Spade';
import { SUIT_NAME, rankLabel } from '../engine/cards';
import type { Card } from '../engine/types';

type Size = 'sm' | 'md' | 'lg';

function Face({ card }: { card: Card }) {
  const red = card.suit === 'H' || card.suit === 'D';
  const r = rankLabel(card.rank);
  const Suit = { H: Heart, D: Diamond, C: Club, S: Spade }[card.suit];
  return (
    <div className={`card-face front ${red ? 'red' : 'black'}`}>
      <span className="corner tl">
        <b>{r}</b>
        <Suit weight="fill" aria-hidden="true" />
      </span>
      <span className="pip"><Suit weight="fill" aria-hidden="true" /></span>
      <span className="corner br">
        <b>{r}</b>
        <Suit weight="fill" aria-hidden="true" />
      </span>
    </div>
  );
}

/** 可翻转的牌：faceUp=false 时显示牌背。card 为空时只能显示牌背。 */
export function PlayingCard({ card, faceUp, size = 'md', delay = 0 }: { card: Card | null; faceUp: boolean; size?: Size; delay?: number }) {
  const up = faceUp && card !== null;
  const label = up ? `${SUIT_NAME[card!.suit]}${rankLabel(card!.rank)}` : '暗牌';
  return (
    <div className={`card ${size} ${up ? 'up' : ''}`} role="img" aria-label={label} style={{ transitionDelay: `${delay}ms` }}>
      <div className="card-inner" style={{ transitionDelay: `${delay}ms` }}>
        <div className="card-face back" />
        {card && <Face card={card} />}
      </div>
    </div>
  );
}

export function CardRow({ cards, faceUp, size = 'md', dim = false }: { cards: Card[] | null; faceUp: boolean; size?: Size; dim?: boolean }) {
  return (
    <div className={`card-row ${dim ? 'dim' : ''}`}>
      {[0, 1, 2].map((i) => (
        // 牌背朝上时不把牌面渲染进 DOM，避免通过页面结构提前得知牌面
        <PlayingCard key={i} card={faceUp && cards ? cards[i] : null} faceUp={faceUp} size={size} delay={i * 90} />
      ))}
    </div>
  );
}
