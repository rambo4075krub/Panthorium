'use strict';

function nowIso() { return new Date().toISOString(); }
function safeArray(value) { return Array.isArray(value) ? value : []; }
function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function clampScore(value) { return Math.max(0, Math.min(100, Math.round(number(value, 0)))); }

const FRONTIER_ARCHITECTURE_PATTERNS = Object.freeze([
  {
    id: 'agent_tools_handoffs_guardrails',
    source: 'OpenAI Agents SDK',
    pillar: 'agent_runtime',
    label: 'Agents + Tools + Handoffs + Guardrails',
    principle: 'Agent workflows should expose tools explicitly, constrain handoffs, and validate inputs/outputs before state changes.',
    sentinelCoreApplication: 'Sentinel Core plans back-office actions, delegates through existing services, and executes only guarded actions.',
    sentinelApplication: 'Sentinel receives user-facing instructions and can only use approved context/tools for general assistance.',
    controls: ['rbac', 'confirmation_or_gate', 'audit_trace', 'no_secret_exposure']
  },
  {
    id: 'trace_observe_evaluate_optimize',
    source: 'OpenAI Agents SDK tracing/evals pattern',
    pillar: 'observability',
    label: 'Trace → Observe → Evaluate → Optimize',
    principle: 'Every agent run should be explainable through telemetry, tool events, guardrail decisions, and evaluation outcomes.',
    sentinelCoreApplication: 'Dual AI cycles persist telemetry, proposals, executed actions, governance signals, and release-gate state.',
    sentinelApplication: 'Sentinel quality is measured through benchmark history, release gate evidence, and learning version outcomes.',
    controls: ['cycle_history', 'snapshot_store', 'benchmark_evidence', 'incident_ledger']
  },
  {
    id: 'mcp_tool_resource_boundary',
    source: 'Anthropic Model Context Protocol',
    pillar: 'tool_boundary',
    label: 'Tool / Resource / Prompt Boundary',
    principle: 'Models should connect to external systems through explicit tools/resources instead of hidden unrestricted access.',
    sentinelCoreApplication: 'Back-office authority is represented by routes, RBAC, integration allowlists, and governance actions.',
    sentinelApplication: 'Public Sentinel has no direct back-office resource access and only sees active, reviewed knowledge.',
    controls: ['permissioned_routes', 'resource_scoping', 'allowlist', 'active_only_context']
  },
  {
    id: 'grounded_tool_context_circulation',
    source: 'Google Gemini API tools and grounding',
    pillar: 'grounding',
    label: 'Grounded Tool Use + Context Circulation',
    principle: 'Tool calls should keep enough structured context to connect evidence, function results, and final answers.',
    sentinelCoreApplication: 'Release Gate and Governance reuse benchmark, production, incident, and training telemetry before proposing actions.',
    sentinelApplication: 'Sentinel improvement is grounded in accepted benchmark failures, reviewed examples, and active knowledge.',
    controls: ['structured_telemetry', 'evidence_first', 'benchmark_case_feedback', 'safe_context_window']
  },
  {
    id: 'durable_execution_human_gate',
    source: 'LangGraph durable execution / human-in-the-loop',
    pillar: 'durability',
    label: 'Durable Execution + Human Gate',
    principle: 'Long-running agent workflows need persistence, resumption, and explicit human gates for high-impact decisions.',
    sentinelCoreApplication: '24h loops store cycles and can resume/observe without taking destructive actions.',
    sentinelApplication: 'Active learning keeps manual activation and cannot promote unsafe candidates directly.',
    controls: ['postgres_history', 'idempotent_cycles', 'manual_activation', 'resume_safe']
  },
  {
    id: 'eval_repair_release_gate_loop',
    source: 'Evaluation-driven release systems',
    pillar: 'quality_gate',
    label: 'Eval → Repair → Shadow → Release Gate',
    principle: 'Quality improvement should be driven by measured failures and must pass staged gates before user impact.',
    sentinelCoreApplication: 'Core triggers benchmark/repair and tracks release readiness instead of claiming superiority without evidence.',
    sentinelApplication: 'Sentinel learns from failing benchmark cases through quarantine, review, shadow, promote, and monitor.',
    controls: ['min_benchmark_score', 'shadow_samples', 'rollback_recovery', 'release_gate_blockers']
  },
  {
    id: 'least_privilege_multi_agent_control',
    source: 'Enterprise agent safety pattern',
    pillar: 'least_privilege',
    label: 'Least-Privilege Multi-Agent Control',
    principle: 'Separate administrator agents from user-facing agents and make every capability explicit.',
    sentinelCoreApplication: 'Core owns orchestration/governance but still cannot merge, deploy, bypass RBAC, or reveal secrets.',
    sentinelApplication: 'Sentinel answers users and captures learning candidates, but cannot operate admin tools.',
    controls: ['role_split', 'capability_matrix', 'negative_permissions', 'audited_actions']
  },
  {
    id: 'continuous_24h_learning_without_gate_bypass',
    source: 'Panthorium guarded self-improvement pattern',
    pillar: 'continuous_learning',
    label: 'Continuous 24h Learning without Gate Bypass',
    principle: 'Self-improvement can run continuously only when candidate creation is separated from activation.',
    sentinelCoreApplication: 'Core supervises provider learning, detects drift, and starts safe loops under Governance.',
    sentinelApplication: 'Sentinel benefits only from candidates that pass review/shadow/promote gates.',
    controls: ['quota_guardrail', 'unsafe_counter', 'manual_activation_required', 'active_only_runtime']
  }
]);

