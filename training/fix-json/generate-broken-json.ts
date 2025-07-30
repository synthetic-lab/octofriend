import { t } from "structural";
import path from "path";
import fs from "fs/promises";
import json5 from "json5";
import create from "../../source/tools/tool-defs/create.ts";
import { fileURLToPath } from "url";
import { fixJsonPrompt, JsonFixResponse } from "../../source/autofix-prompts.ts";
import { genDiffs } from "../generate-edits.ts";
import { cutIndex, insertAt } from "../str.ts";
import { randomIndex, pickRandom, zeroToN, percentChance, randomLowercase } from "../random.ts";
import { tryexpr } from "../../source/tryexpr.ts";
import {
  parseJson, JSONASTNode, NullNode, NumberNode, StringNode, ArrayNode, ObjectNode, BooleanNode
} from "./json-parser.ts";
import { generateJSON } from "./json-generator.ts";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

type FixResponse = t.GetType<typeof JsonFixResponse>;

const TRAIN_PATH = path.join(__dirname, "unfat/output/data/train.jsonl");
const EVAL_PATH = path.join(__dirname, "unfat/output/data/eval.jsonl");
const MAX_NUM_BREAKS = 3;
const MAX_AST_BREAKS = {
  null: 1,
  boolean: 1,
  number: 1,
  string: 3,
  array: 3,
  object: 3,
};
const DIFF_GEN_PERCENT = 0.02;
const EVAL_PERCENT = 0.2;
const NOT_JSON_PERCENT = 0.1;
const JSON5_PERCENT = 0.01;
const NEST_PERCENT = 0.05;
const MAX_NESTING = 5;
const NUM_GENERATED_SAMPLES = 10_000;

const REPOS_DIR = path.join(path.dirname(__dirname), "repos");

async function main() {
  try {
    await fs.rm(TRAIN_PATH);
    await fs.rm(EVAL_PATH);
  } catch {}
  await fs.mkdir(path.dirname(TRAIN_PATH), { recursive: true });
  await fs.writeFile(TRAIN_PATH, "");
  await fs.writeFile(EVAL_PATH, "");

  await genBrokenJsonFromArray("Number", [ -1111.8 ]);
  console.log("Generating synthetic JSON...");
  const samples: any[] = [];
  for(let i = 0; i < NUM_GENERATED_SAMPLES; i++) {
    samples.push(JSON.parse(generateJSON(false)));
    if(i % 200 === 0) console.log(`Generated ${i}...`);
  }
  console.log("Synth data generated; breaking...");
  await genBrokenJsonFromArray("Generated JSON", samples);

  const pokedex = JSON.parse(await fs.readFile(
    path.join(__dirname, "json-repos/pokedex/pokedex.json"),
    "utf8"
  ));
  await genBrokenJsonFromArray("Pokedex", pokedex["pokemon"]);

  const reps = JSON.parse(await fs.readFile(
    path.join(__dirname, "json-repos/us-representatives.json"),
    "utf8",
  ));
  await genBrokenJsonFromArray("US Representatives", reps["objects"]);

  const reddit = await fs.readdir(path.join(__dirname, "json-repos/reddit"));
  for(const redditJson of reddit) {
    const parsed = JSON.parse(await fs.readFile(
      path.join(__dirname, "json-repos/reddit", redditJson),
      "utf8",
    ));
    await genBrokenJsonFromArray(`/r/${redditJson}`, parsed["data"]["children"]);
  }

  const movies2010 = JSON.parse(await fs.readFile(
    path.join(__dirname, "json-repos/wikipedia-movie-data/movies-2010s.json"),
    "utf8",
  ));
  await genBrokenJsonFromArray("Movies (2010s)", movies2010);

  const movies2020 = JSON.parse(await fs.readFile(
    path.join(__dirname, "json-repos/wikipedia-movie-data/movies-2020s.json"),
    "utf8",
  ));
  await genBrokenJsonFromArray("Movies (2020s)", movies2020);

  const repos = await fs.readdir(REPOS_DIR);
  for(const repo of repos) {
    console.log("Generating broken JSON for", repo);
    await genBrokenJsonForRepo(path.join(REPOS_DIR, repo));
  }
}

