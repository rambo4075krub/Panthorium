/** Panthorium OS Backend */
require("dotenv").config();

const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const config = require("./config");
const { createAuthRepository } = require("./repositories/authRepository");
const { SentinelTrainingRepository } = require("./services/sentinelTrainingRepository");
const { SentinelTrainingService } = require("./services/sentinelTrainingService");
const { SentinelLearningRepository } = require("./services/sentinelLearningRepository");
const { SentinelLearningOrchestrator } = require("./services/sentinelLearningOrchestrator");
const { AutonomousLearningPolicy } = require("./services/autonomousLearningPolicy");
const { SentinelBenchmarkService } = require("./services/sentinelBenchmarkService");
const { SentinelRecoveryService } = require("./services/sentinelRecoveryService");
const { SentinelActiveLearningService } = require("./services/sentinelActiveLearningService");
const { SentinelReleaseGateService } = require("./services/sentinelReleaseGateService");
const { AuditService } = require("./services/auditService");
const { AuthService } = require("./services/authService");
const { SecurityResponseService } = require("./services/securityResponseService");
const { ConversationRepository } = require("./services/conversationRepository");
const { AiOperationsService } = require("./services/aiOperationsService");
const { Sentinel } = require("./services/sentinel");
const { ToolRegistry } = require("./services/toolRegistry");
const { AgentService } = require("./services/agentService");
const { AgentPlannerService } = require("./services/agentPlannerService");
const { AgentWorkflowService } = require("./services/agentWorkflowService");
const { AgentRunRepository } = require("./services/agentRunRepository");
const { AgentPendingRepository } = require("./services/agentPendingRepository");
const { AgentJobRepository } = require("./services/agentJobRepository");
const { AgentSchedulerService } = require("./services/agentSchedulerService");
const { AgentAutomationRepository } = require("./services/agentAutomationRepository");
const { AgentAutomationService } = require("./services/agentAutomationService");
const { AgentAutomationPolicyService } = require("./services/agentAutomationPolicyService");
const { AgentMemoryRepository } = require("./services/agentMemoryRepository");
const { AgentMemoryService } = require("./services/agentMemoryService");
const { AgentKnowledgeRepository } = require("./services/agentKnowledgeRepository");
const { AgentKnowledgeService } = require("./services/agentKnowledgeService");
const { AgentPolicyService } = require("./services/agentPolicyService");
const { MultiAgentRunRepository } = require("./services/multiAgentRunRepository");
const { MultiAgentPlannerService } = require("./services/multiAgentPlannerService");
const { MultiAgentOrchestrator } = require("./services/multiAgentOrchestrator");
const { IntegrationRepository } = require("./services/integrationRepository");
const { IntegrationExecutionRepository } = require("./services/integrationExecutionRepository");
const { IntegrationService } = require("./services/integrationService");
const { ProductionIntelligenceService } = require("./services/productionIntelligenceService");
const { AutonomousGovernanceService } = require("./services/autonomousGovernanceService");
const { SentinelOrchestratorService } = require("./services/sentinelOrchestratorService");

const { createApiRouter } = require("./routes/api");
const { createAuthRouter } = require("./routes/auth");
const { createSecurityRouter } = require("./routes/security");
const { createAutomationRouter } = require("./routes/automation");
const { createMemoryRouter } = require("./routes/memory");
const { createKnowledgeRouter } = require("./routes/knowledge");
const { createOrchestrationRouter } = require("./routes/orchestration");
const { createIntegrationsRouter } = require("./routes/integrations");
const { createProductionRouter } = require("./routes/production");
const { createTrainingRouter } = require("./routes/training");
const { createReleaseGateRouter } = require("./routes/releaseGate");
const { createGovernanceRouter } = require("./routes/governance");
const { createSentinelControlRouter } = require("./routes/sentinelControl");
const { requestContext } = require("./middleware/requestContext");

const app = express();
if (config.trustProxy) app.set("trust proxy", 1);

