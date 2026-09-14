(function (root, factory) {
  const catalog = factory();
  if (typeof module === 'object' && module.exports) module.exports = catalog;
  else root.PanthoriumWindowCatalog = catalog;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  // One allowlist for the server, desktop and voice client. Never execute a
  // function name or selector supplied by an AI response or a transcript.
  const apps = [
    { id: 'sentinel', key: 'sentinel', label: 'Sentinel AI', permission: 'chat', aliases: ['Sentinel AI', 'เซนทิเนลเอไอ', 'แชต', 'แชท'], selector: '.window[data-id="sentinel"]', opener: 'openSentinel', windowId: 'sentinel' },
    { id: 'settings', key: 'settings', label: 'Settings', permission: 'settings', aliases: ['Settings', 'Setting', 'การตั้งค่า', 'ตั้งค่า'], selector: '.window[data-id="settings"]', opener: 'openSettings', windowId: 'settings' },
    { id: 'security', key: 'security_dashboard', label: 'Security', permission: 'settings', role: 'administrator', aliases: ['Security Dashboard', 'Security', 'ซีเคียวริตี้', 'แดชบอร์ดความปลอดภัย', 'ความปลอดภัย'], selector: '.window[data-id="security-dashboard"]', opener: 'PanthoriumSecurityDashboard.open', windowId: 'security-dashboard', refreshButton: '[data-p3-refresh]' },
    { id: 'ai-platform', key: 'ai_dashboard', label: 'AI Platform', permission: 'chat', aliases: ['AI Platform', 'AI Dashboard', 'เอไอแพลตฟอร์ม', 'แดชบอร์ดเอไอ', 'สถานะเอไอ', 'สถานะ Sentinel', 'สถานะเซนทิเนล'], selector: '#phase4-ai-dashboard', opener: 'PanthoriumAI.open', closeButton: '#ai-close', refresher: 'PanthoriumAI.refresh' },
    { id: 'sentinel-agent', key: 'sentinel_agent', label: 'Sentinel Agent', permission: 'chat', aliases: ['Sentinel Agent', 'เซนทิเนลเอเจนต์', 'เซนติเนลเอเจนท์'], selector: '#phase5-agent-ui', opener: 'PanthoriumAgent.open', closeButton: '#agent-close', refresher: 'PanthoriumAgent.history' },
    { id: 'agent-automation', key: 'agent_automation', label: 'Agent Automation', permission: 'settings', aliases: ['Agent Automation', 'Automation', 'เอเจนต์ออโตเมชัน', 'ระบบอัตโนมัติ'], selector: '#agent-automation-dashboard', opener: 'PanthoriumAutomation.open', closeButton: '[data-close]', refresher: 'PanthoriumAutomation.refresh' },
    { id: 'memory-knowledge', key: 'memory_knowledge', label: 'Memory & Knowledge', permission: 'settings', aliases: ['Memory and Knowledge', 'Memory & Knowledge', 'Memory Knowledge', 'Memory', 'Knowledge', 'หน่วยความจำ', 'คลังความรู้'], selector: '#agent-memory-dashboard', opener: 'PanthoriumMemoryKnowledge.open', closeButton: '[data-close]', refresher: 'PanthoriumMemoryKnowledge.refresh' },
    { id: 'multi-agent', key: 'multi_agent', label: 'Multi-Agent', permission: 'settings', aliases: ['Multi-Agent', 'มัลติเอเจนต์', 'มัลติเอเจนท์', 'มัลติเจนต์', 'มัลติเจ้น'], selector: '#multi-agent-dashboard', opener: 'PanthoriumMultiAgent.open', closeButton: '[data-close]', refresher: 'PanthoriumMultiAgent.refresh' },
    { id: 'integrations', key: 'integrations', label: 'Integrations', permission: 'settings', aliases: ['Integrations', 'Integration', 'อินทิเกรชัน', 'อินทิเกรชั่น', 'การเชื่อมต่อ'], selector: '#integrations-dashboard', opener: 'PanthoriumIntegrations.open', closeButton: '[data-close]', refreshButton: '[data-refresh]' },
    { id: 'training-lab', key: 'learning_lab', label: 'Learning Lab', permission: 'settings', aliases: ['Learning Lab', 'Training Lab', 'เลิร์นนิงแล็บ', 'เลิร์นนิ่งแล็บ', 'เลินนิ่งแลป', 'เลิร์นนิ่งแลบ', 'เลิร์นนิ่งแลป', 'เทรนนิ่งแล็บ', 'ห้องเรียนรู้', 'ห้องฝึกสอน'], selector: '#sentinel-training-lab', opener: 'PanthoriumTraining.open', closeButton: '#st-close', refresher: 'PanthoriumTraining.refresh' },
    { id: 'production', key: 'production_intelligence', label: 'Production Intelligence', permission: 'settings', aliases: ['Production Intelligence', 'Production', 'ข้อมูลการผลิต'], selector: '#panthorium-production-intelligence', opener: 'PanthoriumProductionIntelligence.open', closeButton: '[data-production-close]', refresher: 'PanthoriumProductionIntelligence.open' },
    { id: 'governance', key: 'governance', label: 'Governance', permission: 'settings', aliases: ['Governance', 'กัฟเวอร์แนนซ์', 'ธรรมาภิบาล'], selector: '#panthorium-governance-dashboard', opener: 'PanthoriumGovernance.open', closeButton: '#gov-close', refresher: 'PanthoriumGovernance.refresh' },
    { id: 'sentinel-control', key: 'sentinel_control', label: 'Sentinel Control', permission: 'settings', aliases: ['Sentinel Control', 'เซนทิเนลคอนโทรล', 'ควบคุมเซนทิเนล'], selector: '#panthorium-sentinel-control-dashboard', opener: 'PanthoriumSentinelControl.open', closeButton: '#dai-close', refresher: 'PanthoriumSentinelControl.refresh' }
  ];
  function allowed(app, user) {
    return !!app && (user?.permissions || []).includes(app.permission) && (!app.role || (user?.roles || []).includes(app.role));
  }
  const normalize = text => String(text || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  const aliases = apps.flatMap(app => app.aliases.map(alias => ({ app, alias: normalize(alias) }))).sort((a, b) => b.alias.length - a.alias.length);
  function actionFor(action) {
    const match = /^(open|close|refresh)_(.+)$/.exec(String(action || ''));
    const app = match && apps.find(item => item.key === match[2]);
    return app ? { app, operation: match[1], action: match[0] } : null;
  }
  const functionCommands = [
    { action: 'function_ai_refresh', appId: 'ai-platform', permission: 'chat', aliases: ['รีเฟรช AI Platform', 'รีเฟรช AI Dashboard', 'รีเฟรชสถานะ AI', 'refresh AI Platform'], button: '#ai-refresh' },
    { action: 'function_security_refresh', appId: 'security', permission: 'settings', role: 'administrator', aliases: ['รีเฟรช Security', 'รีเฟรช Security Dashboard', 'ตรวจ Security', 'refresh Security'], button: '[data-p3-refresh]' },
    { action: 'function_agent_refresh', appId: 'sentinel-agent', permission: 'chat', aliases: ['ดูประวัติ Sentinel Agent', 'รีเฟรช Sentinel Agent', 'refresh Sentinel Agent'], button: '#agent-history' },
    { action: 'function_automation_refresh', appId: 'agent-automation', permission: 'settings', aliases: ['รีเฟรช Agent Automation', 'ตรวจ Agent Automation', 'refresh Agent Automation'], button: '[data-refresh]' },
    { action: 'function_memory_refresh', appId: 'memory-knowledge', permission: 'settings', aliases: ['รีเฟรช Memory', 'รีเฟรช Knowledge', 'ตรวจ Memory', 'refresh Memory'], button: '[data-refresh]' },
    { action: 'function_multi_refresh', appId: 'multi-agent', permission: 'settings', aliases: ['รีเฟรช Multi Agent', 'ตรวจ Multi Agent', 'refresh Multi Agent'], button: '[data-refresh]' },
    { action: 'function_integrations_refresh', appId: 'integrations', permission: 'settings', aliases: ['รีเฟรช Integrations', 'ตรวจ Integrations', 'refresh Integrations'], button: '[data-refresh]' },
    { action: 'function_training_refresh', appId: 'training-lab', permission: 'settings', aliases: ['รีเฟรช Learning Lab', 'รีเฟรช Training Lab', 'ตรวจ Learning Lab', 'refresh Learning Lab'], button: '#st-refresh' },
    { action: 'function_training_auto_run', appId: 'training-lab', permission: 'settings', aliases: ['รันคิวฝึก', 'ตรวจคิวฝึก', 'ประมวลผลคิวฝึก', 'run training queue'], button: '#st-auto-run', requiresConfirmation: true },
    { action: 'function_training_benchmark', appId: 'training-lab', permission: 'settings', aliases: ['รัน Benchmark', 'เริ่ม Benchmark', 'ทดสอบ Benchmark', 'run Benchmark'], button: '#st-benchmark-run', requiresConfirmation: true },
    { action: 'function_governance_refresh', appId: 'governance', permission: 'settings', aliases: ['รีเฟรช Governance', 'ตรวจ Governance', 'refresh Governance'], button: '#gov-refresh' },
    { action: 'function_governance_evaluate', appId: 'governance', permission: 'settings', aliases: ['ประเมิน Governance', 'รัน Governance', 'evaluate Governance'], button: '#gov-execute', requiresConfirmation: true },
    { action: 'function_control_refresh', appId: 'sentinel-control', permission: 'settings', aliases: ['รีเฟรช Sentinel Control', 'ตรวจ Sentinel Control', 'refresh Sentinel Control'], button: '#dai-refresh' },
    { action: 'function_control_cycle', appId: 'sentinel-control', permission: 'settings', aliases: ['รัน Sentinel Control', 'รัน Control Cycle', 'ตรวจ Control Cycle', 'run Sentinel Control'], button: '#dai-cycle', requiresConfirmation: true }
  ];
  const commandAliases = functionCommands.flatMap(command => command.aliases.map(alias => ({ command, alias: normalize(alias) }))).sort((a, b) => b.alias.length - a.alias.length);
  function functionFor(action) { return functionCommands.find(command => command.action === String(action || '')) || null; }
  function parseFunction(command) {
    const value = normalize(command).replace(/ครับ$|ค่ะ$|คะ$|please$/g, '');
    const match = commandAliases.find(item => value === item.alias);
    return match ? { ...match.command } : null;
  }
  function parse(command) {
    const text = normalize(command);
    const target = aliases.find(item => text.includes(item.alias));
    if (!target) return null;
    if (/อย่า|ห้าม|ไม่ต้อง|ไม่อยาก|ไม่ให้|dont|donot|never/.test(text)) return { error: 'voice_command_negated' };
    let rest = text.replace(target.alias, '');
    // Ignore polite framing, but not arbitrary text such as delete/train/change.
    rest = rest.replace(/ช่วย|กรุณา|ขอ|หน้าต่าง|หน้าจอ|ฟังก์ชั่น|ฟังก์ชัน|ฟังชั่น|ฟังชัน|ฟังชั่น|โปรแกรม|ของ|ให้หน่อย|ให้ด้วย|ให้ฉัน|ให้ผม|ให้|หน่อยสิ|หน่อย|ด้วย|ได้ไหม|ได้มั้ย|ได้หรือไม่|นะ|ครับ|ค่ะ|คะ|ที|please|can you|canyou|the|window|app/g, '');
    // Thai "เปิด" contains "ปิด". Tokenize longest verbs first instead of
    // independent substring checks, which interpret every open as a close.
    const verbPattern = /รีเฟรช|อัปเดต|อัพเดต|refresh|reload|เปิด|แสดง|เรียก|เข้า|open|launch|show|ปิด|ซ่อน|close|hide/g;
    const operations = [...new Set((rest.match(verbPattern) || []).map(verb => /^(ปิด|ซ่อน|close|hide)$/.test(verb) ? 'close' : /^(รีเฟรช|อัปเดต|อัพเดต|refresh|reload)$/.test(verb) ? 'refresh' : 'open'))];
    if (operations.length > 1) return { error: 'ambiguous_voice_command' };
    if (!operations.length) return null;
    const operation = operations[0];
    rest = rest.replace(verbPattern, '').replace(/ขึ้นมา|ขึ้น|มา|ลง|ดู|อีกครั้ง|อีกที|อีก|ตอนนี้|now/g, '');
    if (rest) return null;
    return { app: target.app, operation, action: `${operation}_${target.app.key}` };
  }
  return { apps, functionCommands, allowed, parse, parseFunction, functionFor, actionFor, normalize };
});