async function genBrokenJsonFromArray(name: string, array: any[]) {
  let count = 0;
  for await(const obj of array) {
    count++;
    const sample = randomlyBreak(JSON.stringify(obj));
    const outputPath = percentChance(EVAL_PERCENT) ? EVAL_PATH : TRAIN_PATH;
    const messages = [
      {
        role: "user",
        content: fixJsonPrompt(sample.input),
      },
      {
        role: "assistant",
        content: sample.groundTruth,
      },
    ];
    await fs.appendFile(outputPath, JSON.stringify({
      messages
    }) + "\n", "utf8");
    if(count % 200 === 0) console.log(`Broke ${count}...`);
  }
  console.log(`Generated ${count} samples for`, name);
}

async function genBrokenJsonForRepo(path: string) {
  let count = 0;
  for await(const sample of getSamplesForRepo(path)) {
    count++;
    const outputPath = Math.random() > EVAL_PERCENT ? TRAIN_PATH : EVAL_PATH;
    const messages = [
      {
        role: "user",
        content: fixJsonPrompt(sample.input),
      },
      {
        role: "assistant",
        content: sample.groundTruth,
      },
    ];
    await fs.appendFile(outputPath, JSON.stringify({
      messages
    }) + "\n", "utf8");
  }
  console.log(`Broke and stored ${count} samples for`, path);
}

type Sample = {
  input: string,
  groundTruth: string,
};

async function* getSamplesForRepo(dirpath: string): AsyncGenerator<Sample> {
  for await(const diff of genDiffs(path.join(dirpath, ".git"))) {
    if(!percentChance(DIFF_GEN_PERCENT)) continue;
    yield randomlyBreak(JSON.stringify(diff));
  }

  for await(const sourceFile of getSourceFiles(dirpath)) {
    const file = await fs.readFile(sourceFile, "utf8");
    const [ err, _ ] = tryexpr(() => JSON.parse(file));

    if(err == null) {
      yield randomlyBreak(file);
      continue;
    }

    if(percentChance(NOT_JSON_PERCENT)) {
      yield {
        input: file,
        groundTruth: JSON.stringify({ success: false } satisfies FixResponse),
      };
      continue;
    }

    const createEdit: t.GetType<typeof create.ArgumentsSchema> = {
      filePath: sourceFile,
      content: file,
    };
    yield randomlyBreak(JSON.stringify(createEdit));
  }
}

