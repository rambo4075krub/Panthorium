'use strict';

function currentTimeContext(date = new Date()) {
  const buddhistDate = new Intl.DateTimeFormat("th-TH-u-ca-buddhist", { timeZone: "Asia/Bangkok", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(date);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const isoDate = `${values.year}-${values.month}-${values.day}`;
  const localTime = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
  return `\n\n[เวลาปัจจุบันที่เชื่อถือได้] เขตเวลา Asia/Bangkok; วันที่ไทยตามปฏิทินพุทธศักราช (พ.ศ.): ${buddhistDate} (${isoDate}, ค.ศ.) เวลา ${localTime} น. ใช้ข้อมูลนี้เป็นหลักเมื่อผู้ใช้ถามวัน เดือน ปี หรือเวลาปัจจุบัน ห้ามเดาจากความจำหรือข้อมูลฝึก หากตอบวันที่ไทยให้ใช้ปีพุทธศักราชซึ่งเท่ากับ ค.ศ. + 543; หากมีข้อสงสัยเรื่องเขตเวลา ให้ระบุเขตเวลาแทนการคาดเดา`;
}

module.exports = { currentTimeContext };
