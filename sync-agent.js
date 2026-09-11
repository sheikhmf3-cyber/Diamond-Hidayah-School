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
const { initDb, query, queryOne, run, _resetDb } = require('./db/init');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://saphcspyhqorokqmoqks.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_5z1eou12vzDwZ5ozdU_SFA_DVfO0r8I';
const SYNC_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Push local students → Supabase ────────────────────────────────────────────
async function pushStudents() {
  const students = query('SELECT id,name,school,class_name,division,roll_no,guardian_name,phone,category FROM students', []);
  if (!students.length) return;

  const rows = students.map(s => ({
    id: s.id,
    name: s.name,
    school: s.school,
    class_name: s.class_name,
    division: s.division || '',
    roll_no: s.roll_no || '',
    guardian_name: s.guardian_name || '',
    phone: s.phone || '',
    category: s.category || ''
  }));

  const { error } = await supabase
    .from('cloud_students')
    .upsert(rows, { onConflict: 'id' });

  if (error) { console.error('[SYNC] Push students error:', error.message); return; }
  console.log(`[SYNC] Pushed ${rows.length} students to cloud.`);

  // Reconcile deletions — a student removed locally should stop appearing
  // in the online portal too, not linger forever in cloud_students.
  const { data: cloudStudents, error: fetchErr } = await supabase.from('cloud_students').select('id');
  if (fetchErr) { console.error('[SYNC] Fetch cloud students error:', fetchErr.message); return; }
  const localIds = new Set(students.map(s => s.id));
  const staleIds = (cloudStudents || []).map(s => s.id).filter(id => !localIds.has(id));
  if (staleIds.length) {
    // Dependent cloud rows carry a foreign key to cloud_students, so clear
    // those first or the student delete itself gets rejected.
    const cloudReportCardIds = (await supabase.from('cloud_report_cards').select('id').in('student_id', staleIds)).data || [];
    if (cloudReportCardIds.length) {
      await supabase.from('cloud_report_card_marks').delete().in('cloud_report_card_id', cloudReportCardIds.map(r => r.id));
    }
    await supabase.from('cloud_report_cards').delete().in('student_id', staleIds);
    await supabase.from('cloud_daily_diary').delete().in('student_id', staleIds);
    await supabase.from('cloud_unit_test_marks').delete().in('student_id', staleIds);
    await supabase.from('cloud_unit_test_remarks').delete().in('student_id', staleIds);

    const { error: delErr } = await supabase.from('cloud_students').delete().in('id', staleIds);
    if (delErr) console.error('[SYNC] Delete stale cloud students error:', delErr.message);
    else console.log(`[SYNC] Removed ${staleIds.length} deleted student(s) from cloud.`);
  }
}