const LEARNING_CHANNELS = Object.freeze({
  sentinel_core: [
    { id: 'production_telemetry', type: 'internal', label: 'Production telemetry', evidence: 'Production Intelligence, SLO burn, capacity, provider circuits' },
    { id: 'governance_incidents', type: 'internal', label: 'Governance incidents', evidence: 'Incident ledger, runbooks, executed guardrails' },
    { id: 'release_gate_outcomes', type: 'internal', label: 'Release Gate outcomes', evidence: 'blockers, benchmark evidence, repair job state' },
    { id: 'frontier_pattern_catalog', type: 'external', label: 'Frontier architecture pattern catalog', evidence: 'curated official architecture patterns mapped to Panthorium controls' },
    { id: 'provider_teacher_feedback', type: 'external', label: 'Provider teacher feedback', evidence: 'teacher drafts, evaluator scores, benchmark judge feedback' }
  ],
  sentinel: [
    { id: 'active_learning_versions', type: 'internal', label: 'Active learning versions', evidence: 'only promoted active versions enter user context' },
    { id: 'benchmark_failure_cases', type: 'internal', label: 'Benchmark failure cases', evidence: 'weak cases converted into training candidates' },
    { id: 'conversation_capture', type: 'internal', label: 'Conversation capture', evidence: 'sanitized examples enter training review' },
    { id: 'external_provider_distillation', type: 'external', label: 'External provider distillation', evidence: 'bounded provider answers become candidates, not direct runtime behavior' }
  ]
});

class FrontierArchitectureService {
  constructor({ benchmarkScore = process.env.SENTINEL_RELEASE_GATE_MIN_BENCHMARK_SCORE || 80 } = {}) {
    this.benchmarkScore = number(benchmarkScore, 80);
  }

  status({ telemetry = null } = {}) {
    const maturity = this.maturity({ telemetry });
    return {
      ok: true,
      generatedAt: nowIso(),
      label: 'Frontier Architecture Knowledge Base',
      target: 'Apply proven frontier-agent patterns without copying vendor internals or bypassing Panthorium safety gates.',
      patterns: this.patterns(),
      learningChannels: this.learningChannels(),
      maturity,
      recommendations: this.recommend({ telemetry, maturity }),
      roadmap: this.roadmap(maturity),
      safetyBoundary: {
        noSuperiorityClaimWithoutBenchmark: true,
        noExternalTrainingDirectToProduction: true,
        noAutoMerge: true,
        noAutoDeploy: true,
        noGateBypass: true
      }
    };
  }

  patterns() {
    return FRONTIER_ARCHITECTURE_PATTERNS.map((item) => ({ ...item }));
  }