// Random keys to use for nesting, generated by Kimi K2
const keyNamePool: string[] = [
  'accentHue', 'accountHandle', 'aetherToken', 'aliasHash', 'altitude', 'apiRev', 'asymKeyTag',
  'auditEpoch', 'axisX', 'badgeUri', 'baseTimeIso', 'bearingDeg', 'binaryFmt', 'birthSecond',
  'blinker', 'blurbHtml', 'bounceMs', 'burrow', 'caThumb', 'cadenceMs', 'captionMd', 'catchphrase',
  'censusTract', 'centroidLat', 'chakraIndex', 'charterDate', 'chorusId', 'cipherNonce', 'civicId',
  'clerkCode', 'clickDepth', 'clipboardSig', 'codec', 'colorway', 'crewName', 'deltaUs',
  'deltaWing', 'deniableKey', 'depthFt', 'detailYaml', 'deviceUuid', 'dripTheme', 'driver',
  'dwellSec', 'elevationEofe', 'emblemSvg', 'entityTag', 'ephemSeed', 'epochNonce', 'etherFlick',
  'errCount', 'excerptTxt', 'favoriteLocale', 'flagsBitset', 'flareIndex', 'flashNonce', 'fluxCap',
  'forename', 'forkBcrypt', 'franchiseTag', 'freezeSec', 'fuzzyHash', 'gamePreset', 'genesisEpoch',
  'geoCell', 'glancePct', 'glitchAura', 'glitchSpan', 'gpgArmor', 'hash512', 'headline',
  'hearthTone', 'hemisphere', 'hypeScore', 'hushSeed', 'iconPack', 'identityNonce', 'imprint',
  'infuseRatio', 'intensityF', 'intlLocale', 'ivSeed', 'jiffyStamp', 'jinxCode', 'jitterCap',
  'jitterUs', 'jointKey', 'journeyId', 'jweToken', 'karmaDelta', 'kernelVer', 'keySlot',
  'kickoffEpoch', 'kickerLine', 'kitStyle', 'kudosToken', 'ledgerJson', 'legacyMask',
  'lifecyclePhase', 'lineageToken', 'lithiumMark', 'localOffset', 'longitude', 'loreRoot',
  'loungedId', 'luminance', 'luminosityMax', 'lureVal', 'luminaTheme', 'macHmac', 'mapChunk',
  'memoRaw', 'memorabilia', 'mercatorTile', 'metaHint', 'mglCoords', 'millisecondOffset',
  'mimeType', 'mintimeFlag', 'mirrorSig', 'mirthSeed', 'missionStack', 'modIndex', 'moduleVer',
  'monikerSlug', 'moonEpoch', 'morphTag', 'motifId', 'neonHex', 'nilScore', 'nirvanaTick', 'norm',
  'northing', 'notaryCode', 'notesField', 'nthElement', 'nullBits', 'oblivionSalt', 'offsetTick',
  'omenTick', 'oracleRank', 'orionKey', 'overture', 'pageRank', 'pagerankNorm', 'paletteTweak',
  'paradigmFlag', 'parableCbor', 'paramsDict', 'parsecOffset', 'passphraseHint', 'perigeeKm',
  'personaSketch', 'pinOffset', 'pingJitter', 'pipelineVer', 'planetaryDay', 'polygon', 'portalId',
  'postcard', 'powerPct', 'praxisId', 'precessSpan', 'presetBlob', 'prngSeed', 'profileDossier',
  'pulseArc', 'pulverizeMs', 'queriedTs', 'queryLoad', 'queueDepth', 'quiltId', 'quirx',
  'quotation', 'quipBlurb', 'radianSnap', 'radiusKm', 'ramTrack', 'randomNonce', 'rank',
  'rateLimit', 'realmAlias', 'regionBucket', 'regretIndex', 'remarkXml', 'renderNs', 'retroSkin',
  'rewindCursor', 'ringToken', 'riotKey', 'rockKey', 'romanCode', 'rotationSnap', 'radiusKm',
  'ruinList', 'saltSprinkle', 'schemaUri', 'scoreVector', 'scrubIndex', 'sectorId', 'sessionKey',
  'shredRounds', 'sidebar', 'signetCode', 'slangString', 'sliceId', 'softHash', 'soilId',
  'sparkNonce', 'spec', 'splashUri', 'springOffset', 'starSign', 'stateNonce', 'staticHash',
  'streetQuad', 'subEpoch', 'substanceTag', 'suffix', 'surnameStem', 'tag64', 'taglineVerse',
  'tarpId', 'tasTick', 'tasteRating', 'teaserTxt', 'temporalChecksum', 'tessera', 'textureId',
  'tin', 'tint', 'tokenNonce', 'topologyHash', 'touchHeatmap', 'traceId', 'tractPoly',
  'treasureMap', 'tribeId', 'trickle', 'trinityHash', 'troveKey', 'tuningFork', 'twilightMs',
  'twirlFactor', 'twixtHash', 'txHash', 'type', 'uniqueHits', 'uniqueId', 'unitMask', 'updateVer',
  'upgradeSlot', 'uptimeNs', 'urmId', 'urmCode', 'urn', 'usageScore', 'usecaseTags', 'uterms',
  'utmZone', 'uvegaMetric', 'uvPattern', 'vaultIndex', 'vectorAngle', 'vegaPoint', 'verbatimText',
  'vergeId', 'vibeYaml', 'victoryStamp', 'vin', 'vip', 'virtueId', 'visualHash', 'vividKey',
  'voidIndex', 'voxelKey', 'waiverNonce', 'wavelet', 'whiffRate', 'widgetBlob', 'wielderId',
  'wildNonce', 'windchime', 'wingSpan', 'workgroup', 'worldChunk', 'wombatKey', 'xenoMask',
  'xFactor', 'xmlSig', 'xrayHash', 'yawlId', 'yearbookId', 'yieldFlag', 'yokeCode', 'yumSalt',
  'zapsLeft', 'zeroMark', 'zilchFlag', 'zodiacTag', 'zoomLevel', 'zorroSig', 'zyxKey'
];