const authRepository = createAuthRepository(config);
const audit = new AuditService({ file: config.auditFile, databaseUrl: config.databaseUrl, databaseSslMode: config.databaseSslMode });
const securityResponse = new SecurityResponseService({ audit, databaseUrl: config.databaseUrl, databaseSslMode: config.databaseSslMode });
const authService = new AuthService({ repository: authRepository, config, audit });
const conversations = new ConversationRepository({ databaseUrl: config.databaseUrl, databaseSslMode: config.databaseSslMode });
const aiOperations = new AiOperationsService({ audit, conversations });
const agentRuns = new AgentRunRepository({ databaseUrl: config.databaseUrl, databaseSslMode: config.databaseSslMode });
const agentPending = new AgentPendingRepository({ databaseUrl: config.databaseUrl, databaseSslMode: config.databaseSslMode });
const agentJobs = new AgentJobRepository({ databaseUrl: config.databaseUrl, databaseSslMode: config.databaseSslMode });
const agentAutomationRepository = new AgentAutomationRepository({ databaseUrl: config.databaseUrl, databaseSslMode: config.databaseSslMode });
const agentMemoryRepository = new AgentMemoryRepository({ databaseUrl: config.databaseUrl, databaseSslMode: config.databaseSslMode });
const agentKnowledgeRepository = new AgentKnowledgeRepository({ databaseUrl: config.databaseUrl, databaseSslMode: config.databaseSslMode });
const multiAgentRuns = new MultiAgentRunRepository({ databaseUrl: config.databaseUrl, databaseSslMode: config.databaseSslMode });
const integrationRepository = new IntegrationRepository({ databaseUrl: config.databaseUrl, databaseSslMode: config.databaseSslMode });
const integrationExecutions = new IntegrationExecutionRepository({ databaseUrl: config.databaseUrl, databaseSslMode: config.databaseSslMode });
const integrations = new IntegrationService({ repository: integrationRepository, executions: integrationExecutions, audit, allowedHosts: config.integrationAllowedHosts });
const sentinel = new Sentinel({ conversations, audit });
const productionIntelligence = new ProductionIntelligenceService({ databaseUrl: config.databaseUrl, databaseSslMode: config.databaseSslMode, audit, gateway: sentinel.gateway });
const toolRegistry = new ToolRegistry({ sentinel, conversations, securityResponse, aiOperations, integrations });
const agentPolicy = new AgentPolicyService();
const agentService = new AgentService({ tools: toolRegistry, audit, policy: agentPolicy });
const agentKnowledge = new AgentKnowledgeService({ repository: agentKnowledgeRepository, audit });
const agentMemory = new AgentMemoryService({ repository: agentMemoryRepository, audit, knowledge: agentKnowledge });
const agentPlanner = new AgentPlannerService({ agentService, gateway: sentinel.gateway, audit, memory: agentMemory });
const agentWorkflow = new AgentWorkflowService({ agentService, gateway: sentinel.gateway, audit, runs: agentRuns, pendingStore: agentPending, memory: agentMemory });
const agentAutomationPolicy = new AgentAutomationPolicyService();
const agentAutomation = new AgentAutomationService({ repository: agentAutomationRepository, jobs: agentJobs, audit, policy: agentAutomationPolicy });
const agentScheduler = new AgentSchedulerService({ jobs: agentJobs, workflow: agentWorkflow, runs: agentRuns, audit, authService, automation: agentAutomation });
const multiAgentPlanner = new MultiAgentPlannerService({ gateway: sentinel.gateway, audit });
const multiAgent = new MultiAgentOrchestrator({ workflow: agentWorkflow, audit, runs: multiAgentRuns, planner: multiAgentPlanner });