  learningChannels() {
    return JSON.parse(JSON.stringify(LEARNING_CHANNELS));
  }

  maturity({ telemetry = null } = {}) {
    const t = telemetry || {};
    const releaseGate = t.releaseGate || {};
    const benchmark = t.benchmark || {};
    const governance = t.governance || {};
    const activeLearning = t.activeLearning || {};
    const versions = safeArray(t.versions);
    const providers = safeArray(benchmark.availableProviders || t.providers || []);
    const lastBenchmark = releaseGate.evidence?.benchmark || benchmark.lastRun?.summary?.sentinel || null;

    const pillars = {
      roleSeparation: 100,
      toolBoundary: 95,
      observability: t.historyAvailable === false ? 70 : 90,
      releaseGate: releaseGate.ok === false ? 60 : 92,
      benchmarkEvidence: lastBenchmark ? clampScore(number(lastBenchmark.score, 0)) : 55,
      durableLearning: activeLearning.ok === false ? 60 : 88,
      activeOnlyRuntime: versions.some((v) => v.state === 'active') ? 90 : 72,
      providerDiversity: clampScore(Math.min(100, providers.length * 33)),
      governance: governance.status === 'critical' ? 50 : governance.status === 'degraded' ? 70 : 90
    };
    const score = clampScore(Object.values(pillars).reduce((sum, value) => sum + value, 0) / Object.keys(pillars).length);
    return { score, status: score >= 85 ? 'advanced' : score >= 70 ? 'maturing' : 'needs_work', pillars };
  }

  recommend({ telemetry = null, maturity = null } = {}) {
    const t = telemetry || {};
    const m = maturity || this.maturity({ telemetry: t });
    const out = [];
    if (m.pillars.providerDiversity < 66) out.push(this.recommendation('increase_provider_diversity', 'medium', 'Enable at least two independent provider teachers before trusting external distillation.'));
    if (m.pillars.benchmarkEvidence < this.benchmarkScore) out.push(this.recommendation('expand_benchmark_repair', 'high', 'Use failing benchmark cases as training candidates, then rerun Release Gate after shadow promotion.'));
    if (m.pillars.activeOnlyRuntime < 85) out.push(this.recommendation('promote_active_context_only', 'medium', 'Keep user-facing Sentinel on active-only knowledge and increase shadow samples before promotion.'));
    if (m.pillars.governance < 80) out.push(this.recommendation('stabilize_governance_first', 'high', 'Hold high-volume learning until Governance incidents and production SLO signals stabilize.'));
    if (!out.length) out.push(this.recommendation('continue_frontier_watch', 'low', 'Continue 24h observe cycles and compare new architecture patterns against existing Panthorium gates.'));
    return out;
  }

  recommendation(id, priority, action) {
    return { id, priority, action, createdAt: nowIso() };
  }

  roadmap(maturity) {
    const m = maturity || this.maturity();
    return [
      { step: 1, title: 'Separate Core/User AI authority', status: 'done', owner: 'sentinel_core' },
      { step: 2, title: 'Persist cycles, telemetry and incident context', status: 'done', owner: 'sentinel_core' },
      { step: 3, title: 'Use external provider teachers only as candidate sources', status: 'done', owner: 'sentinel' },
      { step: 4, title: 'Continuously rerank frontier patterns against production evidence', status: m.score >= 85 ? 'active' : 'needs_more_evidence', owner: 'sentinel_core' },
      { step: 5, title: 'Expand benchmark taxonomy before claiming leadership over frontier AI', status: 'planned', owner: 'sentinel_core' }
    ];
  }

  trainingTopics() {
    return [
      'agent tools handoffs guardrails',
      'MCP tool resource boundaries',
      'grounded tool use and context circulation',
      'durable execution and human in the loop',
      'evaluation driven repair loops',
      'least privilege multi agent systems',
      'active only runtime knowledge',
      '24h supervised self improvement'
    ];
  }
}

module.exports = { FrontierArchitectureService, FRONTIER_ARCHITECTURE_PATTERNS, LEARNING_CHANNELS };
