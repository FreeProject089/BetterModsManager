// Every story stories.mjs records, in the order of the docs and of stories.json.
import { newGame } from './new-game.mjs';
import { shareSetup } from './share-setup.mjs';
import { makeItYours } from './make-it-yours.mjs';
import { automate } from './automate.mjs';
import { buildPlugin } from './build-plugin.mjs';
import { createTutorial } from './create-tutorial.mjs';
import { fixAMod } from './fix-a-mod.mjs';
import { shareList } from './share-list.mjs';
import { catalogues } from './catalogues.mjs';
import { everyday } from './everyday.mjs';

export const stories = [newGame, shareSetup, makeItYours, automate, buildPlugin, createTutorial, fixAMod, shareList, catalogues, everyday];
