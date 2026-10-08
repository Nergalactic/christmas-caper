// First-scene onboarding checklist. Pure functions over GameState flags;
// panorama-ui.js decides when to set each flag and how to render the list.
// This is a UI-layer training wheel, not story state: it never gates a
// hotspot.

export const TUTORIAL_STEPS = [
  {
    id: "look",
    label: "Look around: drag anywhere on the scene",
    isDone: (state) => state.flag("tutorial_looked"),
  },
  {
    id: "hotspot",
    label: "Tap a glowing marker to interact with it",
    isDone: (state) => state.flag("tutorial_tapped_hotspot"),
  },
  {
    id: "goggles",
    label: "Put on your tinsel goggles",
    isDone: (state) => state.flag("tutorial_used_goggles"),
    isUnlocked: (state) => state.flag("has_goggles"),
  },
  {
    id: "menu",
    label: "Open the menu",
    isDone: (state) => state.flag("tutorial_opened_menu"),
  },
];

export function isTutorialComplete(state) {
  return TUTORIAL_STEPS.every((step) => (step.isUnlocked && !step.isUnlocked(state)) || step.isDone(state));
}

export function skipTutorial(state) {
  state.setFlag("tutorial_looked");
  state.setFlag("tutorial_tapped_hotspot");
  state.setFlag("tutorial_used_goggles");
  state.setFlag("tutorial_opened_menu");
  state.setFlag("tutorial_skipped");
}
