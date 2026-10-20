(function (root, factory) {
  const catalog = factory();
  if (typeof module === 'object' && module.exports) module.exports = catalog;
  else root.PanthoriumWindowCatalog = catalog;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  // One allowlist for the server, desktop and voice client. Never execute a
  // function name or selector supplied by an AI response or a transcript.
  const apps = [
    {"id":"social-watch","key":"social_watch","label":"Watch","permission":"chat","accountRequired":true,"aliases":["Watch","Social Watch","ภาพและข้อความ","ดูโพสต์","Social Media","โซเชียลมีเดีย"],"selector":".window[data-id=\"social-media\"][data-social-active=\"watch\"]","opener":"PanthoriumSocial.openWatch","windowId":"social-media","refresher":"PanthoriumSocial.refresh"},
    {"id":"social-short","key":"social_short","label":"Short","permission":"chat","accountRequired":true,"aliases":["Short","Social Short","คลิปสั้น","Reels"],"selector":".window[data-id=\"social-media\"][data-social-active=\"short\"]","opener":"PanthoriumSocial.openShort","windowId":"social-media","refresher":"PanthoriumSocial.refresh"},
    {"id":"social-live","key":"social_live","label":"Live","permission":"chat","accountRequired":true,"aliases":["Live","Social Live","ถ่ายทอดสด","ไลฟ์"],"selector":".window[data-id=\"social-media\"][data-social-active=\"live\"]","opener":"PanthoriumSocial.openLive","windowId":"social-media","refresher":"PanthoriumSocial.refresh"},
    {"id":"social-market","key":"social_market","label":"Market","permission":"chat","accountRequired":true,"aliases":["Market","Social Market","ตลาด","ร้านค้า"],"selector":".window[data-id=\"social-media\"][data-social-active=\"market\"]","opener":"PanthoriumSocial.openMarket","windowId":"social-media","refresher":"PanthoriumSocial.refresh"},
    {"id":"social-community","key":"social_community","label":"Community","permission":"chat","accountRequired":true,"aliases":["Community","Social Community","ชุมชน","แชทกลุ่ม"],"selector":".window[data-id=\"social-media\"][data-social-active=\"community\"]","opener":"PanthoriumSocial.openCommunity","windowId":"social-media","refresher":"PanthoriumSocial.refresh"},
    {"id":"social-talk","key":"social_talk","label":"Talk","permission":"chat","accountRequired":true,"aliases":["Talk","Social Talk","สนทนา","แชทส่วนตัว"],"selector":".window[data-id=\"social-media\"][data-social-active=\"talk\"]","opener":"PanthoriumSocial.openTalk","windowId":"social-media","refresher":"PanthoriumSocial.refresh"},
    {"id":"social-connect","key":"social_connect","label":"Connect","permission":"chat","accountRequired":true,"aliases":["Connect","Social Connect","ทำความรู้จัก","หาคู่"],"selector":".window[data-id=\"social-media\"][data-social-active=\"connect\"]","opener":"PanthoriumSocial.openConnect","windowId":"social-media","refresher":"PanthoriumSocial.refresh"},
    {"id":"social-profile","key":"social_profile","label":"Profile","permission":"chat","accountRequired":true,"aliases":["Profile","Social Profile","โปรไฟล์ส่วนตัว","โปรไฟล์"],"selector":".window[data-id=\"social-media\"][data-social-active=\"profile\"]","opener":"PanthoriumSocial.openProfile","windowId":"social-media","refresher":"PanthoriumSocial.refresh"},
    {"id":"social-friends","key":"social_friends","label":"Add Friends","permission":"chat","accountRequired":true,"aliases":["Add Friends","Social Add Friends","ค้นหาเพื่อน","เพิ่มเพื่อน"],"selector":".window[data-id=\"social-media\"][data-social-active=\"friends\"]","opener":"PanthoriumSocial.openFriends","windowId":"social-media","refresher":"PanthoriumSocial.refresh"},
    {id:"developer-studio",key:"developer_studio",label:"Developer Studio",permission:"settings",role:"administrator",ownerOnly:true,aliases:["Developer Studio","พัฒนาระบบ","แก้โค้ด"],selector:'.window[data-id="developer-studio"]',opener:"PanthoriumDeveloperStudio.open",windowId:"developer-studio"},
    {id:"user-management",key:"user_management",label:"ผู้ใช้และเงื่อนไข",permission:"settings",role:"administrator",aliases:["จัดการผู้ใช้","ผู้ใช้และเงื่อนไข"],selector:'.window[data-id="account-manager"]',opener:"PanthoriumUserManager.open",windowId:"account-manager"},
    {id:"admin-management",key:"admin_management",label:"ผู้ดูแลระบบ",permission:"settings",role:"administrator",aliases:["จัดการแอดมิน","ผู้ดูแลระบบ"],selector:'.window[data-id="account-manager"]',opener:"PanthoriumUserManager.openAdmins",windowId:"account-manager"},
    {id:"admin-mailbox",key:"admin_mailbox",label:"กล่องอีเมล",permission:"settings",role:"administrator",aliases:["กล่องอีเมล","กล่องจดหมาย","อีเมลระบบ"],selector:'.window[data-id="admin-mailbox"]',opener:"PanthoriumMailbox.open",windowId:"admin-mailbox"},
    {id:"billing-admin",key:"billing_admin",label:"การเงินและการชำระเงิน",permission:"settings",role:"administrator",aliases:["การเงิน","รายรับรายจ่าย","จัดการชำระเงิน"],selector:'.window[data-id="billing-admin"]',opener:"PanthoriumBillingAdmin.open",windowId:"billing-admin"},
    { id: 'sentinel', key: 'sentinel', label: 'Sentinel AI', permission: 'chat', aliases: ['Sentinel AI', 'เซนทิเนลเอไอ', 'แชต', 'แชท'], selector: '.window[data-id="sentinel"]', opener: 'openSentinel', windowId: 'sentinel' },
    { id: 'notes', key: 'notes', label: 'Notes', permission: 'chat', aliases: ['Notes', 'Note', 'โน้ต', 'โน๊ต', 'บันทึก', 'แอปบันทึก'], selector: '.window[data-id="notes"]', opener: 'openNotes', windowId: 'notes' },
    { id: 'files', key: 'files', label: 'Files', permission: 'chat', accountRequired: true, aliases: ['Files', 'File', 'ไฟล์', 'จัดการไฟล์', 'ไฟล์ของฉัน'], selector: '.window[data-id="files"]', opener: 'openFiles', windowId: 'files' },
    { id: 'calculator', key: 'calculator', label: 'Calculator', permission: 'chat', aliases: ['Calculator', 'เครื่องคิดเลข', 'คิดเลข'], selector: '.window[data-id="calculator"]', opener: 'openCalculator', windowId: 'calculator' },
    { id: 'calendar', key: 'calendar', label: 'Calendar', permission: 'chat', accountRequired: true, aliases: ['Calendar', 'ปฏิทิน', 'นัดหมาย', 'ตารางนัด'], selector: '.window[data-id="calendar"]', opener: 'PanthoriumCalendar.open', windowId: 'calendar', refresher: 'PanthoriumCalendar.refresh' },
    { id: 'reminders', key: 'reminders', label: 'Reminders', permission: 'chat', accountRequired: true, aliases: ['Reminders', 'เตือนความจำ', 'เตือนยา', 'เตือนนัด', 'การเตือน'], selector: '.window[data-id="reminders"]', opener: 'PanthoriumReminders.open', windowId: 'reminders', refresher: 'PanthoriumReminders.refresh' },
    { id: 'goals', key: 'goals', label: 'Goals', permission: 'chat', accountRequired: true, aliases: ['Goals', 'Goal', 'เป้าหมาย', 'ติดตามเป้าหมาย', 'เป้าหมายของฉัน'], selector: '.window[data-id="goals"]', opener: 'PanthoriumGoals.open', windowId: 'goals', refresher: 'PanthoriumGoals.refresh' },
    { id: 'assistant-preferences', key: 'sentinel_preferences', label: 'Sentinel Preferences', permission: 'chat', accountRequired: true, aliases: ['Sentinel Preferences', 'ความชอบ Sentinel', 'ตั้งค่าความชอบ Sentinel', 'ปรับแต่ง Sentinel', 'ตั้งค่าการตอบ'], selector: '.window[data-id="assistant-preferences"]', opener: 'PanthoriumAssistantPreferences.open', windowId: 'assistant-preferences', refresher: 'PanthoriumAssistantPreferences.refresh' },
    // Navigation only. Opening this window never attaches organization data to
    // the personal voice session or authorizes an organization mutation.
    { id: 'organizations', key: 'organizations', label: 'องค์กรและทีม', permission: 'chat', accountRequired: true, aliases: ['องค์กรและทีม', 'พื้นที่องค์กร', 'องค์กร', 'Organizations'], selector: '.window[data-id="organizations"]', opener: 'PanthoriumOrganizations.open', windowId: 'organizations' },
    { id: 'settings', key: 'settings', label: 'Settings', permission: 'settings', aliases: ['Settings', 'Setting', 'การตั้งค่า', 'ตั้งค่า'], selector: '.window[data-id="settings"]', opener: 'openSettings', windowId: 'settings' },
    { id: 'voice-identity', key: 'voice_identity', label: 'Voice Identity', permission: 'chat', aliases: ['Voice Identity', 'จดจำเสียง', 'ลงทะเบียนเสียง', 'ลงทะเบียน', 'เข้าสู่ระบบ', 'เสียงที่อนุญาต'], selector: '#panthorium-voice-identity', opener: 'PanthoriumVoiceIdentity.open', closeButton: '[data-close]', refresher: 'PanthoriumVoiceIdentity.refresh' },
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
    { id: 'sentinel-control', key: 'sentinel_control', label: 'Sentinel Control', permission: 'settings', aliases: ['Sentinel Control', 'เซนทิเนลคอนโทรล', 'ควบคุมเซนทิเนล'], selector: '#panthorium-sentinel-control-dashboard', opener: 'PanthoriumSentinelControl.open', closeButton: '#dai-close', refresher: 'PanthoriumSentinelControl.refresh' },
    { id: 'media-studio', key: 'media_studio', label: 'Media Studio', permission: 'chat', accountRequired: true, aliases: ['Media Studio', 'Video Studio', 'ตัดต่อวิดีโอ', 'สตูดิโอวิดีโอ'], selector: '#media-studio-dashboard', opener: 'PanthoriumMediaStudio.open', closeButton: '[data-close]' },
    { id: 'creative-studio', key: 'creative_studio', label: 'สร้างสรรค์และเอกสาร', permission: 'chat', accountRequired: true, aliases: ['สร้างสรรค์และเอกสาร', 'Creative Studio', 'สตูดิโอสร้างสรรค์'], selector: '.window[data-id="creative-studio"]', opener: 'PanthoriumCreativeStudio.open', windowId: 'creative-studio', refresher: 'PanthoriumCreativeStudio.refresh' },
    { id: 'studio-image', key: 'studio_image', label: 'สตูดิโอรูปภาพ', permission: 'chat', accountRequired: true, aliases: ['สตูดิโอรูปภาพ', 'เครื่องมือรูปภาพ', 'Image Studio'], selector: '.window[data-id="creative-studio"][data-studio-active="image"]', opener: 'PanthoriumCreativeStudio.openImage', windowId: 'creative-studio', refresher: 'PanthoriumCreativeStudio.refresh' },
    { id: 'studio-video', key: 'studio_video', label: 'สร้างวิดีโอ', permission: 'chat', accountRequired: true, aliases: ['เครื่องมือสร้างวิดีโอ', 'หน้าสร้างวิดีโอ', 'Video Generator'], selector: '.window[data-id="creative-studio"][data-studio-active="video"]', opener: 'PanthoriumCreativeStudio.openVideo', windowId: 'creative-studio', refresher: 'PanthoriumCreativeStudio.refresh' },
    { id: 'studio-document', key: 'studio_document', label: 'สตูดิโอเอกสาร', permission: 'chat', accountRequired: true, aliases: ['สตูดิโอเอกสาร', 'เครื่องมือเอกสาร', 'Document Studio'], selector: '.window[data-id="creative-studio"][data-studio-active="document"]', opener: 'PanthoriumCreativeStudio.openDocument', windowId: 'creative-studio', refresher: 'PanthoriumCreativeStudio.refresh' },
    { id: 'studio-spreadsheet', key: 'studio_spreadsheet', label: 'สตูดิโอตาราง', permission: 'chat', accountRequired: true, aliases: ['สตูดิโอตาราง', 'เครื่องมือตาราง', 'Spreadsheet Studio'], selector: '.window[data-id="creative-studio"][data-studio-active="spreadsheet"]', opener: 'PanthoriumCreativeStudio.openSpreadsheet', windowId: 'creative-studio', refresher: 'PanthoriumCreativeStudio.refresh' },
    { id: 'studio-presentation', key: 'studio_presentation', label: 'สตูดิโองานนำเสนอ', permission: 'chat', accountRequired: true, aliases: ['สตูดิโองานนำเสนอ', 'เครื่องมืองานนำเสนอ', 'Presentation Studio'], selector: '.window[data-id="creative-studio"][data-studio-active="presentation"]', opener: 'PanthoriumCreativeStudio.openPresentation', windowId: 'creative-studio', refresher: 'PanthoriumCreativeStudio.refresh' },
    { id: 'browser', key: 'browser', label: 'Panthorium Browser', permission: 'chat', accountRequired: true, aliases: ['Web Browser', 'Browser window', 'หน้าต่างเบราว์เซอร์', 'เว็บเบราว์เซอร์', 'Browser', 'เบราว์เซอร์', 'เปิดเว็บไซต์'], selector: '#panthorium-browser-dashboard', opener: 'PanthoriumBrowser.open', closeButton: '[data-browser-close]' },
    { id: 'external-youtube', key: 'external_youtube', label: 'YouTube', permission: 'chat', aliases: ['YouTube', 'ยูทูบ', 'ยูทูป'], selector: '.window[data-id="external-youtube"]', opener: 'PanthoriumExternalApps.openYoutube', windowId: 'external-youtube', external: true, externalUrl: 'https://www.youtube.com/' },
    { id: 'external-facebook', key: 'external_facebook', label: 'Facebook', permission: 'chat', aliases: ['Facebook', 'เฟซบุ๊ก', 'เฟสบุ๊ค', 'เฟซบุ๊ค'], selector: '.window[data-id="external-facebook"]', opener: 'PanthoriumExternalApps.openFacebook', windowId: 'external-facebook', external: true, externalUrl: 'https://www.facebook.com/' },
    { id: 'external-line', key: 'external_line', label: 'LINE', permission: 'chat', aliases: ['LINE', 'ไลน์'], selector: '.window[data-id="external-line"]', opener: 'PanthoriumExternalApps.openLine', windowId: 'external-line', external: true, externalUrl: 'https://line.me/' },
    { id: 'external-tiktok', key: 'external_tiktok', label: 'TikTok', permission: 'chat', aliases: ['TikTok', 'ติ๊กต็อก', 'ติ๊กต๊อก', 'ติ๊กตอก'], selector: '.window[data-id="external-tiktok"]', opener: 'PanthoriumExternalApps.openTiktok', windowId: 'external-tiktok', external: true, externalUrl: 'https://www.tiktok.com/' },
    { id: 'external-instagram', key: 'external_instagram', label: 'Instagram', permission: 'chat', aliases: ['Instagram', 'อินสตาแกรม', 'ไอจี'], selector: '.window[data-id="external-instagram"]', opener: 'PanthoriumExternalApps.openInstagram', windowId: 'external-instagram', external: true, externalUrl: 'https://www.instagram.com/' },
    { id: 'external-x', key: 'external_x', label: 'X', permission: 'chat', aliases: ['X', 'Twitter', 'ทวิตเตอร์'], selector: '.window[data-id="external-x"]', opener: 'PanthoriumExternalApps.openX', windowId: 'external-x', external: true, externalUrl: 'https://x.com/' },
    { id: 'privacy-policy', key: 'privacy_policy', label: 'Privacy/Policy', permission: 'chat', aliases: ['Privacy Policy', 'Privacy/Policy', 'นโยบายความเป็นส่วนตัว', 'นโยบายความเป็นส่วนตัวและข้อกำหนด'], selector: '#panthorium-privacy-policy', opener: 'PanthoriumPrivacyPolicy.open', closeButton: '[data-close]' }
  ];
  apps.push(
    { id: 'desktop-browser', key: 'desktop_browser', label: 'Panthorium Browser Desktop', permission: 'chat', native: true, aliases: ['Panthorium Browser Desktop', 'Panthorium Browser', 'Panthorium OS', 'Panthorium', 'this application', 'this app', 'แพนโทเรียมบราวเซอร์', 'แพนโทเรียม', 'ตัวแอป Panthorium', 'แอป Panthorium', 'ตัวบราวเซอร์', 'desktop app'], selector: null },
    { id: 'active-window', key: 'active_window', label: 'หน้าต่างปัจจุบัน', permission: 'chat', virtual: true, aliases: ['หน้าต่างนี้', 'หน้าต่างปัจจุบัน', 'หน้าต่างที่ใช้อยู่', 'อันนี้', 'this window', 'current window', 'active window'], selector: null }
  );
  const userRestrictedIds = new Set(['user-management', 'admin-management', 'admin-mailbox', 'billing-admin', 'settings', 'security', 'ai-platform', 'sentinel-agent', 'agent-automation', 'memory-knowledge', 'multi-agent', 'integrations', 'training-lab', 'production', 'governance', 'sentinel-control']);
  function allowed(app, user) {
    const roles = user?.roles || [];
    const id = String(user?.sub || user?.id || '');
    const hasAccount = !!id && !id.startsWith('guest:') && !roles.includes('guest');
    return !!app && (!app.ownerOnly || user?.systemOwner === true) && (!app.accountRequired || hasAccount) && !(!roles.some(role => ['administrator', 'operator'].includes(role)) && userRestrictedIds.has(app.id)) && (user?.permissions || []).includes(app.permission) && (!app.role || roles.includes(app.role));
  }
  const normalize = text => String(text || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  const aliases = apps.flatMap(app => app.aliases.map(alias => ({ app, alias: normalize(alias) }))).sort((a, b) => b.alias.length - a.alias.length);
  function actionFor(action) {
    const match = /^(open|close|refresh|minimize|maximize|fullscreen|restore)_(.+)$/.exec(String(action || ''));
    const app = match && apps.find(item => item.key === match[2]);
    return app ? { app, operation: match[1], action: match[0] } : null;
  }
  const functionCommands = [
    {action:'function_calendar_next',appId:'calendar',permission:'chat',aliases:['ปฏิทินเดือนหน้า','ปฏิทินเดือนถัดไป','next calendar month'],button:'[data-calendar-next]'},
    {action:'function_calendar_previous',appId:'calendar',permission:'chat',aliases:['ปฏิทินเดือนก่อน','ปฏิทินเดือนที่แล้ว','previous calendar month'],button:'[data-calendar-prev]'},
    {action:'function_calendar_today',appId:'calendar',permission:'chat',aliases:['ปฏิทินวันนี้','กลับไปวันนี้ในปฏิทิน','calendar today'],button:'[data-calendar-today]'},
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
  const verbs = {
    open: ['เปิด', 'แสดง', 'เรียก', 'เข้า', 'open', 'launch', 'show', 'bringup'],
    close: ['ปิด', 'close', 'shut', 'quit', 'exit'],
    refresh: ['รีเฟรช', 'อัปเดต', 'อัพเดต', 'refresh', 'reload'],
    minimize: ['ย่อ', 'พับ', 'ลดหน้าต่าง', 'ซ่อน', 'minimize', 'minimise', 'hide', 'มินิไมซ์'],
    maximize: ['ขยาย', 'ทำให้ใหญ่', 'maximize', 'maximise', 'enlarge', 'expand', 'makebigger', 'makelarger', 'แม็กซิไมซ์'],
    fullscreen: ['เต็มหน้าจอ', 'เต็มจอ', 'fullscreen', 'gofullscreen', 'ฟูลสกรีน'],
    restore: ['ออกจากเต็มหน้าจอ', 'ออกจากเต็มจอ', 'คืนขนาด', 'คืนหน้าต่าง', 'กลับขนาดเดิม', 'กลับขนาดปกติ', 'restore', 'unmaximize', 'unmaximise', 'unminimize', 'unminimise', 'exitfullscreen', 'leavefullscreen', 'windowedmode']
  };
  const verbEntries = Object.entries(verbs).flatMap(([operation, words]) => words.map(word => ({ operation, word })));
  const verbPattern = new RegExp(verbEntries.map(item => item.word).sort((a,b) => b.length-a.length).join('|'), 'g');
  function parse(command) {
    const text = normalize(command);
    const target = aliases.find(item => text.includes(item.alias));
    if (/อย่า|ห้าม|ไม่ต้อง|ไม่อยาก|ไม่ให้|ไม่(?:ปิด|เปิด|ย่อ|ขยาย|เต็ม|คืน|ซ่อน)|dont|donot|never/.test(text)) return target ? { error: 'voice_command_negated' } : null;
    if (target?.app.id === 'voice-identity' && ['ลงทะเบียน', 'เข้าสู่ระบบ'].includes(text)) return { app: target.app, operation: 'open', action: 'open_voice_identity', focusLogin: text === 'เข้าสู่ระบบ' };
    let rest = text;
    if (target) for (const item of aliases) if (item.app.id === target.app.id) rest = rest.split(item.alias).join('');
    const matches = rest.match(verbPattern) || [];
    const operations = [...new Set(matches.map(word => verbEntries.find(item => item.word === word).operation))];
    if (operations.length > 1) return target ? { error: 'ambiguous_voice_command' } : null;
    if (!operations.length) return null;
    const operation = operations[0];
    rest = rest.replace(verbPattern, '').replace(/ช่วย|กรุณา|ขอ|หน้าต่าง|หน้าจอ|ฟังก์ชั่น|ฟังก์ชัน|ฟังชั่น|ฟังชัน|โปรแกรม|ของ|ให้หน่อย|ให้ด้วย|ให้ฉัน|ให้ผม|ให้|หน่อยสิ|หน่อย|ด้วย|ได้ไหม|ได้มั้ย|ได้หรือไม่|นะ|ครับ|ค่ะ|คะ|ที|please|couldyou|wouldyou|canyou|the|window|app|make|into|put|mode|ขึ้นมา|ขึ้น|มา|ลง|ดู|อีกครั้ง|อีกที|อีก|ตอนนี้|now/g, '');
    if (rest) return null;
    const app = target?.app || (['close','minimize','maximize','fullscreen','restore'].includes(operation) ? apps.find(app => app.virtual) : null);
    return app ? { app, operation, action: `${operation}_${app.key}` } : null;
  }
  function classifyVoiceInput(input) {
    const text = String(input || '').trim();
    // Asking HOW an action works is not permission to execute it.
    if (/(?:คืออะไร|หมายความว่า|อย่างไร|ยังไง)/u.test(text) || /^(?:อะไร|ทำไม|เพราะอะไร|how\b|what\b|why\b|when\b|where\b|explain\b)/i.test(text)) return { kind: 'conversation', text };
    const command = text.replace(/^(?:sentinel|เซนทิเนล)[\s,，:：]+/iu, '').replace(/^(?:ช่วย|กรุณา|please\s+)/iu, '').trim();
    const known = parse(command) || parseFunction(command);
    const imperative = /^(?:ย่อ|ขยาย|เต็มจอ|เต็มหน้าจอ|คืนขนาด|เปิด|ปิด|รีเฟรช|แสดงสถานะ|ตรวจสอบสถานะ|ค้นความรู้|เริ่ม|หยุด|รัน|ยืนยัน|ยกเลิก|ลบ|เปลี่ยน|อนุญาต|open\b|close\b|refresh\b|start\b|stop\b|run\b|delete\b|confirm\b|cancel\b)/i.test(command);
    return known || imperative ? { kind: 'command', text: command } : { kind: 'conversation', text };
  }
  return { apps, functionCommands, allowed, parse, parseFunction, functionFor, actionFor, normalize, classifyVoiceInput };
});