type OutputNode = {
  node: JSONASTNode,
  brokenNode: null,
} | {
  node: null,
  brokenNode: BreakValue,
};

function randomlyBreak(str: string): Sample {
  if(percentChance(JSON5_PERCENT)) {
    return {
      input: json5.stringify(JSON.parse(str)),
      groundTruth: JSON.stringify({ success: true, fixed: JSON.parse(str) } satisfies FixResponse),
    }
  }
  let original = str;

  if(percentChance(NEST_PERCENT)) {
    const nestcount = zeroToN(MAX_NESTING);
    for(let i = 0; i < nestcount; i++) {
      const key = pickRandom(keyNamePool);
      original = JSON.stringify({ [key]: original });
    }
  }

  return {
    input: breakStr(original),
    groundTruth: JSON.stringify({ success: true, fixed: JSON.parse(original) } satisfies FixResponse),
  };
}

function breakStr(str: string) {
  let broken = str;
  const ast = parseJson(str);

  function isBroken() {
    let [ err ] = tryexpr(() => JSON.parse(broken));
    return err != null;
  }

  while(!isBroken()) {
    const brokenNodeCount = Math.min(zeroToN(MAX_NUM_BREAKS), ast.length);
    const indexesToBreak = new Set<number>();
    for(let i = 0; i < brokenNodeCount; i++) {
      indexesToBreak.add(randomIndex(ast));
    }

    const outputNodes = ast.map((node, index): OutputNode => {
      if(!indexesToBreak.has(index)) return { node, brokenNode: null };

      const numBreaks = zeroToN(MAX_AST_BREAKS[node.type]);
      let prev: BreakValue = initialBreak(node);
      for(let i = 0; i < numBreaks; i++) {
        const typebreaks: Array<Breaker<any>> = astBreaks[node.type];
        const typebreaker = pickRandom(typebreaks);
        const next = typebreaker(prev);
        if(next != null) prev = next;
      }
      return { node: null, brokenNode: prev };
    });

    broken = stringify(ast[ast.length - 1], outputNodes);
  }

  return broken;
}

function stringify(original: JSONASTNode, outputNodes: OutputNode[]): string {
  const matchingOutputNode = outputNodes.find(output => {
    if(output.node != null) return output.node === original;
    return output.brokenNode.node === original;
  });
  if(matchingOutputNode == null) throw new Error("Couldn't find matching output node");

  const { node, brokenNode } = matchingOutputNode;
  if(node) return stringifyNode(node, outputNodes);
  if(brokenNode.type === "string") return brokenNode.broken;
  if(brokenNode.type === "null") return brokenNode.broken;
  if(brokenNode.type === "number") return brokenNode.broken;
  if(brokenNode.type === "boolean") return brokenNode.broken;
  if(brokenNode.type === "array") {
    const arr: string[] = [];
    if(!brokenNode.broken.openCut) arr.push("[");
    for(let i = 0; i < brokenNode.node.children.length; i++) {
      const child = brokenNode.node.children[i];
      arr.push(randomWhitespace());
      arr.push(stringify(child, outputNodes));
      arr.push(randomWhitespace());
      if(i !== brokenNode.node.children.length - 1 && !brokenNode.broken.commaCuts.has(i)) {
        arr.push(",");
      }
      if(brokenNode.broken.commaDupes.has(i)) arr.push(",");
    }
    if(!brokenNode.broken.closeCut) arr.push("]");
    return arr.join("");
  }

  const obj: string[] = [];
  if(!brokenNode.broken.openCut) obj.push("{");
  for(let i = 0; i < brokenNode.node.children.length; i++) {
    const [ k, v ] = brokenNode.node.children[i];
    obj.push(randomWhitespace());
    obj.push(stringify(k, outputNodes));
    if(!brokenNode.broken.colonCuts.has(i)) obj.push(":");
    if(brokenNode.broken.colonDupes.has(i)) obj.push(":");
    obj.push(randomWhitespace());
    obj.push(stringify(v, outputNodes));
    obj.push(randomWhitespace());
    if(i !== brokenNode.node.children.length - 1 && !brokenNode.broken.commaCuts.has(i)) {
      obj.push(",");
    }
    if(brokenNode.broken.commaDupes.has(i)) obj.push(",");
  }
  if(!brokenNode.broken.closeCut) obj.push("}");
  return obj.join("");
}

