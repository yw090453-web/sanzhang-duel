import { useEffect, useState, useSyncExternalStore } from 'react';
import { GameController } from './controller/GameController';
import { getBrowserStorage } from './storage/save';
import { FinalPage } from './ui/FinalPage';
import { GamePage } from './ui/GamePage';
import { StartPage } from './ui/StartPage';
import { OnlinePage } from './online/OnlinePage';
import { readLocal } from './online/useOnline';

type View = 'start' | 'game' | 'final' | 'online';

export default function App() {
  const [controller] = useState(() => new GameController({ storage: getBrowserStorage() }));
  // 刷新后若有未完成对局，直接恢复到对局页
  const [view, setView] = useState<View>(() => {
    const saved = controller.init();
    if (!location.hostname.endsWith('.github.io') && (new URLSearchParams(location.search).has('room') || readLocal('night-table-room'))) return 'online';
    return saved === 'resumable' ? 'game' : 'start';
  });
  const snap = useSyncExternalStore(controller.subscribe, controller.getSnapshot);

  useEffect(() => {
    if (view === 'game') controller.enter();
    else controller.leave();
  }, [view, controller]);

  if (view === 'online') return <OnlinePage onHome={() => setView('start')} />;

  if (view === 'final' && snap.match?.finished) {
    return (
      <FinalPage
        match={snap.match}
        onHome={() => {
          controller.finishAndClear();
          setView('start');
        }}
      />
    );
  }

  if (view === 'game' && snap.match) {
    const goHome = () => {
      controller.finishAndClear(); // 仅在整场已结束时生效
      setView('start');
    };
    return <GamePage snap={snap} controller={controller} onHome={goHome} onFinal={() => setView('final')} />;
  }

  return <StartPage snap={snap} controller={controller} onPlay={() => setView('game')} onOnline={() => setView('online')} />;
}