const sentinelTrainingRepository = new SentinelTrainingRepository({ databaseUrl: config.databaseUrl, databaseSslMode: config.databaseSslMode });
const sentinelLearningRepository = new SentinelLearningRepository({ databaseUrl: config.databaseUrl, databaseSslMode: config.databaseSslMode });
const sentinelLearningPolicy = new AutonomousLearningPolicy();
const sentinelLearning = new SentinelLearningOrchestrator({ repository: sentinelLearningRepository, trainingRepository: sentinelTrainingRepository, audit, policy: sentinelLearningPolicy });
const sentinelTraining = new SentinelTrainingService({ repository: sentinelTrainingRepository, providers: sentinel.providers, audit, learning: sentinelLearning, autoEnabled: config.sentinelAutoTraining, autoCapture: config.sentinelAutoCapture, autoScoreThreshold: config.sentinelAutoScoreThreshold, autoIntervalMs: config.sentinelAutoIntervalMs });
const sentinelRecovery = new SentinelRecoveryService({ learning: sentinelLearning, training: sentinelTraining, trainingRepository: sentinelTrainingRepository, providers: sentinel.providers, audit, maxAttempts: Number(process.env.SENTINEL_AUTONOMOUS_RECOVERY_MAX_ATTEMPTS || 3) });
const sentinelBenchmark = new SentinelBenchmarkService({ sentinel, providers: sentinel.providers, audit, databaseUrl: config.databaseUrl, databaseSslMode: config.databaseSslMode });
const sentinelActiveLearning = new SentinelActiveLearningService({ training: sentinelTraining, learning: sentinelLearning, providers: sentinel.providers, audit, databaseUrl: config.databaseUrl, databaseSslMode: config.databaseSslMode });
const sentinelReleaseGate = new SentinelReleaseGateService({ training: sentinelTraining, learning: sentinelLearning, benchmark: sentinelBenchmark, activeLearning: sentinelActiveLearning, audit, minBenchmarkScore: Number(process.env.SENTINEL_RELEASE_GATE_MIN_BENCHMARK_SCORE || 80) });
const autonomousGovernance = new AutonomousGovernanceService({ production: productionIntelligence, releaseGate: sentinelReleaseGate, benchmark: sentinelBenchmark, activeLearning: sentinelActiveLearning, learning: sentinelLearning, training: sentinelTraining, audit, databaseUrl: config.databaseUrl, databaseSslMode: config.databaseSslMode, mode: process.env.PANTHORIUM_GOVERNANCE_MODE || 'observe', intervalMs: process.env.PANTHORIUM_GOVERNANCE_INTERVAL_MS || 300000 });
const sentinelOrchestrator = new SentinelOrchestratorService({ sentinel, training: sentinelTraining, learning: sentinelLearning, releaseGate: sentinelReleaseGate, benchmark: sentinelBenchmark, activeLearning: sentinelActiveLearning, governance: autonomousGovernance, production: productionIntelligence, providers: sentinel.providers, audit, databaseUrl: config.databaseUrl, databaseSslMode: config.databaseSslMode, mode: process.env.PANTHORIUM_SENTINEL_CONTROL_MODE || 'observe', intervalMs: process.env.PANTHORIUM_SENTINEL_CONTROL_INTERVAL_MS || 300000 });
sentinelLearning.recovery = sentinelRecovery;
sentinel.training = sentinelTraining;
sentinel.sentinelControl = sentinelOrchestrator;

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", "data:", "blob:"], mediaSrc: ["'self'", "blob:", "https://translate.google.com", "https://translate.googleapis.com"], connectSrc: ["'self'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", ...config.allowedOrigins], workerSrc: ["'self'", "blob:"], objectSrc: ["'none'"], frameAncestors: ["'none'"] } }, crossOriginEmbedderPolicy: false }));
app.use(cors({ origin(origin, cb) { if (!origin || config.allowedOrigins.includes(origin)) return cb(null, true); cb(new Error("CORS origin denied")); }, credentials: true }));
app.use(express.json({ limit: "768kb", type: "application/json" }));
app.use(cookieParser());
app.use(requestContext(audit));

app.get("/healthz", async (req, res) => {
  try {
    const result = await productionIntelligence.readiness();
    res.status(result.ok ? 200 : 503).json({ ok: result.ok, status: result.status });
  } catch (error) {
    res.status(503).json({ ok: false, status: "not_ready" });
  }
});

app.use("/api/training/release-gate", createReleaseGateRouter(authService, sentinelReleaseGate));
app.use("/api/training", createTrainingRouter(authService, sentinelTraining, sentinelBenchmark, sentinelActiveLearning));
app.use("/api/governance", createGovernanceRouter(authService, autonomousGovernance));
app.use("/api/sentinel-control", createSentinelControlRouter(authService, sentinelOrchestrator));
app.use("/api/auth", createAuthRouter(authService, config, securityResponse));
app.use("/api/security", createSecurityRouter(authService, authRepository, audit, securityResponse));
app.use("/api/agent/automation", createAutomationRouter(authService, agentAutomation));
app.use("/api/agent/memory", createMemoryRouter(authService, agentMemory));
app.use("/api/agent/knowledge", createKnowledgeRouter(authService, agentKnowledge));
app.use("/api/agent/orchestration", createOrchestrationRouter(authService, multiAgent));
app.use("/api/integrations", createIntegrationsRouter(authService, integrations));
app.use("/api/production", createProductionRouter(authService, productionIntelligence));
app.use("/api", createApiRouter(sentinel, authService, audit, aiOperations, agentService, agentPlanner, agentWorkflow, agentRuns, agentScheduler, agentAutomation));

const frontendCandidates = [path.join(__dirname, ".."), __dirname];
const frontendRoot = frontendCandidates.find((directory) => fs.existsSync(path.join(directory, "sentinel.html"))) || __dirname;
app.get("/vendor/three.min.js", (req, res, next) => {
  try {
    res.set("Cache-Control", "public, max-age=31536000, immutable");
    res.type("application/javascript").sendFile(path.join(__dirname, "node_modules", "three", "build", "three.min.js"));
  } catch (error) {
    next(error);
  }
});
app.get("/sw.js", (req, res, next) => {
  try {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.set("Service-Worker-Allowed", "/");
    res.type("application/javascript").sendFile(path.join(frontendRoot, "sw.js"));
  } catch (error) {
    next(error);
  }
});