function stringifyNode(node: JSONASTNode, outputNodes: OutputNode[]): string {
  switch(node.type) {
    case "string":
    case "null":
    case "number":
    case "boolean":
      return JSON.stringify(node.value);

    case "array":
      const arr = [ "[" ];
      if(node.children.length === 0) arr.push(randomWhitespace());
      else {
        arr.push(node.children.map(child => {
          return randomWhitespace() + stringify(child, outputNodes) + randomWhitespace();
        }).join(","));
      }
      arr.push("]");
      return arr.join("");

    case "object":
      const obj = [ "{" ];
      if(node.children.length === 0) obj.push(randomWhitespace());
      else {
        obj.push(node.children.map(([k, v]) => {
          return [
            randomWhitespace(),
            stringify(k, outputNodes),
            randomWhitespace(),
            ":",
            randomWhitespace(),
            stringify(v, outputNodes),
            randomWhitespace(),
          ].join("");
        }).join(","));
      }
      obj.push("}");
      return obj.join("");
  }
}

const MAX_WHITESPACE = 5;
const SPACE_PERCENT = 0.7;
function randomWhitespace() {
  const numws = zeroToN(MAX_WHITESPACE);
  const whitespace: string[] = [];
  for(let i = 0; i < numws; i++) {
    if(percentChance(SPACE_PERCENT)) whitespace.push(" ");
    else whitespace.push("\n");
  }
  return whitespace.join("");
}

type BreakResult = {
  null: {
    type: "null",
    broken: string,
    node: NullNode,
  },
  boolean: {
    type: "boolean",
    broken: string,
    node: BooleanNode,
  },
  number: {
    type: "number",
    broken: string,
    node: NumberNode,
  },
  string: {
    type: "string",
    broken: string,
    node: StringNode,
  },
  array: {
    type: "array",
    broken: {
      commaCuts: Set<number>,
      commaDupes: Set<number>,
      openCut: boolean,
      closeCut: boolean,
    },
    node: ArrayNode,
  },
  object: {
    type: "object",
    broken: {
      colonCuts: Set<number>,
      colonDupes: Set<number>,
      commaCuts: Set<number>,
      commaDupes: Set<number>,
      openCut: boolean,
      closeCut: boolean,
    },
    node: ObjectNode,
  },
};
type BreakValue = BreakResult[JSONASTNode["type"]];
export type BreakNode<K extends keyof BreakResult> = BreakResult[K];

function initialBreak<T extends JSONASTNode>(node: T): BreakValue {
  switch(node.type) {
    case "null": return { type: "null", node, broken: "null" };
    case "boolean": return { type: "boolean", node, broken: node.value ? "true" : "false" };
    case "number": return { type: "number", node, broken: JSON.stringify(node.value) };
    case "string": return { type: "string", node, broken: JSON.stringify(node.value) };
    case "array": return {
      type: "array",
      node,
      broken: {
        commaCuts: new Set(), commaDupes: new Set(), openCut: false, closeCut: false
      },
    };
    case "object": return {
      type: "object",
      node,
      broken: {
        commaCuts: new Set(),
        commaDupes: new Set(),
        colonCuts: new Set(),
        colonDupes: new Set(),
        openCut: false,
        closeCut: false,
      },
    };
  }
}

