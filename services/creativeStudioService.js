'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { isAccountUser, runProcess } = require('./mediaStudioService');
const { ConcurrencyGate } = require('./concurrencyGate');
const { LIMITS } = require('./creativeStudioRepository');
const { sanitizeFilename, MAX_FILE_BYTES } = require('./cloudFilesService');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IMAGE_MODELS = new Set(['gemini-2.5-flash-image', 'gemini-3.1-flash-image']);
const ASPECTS = new Set(['1:1','3:2','2:3','3:4','4:3','4:5','5:4','9:16','16:9','21:9']);
const OFFICE_PREOUTPUT_ERRORS = new Set(['office_tabular_data_required', 'invalid_office_ai_output', 'invalid_office_content', 'office_table_columns_mismatch', 'invalid_office_sheet_name', 'office_drafting_failed']);
const PLUGINS = Object.freeze([
  { id: 'image', title: 'รูปภาพ', outputs: ['image/png','image/jpeg','image/webp'], acceptedSourceTypes: ['image/png','image/jpeg','image/webp'], maxSources:3, upstreamPlugins:['image'], requiresConfirmation: true },
  { id: 'video', title: 'วิดีโอ', outputs: ['video/mp4'], acceptedSourceTypes:['image/png','image/jpeg'], maxSources:1, upstreamPlugins:['image'], requiresConfirmation: true },
  { id: 'document', title: 'เอกสาร', outputs: ['docx','html'], acceptedSourceTypes:['text/plain','text/csv','text/tab-separated-values','text/markdown','application/json','docx','xlsx','pptx','image/png','image/jpeg'], maxSources:6, upstreamPlugins:['image','document','spreadsheet','presentation'], printCompanion:'.print.html', requiresConfirmation: false },
  { id: 'spreadsheet', title: 'ตาราง', outputs: ['xlsx','html'], acceptedSourceTypes:['text/plain','text/csv','text/tab-separated-values','text/markdown','application/json','docx','xlsx','pptx'], maxSources:6, upstreamPlugins:['document','spreadsheet','presentation'], printCompanion:'.print.html', requiresConfirmation: false },
  { id: 'presentation', title: 'งานนำเสนอ', outputs: ['pptx','html'], acceptedSourceTypes:['text/plain','text/csv','text/tab-separated-values','text/markdown','application/json','docx','xlsx','pptx','image/png','image/jpeg'], maxSources:6, upstreamPlugins:['image','document','spreadsheet','presentation'], printCompanion:'.print.html', requiresConfirmation: false }
]);

