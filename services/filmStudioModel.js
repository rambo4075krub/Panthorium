'use strict';

const {createHash, randomUUID} = require('node:crypto');
const {fail, id, text} = require('./onlineToolModel');

const FEATURE_SECONDS = 180 * 60;
const FEATURE_SEQUENCES = 360;
function sequenceSeconds(ep) {
  return ep.footage ? ep.footage.end - ep.footage.start : ep.shots.reduce((n, s) => n + s.seconds, 0);
}
function featureSequence(e) {
  if (!e || typeof e !== 'object') fail('invalid_feature_sequence');
  const act = e.act ?? 1;
  const plannedSeconds = e.plannedSeconds ?? 0;
  if (
    ![1, 2, 3].includes(act) ||
    !Number.isInteger(plannedSeconds) ||
    plannedSeconds < 0 ||
    plannedSeconds > 120
  )
    fail('invalid_feature_sequence');
  let footage = null;
  if (e.footage != null) {
    const {start, end, fileId} = e.footage;
    if (
      ![start, end].every(Number.isFinite) ||
      start < 0 ||
      end > 86400 ||
      end - start < 0.05 ||
      end - start > 120
    )
      fail('invalid_feature_footage');
    footage = {fileId: id(fileId), start, end};
  }
  return {act, plannedSeconds, footage};
}
function featureSettings(value = {}) {
  if (!value || typeof value !== 'object') fail('invalid_feature_duration');
  const minutes = value.minutes ?? 120;
  if (![120, 150, 180].includes(minutes)) fail('invalid_feature_duration');
  return {
    minutes,
    synopsis: text(value.synopsis ?? '', 6000, true),
    screenplay: text(value.screenplay ?? '', 120000, true)
  };
}

function items(value, limit, map) {
  if (!Array.isArray(value) || value.length > limit) fail('invalid_film_plan');
  return value.map(map);
}
function unique(values) {
  if (new Set(values).size !== values.length) fail('duplicate_film_item');
  return values;
}
function entity(raw) {
  return {
    id: id(raw?.id),
    name: text(raw?.name, 64),
    description: text(raw.description, 400, true),
    referenceId: raw.referenceId ? id(raw.referenceId) : null
  };
}
function normalizeFilm(raw) {
  if (
    !['movie', 'series', 'short', 'feature'].includes(raw.format) ||
    !['16:9', '9:16'].includes(raw.aspect)
  )
    fail('invalid_film_format');
  const characters = items(raw.characters, 40, entity);
  const locations = items(raw.locations, 40, entity);
  const feature = raw.format === 'feature';
  const episodes = items(raw.episodes, feature ? FEATURE_SEQUENCES : 40, (e) => ({
    ...(feature ? featureSequence(e) : {}),
    id: id(e?.id),
    title: text(e?.title, 90),
    story: text(e.story, 8000, true),
    shots: items(e.shots, 8, (s) => {
      const characterIds = unique(items(s?.characterIds, 2, id));
      const locationId = s.locationId ? id(s.locationId) : null;
      if (
        characterIds.some((key) => !characters.some((c) => c.id === key)) ||
        (locationId && !locations.some((l) => l.id === locationId)) ||
        ![4, 6, 8].includes(s.seconds)
      )
        fail('invalid_film_shot');
      return {
        id: id(s.id),
        action: text(s.action, 420),
        camera: text(s.camera, 150, true),
        emotion: text(s.emotion || '', 100, true),
        dialogue: text(s.dialogue, 200, true),
        seconds: s.seconds,
        locationId,
        characterIds
      };
    })
  }));
  if (!episodes.length || (raw.format === 'short' && episodes.length !== 1)) fail('invalid_film_episodes');
  unique([...characters, ...locations, ...episodes, ...episodes.flatMap((e) => e.shots)].map((x) => x.id));
  const body = {
    ...(feature ? {feature: featureSettings(raw.feature)} : {}),
    format: raw.format,
    aspect: raw.aspect,
    style: text(raw.style, 200, true),
    characters,
    locations,
    episodes
  };
  if (feature && episodes.reduce((n, e) => n + sequenceSeconds(e), 0) > FEATURE_SECONDS + 0.001)
    fail('film_duration_exceeded');
  if (Buffer.byteLength(JSON.stringify(body)) > (feature ? 20 * 1024 * 1024 : 380000))
    fail('film_project_too_large', 413);
  return body;
}