type Breaker<K extends JSONASTNode["type"]> =
  (prev: BreakResult[K]) => BreakResult[K] | null;
const astBreaks: { [K in JSONASTNode["type"]]: Array<Breaker<K>> } = {
  null: [],
  boolean: [],
  number: [],
  string: [],
  array: [],
  object: [],
};

function savePush<T>(arr: T[], item: T): T {
  arr.push(item);
  return item;
}

function stringBreak<T extends { broken: string }>(t: T): T | null {
  const [ err ] = tryexpr(() => JSON.parse(t.broken));
  if(err) return t;
  return null;
}

/*
 * AST-based JSON mangling functions
 */
// Nulls
export const nullCut = savePush(astBreaks.null, prev => {
  return stringBreak({
    ...prev,
    broken: cutIndex(prev.broken, randomIndex(prev.broken)),
  });
});
export const nullAdd = savePush(astBreaks.null, prev => {
  return stringBreak({
    ...prev,
    broken: insertAt(prev.broken, randomIndex(prev.broken), randomLowercase()),
  });
});

// Bools
export const boolCut = savePush(astBreaks.boolean, prev => {
  return stringBreak({
    ...prev,
    broken: cutIndex(prev.broken, randomIndex(prev.broken)),
  });
});
export const boolAdd = savePush(astBreaks.boolean, prev => {
  return stringBreak({
    ...prev,
    broken: insertAt(prev.broken, randomIndex(prev.broken), randomLowercase()),
  });
});

// Numbers
export const numberDot = savePush(astBreaks.number, prev => {
  return stringBreak({ ...prev, broken: prev.broken + "." });
});

// Strings
export const strUnescape = savePush(astBreaks.string, prev => {
  const indexes = findEscaped(prev.broken, [ "n", '"' ]);
  return stringBreak({
    ...prev,
    broken: cutIndex(prev.broken, pickRandom(indexes)),
  });
});
export const strRemoveQuote = savePush(astBreaks.string, prev => {
  const indexes = findUnescaped(prev.broken, [ '"' ]);
  return stringBreak({
    ...prev,
    broken: cutIndex(prev.broken, pickRandom(indexes)),
  });
});
export const strEscapeQuote = savePush(astBreaks.string, prev => {
  const indexes = findUnescaped(prev.broken, [ '"' ]);
  return stringBreak({
    ...prev,
    broken: insertAt(prev.broken, pickRandom(indexes) - 1, "\\"),
  });
});
export const strPrefixQuote = savePush(astBreaks.string, prev => {
  return stringBreak({ ...prev, broken: '"' + prev.broken });
});
export const strPostfixQuote = savePush(astBreaks.string, prev => {
  return stringBreak({ ...prev, broken: prev.broken + '"' });
});

// Array and object shared mangling
type HasCommaPos = { commaPositions: number[] };
type HasCommaBreak = { node: HasCommaPos, broken: { commaCuts: Set<number>, commaDupes: Set<number> } };
function remainingCommas(prev: HasCommaBreak) {
  return prev.node.commaPositions
    .map((_, i) => i)
    .filter(i => !prev.broken.commaCuts.has(i))
    .filter(i => !prev.broken.commaDupes.has(i))
    ;
}