class CreativeStudioError extends Error {
  constructor(status, code, uncertain = false) { super(code); this.name = 'CreativeStudioError'; this.status = status; this.code = code; this.uncertain = uncertain; }
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
function sourceIds(value) {
  if (!Array.isArray(value) || value.length > 6 || value.some(id => typeof id !== 'string' || !UUID.test(id))) throw new CreativeStudioError(400, 'invalid_source_file_ids');
  return [...new Set(value)];
}
function normalizeInput(value) {
  if (typeof value === 'string') value = { prompt: value };
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CreativeStudioError(400, 'invalid_studio_input');
  if (Object.keys(value).some(key => !['prompt','name','title','content','aspectRatio','durationSeconds'].includes(key))) throw new CreativeStudioError(400, 'unsupported_studio_input');
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 48000) throw new CreativeStudioError(413, 'studio_input_too_large');
  if (typeof value.prompt !== 'string' || !value.prompt.trim() || value.prompt.length > 12000) throw new CreativeStudioError(400, 'invalid_studio_prompt');
  if (value.name != null && (typeof value.name !== 'string' || value.name.length > 150)) throw new CreativeStudioError(400, 'invalid_output_name');
  if (value.title != null && (typeof value.title !== 'string' || value.title.length > 200)) throw new CreativeStudioError(400, 'invalid_output_title');
  return JSON.parse(JSON.stringify({ ...value, prompt: value.prompt.trim() }));
}
function normalizeSteps({ pluginId, input, sourceFileIds = [], steps }) {
  const proposed = steps == null ? [{ pluginId, input, sourceFileIds }] : steps;
  if (!Array.isArray(proposed) || !proposed.length || proposed.length > 5) throw new CreativeStudioError(400, 'invalid_studio_workflow');
  const normalized = proposed.map((step, index) => {
    if (!step || !PLUGINS.some(plugin => plugin.id === step.pluginId)) throw new CreativeStudioError(400, 'unknown_studio_plugin');
    if (Object.keys(step).some(key => !['pluginId','input','sourceFileIds','usePrevious'].includes(key))) throw new CreativeStudioError(400, 'invalid_studio_step');
    if (step.usePrevious != null && typeof step.usePrevious !== 'boolean') throw new CreativeStudioError(400, 'invalid_studio_workflow');
    if (index === 0 && step.usePrevious) throw new CreativeStudioError(400, 'invalid_studio_workflow');
    if (step.usePrevious && !PLUGINS.find(plugin=>plugin.id===step.pluginId).upstreamPlugins.includes(proposed[index-1]?.pluginId)) throw new CreativeStudioError(400,'incompatible_studio_workflow');
    const normalizedInput = normalizeInput(step.input);
    const ids = sourceIds(step.sourceFileIds || []);
    if (['document','spreadsheet','presentation'].includes(step.pluginId) && (normalizedInput.prompt.length > 8000 || (normalizedInput.title || '').length > 160)) throw new CreativeStudioError(400,'invalid_office_input');
    if (step.pluginId === 'video') {
      if (normalizedInput.prompt.length > 1600) throw new CreativeStudioError(400, 'invalid_generation_prompt');
      if (ids.length > 1) throw new CreativeStudioError(400, 'too_many_video_sources');
      if (![4,6,8].includes(Number(normalizedInput.durationSeconds ?? 8))) throw new CreativeStudioError(400, 'invalid_generation_duration');
      if (!['16:9','9:16'].includes(normalizedInput.aspectRatio || '16:9')) throw new CreativeStudioError(400, 'invalid_generation_aspect');
    }
    if (step.pluginId === 'image' && (!ASPECTS.has(normalizedInput.aspectRatio || '1:1') || ids.length > 3)) throw new CreativeStudioError(400, 'invalid_image_input');
    return { pluginId: step.pluginId, input: normalizedInput, sourceFileIds: ids, usePrevious: Boolean(step.usePrevious), status: 'queued', files: [], error: null };
  });
  if (Buffer.byteLength(JSON.stringify(normalized)) > 100000) throw new CreativeStudioError(413, 'studio_workflow_too_large');
  return normalized;
}

