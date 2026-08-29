/**
 * Diamond School — Cloud Sync Agent
 * ===================================
 * Drop this file into D:\diamond-school-system\
 * Run: node sync-agent.js
 *
 * Polls Supabase every 2 minutes for new/updated report cards and
 * diary entries, then writes them into the local sql.js database.
 *
 * Also pushes local students + users to Supabase so teachers can
 * see the student list when entering data online.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { initDb, query, queryOne, run } = require('./db/init');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://saphcspyhqorokqmoqks.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_5z1eou12vzDwZ5ozdU_SFA_DVfO0r8I';
const SYNC_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Push local students → Supabase ────────────────────────────────────────────
async function pushStudents() {
  const students = query('SELECT id,name,school,class_name,division,roll_no,guardian_name,phone FROM students', []);
  if (!students.length) return;

  const rows = students.map(s => ({
    id: s.id,
    name: s.name,
    school: s.school,
    class_name: s.class_name,
    division: s.division || '',
    roll_no: s.roll_no || '',
    guardian_name: s.guardian_name || '',
    phone: s.phone || ''
  }));

  const { error } = await supabase
    .from('cloud_students')
    .upsert(rows, { onConflict: 'id' });

  if (error) console.error('[SYNC] Push students error:', error.message);
  else console.log(`[SYNC] Pushed ${rows.length} students to cloud.`);
}

// ── Push local users (teachers) → Supabase ────────────────────────────────────
async function pushUsers() {
  const users = query("SELECT id,name,username,password_hash,role,status,allowed_sections FROM users WHERE status='approved'", []);
  if (!users.length) return;

  const rows = users.map(u => ({
    id: u.id,
    name: u.name,
    username: u.username,
    password_hash: u.password_hash,
    role: u.role,
    status: u.status,
    allowed_sections: u.allowed_sections || ''
  }));

  const { error } = await supabase
    .from('cloud_users')
    .upsert(rows, { onConflict: 'id' });

  if (error) console.error('[SYNC] Push users error:', error.message);
  else console.log(`[SYNC] Pushed ${rows.length} users to cloud.`);

  // Push teacher class assignments
  const classes = query('SELECT user_id, school, class_name FROM teacher_classes', []);
  if (classes.length) {
    const { error: ce } = await supabase
      .from('cloud_teacher_classes')
      .upsert(classes.map(c => ({ user_id: c.user_id, school: c.school, class_name: c.class_name })),
        { onConflict: 'user_id,school,class_name', ignoreDuplicates: true });
    if (ce) console.error('[SYNC] Push teacher_classes error:', ce.message);
    else console.log(`[SYNC] Pushed ${classes.length} teacher class assignments.`);
  }
}

// ── Push local report cards → Supabase ───────────────────────────────────────
async function pushReportCards() {
  const cards = query(`SELECT rc.*, s.school, s.class_name FROM report_cards rc
    JOIN students s ON s.id = rc.student_id`, []);
  if (!cards.length) return;

  for (const card of cards) {
    const marks = query('SELECT * FROM report_card_marks WHERE report_card_id=?', [card.id]);
    const cardData = {
      local_id: card.id,
      student_id: card.student_id,
      term: card.term,
      academic_year: card.academic_year || '2025-26',
      attendance_present: card.attendance_present || 0,
      attendance_total: card.attendance_total || 0,
      conduct: card.conduct || '',
      remarks: card.remarks || '',
      activity: card.activity || '',
      arts: card.arts || '',
      communication: card.communication || '',
      discipline: card.discipline || '',
      homework: card.homework || '',
      participation: card.participation || '',
      respect: card.respect || '',
      teamwork: card.teamwork || '',
      punctuality: card.punctuality || '',
      improvement: card.improvement || '',
      daily_activity: card.daily_activity || '',
      created_by: card.created_by,
      synced_at: new Date().toISOString()
    };

    const { data: upserted, error } = await supabase
      .from('cloud_report_cards')
      .upsert(cardData, { onConflict: 'local_id' })
      .select('id').single();

    if (error) { console.error('[SYNC] Push report card error:', error.message); continue; }

    // Push marks
    if (upserted && marks.length) {
      await supabase.from('cloud_report_card_marks').delete().eq('cloud_report_card_id', upserted.id);
      await supabase.from('cloud_report_card_marks').insert(
        marks.map(m => ({
          cloud_report_card_id: upserted.id,
          subject: m.subject,
          marks_obtained: m.marks_obtained,
          marks_total: m.marks_total
        }))
      );
    }
  }
  console.log(`[SYNC] Pushed ${cards.length} report cards to cloud.`);
}

// ── Push local diary entries → Supabase ───────────────────────────────────────
async function pushDiaryEntries() {
  const entries = query('SELECT * FROM daily_diary', []);
  if (!entries.length) return;

  const rows = entries.map(e => ({
    local_id: e.id,
    student_id: e.student_id,
    entry_date: e.entry_date,
    activity: e.activity || '',
    behaviour: e.behaviour || '',
    homework: e.homework || '',
    classwork: e.classwork || '',
    remarks: e.remarks || '',
    recorded_by: e.recorded_by,
    synced_at: new Date().toISOString()
  }));

  // Batch upsert in chunks of 100
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const { error } = await supabase
      .from('cloud_daily_diary')
      .upsert(chunk, { onConflict: 'local_id' });
    if (error) console.error('[SYNC] Push diary chunk error:', error.message);
  }
  console.log(`[SYNC] Pushed ${rows.length} diary entries to cloud.`);
}

// ── Push local unit test marks → Supabase ─────────────────────────────────────
async function pushUnitTests() {
  const marks = query('SELECT * FROM unit_test_marks', []);
  if (!marks.length) return;

  const rows = marks.map(m => ({
    local_id: m.id,
    student_id: m.student_id,
    academic_year: m.academic_year || '2025-26',
    test_name: m.test_name,
    subject: m.subject,
    total_marks: m.total_marks || '',
    obtained_marks: m.obtained_marks || '',
    part1_marks: m.part1_marks || '',
    part2_marks: m.part2_marks || '',
    part3_marks: m.part3_marks || '',
    part4_marks: m.part4_marks || '',
    part5_marks: m.part5_marks || '',
    recorded_by: m.created_by,
    synced_at: new Date().toISOString()
  }));

  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const { error } = await supabase
      .from('cloud_unit_test_marks')
      .upsert(chunk, { onConflict: 'local_id' });
    if (error) console.error('[SYNC] Push unit test chunk error:', error.message);
  }
  console.log(`[SYNC] Pushed ${rows.length} unit test marks to cloud.`);
}

// ── Pull cloud report cards → local ───────────────────────────────────────────
async function pullReportCards() {
  // Fetch all unsynced report cards
  const { data: cards, error } = await supabase
    .from('cloud_report_cards')
    .select('*')
    .is('synced_at', null);

  if (error) { console.error('[SYNC] Fetch report cards error:', error.message); return 0; }
  if (!cards || cards.length === 0) return 0;

  let synced = 0;
  for (const card of cards) {
    try {
      const existing = queryOne('SELECT id FROM report_cards WHERE student_id=? AND term=? AND academic_year=?',
        [card.student_id, card.term, card.academic_year]);

      let localId;
      if (existing) {
        run(`UPDATE report_cards SET
          attendance_present=?,attendance_total=?,conduct=?,remarks=?,
          activity=?,arts=?,communication=?,discipline=?,homework=?,participation=?,
          respect=?,teamwork=?,punctuality=?,improvement=?,daily_activity=?,created_by=?
          WHERE id=?`,
          [card.attendance_present||0, card.attendance_total||0, card.conduct||'', card.remarks||'',
           card.activity||'', card.arts||'', card.communication||'', card.discipline||'',
           card.homework||'', card.participation||'', card.respect||'', card.teamwork||'',
           card.punctuality||'', card.improvement||'', card.daily_activity||'',
           card.created_by, existing.id]);
        localId = existing.id;
        run('DELETE FROM report_card_marks WHERE report_card_id=?', [localId]);
      } else {
        const info = run(`INSERT INTO report_cards
          (student_id,term,academic_year,attendance_present,attendance_total,conduct,remarks,
           activity,arts,communication,discipline,homework,participation,
           respect,teamwork,punctuality,improvement,daily_activity,created_by)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [card.student_id, card.term, card.academic_year,
           card.attendance_present||0, card.attendance_total||0, card.conduct||'', card.remarks||'',
           card.activity||'', card.arts||'', card.communication||'', card.discipline||'',
           card.homework||'', card.participation||'', card.respect||'', card.teamwork||'',
           card.punctuality||'', card.improvement||'', card.daily_activity||'', card.created_by]);
        localId = info.lastInsertRowid;
      }

      // Fetch and insert marks
      const { data: marks } = await supabase
        .from('cloud_report_card_marks')
        .select('*')
        .eq('cloud_report_card_id', card.id);

      (marks || []).forEach(m => {
        if (m.subject) run(
          'INSERT INTO report_card_marks (report_card_id,subject,marks_obtained,marks_total) VALUES (?,?,?,?)',
          [localId, m.subject, m.marks_obtained??null, m.marks_total??null]
        );
      });

      // Mark as synced in Supabase
      await supabase
        .from('cloud_report_cards')
        .update({ synced_at: new Date().toISOString(), local_id: localId })
        .eq('id', card.id);

      synced++;
    } catch(e) {
      console.error(`[SYNC] Error syncing report card id=${card.id}:`, e.message);
    }
  }
  return synced;
}

// ── Pull cloud diary entries → local ──────────────────────────────────────────
async function pullDiaryEntries() {
  const { data: entries, error } = await supabase
    .from('cloud_daily_diary')
    .select('*')
    .is('synced_at', null);

  if (error) { console.error('[SYNC] Fetch diary error:', error.message); return 0; }
  if (!entries || entries.length === 0) return 0;

  let synced = 0;
  for (const en of entries) {
    try {
      const existing = queryOne('SELECT id FROM daily_diary WHERE student_id=? AND entry_date=?',
        [en.student_id, en.entry_date]);

      let localId;
      if (existing) {
        run('UPDATE daily_diary SET activity=?,behaviour=?,homework=?,classwork=?,remarks=?,recorded_by=? WHERE id=?',
          [en.activity||'', en.behaviour||'', en.homework||'', en.classwork||'', en.remarks||'', en.recorded_by, existing.id]);
        localId = existing.id;
      } else {
        const info = run(
          'INSERT INTO daily_diary (student_id,entry_date,activity,behaviour,homework,classwork,remarks,recorded_by) VALUES (?,?,?,?,?,?,?,?)',
          [en.student_id, en.entry_date, en.activity||'', en.behaviour||'', en.homework||'', en.classwork||'', en.remarks||'', en.recorded_by]);
        localId = info.lastInsertRowid;
      }

      // Mark as synced in Supabase
      await supabase
        .from('cloud_daily_diary')
        .update({ synced_at: new Date().toISOString(), local_id: localId })
        .eq('id', en.id);

      synced++;
    } catch(e) {
      console.error(`[SYNC] Error syncing diary id=${en.id}:`, e.message);
    }
  }
  return synced;
}

// ── Pull cloud unit test marks → local ───────────────────────────────────────
async function pullUnitTests() {
  const { data: entries, error } = await supabase
    .from('cloud_unit_test_marks')
    .select('*')
    .is('synced_at', null);

  if (error) { console.error('[SYNC] Fetch unit tests error:', error.message); return 0; }
  if (!entries || entries.length === 0) return 0;

  let synced = 0;
  for (const en of entries) {
    try {
      const existing = queryOne(
        'SELECT id FROM unit_test_marks WHERE student_id=? AND academic_year=? AND test_name=? AND subject=?',
        [en.student_id, en.academic_year, en.test_name, en.subject]
      );

      let localId;
      if (existing) {
        run(`UPDATE unit_test_marks SET total_marks=?,obtained_marks=?,
          part1_marks=?,part2_marks=?,part3_marks=?,part4_marks=?,part5_marks=?,created_by=? WHERE id=?`,
          [en.total_marks||'', en.obtained_marks||'',
           en.part1_marks||'', en.part2_marks||'', en.part3_marks||'', en.part4_marks||'', en.part5_marks||'',
           en.recorded_by, existing.id]);
        localId = existing.id;
      } else {
        const info = run(
          `INSERT INTO unit_test_marks
           (student_id,academic_year,test_name,subject,total_marks,obtained_marks,
            part1_marks,part2_marks,part3_marks,part4_marks,part5_marks,created_by)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [en.student_id, en.academic_year, en.test_name, en.subject,
           en.total_marks||'', en.obtained_marks||'',
           en.part1_marks||'', en.part2_marks||'', en.part3_marks||'', en.part4_marks||'', en.part5_marks||'',
           en.recorded_by]
        );
        localId = info.lastInsertRowid;
      }

      await supabase
        .from('cloud_unit_test_marks')
        .update({ synced_at: new Date().toISOString(), local_id: localId })
        .eq('id', en.id);

      synced++;
    } catch(e) {
      console.error(`[SYNC] Error syncing unit test id=${en.id}:`, e.message);
    }
  }
  return synced;
}

// ── Main sync cycle ───────────────────────────────────────────────────────────
async function syncCycle() {
  const now = new Date().toLocaleTimeString('en-IN');
  console.log(`\n[SYNC] Starting sync at ${now}`);

  try {
    const rcCount = await pullReportCards();
    const diaryCount = await pullDiaryEntries();
    const utCount = await pullUnitTests();

    if (rcCount > 0 || diaryCount > 0 || utCount > 0) {
      console.log(`[SYNC] ✅ Synced: ${rcCount} report card(s), ${diaryCount} diary entry/entries, ${utCount} unit test mark(s).`);
      await supabase.from('sync_log').insert({
        report_cards_synced: rcCount,
        diary_entries_synced: diaryCount,
        notes: `unit_tests: ${utCount}`
      });
    } else {
      console.log(`[SYNC] ✓ No new data to sync.`);
    }
  } catch(e) {
    console.error('[SYNC] Sync cycle error:', e.message);
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────
async function start() {
  console.log('=========================================');
  console.log(' Diamond School — Cloud Sync Agent');
  console.log('=========================================');
  console.log(` Supabase: ${SUPABASE_URL}`);
  console.log(` Sync interval: every 2 minutes`);
  console.log('=========================================');

  await initDb();

  // Push local data to cloud on startup
  console.log('\n[SYNC] Pushing students and users to cloud...');
  await pushStudents();
  await pushUsers();

  console.log('\n[SYNC] Pushing local academic data to cloud...');
  await pushReportCards();
  await pushDiaryEntries();
  await pushUnitTests();

  // First sync immediately
  await syncCycle();

  // Then every 2 minutes
  setInterval(syncCycle, SYNC_INTERVAL_MS);

  // Re-push students/users every 30 minutes
  setInterval(async () => {
    console.log('\n[SYNC] Refreshing all data in cloud...');
    await pushStudents();
    await pushUsers();
    await pushReportCards();
    await pushDiaryEntries();
    await pushUnitTests();
  }, 30 * 60 * 1000);
}

start().catch(err => {
  console.error('Sync agent failed to start:', err);
  process.exit(1);
});