export function cutComma<P extends HasCommaBreak>(prev: P): P | null {
  const remaining = remainingCommas(prev);
  if(remaining.length === 0) return null;
  return {
    ...prev,
    broken: {
      ...prev.broken,
      commaCuts: new Set([
        ...prev.broken.commaCuts,
        pickRandom(remaining),
      ]),
    },
  };
}
export function dupeComma<P extends HasCommaBreak>(prev: P): P | null {
  const remaining = remainingCommas(prev);
  if(remaining.length === 0) return null;
  return {
    ...prev,
    commaDupes: new Set([
      ...prev.broken.commaCuts,
      pickRandom(remaining),
    ]),
  };
}
type HasCutBreak = { broken: { closeCut: boolean, openCut: boolean } };
export function cutClose<P extends HasCutBreak>(prev: P): P | null {
  if(prev.broken.closeCut || prev.broken.openCut) return null;
  return { ...prev, broken: { ...prev.broken, closeCut: true } };
}
export function cutOpen<P extends HasCutBreak>(prev: P): P | null {
  if(prev.broken.closeCut || prev.broken.openCut) return null;
  return { ...prev, broken: { ...prev.broken, openCut: true } };
}
const CONTAINER_BREAKS = [ cutComma, dupeComma, cutClose, cutOpen ] as const;

for(const breakfn of CONTAINER_BREAKS) {
  astBreaks.array.push(breakfn);
  astBreaks.object.push(breakfn);
}

// Object-specific mangling
function remainingColons(prev: BreakResult["object"]) {
  return prev.node.colonPositions
    .map((_, i) => i)
    .filter(i => !prev.broken.colonCuts.has(i))
    .filter(i => !prev.broken.colonDupes.has(i))
    ;
}
export const cutColon = savePush(astBreaks.object, prev => {
  const remaining = remainingColons(prev);
  if(remaining.length === 0) return null;
  return {
    ...prev,
    broken: {
      ...prev.broken,
      colonCuts: new Set([
        ...prev.broken.colonCuts,
        pickRandom(remaining),
      ]),
    },
  };
});
export const dupeColon = savePush(astBreaks.object, prev => {
  const remaining = remainingColons(prev);
  if(remaining.length === 0) return null;
  return {
    ...prev,
    broken: {
      ...prev.broken,
      colonDupes: new Set([
        ...prev.broken.colonCuts,
        pickRandom(remaining),
      ]),
    },
  };
});

function findJsonIndexes(source: string, escaped: boolean, strings: string[]) {
  const search = new Set(strings);
  let isEscaped = false;
  const indexes: number[] = [];

  for(let i = 0; i < source.length; i++) {
    const char = source[i];
    if(char === "\\") isEscaped = !isEscaped;
    if(search.has(char) && escaped === isEscaped) indexes.push(i);
    if(char !== "\\") isEscaped = false;
  }

  return indexes;
}

function findEscaped(source: string, strings: string[]) {
  return findJsonIndexes(source, true, strings);
}
function findUnescaped(source: string, strings: string[]) {
  return findJsonIndexes(source, false, strings);
}

const SOURCE_FILE_EXTS = new Set([
  "js", "css", "ts", "jsx", "tsx", "rb", "py", "rs", "c", "cpp", "h", "toml", "md", "yml", "yaml",
  "ini", "pylintrc", "txt", "rst", "rspec", "jshintrc", "prettierignore", "npmrc", "spec",
  "gitignore", "yardopts", "simplecov", "gemspec", "in", "nix", "lua",
]);
const SPECIAL_SOURCE_FILES = new Set([
  "Gemfile", "Rakefile", "CODEOWNERS", "AUTHORS", "LICENSE", "OWNERS", "release-notes",
]);

async function* getSourceFiles(dirpath: string): AsyncGenerator<string> {
  const direntries = await fs.readdir(dirpath);
  for(const entry of direntries) {
    const fullpath = path.join(dirpath, entry);
    const stat = await fs.stat(fullpath);
    if(stat.isFile()) {
      if(SPECIAL_SOURCE_FILES.has(entry)) yield fullpath;
      if(entry.includes(".")) {
        const pieces = entry.split(".");
        const ext = pieces[pieces.length - 1];
        if(SOURCE_FILE_EXTS.has(ext)) {
          yield fullpath;
        }
      }
    }
    else if(stat.isDirectory()) {
      if(entry[0] !== ".") yield* await getSourceFiles(fullpath);
    }
  }
}

main();