// Model output describes names and visual direction. File IDs, job parameters and identity keys are assigned here.
function applyPlan(body, episodeId, plan, count) {
  const next = structuredClone(body);
  const episode = next.episodes.find((e) => e.id === episodeId);
  if (!episode || !plan || !Array.isArray(plan.shots) || plan.shots.length !== count)
    fail('invalid_film_plan', 422);
  const nameKey = (value) => text(value, 64).normalize('NFC').toLowerCase();
  const match = (rows, name) => rows.find((x) => nameKey(x.name) === nameKey(name));
  try {
    for (const group of ['characters', 'locations']) {
      for (const entry of items(plan[group], 2, (e) =>
        entity({name: e?.name, description: e?.description, id: randomUUID()})
      )) {
        if (!match(next[group], entry.name)) next[group].push(entry);
      }
    }
    episode.shots = plan.shots.map((s) => {
      const place = s.location ? match(next.locations, s.location) : null;
      if (s.location && !place) fail('invalid_film_plan');
      const characterIds = items(s.characters, 2, (n) => {
        const c = match(next.characters, n);
        if (!c) fail('invalid_film_plan');
        return c.id;
      });
      return {
        id: randomUUID(),
        action: s.action,
        camera: s.camera || '',
        emotion: s.emotion || '',
        dialogue: s.dialogue || '',
        seconds: s.seconds,
        characterIds,
        locationId: place?.id || null
      };
    });
    return normalizeFilm(next);
  } catch {
    fail('invalid_film_plan', 422);
  }
}

const digest = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex');

