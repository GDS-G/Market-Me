import { generateGroundedDraft, GENERATOR_MODEL, GENERATOR_VERSION, PROMPT_VERSION } from "../packages/generation/src/index";
import { DRAFT_QUALITY_CASES, DRAFT_QUALITY_CORPUS_VERSION } from "../packages/generation/src/evaluation/draft-cases";
import { evaluateDraftCase } from "../packages/generation/src/evaluation/draft-evaluator";

const results = DRAFT_QUALITY_CASES.map(testCase => evaluateDraftCase(testCase, generateGroundedDraft));
const passed = results.filter(result => result.passed).length;
console.log(JSON.stringify({ corpusVersion: DRAFT_QUALITY_CORPUS_VERSION, generatorModel: GENERATOR_MODEL,
  generatorVersion: GENERATOR_VERSION, promptVersion: PROMPT_VERSION, scope: "offline_synthetic_deterministic_copy",
  total: results.length, passed, failed: results.length - passed, results }, null, 2));
if (passed !== results.length) process.exitCode = 1;
