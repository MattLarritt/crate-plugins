import type { UiPlugin } from '../../../types/contract';
import { ChordPanel } from './panel';
import { ChordSheetsPane } from './pane';
import { IconGuitar } from './icon';

/**
 * Chord sheets, the client half. The default export is the installable contract: crate
 * import()s this bundle and reads the UiPlugin off module.default. The stylesheet ships as a
 * sibling style.css named in the manifest — crate injects it as a <link> when it loads this.
 */
const chordsUi: UiPlugin = {
  id: 'chords',
  playbar: {
    title: 'Chords and notes',
    icon: IconGuitar,
    Panel: ChordPanel,
  },
  profile: {
    label: 'Chords & notes',
    hint: 'what you have written down',
    Pane: ChordSheetsPane,
  },
};

export default chordsUi;