class CreativeStudioService {
  constructor({ repository, files, providers, gateway, mediaStudio, office, resolveUser, audit, vertexFetch } = {}) {
    Object.assign(this, { repository, files, providers, gateway, mediaStudio, office, resolveUser, audit });
    this.vertexFetch = vertexFetch || ((...args) => fetch(...args));
    this.imageGate = gateway?.concurrencyGate || new ConcurrencyGate({limit:2,maxQueue:4,name:'studio-images',audit});
  }
  async init() { await this.repository?.init?.(); }
  requireAccount(user) { if (!isAccountUser(user)) throw new CreativeStudioError(403, 'account_required'); return String(user.sub || user.id); }
  requireStorage() { if (!this.repository?.available) throw new CreativeStudioError(503, 'studio_storage_unconfigured'); }
  async principal(user) {
    const ownerId = this.requireAccount(user);
    // Production must not execute from a stale role snapshot stored with the job.
    if (!this.resolveUser) throw new CreativeStudioError(503, 'studio_account_validation_unconfigured');
    const current = await this.resolveUser(user);
    if (!current || this.requireAccount(current) !== ownerId) throw new CreativeStudioError(403, 'account_required');
    return current;
  }
  imageConfig() {
    return { model: String(process.env.PANTHORIUM_IMAGE_MODEL || 'gemini-2.5-flash-image'), location: String(process.env.SENTINEL_IMAGE_LOCATION || 'global'), project: String(this.providers?.vertex?.project || '') };
  }
  fileStorageReady() { try { this.files?.ensureConfigured?.(); return Boolean(this.files?.bucket && this.files?.upload && this.files?.download); } catch (_) { return false; } }
  available(pluginId) {
    if (!this.repository?.available) return 'studio_storage_unconfigured';
    if (!this.resolveUser) return 'studio_account_validation_unconfigured';
    if (!this.fileStorageReady()) return 'files_storage_unconfigured';
    if (pluginId === 'image') {
      const config = this.imageConfig();
      return this.providers?.vertexPublisherConfigured?.() && this.providers?.vertexAccessToken && IMAGE_MODELS.has(config.model)
        && /^[a-z0-9-]{2,40}$/.test(config.location) && /^[A-Za-z0-9.-]{3,100}$/.test(config.project) ? null : 'image_generation_unavailable';
    }
    if (pluginId === 'video') return this.mediaStudio?.capabilities?.().videoGeneration ? null : 'video_generation_unavailable';
    return this.office?.create && this.gateway?.complete ? null : 'office_generation_unavailable';
  }
  async catalog({ user }) {
    const ownerId = this.requireAccount(user);
    const modes = this.repository?.available ? await this.repository.modes(ownerId) : {};
    return { durable: Boolean(this.repository?.available && this.repository.durable), limits: LIMITS, plugins: PLUGINS.map(plugin => ({ ...plugin, version: 1, available: !this.available(plugin.id), reason: this.available(plugin.id), mode: modes[plugin.id] || 'auto' })) };
  }
  async assertAllowed(user, pluginId) {
    const ownerId = this.requireAccount(user); this.requireStorage();
    if (!PLUGINS.some(plugin => plugin.id === pluginId)) throw new CreativeStudioError(400, 'unknown_studio_plugin');
    if ((await this.repository.modes(ownerId))[pluginId] === 'never') throw new CreativeStudioError(403, 'studio_plugin_disabled');
    return true;
  }
  async setMode({ user, pluginId, mode }) {
    const current = await this.principal(user); this.requireStorage();
    if (!PLUGINS.some(plugin => plugin.id === pluginId) || !['auto','never'].includes(mode)) throw new CreativeStudioError(400, 'invalid_studio_mode');
    await this.repository.setMode(this.requireAccount(current), pluginId, mode);
    return { pluginId, mode };
  }
  publicJob(job) {
    // Older Office validation failures were classified as uncertain submissions.
    // Correct the read-only display; never retry or rewrite historical jobs here.
    const displayState = step => step?.status === 'needs_review' && ['document','spreadsheet','presentation'].includes(step.pluginId) && OFFICE_PREOUTPUT_ERRORS.has(step.error) ? 'failed' : step?.status;
    return { id: job.id, status: job.status === 'needs_review' && displayState(job.steps[job.currentStep]) === 'failed' ? 'failed' : job.status, pluginId: job.steps.length === 1 ? job.steps[0].pluginId : 'workflow', currentStep: job.currentStep,
      steps: job.steps.map(step => ({ pluginId: step.pluginId, status: displayState(step), files: step.files || [], sourceFileIds: step.resolvedSourceFileIds || step.sourceFileIds, usePrevious: step.usePrevious, error: step.error || null })),
      files: job.files || [], summary: job.summary || '', error: job.error || null, createdAt: job.createdAt, updatedAt: job.updatedAt };
  }
  async start({ user, pluginId, input, sourceFileIds = [], idempotencyKey, confirmed = false, steps } = {}) {
    let current, ownerId, normalized;
    try {
    current = await this.principal(user); ownerId = this.requireAccount(current); this.requireStorage();
    if (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9:_-]{8,128}$/.test(idempotencyKey)) throw new CreativeStudioError(400, 'invalid_idempotency_key');
    normalized = normalizeSteps({ pluginId, input, sourceFileIds, steps });
    for (const step of normalized) {
      await this.assertAllowed(current, step.pluginId);
      const unavailable = this.available(step.pluginId); if (unavailable) throw new CreativeStudioError(503, unavailable);
      if (['image','video'].includes(step.pluginId) && confirmed !== true) throw new CreativeStudioError(409, 'generation_confirmation_required');
      for (const id of step.sourceFileIds) await this.files.findObject(ownerId, id);
    }
    } catch(error) { error.sideEffectNotApplied=true; throw error; }
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify(stable({ steps: normalized }))).digest('hex');
    const principal = { sub: ownerId, roles: current.roles, permissions: current.permissions, ...(current.accountVersion != null ? { accountVersion: current.accountVersion } : {}) };
    const result = await this.repository.create({ id: crypto.randomUUID(), ownerId, principal, idempotencyKey, fingerprint, confirmed: confirmed === true, steps: normalized, status: 'queued', currentStep: 0, files: [], summary: '', error: null });
    if (!result.job || result.job.fingerprint !== fingerprint) throw new CreativeStudioError(409, 'studio_idempotency_conflict');
    // The caller awaits a bounded step. No detached promise is required to preserve a job.
    if (result.created) return this.advance({ user: current, jobId: result.job.id });
    return { job: this.publicJob(result.job) };
  }
  async get({ user, jobId }) {
    const ownerId = this.requireAccount(user); this.requireStorage();
    if (!UUID.test(String(jobId))) throw new CreativeStudioError(400, 'invalid_studio_job');
    const job = await this.repository.get(ownerId, jobId); if (!job) throw new CreativeStudioError(404, 'studio_job_not_found');
    return { job: this.publicJob(job) };
  }
  async list({ user }) { const ownerId = this.requireAccount(user); this.requireStorage(); return { jobs: (await this.repository.list(ownerId)).map(job => this.publicJob(job)) }; }
  async advance({ user, jobId }) {
    const ownerId = this.requireAccount(user); this.requireStorage();
    if (!UUID.test(String(jobId))) throw new CreativeStudioError(400, 'invalid_studio_job');
    const job = await this.repository.claim(ownerId, jobId);
    if (!job) return this.get({ user, jobId });
    return { job: this.publicJob(await this.executeClaim(job)) };
  }
  async executeClaim(job) {
    const step = job.steps[job.currentStep];
    try {
      const user = await this.principal(job.principal);
      await this.assertAllowed(user, step.pluginId);
      const unavailable = this.available(step.pluginId); if (unavailable) throw new CreativeStudioError(503, unavailable);
      // The previous process may have crossed a billing/storage boundary before it died.
      if (step.status === 'submitting') throw new CreativeStudioError(409, 'studio_submission_uncertain', true);
      const previous = step.usePrevious ? job.steps[job.currentStep - 1].files.map(file => file.id) : [];
      const ids = sourceIds([...new Set([...step.sourceFileIds, ...previous])]);
      step.resolvedSourceFileIds = ids;
      for (const id of ids) await this.files.findObject(job.ownerId, id);
      if (step.pluginId === 'video' && (ids.length > 1 || (ids.length && !['image/png','image/jpeg'].includes((await this.files.findObject(job.ownerId,ids[0])).contentType)))) throw new CreativeStudioError(415,'video_image_source_required');
      let result;
      if (step.pluginId === 'video' && step.providerJobToken) {
        try { result = await this.mediaStudio.generationStatus({ user, jobToken: step.providerJobToken, allowExpired: true }); }
        catch (error) {
          // Polling an existing operation never submits another paid job. Transient reads can retry.
          if ((Number(error.status) || 500) >= 500) {
            step.pollFailures = (step.pollFailures || 0) + 1;
            if (step.pollFailures <= 8) return this.repository.save(job, { release: true, delayMs: 30000 });
          }
          throw error;
        }
        if (result.status === 'running') return this.repository.save(job, { release: true, delayMs: 15000 });
        if (result.status !== 'completed' || !result.file) throw new CreativeStudioError(422, result.error || 'video_generation_failed');
        result = { files: [result.file], summary: 'สร้างวิดีโอเรียบร้อยแล้ว' };
      } else {
        step.status = 'submitting'; job.status = 'running';
        await this.repository.save(job);
        if (step.pluginId === 'video') {
          try { result = await this.mediaStudio.startGeneration({ user, ...step.input, ...(ids.length ? { sourceFileId: ids[0] } : {}), confirmed: job.confirmed }); }
          catch (error) { throw new CreativeStudioError(error.status || 503, error.code || 'video_generation_unavailable', true); }
          if (!result.jobToken) throw new CreativeStudioError(503, 'studio_submission_uncertain', true);
          step.providerJobToken = result.jobToken; step.status = 'running';
          return this.repository.save(job, { release: true, delayMs: 15000 });
        }
        if (step.pluginId === 'image') result = await this.imageGate.run(()=>this.generateImage({ user, input: step.input, sourceFileIds: ids }));
        else {
          const officeInput = Object.fromEntries(Object.entries(step.input).filter(([key]) => ['prompt','title','content'].includes(key)));
          result = await this.office.create({ user, pluginId: step.pluginId, input: officeInput, sourceFileIds: ids, name: step.input.name || '' });
        }
      }
      if (!Array.isArray(result.files) || !result.files.length || result.files.length > 6 || result.files.some(file => !UUID.test(String(file?.id)))) throw new CreativeStudioError(502, 'invalid_studio_output', true);
      // Authorize even adapter-returned artifacts before making them visible or passing them onward.
      for (const file of result.files) await this.files.findObject(job.ownerId, file.id);
      step.files = result.files; step.status = 'completed'; step.summary = String(result.summary || '').slice(0,1000); delete step.providerJobToken;
      job.files.push(...result.files.map(file => ({ ...file, pluginId: step.pluginId, stepIndex: job.currentStep, jobId: job.id, sourceFileIds: ids })));
      job.summary = step.summary; job.currentStep += 1;
      job.status = job.currentStep === job.steps.length ? 'completed' : 'queued';
      this.audit?.record('studio.step_completed', { userId: job.ownerId, jobId: job.id, pluginId: step.pluginId, outputCount: result.files.length });
      return await this.repository.save(job, { release: true });
    } catch (error) {
      if (error.code === 'studio_lease_lost') throw error;
      const code = String(error.code || error.message || 'studio_operation_failed').replace(/[^a-zA-Z0-9_:.-]/g,'_').slice(0,100);
      const knownOfficeFailure = ['document','spreadsheet','presentation'].includes(step.pluginId) && error.name === 'OfficeArtifactError' && error.artifactNotCreated === true;
      const uncertain = !knownOfficeFailure && (error.uncertain === true || (step.status === 'submitting' && !(error instanceof CreativeStudioError && error.uncertain === false)));
      step.error = code; step.status = uncertain ? 'needs_review' : 'failed'; job.status = step.status; job.error = code;
      for (const remaining of job.steps.slice(job.currentStep + 1)) remaining.status = 'blocked';
      this.audit?.record('studio.step_failed', { userId: job.ownerId, jobId: job.id, pluginId: step.pluginId, error: code, status: job.status });
      return this.repository.save(job, { release: true });
    }
  }
  async tick() {
    if (!this.repository?.available) return { processed: 0, reason: 'studio_storage_unconfigured' };
    const jobs = await this.repository.due(1); let processed = 0;
    for (const item of jobs) { const job = await this.repository.claim(item.ownerId,item.id); if (job) { await this.executeClaim(job); processed += 1; } }
    return { processed };
  }
  async generateImage({ user, input, sourceFileIds }) {
    const ownerId = this.requireAccount(user), config = this.imageConfig();
    if (sourceFileIds.length > 3) throw new CreativeStudioError(400, 'too_many_image_sources');
    const parts = [{ text: 'Create one image following the user request. Return the image with a short description.\n' + input.prompt }];
    let totalBytes = 0;
    for (const id of sourceFileIds) {
      const file = await this.files.download(ownerId,id);
      if (!['image/png','image/jpeg','image/webp'].includes(file.contentType)) throw new CreativeStudioError(415, 'image_source_required');
      if (!file.body?.length || file.body.length > 7*1024*1024 || (totalBytes += file.body.length) > 14*1024*1024) throw new CreativeStudioError(413, 'image_source_too_large');
      parts.push({ inlineData: { mimeType: file.contentType, data: file.body.toString('base64') } });
    }
    let token; try { token = await this.providers.vertexAccessToken(); } catch (_) { throw new CreativeStudioError(503, 'image_generation_unavailable'); }
    if (!token) throw new CreativeStudioError(503, 'image_generation_unavailable');
    const host = config.location === 'global' ? 'aiplatform.googleapis.com' : `${config.location}-aiplatform.googleapis.com`;
    const url = `https://${host}/v1/projects/${encodeURIComponent(config.project)}/locations/${config.location}/publishers/google/models/${config.model}:generateContent`;
    let response;
    try {
      // Official Vertex Gemini image API; never trust a model/user-provided URL.
      // https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/image-generation
      response = await this.vertexFetch(url, { method: 'POST', headers: { Authorization: 'Bearer '+token, 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['TEXT','IMAGE'], imageConfig: { aspectRatio: input.aspectRatio || '1:1' }, candidateCount: 1, maxOutputTokens: 8192 } }), signal: AbortSignal.timeout(90000) });
    } catch (_) { throw new CreativeStudioError(503, 'image_submission_uncertain', true); }
    if (!response.ok) throw new CreativeStudioError(503, response.status === 429 ? 'image_generation_capacity' : 'image_generation_unavailable', response.status >= 500);
    let data; try { data = await response.json(); } catch (_) { throw new CreativeStudioError(502, 'image_response_invalid', true); }
    const output = data?.candidates?.[0]?.content?.parts || [];
    const images = output.filter(part => part.inlineData && ['image/png','image/jpeg','image/webp'].includes(part.inlineData.mimeType)).slice(0,1);
    if (!images.length) throw new CreativeStudioError(422, data.promptFeedback?.blockReason ? 'image_generation_filtered' : 'image_generation_empty');
    const files = [];
    for (const part of images) {
      const encoded = part.inlineData.data;
      if (typeof encoded !== 'string' || encoded.length > Math.ceil(MAX_FILE_BYTES*4/3)+16 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new CreativeStudioError(413, 'generated_image_too_large', true);
      const bytes = Buffer.from(encoded,'base64');
      const type = part.inlineData.mimeType;
      const valid = type === 'image/png' ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : type === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 : bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP';
      if (!valid || !bytes.length || bytes.length>MAX_FILE_BYTES) throw new CreativeStudioError(502, 'invalid_generated_image', true);
      const extension = { 'image/png':'png', 'image/jpeg':'jpg', 'image/webp':'webp' }[type];
      await this.validateGeneratedImage(bytes,type,extension);
      const name = sanitizeFilename(input.name || 'sentinel-image').replace(/\.[^.]*$/,'').slice(0,140) + '.' + extension;
      try { files.push(await this.files.upload(ownerId,name,type,bytes)); }
      catch (_) { throw new CreativeStudioError(503, 'image_output_save_uncertain', true); }
    }
    return { files, summary: output.filter(part => typeof part.text === 'string' && !part.thought).map(part => part.text).join('\n').slice(0,1000) || 'สร้างรูปภาพเรียบร้อยแล้ว' };
  }
  async validateGeneratedImage(bytes,type,extension) {
    let directory;
    try {
      directory=await fs.mkdtemp(path.join(os.tmpdir(),'panthorium-image-'));
      const file=path.join(directory,'image.'+extension);await fs.writeFile(file,bytes,{mode:0o600,flag:'wx'});
      // Decode one bounded frame using the existing deployed media encoder.
      // Fixed image decoder + local-only protocols prevent playlist/URL interpretation.
      const decoder={'image/png':'png','image/jpeg':'mjpeg','image/webp':'webp'}[type];
      await runProcess(process.env.FFMPEG_PATH || 'ffmpeg',['-hide_banner','-v','error','-xerror','-err_detect','explode','-protocol_whitelist','file,pipe','-f','image2','-pattern_type','none','-c:v',decoder,'-max_pixels','16777216','-i',file,'-frames:v','1','-f','null','-'],{timeoutMs:10000,maxOutputBytes:1024});
    } catch(_) { throw new CreativeStudioError(502,'invalid_generated_image',true); }
    finally { if(directory) await fs.rm(directory,{recursive:true,force:true}).catch(()=>{}); }
  }
}

module.exports = { CreativeStudioService, CreativeStudioError, PLUGINS, IMAGE_MODELS, normalizeSteps, stable };