// ── Push local users (teachers) → Supabase ────────────────────────────────────
async function pushUsers() {
  const users = query("SELECT id,name,username,password_hash,role,status,allowed_sections,parent_student_id,parent_school,parent_class_name,parent_roll_no FROM users WHERE status='approved'", []);
  if (!users.length) return;

  const rows = users.map(u => ({
    id: u.id,
    name: u.name,
    username: u.username,
    password_hash: u.password_hash,
    role: u.role,
    status: u.status,
    allowed_sections: u.allowed_sections || '',
    parent_student_id: u.parent_student_id || null,
    parent_school: u.parent_school || '',
    parent_class_name: u.parent_class_name || '',
    parent_roll_no: u.parent_roll_no || ''
  }));

  const { error } = await supabase
    .from('cloud_users')
    .upsert(rows, { onConflict: 'id' });

  if (error) { console.error('[SYNC] Push users error:', error.message); return; }
  console.log(`[SYNC] Pushed ${rows.length} users to cloud.`);

  // Reconcile deletions — a teacher removed locally (any status, not just
  // approved) should lose online-portal access too, not linger in
  // cloud_users forever with their last-synced password still valid.
  const allLocalIds = new Set(query('SELECT id FROM users', []).map(u => u.id));
  const { data: cloudUsers, error: fetchErr } = await supabase.from('cloud_users').select('id');
  if (fetchErr) { console.error('[SYNC] Fetch cloud users error:', fetchErr.message); return; }
  const staleIds = (cloudUsers || []).map(u => u.id).filter(id => !allLocalIds.has(id));
  if (staleIds.length) {
    await supabase.from('cloud_teacher_classes').delete().in('user_id', staleIds);
    const { error: delErr } = await supabase.from('cloud_users').delete().in('id', staleIds);
    if (delErr) console.error('[SYNC] Delete stale cloud users error:', delErr.message);
    else console.log(`[SYNC] Removed ${staleIds.length} deleted user(s) from cloud.`);
  }

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

// Same academic-year math used on the cloud side (routes/parent.js
// academicYear()) — year rolls over in June.
function currentAcademicYear() {
  const now = new Date();
  const m = now.getMonth();
  const y = now.getFullYear();
  const start = m >= 5 ? y : y - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}

// ── Push Term 1 fee-clearance status → Supabase ────────────────────────────────
// Doesn't sync fee amounts or payment history (those stay local-only, per the
// school's policy) — just a yes/no "has this student paid enough to unlock
// the online parent portal for this year" flag, computed here:
//   required = 50% of tuition_fee + term_fee
//   paid     = sum of this student's non-deleted payments this academic year
async function pushFeeStatus() {
  const year = currentAcademicYear();
  const fees = query(
    'SELECT student_id, tuition_fee, term_fee FROM student_fees WHERE academic_year=?', [year]);
  if (!fees.length) return;

  const rows = fees.map(f => {
    const paidRow = queryOne(
      `SELECT COALESCE(SUM(amount),0) AS total FROM payments
       WHERE student_id=? AND academic_year=? AND (is_deleted IS NULL OR is_deleted=0)`,
      [f.student_id, year]);
    const required = (f.tuition_fee || 0) * 0.5 + (f.term_fee || 0);
    const paid = (paidRow && paidRow.total) || 0;
    return {
      student_id: f.student_id,
      academic_year: year,
      term1_cleared: paid >= required,
      updated_at: new Date().toISOString()
    };
  });

  const { error } = await supabase
    .from('cloud_student_fee_status')
    .upsert(rows, { onConflict: 'student_id' });

  if (error) console.error('[SYNC] Push fee status error:', error.message);
  else console.log(`[SYNC] Pushed fee status for ${rows.length} students.`);
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

// ── Push local Term 1/2 results → Supabase (one-way: term marksheets are
// only ever entered on the local system, never via the cloud portal, so
// there's nothing to pull back here — this exists purely so the parent
// portal can read Term 1/2 marks from the cloud too) ─────────────────────────
async function pushResults() {
  const results = query('SELECT * FROM results', []);
  if (!results.length) return;

  for (const r of results) {
    const subjects = query('SELECT * FROM result_subjects WHERE result_id=?', [r.id]);
    const resultData = {
      local_id: r.id,
      student_id: r.student_id,
      academic_year: r.academic_year || '2025-26',
      format: r.format || 'grade48',
      attendance_present: r.attendance_present || 0,
      attendance_total: r.attendance_total || 0,
      conduct: r.conduct || '',
      remarks: r.remarks || '',
      synced_at: new Date().toISOString()
    };

    const { data: upserted, error } = await supabase
      .from('cloud_results')
      .upsert(resultData, { onConflict: 'student_id,academic_year' })
      .select('id').single();

    if (error) { console.error('[SYNC] Push result error:', error.message); continue; }

    if (upserted && subjects.length) {
      await supabase.from('cloud_result_subjects').delete().eq('cloud_result_id', upserted.id);
      await supabase.from('cloud_result_subjects').insert(
        subjects.map(s => ({
          cloud_result_id: upserted.id,
          subject: s.subject,
          max1: s.max1 || '', min1: s.min1 || '', obtained1: s.obtained1 || '',
          max2: s.max2 || '', min2: s.min2 || '', obtained2: s.obtained2 || '',
          remark: s.remark || ''
        }))
      );
    }
  }
  console.log(`[SYNC] Pushed ${results.length} results to cloud.`);
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

  // Natural key, not local_id — a mark entered directly on the online
  // portal has no local_id yet, so upserting on local_id would try to
  // INSERT a second row for the same student/subject/test instead of
  // updating it, tripping the table's other unique constraint.
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const { error } = await supabase
      .from('cloud_unit_test_marks')
      .upsert(chunk, { onConflict: 'student_id,academic_year,test_name,subject' });
    if (error) console.error('[SYNC] Push unit test chunk error:', error.message);
  }
  console.log(`[SYNC] Pushed ${rows.length} unit test marks to cloud.`);
}

// ── Push local unit test remarks → Supabase ───────────────────────────────────
async function pushUnitTestRemarks() {
  const remarks = query('SELECT * FROM unit_test_remarks', []);
  if (!remarks.length) return;

  const rows = remarks.map(r => ({
    local_id: r.id,
    student_id: r.student_id,
    academic_year: r.academic_year,
    test_name: r.test_name,
    report_type: r.report_type || 'academic',
    remarks: r.remarks || '',
    recorded_by: r.created_by,
    synced_at: new Date().toISOString()
  }));

  const { error } = await supabase
    .from('cloud_unit_test_remarks')
    .upsert(rows, { onConflict: 'student_id,academic_year,test_name,report_type' });

  if (error) console.error('[SYNC] Push unit test remarks error:', error.message);
  else console.log(`[SYNC] Pushed ${rows.length} unit test remarks to cloud.`);
}

// ── Pull cloud report cards → local ───────────────────────────────────────────
async function pullReportCards() {
  // Fetch all unsynced report cards
  const { data: cards, error } = await supabase
    .from('cloud_report_cards')
    .select('*')
    .is('synced_at', null);

  if (error) { console.error('[SYNC] Fetch report cards error:', error.message, error.cause ? '| cause: '+JSON.stringify(error.cause) : ''); throw error; }
  if (!cards || cards.length === 0) return 0;

  // Reload from disk first — server.js may have persisted local edits since
  // this process last wrote, and persist() below would otherwise overwrite
  // the whole file with our (stale) in-memory copy and silently discard them.
  await _resetDb();

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

  if (error) { console.error('[SYNC] Fetch diary error:', error.message, error.cause ? '| cause: '+JSON.stringify(error.cause) : ''); throw error; }
  if (!entries || entries.length === 0) return 0;

  await _resetDb(); // see comment in pullReportCards

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

  if (error) { console.error('[SYNC] Fetch unit tests error:', error.message, error.cause ? '| cause: '+JSON.stringify(error.cause) : ''); throw error; }
  if (!entries || entries.length === 0) return 0;

  await _resetDb(); // see comment in pullReportCards

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

// ── Pull cloud unit test remarks → local ──────────────────────────────────────
async function pullUnitTestRemarks() {
  const { data: entries, error } = await supabase
    .from('cloud_unit_test_remarks')
    .select('*')
    .is('synced_at', null);

  if (error) { console.error('[SYNC] Fetch unit test remarks error:', error.message, error.cause ? '| cause: '+JSON.stringify(error.cause) : ''); throw error; }
  if (!entries || entries.length === 0) return 0;

  await _resetDb(); // see comment in pullReportCards

  let synced = 0;
  for (const en of entries) {
    try {
      const existing = queryOne(
        'SELECT id FROM unit_test_remarks WHERE student_id=? AND academic_year=? AND test_name=? AND report_type=?',
        [en.student_id, en.academic_year, en.test_name, en.report_type]
      );

      let localId;
      if (existing) {
        run('UPDATE unit_test_remarks SET remarks=?, created_by=?, updated_at=datetime(\'now\') WHERE id=?',
          [en.remarks || '', en.recorded_by, existing.id]);
        localId = existing.id;
      } else {
        const info = run(
          'INSERT INTO unit_test_remarks (student_id,academic_year,test_name,report_type,remarks,created_by) VALUES (?,?,?,?,?,?)',
          [en.student_id, en.academic_year, en.test_name, en.report_type, en.remarks || '', en.recorded_by]
        );
        localId = info.lastInsertRowid;
      }

      await supabase
        .from('cloud_unit_test_remarks')
        .update({ synced_at: new Date().toISOString(), local_id: localId })
        .eq('id', en.id);

      synced++;
    } catch(e) {
      console.error(`[SYNC] Error syncing unit test remark id=${en.id}:`, e.message);
    }
  }
  return synced;
}

// ── Pull cloud teacher registrations → local ──────────────────────────────────
// New teachers registering from the online portal land in
// cloud_teacher_registrations (staged there since it has no id relationship
// to cloud_users' local-assigned ids). Pulling them in as local `users` rows
// with status='pending' means they show up in the normal local admin
// approval screen — approval itself stays entirely local. Once approved,
// the existing pushUsers() picks them up and pushes them to cloud_users
// with the id the local system assigned.
async function pullTeacherRegistrations() {
  const { data: entries, error } = await supabase
    .from('cloud_teacher_registrations')
    .select('*')
    .is('synced_at', null);

  if (error) { console.error('[SYNC] Fetch teacher registrations error:', error.message, error.cause ? '| cause: '+JSON.stringify(error.cause) : ''); throw error; }
  if (!entries || entries.length === 0) return 0;

  await _resetDb(); // see comment in pullReportCards

  let synced = 0;
  for (const en of entries) {
    try {
      const existing = queryOne('SELECT id FROM users WHERE username=?', [en.username]);
      let localId;
      if (existing) {
        // Username already taken locally (race with a local registration,
        // or already handled) — leave the local row untouched, just mark
        // this cloud request as seen so it stops showing as pending.
        localId = existing.id;
      } else {
        const info = run(
          'INSERT INTO users (name,username,password_hash,role,status) VALUES (?,?,?,?,?)',
          [en.name, en.username, en.password_hash, 'teacher', 'pending']
        );
        localId = info.lastInsertRowid;
      }

      await supabase
        .from('cloud_teacher_registrations')
        .update({ synced_at: new Date().toISOString(), local_id: localId })
        .eq('id', en.id);

      synced++;
    } catch(e) {
      console.error(`[SYNC] Error syncing teacher registration id=${en.id}:`, e.message);
    }
  }
  return synced;
}

// ── Pull cloud parent registrations → local ───────────────────────────────────
// New parents registering from the online portal land in
// cloud_parent_registrations, validated there against cloud_students at
// submit time (same school+class+roll_no check as the local registration
// form). cloud_students.id is always the same as the local student's id
// (pushStudents() upserts using the local id directly), so
// parent_student_id can be used as-is with no remapping — unlike teacher
// registrations there's no local-id mismatch to bridge.
async function pullParentRegistrations() {
  const { data: entries, error } = await supabase
    .from('cloud_parent_registrations')
    .select('*')
    .is('synced_at', null);

  if (error) { console.error('[SYNC] Fetch parent registrations error:', error.message, error.cause ? '| cause: '+JSON.stringify(error.cause) : ''); throw error; }
  if (!entries || entries.length === 0) return 0;

  await _resetDb(); // see comment in pullReportCards

  let synced = 0;
  for (const en of entries) {
    try {
      const existing = queryOne('SELECT id FROM users WHERE username=?', [en.username]);
      let localId;
      if (existing) {
        // Username already taken locally (race with a local registration,
        // or already handled) — leave the local row untouched, just mark
        // this cloud request as seen so it stops showing as pending.
        localId = existing.id;
      } else {
        const info = run(
          `INSERT INTO users (name,username,password_hash,role,status,parent_student_id,parent_school,parent_class_name,parent_roll_no)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          [en.name, en.username, en.password_hash, 'parent', 'pending', en.parent_student_id, en.parent_school || '', en.parent_class_name || '', en.parent_roll_no || '']
        );
        localId = info.lastInsertRowid;
      }

      await supabase
        .from('cloud_parent_registrations')
        .update({ synced_at: new Date().toISOString(), local_id: localId })
        .eq('id', en.id);

      synced++;
    } catch(e) {
      console.error(`[SYNC] Error syncing parent registration id=${en.id}:`, e.message);
    }
  }
  return synced;
}

// ── Retry wrapper: retries a function up to 3 times with delay on fetch failure ──
async function withRetry(fn, label, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch(e) {
      if (attempt === maxRetries) {
        console.error(`[SYNC] ${label} failed after ${maxRetries} attempts:`, e.message);
        return 0;
      }
      console.log(`[SYNC] ${label} attempt ${attempt} failed (${e.message}), retrying in 3s...`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Main sync cycle ───────────────────────────────────────────────────────────
async function syncCycle() {
  const now = new Date().toLocaleTimeString('en-IN');
  console.log(`\n[SYNC] Starting sync at ${now}`);

  try {
    await pushStudents(); // cheap read+upsert; a locally-deleted student needs to disappear from the online portal quickly, not up to 30 min later
    await pushUsers(); // cheap read+upsert; a freshly-approved teacher needs this to log into the online portal, not up to 30 min later
    await pushUnitTestRemarks(); // cheap read+upsert; keeps the cloud backup close to real-time
    await pushFeeStatus(); // cheap read+upsert; a fee payment taken today should unlock the parent portal within this same 2-minute cycle

    const rcCount = await withRetry(() => pullReportCards(), 'Pull report cards');
    await delay(1000);
    const diaryCount = await withRetry(() => pullDiaryEntries(), 'Pull diary');
    await delay(1000);
    const utCount = await withRetry(() => pullUnitTests(), 'Pull unit tests');
    await delay(1000);
    const utrCount = await withRetry(() => pullUnitTestRemarks(), 'Pull unit test remarks');
    await delay(1000);
    const regCount = await withRetry(() => pullTeacherRegistrations(), 'Pull teacher registrations');
    await delay(1000);
    const parentRegCount = await withRetry(() => pullParentRegistrations(), 'Pull parent registrations');

    if (rcCount > 0 || diaryCount > 0 || utCount > 0 || utrCount > 0 || regCount > 0 || parentRegCount > 0) {
      console.log(`[SYNC] ✅ Synced: ${rcCount} report card(s), ${diaryCount} diary entry/entries, ${utCount} unit test mark(s), ${utrCount} unit test remark(s), ${regCount} teacher registration(s), ${parentRegCount} parent registration(s).`);
      await supabase.from('sync_log').insert({
        report_cards_synced: rcCount,
        diary_entries_synced: diaryCount,
        notes: `unit_tests: ${utCount}, unit_test_remarks: ${utrCount}, teacher_registrations: ${regCount}, parent_registrations: ${parentRegCount}`
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
  await pushResults();
  await pushDiaryEntries();
  await pushUnitTests();
  await pushUnitTestRemarks();
  await pushFeeStatus();

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
    await pushResults();
    await pushDiaryEntries();
    await pushUnitTests();
    await pushUnitTestRemarks();
    await pushFeeStatus();
  }, 30 * 60 * 1000);
}

start().catch(err => {
  console.error('Sync agent failed to start:', err);
  process.exit(1);
});
