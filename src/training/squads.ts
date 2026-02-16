import type { GameConfig, UnitClass, UnitConfig, SideConfig } from "../types";

const ALL_CLASSES: UnitClass[] = ["sentinel", "specter", "oracle", "striker", "medic", "vector"];

const UNIT_NAMES: Record<UnitClass, string[]> = {
  sentinel: ["Bastion", "Rampart", "Bulwark", "Warden", "Aegis"],
  specter: ["Ghost", "Shade", "Phantom", "Wraith", "Veil"],
  oracle: ["Seer", "Prophet", "Watcher", "Insight", "Lens"],
  striker: ["Longshot", "Deadeye", "Hawk", "Marksman", "Bolt"],
  medic: ["Doc", "Pulse", "Remedy", "Patch", "Lifeline"],
  vector: ["Viper", "Weaver", "Lattice", "Snare", "Grid"],
};

const TACTICAL_PROMPTS: Record<UnitClass, string[]> = {
  sentinel: [
    "Advance toward the nearest enemy. Use shield_wall facing the direction with the most enemies. If an enemy is adjacent, attack them.",
    "Hold the front line. Position between allies and enemies. Use shield_wall toward incoming threats. Attack adjacent enemies.",
    "Push forward aggressively. Shield_wall facing the enemy cluster. If flanked, turn to face the biggest threat. Attack when possible.",
  ],
  specter: [
    "Cloak immediately on turn 1. Move toward the enemy medic or weakest target. Use shadow_strike when adjacent while cloaked. Use breach to sabotage high-value targets.",
    "Stay cloaked and flank. Prioritize assassinating the enemy damage dealer. Use breach on sentinels to break their defensive posture. Recloak whenever it drops.",
    "Cloak and move behind enemy lines. Target isolated enemies with shadow_strike. Save breach for the most dangerous enemy. Avoid being caught uncloaked.",
  ],
  oracle: [
    "Use foresight to reveal enemy positions and cloaked units. Stay at max range. Use mind_spike on the highest-threat target. Keep distance from enemies.",
    "Scan the battlefield with foresight each turn. Focus mind_spike on wounded enemies to secure kills. Stay behind allies and maintain range.",
    "Use foresight early to give your team intel. Target enemy specters with mind_spike to break cloak. Stay safe at range behind your front line.",
  ],
  striker: [
    "Stay at maximum range. Use precision_shot on the most wounded enemy to secure kills. If no one is wounded, target the enemy medic. Never move adjacent to enemies.",
    "Maintain distance. Use precision_shot on high-value targets — medics first, then damage dealers. Use suppressing_fire if enemies close in.",
    "Position for clear sight lines. Prioritize killing wounded enemies with precision_shot. If forced to move, retreat away from threats. Suppressing_fire to slow rushers.",
  ],
  medic: [
    "Stay adjacent to the most threatened ally. Use patch on the most wounded teammate. If all healthy, use overclock on your damage dealer.",
    "Keep your frontliner alive with patch. Stay behind them for cover. Overclock your striker or specter when no healing is needed.",
    "Prioritize healing the lowest HP ally. Position safely behind your sentinel. Use overclock on allies who can do the most with an extra action.",
  ],
  vector: [
    "Place traps on tiles enemies are likely to move through. Use pulse if 2+ enemies are adjacent. Stay near allies for mutual support.",
    "Control chokepoints with traps. Place them between enemy positions and your allies. Use denial to block adjacent enemy abilities. Pulse groups when possible.",
    "Trap the paths enemies must take to reach your backline. Stay at medium range. Use pulse on clustered enemies. Denial blocks adjacent threats.",
  ],
};

const PLACEMENT_PROMPTS: string[] = [
  "Place the tankiest unit center front. Ranged units in the back. Flankers on the edges.",
  "Spread units across the front with ranged support behind. Keep the medic protected.",
  "Cluster near the center for mutual support. Front-liner forward, others one row back.",
  "Place aggressive units forward on one flank. Support units behind and toward center.",
];

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function pickNRandom<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

function generateSide(): SideConfig {
  const classes = pickNRandom(ALL_CLASSES, 3);
  const usedNames = new Set<string>();
  const units: UnitConfig[] = classes.map((cls) => {
    const available = UNIT_NAMES[cls].filter((n) => !usedNames.has(n));
    const name = pickRandom(available.length > 0 ? available : UNIT_NAMES[cls]);
    usedNames.add(name);
    return {
      name,
      class: cls,
      prompt: pickRandom(TACTICAL_PROMPTS[cls]),
    };
  });
  return {
    units,
    placementPrompt: pickRandom(PLACEMENT_PROMPTS),
  };
}

export function generateRandomConfig(): GameConfig {
  return {
    player: generateSide(),
    opponent: generateSide(),
  };
}
