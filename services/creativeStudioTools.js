'use strict';

const { normalizeSteps } = require('./creativeStudioService');

const PLUGIN_IDS = ['image', 'video', 'document', 'spreadsheet', 'presentation'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const only = (value, keys) => object(value) && Object.keys(value).every(key => keys.includes(key));
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const fileIds = (value, pluginId) => value == null || Array.isArray(value) && value.length <= (pluginId === 'video' ? 1 : pluginId === 'image' ? 3 : 6) && value.every(id => typeof id === 'string' && UUID_RE.test(id));
const inputSchema = {
  type: 'OBJECT', description: 'The exact content and output settings shown to the user before execution.',
  properties: {
    prompt: { type: 'STRING', description: 'Requested content or creative instruction, at most 8000 characters.' },
    name: { type: 'STRING', description: 'Optional output name, at most 150 characters.' },
    aspectRatio: { type: 'STRING', description: 'Optional image or video aspect ratio.', enum: ['1:1', '16:9', '9:16'] },
    durationSeconds: { type: 'INTEGER', description: 'Optional video duration, 4, 6, or 8 seconds.' }
  }, required: ['prompt']
};
const sourceSchema = { type: 'ARRAY', description: 'Current-account Cloud Files IDs to reuse as sources. Obtain IDs from files.read or earlier studio results; never invent them.', items: { type: 'STRING', description: 'UUID of a source file owned by the current account.' } };
const pluginSchema = { type: 'STRING', description: 'Built-in creative plugin. Read studio.catalog for availability and supported inputs.', enum: PLUGIN_IDS };
const STUDIO_TOOL_DEFINITIONS = [
  { name: 'panthorium_studio_catalog', toolId: 'studio.catalog', description: 'Read Creative Studio plugin availability, supported file types, and Auto/Never settings for the current user. Use before planning image, video, printable document, spreadsheet, or presentation work.', properties: {}, required: [] },
  { name: 'panthorium_studio_jobs', toolId: 'studio.jobs', description: 'Read the current account Creative Studio jobs and output file IDs. This does not start, advance, or retry a job.', properties: {}, required: [] },
  { name: 'panthorium_studio_status', toolId: 'studio.status', description: 'Read the real status and output files of one current-account Creative Studio job. A queued/running job is not completed. This call is read-only.', properties: { jobId: { type: 'STRING', description: 'Existing Creative Studio job UUID, returned by studio.create or studio.jobs.' } }, required: ['jobId'] },
  {
    name: 'panthorium_studio_create', toolId: 'studio.create',
    description: 'Propose image, video, printable document, spreadsheet, or presentation creation using Panthorium plugins. For one output use pluginId and input. For connected work use steps (up to 5), with usePrevious only when the catalog says the next plugin accepts that output. A review card requires authenticated user approval before any paid or file-creating work. Never claim the output exists until job.status is completed. Never pass confirmation, idempotency keys, provider keys, modes, URLs or owner IDs.',
    properties: {
      pluginId: pluginSchema,
      input: inputSchema,
      sourceFileIds: sourceSchema,
      steps: { type: 'ARRAY', description: 'Optional ordered workflow, instead of top-level pluginId/input/sourceFileIds. Each step has its own content instruction; output handoff is explicit.', items: { type: 'OBJECT', description: 'One validated creative workflow step.', properties: { pluginId: pluginSchema, input: inputSchema, sourceFileIds: sourceSchema, usePrevious: { type: 'BOOLEAN', description: 'Reuse output files from the preceding step, only when their type is accepted by this plugin. Must be false or absent on the first step.' } }, required: ['pluginId', 'input'] } }
    }, required: []
  }
];

function validInput(value, pluginId) {
  if (!only(value, ['prompt', 'name', 'aspectRatio', 'durationSeconds']) || !text(value.prompt, pluginId === 'video' ? 1600 : 8000)) return false;
  if (value.name != null && (!text(value.name, 150) || /[\\/\x00-\x1f]/.test(value.name))) return false;
  if (value.aspectRatio != null && (!['image', 'video'].includes(pluginId) || !(pluginId === 'video' ? ['16:9', '9:16'] : ['1:1', '16:9', '9:16']).includes(value.aspectRatio))) return false;
  if (value.durationSeconds != null && (pluginId !== 'video' || !Number.isInteger(value.durationSeconds) || ![4, 6, 8].includes(value.durationSeconds))) return false;
  return true;
}
function validateStudioArgs(args) {
  if (!only(args, ['pluginId', 'input', 'sourceFileIds', 'steps'])) return 'invalid_studio_args';
  if (args.steps != null) {
    if (Object.keys(args).some(key => key !== 'steps') || !Array.isArray(args.steps) || args.steps.length < 1 || args.steps.length > 5) return 'invalid_studio_workflow';
    for (const [index, step] of args.steps.entries()) {
      if (!only(step, ['pluginId', 'input', 'sourceFileIds', 'usePrevious']) || !PLUGIN_IDS.includes(step.pluginId) || !validInput(step.input, step.pluginId) || !fileIds(step.sourceFileIds, step.pluginId) || (step.usePrevious != null && typeof step.usePrevious !== 'boolean') || (index === 0 && step.usePrevious)) return 'invalid_studio_workflow';
    }
    try { normalizeSteps(args); return null; } catch (error) { return error.code || 'invalid_studio_workflow'; }
  }
  if (!PLUGIN_IDS.includes(args.pluginId) || !validInput(args.input, args.pluginId) || !fileIds(args.sourceFileIds, args.pluginId)) return 'invalid_studio_args';
  try { normalizeSteps(args); return null; } catch (error) { return error.code || 'invalid_studio_args'; }
}
function requireAccount(user) {
  if (!user?.sub || String(user.sub).startsWith('guest:') || user.roles?.includes('guest')) throw Object.assign(new Error('studio_account_required'), { sideEffectNotApplied: true });
}
function registerCreativeStudioTools(registry, { studio } = {}) {
  if (!registry || typeof registry.register !== 'function') throw new Error('tool_registry_required');
  if (!studio) return;
  const read = (id, description, validateArgs, run, argsSchema = {}) => registry.register({ id, description, permission: 'chat', risk: 'low', mutates: false, argsSchema, validateArgs, run: async context => { requireAccount(context.user); return run(context); } });
  const noArgs = args => only(args, []) ? null : 'invalid_tool_args';
  read('studio.catalog', 'Read creative plugins and Auto/Never settings for the current account', noArgs, ({ user }) => studio.catalog({ user }));
  read('studio.jobs', 'Read creative jobs belonging to the current account without advancing them', noArgs, ({ user }) => studio.list({ user }));
  read('studio.status', 'Read a current-account creative job status and output files; never starts or advances it', args => only(args, ['jobId']) && UUID_RE.test(String(args.jobId || '')) ? null : 'invalid_studio_job', ({ user, args }) => studio.get({ user, jobId: args.jobId }), { jobId: 'required current-account creative job UUID' });
  registry.register({
    id: 'studio.create', description: 'Create image, video, printable document, spreadsheet or presentation files; run a connected workflow only after approval of its exact steps. May use paid providers.',
    permission: 'chat', risk: 'high', mutates: true, requiresConfirmation: true,
    argsSchema: { pluginId: PLUGIN_IDS.join(', '), input: 'prompt, optional name, aspectRatio and durationSeconds', sourceFileIds: 'current-account file UUIDs', steps: 'optional workflow of 1..5 {pluginId,input,sourceFileIds,usePrevious}; replaces other arguments' },
    validateArgs: validateStudioArgs,
    run: async ({ user, args, actionId }) => {
      requireAccount(user);
      // Only an action claimed by AgentService's ledger can create a Studio job.
      // This also fails closed on old deployments without the durable ledger.
      if (!actionId) throw Object.assign(new Error('immutable_action_confirmation_required'), { sideEffectNotApplied: true });
      return studio.start({ user, ...args, idempotencyKey: `action:${actionId}`, confirmed: true });
    }
  });
}

module.exports = { PLUGIN_IDS, STUDIO_TOOL_DEFINITIONS, validateStudioArgs, registerCreativeStudioTools };
