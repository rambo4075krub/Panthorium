(function (root) {
  'use strict';
  // Contract profiles are deliberately separate from purchasable billing products.
  const profiles = [
    { id: 'micro', name: 'Micro', label: 'องค์กรขนาดย่อม', description: 'รวมงานของทีมเล็กไว้ในพื้นที่องค์กรเดียว', features: ['สมาชิกและคำเชิญ', 'ทีมและพื้นที่งานร่วม', 'เอกสาร งาน และการตัดสินใจ'] },
    { id: 'small', name: 'Small', label: 'องค์กรขนาดเล็ก', description: 'จัดทีมและขอบเขตข้อมูลเมื่อเริ่มแบ่งหน้าที่', features: ['โครงสร้างทีมและสมาชิก', 'กำหนดผู้ดูและผู้แก้ไขข้อมูล', 'ประวัติรุ่นและความคิดเห็น'] },
    { id: 'medium', name: 'Medium', label: 'องค์กรขนาดกลาง', description: 'ประสานงานหลายทีมด้วยสิทธิ์ที่ตรวจสอบได้', features: ['จัดทีมตามลำดับชั้น', 'คำขอเข้าถึงและการพิจารณา', 'บันทึกเหตุการณ์ตามสิทธิ์'] },
    { id: 'large', name: 'Large', label: 'องค์กรขนาดใหญ่', description: 'วางขอบเขตข้อมูลและนโยบายสำหรับหลายหน่วยงาน', features: ['นโยบาย AI และการส่งออกขององค์กร', 'กำหนดสิทธิ์รายทรัพยากร', 'ตรวจประวัติการเปลี่ยนแปลง'] },
    { id: 'security', name: 'Security', label: 'องค์กรความมั่นคง', description: 'โปรไฟล์จำกัดการประมวลผล AI และการเข้าถึงตามหน้าที่ ยังไม่ใช่การรับรองให้ใช้ข้อมูลลับ', features: ['ไม่ใช้ AI กับข้อมูลในโปรไฟล์นี้', 'สิทธิ์ตามหน้าที่และขอบเขตข้อมูล', 'ต้องตกลงเงื่อนไขและประเมินระบบจริงก่อนใช้'] }
  ].map(profile => Object.freeze({ ...profile, features: Object.freeze(profile.features) }));
  function contactUrl(profileId) {
    const profile = profiles.find(item => item.id === profileId);
    const subject = 'Panthorium — สอบถามสัญญาองค์กร ' + (profile?.name || '');
    return 'mailto:account@panthorium.net?subject=' + encodeURIComponent(subject);
  }
  const catalog = Object.freeze({ profiles: Object.freeze(profiles), contactUrl });
  if (typeof module !== 'undefined' && module.exports) module.exports = catalog;
  if (root) root.PanthoriumOrganizationCatalog = catalog;
})(typeof window !== 'undefined' ? window : null);
