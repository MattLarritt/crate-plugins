import type { UiPlugin } from '../../../types/contract';
import { IntelligentShufflePanel } from './panel';
import { IntelligentShuffleService } from './service';
import { IconIntelligentShuffle } from './icon';

/**
 * Intelligent Shuffle: a dynamic DJ over your own library. Votes nudge weights, weights decay,
 * the queue re-deals itself. The Service keeps a session fed while the window is closed —
 * which is the whole reason the Service slot exists.
 */
const intelligentShuffleUi: UiPlugin = {
  id: 'intelligent-shuffle',
  playbar: {
    title: 'Intelligent Shuffle',
    icon: IconIntelligentShuffle,
    Panel: IntelligentShufflePanel,
  },
  Service: IntelligentShuffleService,
};

export default intelligentShuffleUi;