// The same graph describes progress, exact cost preview and execution. A new version of a reference
// invalidates its consumers even when its written description has stayed the same.
function filmGraph(project, episodeId, assets, requestId, target = '') {
  const b = project.body,
    ep = b.episodes.find((x) => x.id === episodeId);
  if (!ep) fail('film_episode_not_found', 404);
  const nodes = new Map(),
    status = {},
    steps = [],
    targets = [];
  function add(key, pluginId, input, deps = [], referenceId = null) {
    nodes.set(key, {key, pluginId, input, deps, referenceId});
  }
  for (const c of b.characters)
    add(
      'character:' + c.id,
      'image',
      {
        prompt: [
          'Create a single character reference portrait for a film. Clearly show facial features, hairstyle, costume and silhouette. No text.',
          c.name,
          c.description,
          b.style
        ].join('\n'),
        aspectRatio: '1:1',
        name: c.name
      },
      [],
      c.referenceId
    );
  for (const l of b.locations)
    add(
      'location:' + l.id,
      'image',
      {
        prompt: [
          'Establishing reference of an empty film location. Preserve layout, lighting and visual style. No people or text.',
          l.name,
          l.description,
          b.style
        ].join('\n'),
        aspectRatio: b.aspect,
        name: l.name
      },
      [],
      l.referenceId
    );
  (ep.footage ? [] : ep.shots).forEach((s, i) => {
    const cast = s.characterIds.map((k) => b.characters.find((c) => c.id === k));
    const place = b.locations.find((l) => l.id === s.locationId);
    const frame = 'frame:' + s.id;
    const name = ep.title + ' - ' + (i + 1);
    add(
      frame,
      'image',
      {
        prompt: [
          'Create one full-bleed cinematic storyboard frame, no collage, captions or lettering. Match each supplied character portrait and the location reference.',
          ...cast.map((c, n) => 'Character reference ' + (n + 1) + ': ' + c.name + ' — ' + c.description),
          place && 'Location reference: ' + place.name + ' — ' + place.description,
          b.style,
          s.camera,
          s.emotion,
          s.action
        ]
          .filter(Boolean)
          .join('\n'),
        aspectRatio: b.aspect,
        name: name + ' - frame'
      },
      [...s.characterIds.map((k) => 'character:' + k), ...(place ? ['location:' + place.id] : [])]
    );
    add(
      'clip:' + s.id,
      'video',
      {
        prompt: [
          'Animate the supplied first frame as one continuous film shot. Preserve faces, costumes, setting and screen direction.',
          b.style,
          s.camera,
          s.emotion,
          s.action,
          s.dialogue && 'Spoken dialogue in its original language: ' + s.dialogue
        ]
          .filter(Boolean)
          .join('\n'),
        aspectRatio: b.aspect,
        durationSeconds: s.seconds,
        name: name + ' - clip'
      },
      [frame]
    );
  });
  const final = 'episode:' + ep.id;
  if (ep.footage) {
    add(
      final,
      'film-assemble',
      {
        aspectRatio: b.aspect,
        startSeconds: ep.footage.start,
        durations: [sequenceSeconds(ep)],
        name: ep.title
      },
      [],
      ep.footage.fileId
    );
  } else
    add(
      final,
      'film-assemble',
      {aspectRatio: b.aspect, durations: ep.shots.map((s) => s.seconds), name: ep.title},
      ep.shots.map((s) => 'clip:' + s.id)
    );

  function signature(node, versions) {
    const {name, ...visualInput} = node.input;
    return digest([node.pluginId, visualInput, node.deps, node.referenceId, versions]);
  }
  // Identical trims of an owned, immutable source share the same normalized sequence file.
  // This also permits reuse across acts without creating another intermediate MP4.
  let reused;
  if (ep.footage) {
    const sig = signature(nodes.get(final), []);
    reused = Object.values(assets).find(
      (asset) => asset.key?.startsWith('episode:') && asset.signature === sig
    );
  }
  function existing(key) {
    return key === final && reused ? reused : assets[key];
  }
  for (const node of nodes.values()) {
    const old = existing(node.key);
    const ready =
      !!old &&
      node.deps.every((k) => status[k]?.ready) &&
      old.signature ===
        signature(
          node,
          node.deps.map((k) => assets[k]?.version)
        );
    status[node.key] = {ready, ...(old ? {file: old.file} : {})};
  }
  const resolved = new Map();
  function schedule(key) {
    if (resolved.has(key)) return resolved.get(key);
    const node = nodes.get(key);
    if (!node || (node.pluginId === 'film-assemble' && !node.deps.length && !node.referenceId))
      fail('film_shots_required');
    const deps = node.deps.map(schedule);
    const sig = signature(
      node,
      deps.map((d) => d.version)
    );
    const old = existing(key);
    let ref;
    if (old && old.signature === sig && !(target === key && key !== final))
      ref = {fileId: old.file.id, version: old.version};
    else {
      ref = {step: steps.length, version: digest([requestId, key])};
      steps.push({
        pluginId: node.pluginId,
        input: node.input,
        sources: [
          ...(node.referenceId ? [{fileId: node.referenceId}] : []),
          ...deps.map((d) => (d.fileId ? {fileId: d.fileId} : {step: d.step}))
        ]
      });
      targets.push({key, signature: sig, version: ref.version});
    }
    resolved.set(key, ref);
    return ref;
  }
  if (target) {
    if (!nodes.has(target)) fail('invalid_film_target');
    schedule(target);
  }
  return {steps, targets, status};
}
module.exports = {normalizeFilm, applyPlan, filmGraph, sequenceSeconds, FEATURE_SECONDS, FEATURE_SEQUENCES};