const shellScripts = ["boot-recovery.js", "branding.js", "phase2-auth.js", "user-manager.js", "security-dashboard.js", "ui-layout.js", "ai-dashboard.js", "ai-stream-client.js", "agent-ui.js", "agent-automation-ui.js", "agent-memory-ui.js", "multi-agent-ui.js", "integrations-ui.js", "production-intelligence-ui.js", "training-ui.js", "active-learning-ui.js", "release-gate-ui.js", "governance-ui.js", "sentinel-control-ui.js", "staging-admin-desktop.js", "access-shell-ui.js"];
for (const script of shellScripts) {
  app.get(`/${script}`, (req, res, next) => {
    try {
      res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.sendFile(path.join(frontendRoot, script));
    } catch (error) {
      next(error);
    }
  });
}

function renderShell() {
  let html = fs.readFileSync(path.join(frontendRoot, "sentinel.html"), "utf8");
  const version = "phase15-single-sentinel-v1";
  for (const script of shellScripts) {
    if (!html.includes(`/${script}`)) html = html.replace(/<\/body>/i, `  <script src="/${script}?v=${version}"></script>\n</body>`);
  }
  return html;
}

function serveShell(req, res, next) {
  try {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.set("Surrogate-Control", "no-store");
    res.type("html").send(renderShell());
  } catch (error) {
    next(error);
  }
}

app.get("/", serveShell);
app.get("/sentinel.html", serveShell);
app.get("/admin", serveShell);
app.get("/admin/", serveShell);
app.get("/admin.html", serveShell);
app.use(express.static(frontendRoot, { index: false, etag: true, maxAge: config.isProduction ? "1h" : 0 }));
app.use((req, res) => res.status(404).json({ ok: false, error: "not_found" }));
app.use((err, req, res, next) => {
  console.error("[HTTP]", err.message);
  if (err.message === "CORS origin denied") return res.status(403).json({ ok: false, error: "cors_denied" });
  res.status(500).json({ ok: false, error: "internal_error" });
});

async function start() {
  await audit.init();
  await securityResponse.init();
  await authService.init();
  await conversations.init();
  await agentRuns.init();
  await agentPending.init();
  await agentScheduler.init();
  await agentKnowledge.init();
  await agentMemory.init();
  await multiAgentRuns.init();
  await integrationRepository.init();
  await integrationExecutions.init();
  await productionIntelligence.init();
  await sentinelTraining.init();
  await sentinelBenchmark.init();
  await sentinelActiveLearning.init();
  await autonomousGovernance.init();
  await sentinelOrchestrator.init();

  const server = app.listen(config.port, config.host, () => {
    console.log("========================================");
    console.log("  Panthorium OS Backend · Phase 15 Single Sentinel");
    console.log(`  Auto training: ${config.sentinelAutoTraining ? "enabled" : "disabled"} · review threshold ${config.sentinelAutoScoreThreshold}`);
    console.log(`  Autonomous promotion: ${sentinelLearningPolicy.promotionScore} · shadow samples ${sentinelLearningPolicy.shadowMinSamples}`);
    console.log(`  Automatic recovery: enabled · max attempts ${sentinelRecovery.maxAttempts}`);
    console.log("  Active Learning Runner: manual 24h provider training controls online");
    console.log(`  Release Gate: requires benchmark score >= ${sentinelReleaseGate.minBenchmarkScore}`);
    console.log(`  Governance mode: ${autonomousGovernance.mode} · interval ${autonomousGovernance.intervalMs}ms · incident ledger online`);
    console.log(`  Sentinel Control mode: ${sentinelOrchestrator.mode} · one Sentinel identity with gated RBAC contexts`);
    console.log(`  Benchmark Arena providers: ${sentinel.providers.available().join(', ') || 'none'} · persistent evidence store online`);
    console.log(`  http://localhost:${config.port}`);
    console.log("========================================");
  });
  agentScheduler.start();
  sentinelTraining.start();
  autonomousGovernance.start();
  sentinelOrchestrator.start();
  server.on('close', () => { sentinelTraining.stop(); sentinelActiveLearning.shutdown?.(); autonomousGovernance.stop(); sentinelOrchestrator.stop(); });
  return server;
}

if (require.main === module) start().catch((error) => { console.error("[BOOT]", error); process.exit(1); });

module.exports = { app, sentinel, sentinelTraining, sentinelTrainingRepository, sentinelLearning, sentinelLearningRepository, sentinelLearningPolicy, sentinelRecovery, sentinelBenchmark, sentinelActiveLearning, sentinelReleaseGate, autonomousGovernance, sentinelOrchestrator, authService, securityResponse, conversations, aiOperations, toolRegistry, agentPolicy, agentService, agentPlanner, agentWorkflow, agentRuns, agentPending, agentJobs, agentAutomationRepository, agentAutomationPolicy, agentAutomation, agentMemoryRepository, agentMemory, agentKnowledgeRepository, agentKnowledge, agentScheduler, multiAgentRuns, multiAgentPlanner, multiAgent, integrationRepository, integrationExecutions, integrations, productionIntelligence, start };
